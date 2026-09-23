import {BuildResultsService} from './results.js';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {FastifyInstance} from 'fastify';
import type {TaskStore} from '../../platform/store.js';
import type {EnvironmentService} from '../environment/environment.js';
import {shellQuote} from '../../infrastructure/ssh.js';
import type {SshOperations, SshTarget} from '../../infrastructure/ssh.js';
import {durableSse} from '../../infrastructure/sse.js';
import {noFileLogs} from '../../infrastructure/file-logs.js';
import type {LogSink} from '../../infrastructure/file-logs.js';

const CBB='https://szv-y.codehub.huawei.com/MAE-M/Common/CBB-Web-Dev.git';
const ARCH='https://szv-y.codehub.huawei.com/MAE-M/CI/ArchDesign.git';
const BUILD='mvn clean install -Dmaven.test.skip=true -Dbuild.package.type=DOCKER';
const modules=[
 ['mae-access','mae-access-base-features-charts/chartTool/charts'],['mae-common','mae-common-feature-charts/chartTool/charts'],
 ['mae-commonan','assurance-common-feature-charts/chartTool/charts'],['mae-datapulse','datapulse-charts/chartTool/charts'],
 ['mae-devicehealthcheck','devicehealthcheck-charts/chartTool/charts'],['mae-fmemate','fmemate-charts/chartTool/charts'],
 ['mae-ifaultcare','ifaultcare-charts/chartTool/charts'],['mae-optimization','optimization-feature-charts/chartTool/charts']
] as const;
export interface BuildModule {name:string;chartsPath:string;archDirectory:string}
export const buildModules: BuildModule[]=modules.map(([name,chartsPath])=>({name,chartsPath,archDirectory:`Chart/${name}`}));
const branch=z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/).refine(v=>!v.includes('..')&&!v.includes('//')&&!v.endsWith('/')&&!v.endsWith('.'),'分支名称格式不正确');
const businessRepository=z.object({repository:z.string().trim().max(500).regex(/^(?:https:\/\/[A-Za-z0-9.-]+(?::[0-9]+)?\/|ssh:\/\/git@[A-Za-z0-9.-]+(?::[0-9]+)?\/|git@[A-Za-z0-9.-]+:)[A-Za-z0-9_-][A-Za-z0-9._/-]*\.git$/).refine(v=>!v.includes('..')&&!v.replace(/^[a-z]+:\/\//,'').includes('//'),'仓库地址格式不正确'),branch:branch.default('master')}).strict();
const branches=z.object({cbbWebDevBranch:branch.default('master'),archDesignBranch:branch.default('master'),businessRepositories:z.array(businessRepository).max(100).optional()}).strict();
const startInput=z.object({mode:z.enum(['SINGLE','COMPARE']),environmentId:z.number().int().positive(),module:z.string(),baseline:branches,candidate:branches.nullable().optional()}).strict()
  .refine(v=>v.mode!=='COMPARE'||v.candidate!=null,'双分支构建必须填写验证版本分支');
type BuildStatus='PENDING'|'RUNNING'|'SUCCEEDED'|'FAILED'; type StepStatus='PENDING'|'RUNNING'|'SUCCEEDED'|'FAILED'|'SKIPPED';
interface BuildEvent {sequence:number;occurredAt:string;type:'TASK'|'STEP'|'LOG';stepId:string|null;message:string;progress:number;taskStatus:BuildStatus}
interface BuildStep {id:string;label:string;status:StepStatus}
export interface BuildTask {id:string;mode:'SINGLE'|'COMPARE';environmentId:number;environmentName:string;module:string;baseline:z.infer<typeof branches>;candidate:z.infer<typeof branches>|null;
 status:BuildStatus;progress:number;error:string|null;createdAt:string;startedAt:string|null;finishedAt:string|null;workspaceRoot:string;steps:BuildStep[];events:BuildEvent[];sequence:number;completedSteps:number}
export interface BuildArtifact {id:number;buildTaskId:string;buildEnvironmentId:number;module:string;cbbWebDevBranch:string;archDesignBranch:string;remoteTaskRoot:string;remoteArchDesignRoot:string;remoteModuleRoot:string;remoteChartsRoot:string;createdAt:string}

export class BuildService {
  private readonly results:BuildResultsService;
  private readonly deleting=new Set<string>();
  private readonly executions=new Map<string,Promise<void>>();
  private readonly controllers=new Map<string,AbortController>();
  constructor(private readonly store:TaskStore,private readonly environments:EnvironmentService,private readonly ssh:SshOperations,private readonly logs:LogSink=noFileLogs) {
    this.results=new BuildResultsService(store,environments,ssh);
    for(const task of store.records<BuildTask>('build-task').filter(item=>!['SUCCEEDED','FAILED'].includes(item.status))) this.fail(task,'服务重启，原构建进程状态已丢失，任务按整体失败处理');
  }
  configuration(){return {cbbWebDevRepository:CBB,archDesignRepository:ARCH,defaultBranch:'master',buildCommand:BUILD,modules:buildModules.map(({name,chartsPath})=>({name,chartsPath}))};}
  get(id:string){const task=this.store.getRecord<BuildTask>('build-task',id);if(!task)throw Object.assign(new Error('构建任务不存在或服务已重启'),{statusCode:404});return task;}
  list(){return this.store.records<BuildTask>('build-task').map(task=>this.response(task,true));}
  artifacts(){return this.store.records<BuildArtifact>('build-artifact').filter(a=>{const task=this.store.getRecord<BuildTask>('build-task',a.buildTaskId);return task?.mode==='SINGLE'&&task.status==='SUCCEEDED';})
    .map(({remoteTaskRoot:_r,remoteArchDesignRoot:_a,remoteModuleRoot:_m,...rest})=>rest);}
  artifact(id:number){const artifact=this.store.records<BuildArtifact>('build-artifact').find(item=>item.id===id),task=artifact&&this.store.getRecord<BuildTask>('build-task',artifact.buildTaskId);if(!artifact||task?.mode!=='SINGLE'||task.status!=='SUCCEEDED')throw Object.assign(new Error('构建产物不存在或关联构建任务并未成功'),{statusCode:404});return artifact;}
  start(input:unknown){const value=startInput.parse(input);const environment=this.environments.get(value.environmentId);if(environment.type!=='BUILD')throw Object.assign(new Error('构建任务只能选择构建环境'),{statusCode:400});
    if(!environment.workDirectory)throw Object.assign(new Error('构建环境未配置工作目录'),{statusCode:400});
    const module=buildModules.find(item=>item.name===value.module);if(!module)throw Object.assign(new Error('构建模块不存在'),{statusCode:400});
    const id=randomUUID(),root=String(environment.workDirectory).replace(/\/+$/,'')+`/container-ops-kit/builds/${id}`;
    const task:BuildTask={id,mode:value.mode,environmentId:environment.id,environmentName:String(environment.name),module:module.name,baseline:value.baseline,candidate:value.candidate??null,status:'PENDING',progress:0,error:null,
      createdAt:new Date().toISOString(),startedAt:null,finishedAt:null,workspaceRoot:root,steps:this.steps(value.mode,value.baseline,value.candidate),events:[],sequence:0,completedSteps:0};
    this.event(task,'TASK',null,'构建任务已创建');this.save(task);const controller=new AbortController();this.controllers.set(id,controller);const execution=this.execute(task,module,this.environments.target(environment),controller.signal);this.executions.set(id,execution);void execution.finally(()=>this.executions.delete(id));return this.response(task);
  }
  response(task:BuildTask,summary=false){if(summary){const {mode,environmentId,environmentName,module,status,progress,error,createdAt,finishedAt,workspaceRoot}=task;return{id:task.id,mode,environmentId,environmentName,module,status,progress,error,createdAt,finishedAt,workspaceRoot};}
    const root=task.workspaceRoot;const directories=task.mode==='SINGLE'?[{label:'CBB-Web-Dev',path:`${root}/single/CBB-Web-Dev/chart-codegen-plugin`},{label:task.module,path:`${root}/single/ArchDesign/Chart/${task.module}`}]:[
      {label:'基准 · CBB-Web-Dev',path:`${root}/baseline/CBB-Web-Dev/chart-codegen-plugin`},{label:`基准 · ${task.module}`,path:`${root}/baseline/ArchDesign/Chart/${task.module}`},
      {label:'验证 · CBB-Web-Dev',path:`${root}/candidate/CBB-Web-Dev/chart-codegen-plugin`},{label:`验证 · ${task.module}`,path:`${root}/candidate/ArchDesign/Chart/${task.module}`}];
    for(const [side,input] of task.mode==='SINGLE'?[['single',task.baseline] as const]:[['baseline',task.baseline] as const,['candidate',task.candidate] as const]){
      (input?.businessRepositories??[]).forEach((repo,i)=>directories.push({label:`${side} · ${repo.repository.split(/[/:]/).at(-1)}/chart`,path:`${root}/${side}/business-${i}/chart`}));
    }
    const {sequence:_s,completedSteps:_c,...base}=task;return{...base,directories};
  }
  private resultTask(id:string){
    if(this.deleting.has(id))throw Object.assign(new Error('任务正在删除'),{statusCode:409});
    const task=this.get(id),module=buildModules.find(m=>m.name===task.module);
    if(!module)throw Object.assign(new Error('构建模块不存在'),{statusCode:409});
    if(task.status!=='SUCCEEDED')throw Object.assign(new Error('构建尚未成功，暂不可读取产物'),{statusCode:409});
    return {task,module};
  }
  result(id:string){const {task,module}=this.resultTask(id);return this.results.inspect(task,module);}
  download(id:string,query:unknown,signal?:AbortSignal){const {task,module}=this.resultTask(id);return this.results.download(task,module,query,signal);}
  async storage(environmentId:number){const environment=this.environments.get(environmentId);if(environment.type!=='BUILD')throw Object.assign(new Error('构建任务只能选择构建环境'),{statusCode:400});
    const path=String(environment.workDirectory??'').replace(/\/+$/,'');if(!path)throw Object.assign(new Error('构建环境未配置工作目录'),{statusCode:409});
    const result=await this.ssh.execute(this.environments.target(environment),`du -sk ${shellQuote(path)} 2>/dev/null | awk '{print "DU " $1}'; df -Pk ${shellQuote(path)} 2>/dev/null | tail -1 | awk '{print "DF " $2 " " $4 " " $5}'`);
    if(result.exitCode!==0)throw Object.assign(new Error('无法读取构建工作目录存储占用'),{statusCode:409});let used=0,total=0,available=0,filesystemUsage='—';
    for(const line of result.lines){const c=line.trim().split(/\s+/);if(c[0]==='DU')used=(Number(c[1])||0)*1024;if(c[0]==='DF'){total=(Number(c[1])||0)*1024;available=(Number(c[2])||0)*1024;filesystemUsage=c[3]??'—';}}
    if(!used&&!total)throw Object.assign(new Error(`${path} 不存在或不可读取`),{statusCode:409});return{path,usedBytes:used,filesystemBytes:total,availableBytes:available,filesystemUsage};
  }
  async delete(id:string,deleteWorkspace:boolean){const task=this.get(id);if(!['SUCCEEDED','FAILED'].includes(task.status))throw Object.assign(new Error('运行中的构建任务不能删除'),{statusCode:409});
    if(this.deleting.has(id)||this.results.busy(id))throw Object.assign(new Error('构建产物正在读取或下载，请稍后删除'),{statusCode:409});
    this.deleting.add(id);try{
    if(deleteWorkspace){const suffix=`/container-ops-kit/builds/${id}`;if(!task.workspaceRoot.endsWith(suffix))throw Object.assign(new Error('任务工作目录不合法，拒绝清理'),{statusCode:409});
      const result=await this.ssh.execute(this.environments.target(this.environments.get(task.environmentId)),`rm -rf -- ${shellQuote(task.workspaceRoot)}`);if(result.exitCode!==0)throw Object.assign(new Error('远端构建目录清理失败'),{statusCode:409});}
    this.results.remove(id);this.store.deleteRecord('build-artifact',id);this.store.deleteRecord('build-task',id);
    }finally{this.deleting.delete(id);}
  }
  events(id:string,after:number){return this.get(id).events.filter(e=>e.sequence>after);}
  terminal(id:string){return ['SUCCEEDED','FAILED'].includes(this.get(id).status);}
  async close(){for(const controller of this.controllers.values())controller.abort();await this.results.close();await Promise.allSettled(this.executions.values());}
  private steps(mode:'SINGLE'|'COMPARE',baseline:z.infer<typeof branches>,candidate?:z.infer<typeof branches>|null){
    const values:BuildStep[]=[];
    const add=(side:string,label:string,input:z.infer<typeof branches>)=>{
      const step=(id:string,name:string)=>values.push({id:`${side}:${id}`,label:`${label} · ${name}`,status:'PENDING'});
      step('prepare','准备目录');step('clone-cbb','检出 CBB-Web-Dev');step('build-cbb','构建 CBB-Web-Dev');
      (input.businessRepositories??[]).forEach((repo,i)=>{const name=repo.repository.split(/[/:]/).at(-1)!.replace(/\.git$/,'');step(`clone-business-${i}`,`检出业务仓 ${name}`);step(`build-business-${i}`,`构建业务仓 ${name}/chart`);});
      step('clone-arch','检出 ArchDesign');step('build-arch','构建 ArchDesign');
    };
    if(mode==='SINGLE'){add('single','单分支',baseline);values.push({id:'single:results',label:'读取服务构建包',status:'PENDING'});}else{add('baseline','基准版本 A',baseline);add('candidate','验证版本 B',candidate!);values.push({id:'compare:diff',label:'对比 ArchDesign 产物',status:'PENDING'});}return values;
  }
  private save(task:BuildTask){this.store.putRecord('build-task',task.id,task,task.createdAt);}
  private event(task:BuildTask,type:BuildEvent['type'],stepId:string|null,message:string){task.events.push({sequence:++task.sequence,occurredAt:new Date().toISOString(),type,stepId,message,progress:task.progress,taskStatus:task.status});
    this.logs.task('build',task.id,task.events.at(-1));
    while(task.events.length>10000){const index=task.events.findIndex(e=>e.type==='LOG');if(index<0)break;task.events.splice(index,1);}}
  private setStep(task:BuildTask,id:string,status:StepStatus,message?:string){const step=task.steps.find(item=>item.id===id);if(!step)throw new Error('构建步骤不存在');step.status=status;
    if(status==='SUCCEEDED'){task.completedSteps++;task.progress=Math.min(100,Math.floor(task.completedSteps*100/task.steps.length));}this.event(task,'STEP',id,message??`${step.label}${status==='RUNNING'?'开始':'完成'}`);this.save(task);}
  private fail(task:BuildTask,message:string){task.status='FAILED';task.error=message;task.finishedAt=new Date().toISOString();for(const step of task.steps)step.status=step.status==='PENDING'?'SKIPPED':step.status==='RUNNING'?'FAILED':step.status;this.event(task,'TASK',null,message);this.save(task);}
  private async execute(task:BuildTask,module:BuildModule,target:SshTarget,signal:AbortSignal){task.status='RUNNING';task.startedAt=new Date().toISOString();this.event(task,'TASK',null,'构建任务开始执行');this.save(task);
    try{let ok;if(task.mode==='SINGLE')ok=await this.branch(task,target,`${task.workspaceRoot}/single`,'single',module,task.baseline,signal);else{const [a,b]=await Promise.all([this.branch(task,target,`${task.workspaceRoot}/baseline`,'baseline',module,task.baseline,signal),this.branch(task,target,`${task.workspaceRoot}/candidate`,'candidate',module,task.candidate!,signal)]);ok=a&&b&&await this.diff(task,target,module,signal);}
      if(ok){if(task.mode==='SINGLE'){this.setStep(task,'single:results','RUNNING');await this.results.inspect(task,module,target,signal);this.setStep(task,'single:results','SUCCEEDED');const remoteArchDesignRoot=`${task.workspaceRoot}/single/ArchDesign`,remoteModuleRoot=`${remoteArchDesignRoot}/${module.archDirectory}`,id=Math.max(Date.now(),...this.store.records<BuildArtifact>('build-artifact').map(item=>item.id+1));const artifact:BuildArtifact={id,buildTaskId:task.id,buildEnvironmentId:task.environmentId,module:module.name,cbbWebDevBranch:task.baseline.cbbWebDevBranch,archDesignBranch:task.baseline.archDesignBranch,remoteTaskRoot:task.workspaceRoot,remoteArchDesignRoot,remoteModuleRoot,remoteChartsRoot:`${remoteModuleRoot}/target/${module.chartsPath}`,createdAt:new Date().toISOString()};this.store.putRecord('build-artifact',task.id,artifact,artifact.createdAt);}
        task.status='SUCCEEDED';task.progress=100;task.finishedAt=new Date().toISOString();this.event(task,'TASK',null,'构建任务执行成功');this.save(task);}else if(!['SUCCEEDED','FAILED'].includes(task.status))this.fail(task,'构建失败');}
    catch(error){this.fail(task,error instanceof Error?error.message:'构建执行异常');}finally{this.controllers.delete(task.id);}}
  private async runStep(task:BuildTask,target:SshTarget,id:string,label:string,command:string,signal:AbortSignal,accept:(code:number)=>boolean=(code:number)=>code===0){this.setStep(task,id,'RUNNING');try{const result=await this.ssh.execute(target,command,line=>{if(line.trim()){this.event(task,'LOG',id,line);this.save(task);}},signal);if(accept(result.exitCode)){this.setStep(task,id,'SUCCEEDED');return true;}this.setStep(task,id,'FAILED',`${label}失败，退出码 ${result.exitCode}`);return false;}catch(error){this.setStep(task,id,'FAILED',error instanceof Error?error.message:`${label}失败`);return false;}}
  private clone(repository:string,name:string,directory:string){return`GIT_TERMINAL_PROMPT=0 git clone --single-branch --branch ${shellQuote(name)} ${shellQuote(repository)} ${shellQuote(directory)}`;}
  private async branch(task:BuildTask,target:SshTarget,directory:string,side:string,module:BuildModule,value:z.infer<typeof branches>,signal:AbortSignal){
    if(!await this.runStep(task,target,`${side}:prepare`,'创建远端工作目录',`mkdir -p ${shellQuote(directory)}`,signal))return false;
    const cbb=`${directory}/CBB-Web-Dev`,arch=`${directory}/ArchDesign`;
    const command=BUILD+(task.mode==='COMPARE'?` -Dmaven.repo.local=${shellQuote(`${directory}/.m2/repository`)}`:'');
    if(!await this.runStep(task,target,`${side}:clone-cbb`,'检出 CBB-Web-Dev',this.clone(CBB,value.cbbWebDevBranch,cbb),signal))return false;
    if(!await this.runStep(task,target,`${side}:build-cbb`,'构建 CBB-Web-Dev',`cd ${shellQuote(`${cbb}/chart-codegen-plugin`)} && ${command}`,signal))return false;
    for(const [i,repo] of (value.businessRepositories??[]).entries()){
      const path=`${directory}/business-${i}`;
      if(!await this.runStep(task,target,`${side}:clone-business-${i}`,'检出业务仓',this.clone(repo.repository,repo.branch,path),signal))return false;
      if(!await this.runStep(task,target,`${side}:build-business-${i}`,'构建业务仓 chart',`cd ${shellQuote(`${path}/chart`)} && ${command}`,signal))return false;
    }
    if(!await this.runStep(task,target,`${side}:clone-arch`,'检出 ArchDesign',this.clone(ARCH,value.archDesignBranch,arch),signal))return false;
    return this.runStep(task,target,`${side}:build-arch`,'构建 ArchDesign',`cd ${shellQuote(`${arch}/${module.archDirectory}`)} && ${command}`,signal);}
  private async diff(task:BuildTask,target:SshTarget,module:BuildModule,signal:AbortSignal){
    this.setStep(task,'compare:diff','RUNNING');
    try{const result=await this.results.inspect(task,module,target,signal);const changed=result.comparison?.filter(s=>s.status!=='UNCHANGED').length??0;
      this.setStep(task,'compare:diff','SUCCEEDED',`产物对比完成：${result.comparison?.length??0} 个服务，${changed} 个有差异`);return true;
    }catch(error){this.setStep(task,'compare:diff','FAILED',error instanceof Error?error.message:'产物对比失败');throw error;}
  }

}

export function buildRoutes(app:FastifyInstance,service:BuildService):void{
 const taskId=(p:unknown)=>z.object({id:z.uuid()}).parse(p).id;const environmentId=(p:unknown)=>z.object({id:z.coerce.number().int().positive()}).parse(p).id;
 app.get('/api/build-configuration',async()=>service.configuration());app.get('/api/build-artifacts',async()=>service.artifacts());
 app.post('/api/build-tasks',async(req,reply)=>reply.code(202).send(service.start(req.body)));app.get('/api/build-tasks',async()=>service.list());
 app.get('/api/build-tasks/:id',async req=>service.response(service.get(taskId(req.params))));
 app.get('/api/build-tasks/:id/results',async req=>service.result(taskId(req.params)));
 app.get('/api/build-tasks/:id/packages',async(req,reply)=>{
   const controller=new AbortController();const abort=()=>controller.abort();reply.raw.once('close',abort);
   try{const {stream,filename}=await service.download(taskId(req.params),req.query,controller.signal);
     stream.once('close',()=>reply.raw.removeListener('close',abort));
     return reply.type('application/gzip').header('Content-Disposition',`attachment; filename="build-packages.tar.gz"; filename*=UTF-8''${encodeURIComponent(filename)}`).header('Cache-Control','no-store').send(stream);
   }catch(error){reply.raw.removeListener('close',abort);throw error;}
 });
 app.get('/api/build-tasks/:id/diff-report',async(req,reply)=>{
   const id=taskId(req.params),result=await service.result(id);
   if(!result.comparison)throw Object.assign(new Error('单分支任务没有差异报告'),{statusCode:400});
   return reply.type('application/json').header('Content-Disposition',`attachment; filename="build-diff-${id}.json"`).send(JSON.stringify(result,null,2));
 });
 app.delete('/api/build-tasks/:id',async(req,reply)=>{const {deleteWorkspace}=z.object({deleteWorkspace:z.stringbool().default(false)}).parse(req.query);await service.delete(taskId(req.params),deleteWorkspace);return reply.code(204).send();});
 app.get('/api/build-environments/:id/storage',async req=>service.storage(environmentId(req.params)));
 app.get('/api/build-tasks/:id/events',async(req,reply)=>{const id=taskId(req.params);service.get(id);const after=z.coerce.number().int().min(0).parse(req.headers['last-event-id']??0);durableSse(reply,n=>service.events(id,n),()=>service.terminal(id),after);});
}
