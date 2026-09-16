import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {FastifyInstance} from 'fastify';
import type {TaskStore} from '../../platform/store.js';
import type {EnvironmentService} from '../environment/environment.js';
import {shellQuote} from '../../infrastructure/ssh.js';
import type {SshOperations, SshTarget} from '../../infrastructure/ssh.js';
import {durableSse} from '../../infrastructure/sse.js';

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
const branches=z.object({cbbWebDevBranch:branch.default('master'),archDesignBranch:branch.default('master')}).strict();
const startInput=z.object({mode:z.enum(['SINGLE','COMPARE']),environmentId:z.number().int().positive(),module:z.string(),baseline:branches,candidate:branches.nullable().optional()}).strict()
  .refine(v=>v.mode!=='COMPARE'||v.candidate!=null,'双分支构建必须填写验证版本分支');
type BuildStatus='PENDING'|'RUNNING'|'SUCCEEDED'|'FAILED'; type StepStatus='PENDING'|'RUNNING'|'SUCCEEDED'|'FAILED'|'SKIPPED';
interface BuildEvent {sequence:number;occurredAt:string;type:'TASK'|'STEP'|'LOG';stepId:string|null;message:string;progress:number;taskStatus:BuildStatus}
interface BuildStep {id:string;label:string;status:StepStatus}
export interface BuildTask {id:string;mode:'SINGLE'|'COMPARE';environmentId:number;environmentName:string;module:string;baseline:z.infer<typeof branches>;candidate:z.infer<typeof branches>|null;
 status:BuildStatus;progress:number;error:string|null;createdAt:string;startedAt:string|null;finishedAt:string|null;workspaceRoot:string;steps:BuildStep[];events:BuildEvent[];sequence:number;completedSteps:number}
export interface BuildArtifact {id:number;buildTaskId:string;buildEnvironmentId:number;module:string;cbbWebDevBranch:string;archDesignBranch:string;remoteTaskRoot:string;remoteArchDesignRoot:string;remoteModuleRoot:string;remoteChartsRoot:string;createdAt:string}

export class BuildService {
  private readonly controllers=new Map<string,AbortController>();
  constructor(private readonly store:TaskStore,private readonly environments:EnvironmentService,private readonly ssh:SshOperations) {
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
      createdAt:new Date().toISOString(),startedAt:null,finishedAt:null,workspaceRoot:root,steps:this.steps(value.mode),events:[],sequence:0,completedSteps:0};
    this.event(task,'TASK',null,'构建任务已创建');this.save(task);const controller=new AbortController();this.controllers.set(id,controller);void this.execute(task,module,this.environments.target(environment),controller.signal);return this.response(task);
  }
  response(task:BuildTask,summary=false){if(summary){const {mode,environmentId,environmentName,module,status,progress,error,createdAt,finishedAt,workspaceRoot}=task;return{id:task.id,mode,environmentId,environmentName,module,status,progress,error,createdAt,finishedAt,workspaceRoot};}
    const root=task.workspaceRoot;const directories=task.mode==='SINGLE'?[{label:'CBB-Web-Dev',path:`${root}/single/CBB-Web-Dev/chart-codegen-plugin`},{label:task.module,path:`${root}/single/ArchDesign/Chart/${task.module}`}]:[
      {label:'基准 · CBB-Web-Dev',path:`${root}/baseline/CBB-Web-Dev/chart-codegen-plugin`},{label:`基准 · ${task.module}`,path:`${root}/baseline/ArchDesign/Chart/${task.module}`},
      {label:'验证 · CBB-Web-Dev',path:`${root}/candidate/CBB-Web-Dev/chart-codegen-plugin`},{label:`验证 · ${task.module}`,path:`${root}/candidate/ArchDesign/Chart/${task.module}`}];
    const {sequence:_s,completedSteps:_c,...base}=task;return{...base,directories};
  }
  async storage(environmentId:number){const environment=this.environments.get(environmentId);if(environment.type!=='BUILD')throw Object.assign(new Error('构建任务只能选择构建环境'),{statusCode:400});
    const path=String(environment.workDirectory??'').replace(/\/+$/,'');if(!path)throw Object.assign(new Error('构建环境未配置工作目录'),{statusCode:409});
    const result=await this.ssh.execute(this.environments.target(environment),`du -sk ${shellQuote(path)} 2>/dev/null | awk '{print "DU " $1}'; df -Pk ${shellQuote(path)} 2>/dev/null | tail -1 | awk '{print "DF " $2 " " $4 " " $5}'`);
    if(result.exitCode!==0)throw Object.assign(new Error('无法读取构建工作目录存储占用'),{statusCode:409});let used=0,total=0,available=0,filesystemUsage='—';
    for(const line of result.lines){const c=line.trim().split(/\s+/);if(c[0]==='DU')used=(Number(c[1])||0)*1024;if(c[0]==='DF'){total=(Number(c[1])||0)*1024;available=(Number(c[2])||0)*1024;filesystemUsage=c[3]??'—';}}
    if(!used&&!total)throw Object.assign(new Error(`${path} 不存在或不可读取`),{statusCode:409});return{path,usedBytes:used,filesystemBytes:total,availableBytes:available,filesystemUsage};
  }
  async delete(id:string,deleteWorkspace:boolean){const task=this.get(id);if(!['SUCCEEDED','FAILED'].includes(task.status))throw Object.assign(new Error('运行中的构建任务不能删除'),{statusCode:409});
    if(deleteWorkspace){const suffix=`/container-ops-kit/builds/${id}`;if(!task.workspaceRoot.endsWith(suffix))throw Object.assign(new Error('任务工作目录不合法，拒绝清理'),{statusCode:409});
      const result=await this.ssh.execute(this.environments.target(this.environments.get(task.environmentId)),`rm -rf -- ${shellQuote(task.workspaceRoot)}`);if(result.exitCode!==0)throw Object.assign(new Error('远端构建目录清理失败'),{statusCode:409});}
    this.store.deleteRecord('build-artifact',id);this.store.deleteRecord('build-task',id);
  }
  events(id:string,after:number){return this.get(id).events.filter(e=>e.sequence>after);}
  terminal(id:string){return ['SUCCEEDED','FAILED'].includes(this.get(id).status);}
  async close(){for(const controller of this.controllers.values())controller.abort();}
  private steps(mode:'SINGLE'|'COMPARE'){const values:BuildStep[]=[];const add=(side:string,label:string)=>['准备目录','检出 CBB-Web-Dev','构建 CBB-Web-Dev','检出 ArchDesign','构建 ArchDesign'].forEach((name,i)=>values.push({id:`${side}:${['prepare','clone-cbb','build-cbb','clone-arch','build-arch'][i]}`,label:`${label} · ${name}`,status:'PENDING'}));
    if(mode==='SINGLE')add('single','单分支');else{add('baseline','基准版本 A');add('candidate','验证版本 B');values.push({id:'compare:diff',label:'对比 ArchDesign 产物',status:'PENDING'});}return values;}
  private save(task:BuildTask){this.store.putRecord('build-task',task.id,task,task.createdAt);}
  private event(task:BuildTask,type:BuildEvent['type'],stepId:string|null,message:string){task.events.push({sequence:++task.sequence,occurredAt:new Date().toISOString(),type,stepId,message,progress:task.progress,taskStatus:task.status});
    while(task.events.length>10000){const index=task.events.findIndex(e=>e.type==='LOG');if(index<0)break;task.events.splice(index,1);}}
  private setStep(task:BuildTask,id:string,status:StepStatus,message?:string){const step=task.steps.find(item=>item.id===id);if(!step)throw new Error('构建步骤不存在');step.status=status;
    if(status==='SUCCEEDED'){task.completedSteps++;task.progress=Math.min(100,Math.floor(task.completedSteps*100/task.steps.length));}this.event(task,'STEP',id,message??`${step.label}${status==='RUNNING'?'开始':'完成'}`);this.save(task);}
  private fail(task:BuildTask,message:string){task.status='FAILED';task.error=message;task.finishedAt=new Date().toISOString();for(const step of task.steps)step.status=step.status==='PENDING'?'SKIPPED':step.status==='RUNNING'?'FAILED':step.status;this.event(task,'TASK',null,message);this.save(task);}
  private async execute(task:BuildTask,module:BuildModule,target:SshTarget,signal:AbortSignal){task.status='RUNNING';task.startedAt=new Date().toISOString();this.event(task,'TASK',null,'构建任务开始执行');this.save(task);
    try{let ok;if(task.mode==='SINGLE')ok=await this.branch(task,target,`${task.workspaceRoot}/single`,'single',module,task.baseline,signal);else{const [a,b]=await Promise.all([this.branch(task,target,`${task.workspaceRoot}/baseline`,'baseline',module,task.baseline,signal),this.branch(task,target,`${task.workspaceRoot}/candidate`,'candidate',module,task.candidate!,signal)]);ok=a&&b&&await this.diff(task,target,module,signal);}
      if(ok){if(task.mode==='SINGLE'){const remoteArchDesignRoot=`${task.workspaceRoot}/single/ArchDesign`,remoteModuleRoot=`${remoteArchDesignRoot}/${module.archDirectory}`,id=Math.max(Date.now(),...this.store.records<BuildArtifact>('build-artifact').map(item=>item.id+1));const artifact:BuildArtifact={id,buildTaskId:task.id,buildEnvironmentId:task.environmentId,module:module.name,cbbWebDevBranch:task.baseline.cbbWebDevBranch,archDesignBranch:task.baseline.archDesignBranch,remoteTaskRoot:task.workspaceRoot,remoteArchDesignRoot,remoteModuleRoot,remoteChartsRoot:`${remoteModuleRoot}/target/${module.chartsPath}`,createdAt:new Date().toISOString()};this.store.putRecord('build-artifact',task.id,artifact,artifact.createdAt);}
        task.status='SUCCEEDED';task.progress=100;task.finishedAt=new Date().toISOString();this.event(task,'TASK',null,'构建任务执行成功');this.save(task);}else if(!['SUCCEEDED','FAILED'].includes(task.status))this.fail(task,'构建失败');}
    catch(error){this.fail(task,error instanceof Error?error.message:'构建执行异常');}finally{this.controllers.delete(task.id);}}
  private async runStep(task:BuildTask,target:SshTarget,id:string,label:string,command:string,signal:AbortSignal,accept:(code:number)=>boolean=(code:number)=>code===0){this.setStep(task,id,'RUNNING');try{const result=await this.ssh.execute(target,command,line=>{if(line.trim()){this.event(task,'LOG',id,line);this.save(task);}},signal);if(accept(result.exitCode)){this.setStep(task,id,'SUCCEEDED');return true;}this.setStep(task,id,'FAILED',`${label}失败，退出码 ${result.exitCode}`);return false;}catch(error){this.setStep(task,id,'FAILED',error instanceof Error?error.message:`${label}失败`);return false;}}
  private clone(repository:string,name:string,directory:string){return`GIT_TERMINAL_PROMPT=0 git clone --single-branch --branch ${shellQuote(name)} ${shellQuote(repository)} ${shellQuote(directory)}`;}
  private async branch(task:BuildTask,target:SshTarget,directory:string,side:string,module:BuildModule,value:z.infer<typeof branches>,signal:AbortSignal){
    if(!await this.runStep(task,target,`${side}:prepare`,'创建远端工作目录',`mkdir -p ${shellQuote(directory)}`,signal))return false;
    const cbb=`${directory}/CBB-Web-Dev`,arch=`${directory}/ArchDesign`;
    if(!await this.runStep(task,target,`${side}:clone-cbb`,'检出 CBB-Web-Dev',this.clone(CBB,value.cbbWebDevBranch,cbb),signal))return false;
    if(!await this.runStep(task,target,`${side}:build-cbb`,'构建 CBB-Web-Dev',`cd ${shellQuote(`${cbb}/chart-codegen-plugin`)} && ${BUILD}`,signal))return false;
    if(!await this.runStep(task,target,`${side}:clone-arch`,'检出 ArchDesign',this.clone(ARCH,value.archDesignBranch,arch),signal))return false;
    return this.runStep(task,target,`${side}:build-arch`,'构建 ArchDesign',`cd ${shellQuote(`${arch}/${module.archDirectory}`)} && ${BUILD}`,signal);}
  private diff(task:BuildTask,target:SshTarget,module:BuildModule,signal:AbortSignal){const root=task.workspaceRoot;return this.runStep(task,target,'compare:diff','产物对比',`diff -ru --exclude=.git ${shellQuote(`${root}/baseline/ArchDesign/${module.archDirectory}/target/${module.chartsPath}`)} ${shellQuote(`${root}/candidate/ArchDesign/${module.archDirectory}/target/${module.chartsPath}`)}`,signal,code=>code<=1);}
}

export function buildRoutes(app:FastifyInstance,service:BuildService):void{
 const taskId=(p:unknown)=>z.object({id:z.uuid()}).parse(p).id;const environmentId=(p:unknown)=>z.object({id:z.coerce.number().int().positive()}).parse(p).id;
 app.get('/api/build-configuration',async()=>service.configuration());app.get('/api/build-artifacts',async()=>service.artifacts());
 app.post('/api/build-tasks',async(req,reply)=>reply.code(202).send(service.start(req.body)));app.get('/api/build-tasks',async()=>service.list());
 app.get('/api/build-tasks/:id',async req=>service.response(service.get(taskId(req.params))));
 app.delete('/api/build-tasks/:id',async(req,reply)=>{const {deleteWorkspace}=z.object({deleteWorkspace:z.stringbool().default(false)}).parse(req.query);await service.delete(taskId(req.params),deleteWorkspace);return reply.code(204).send();});
 app.get('/api/build-environments/:id/storage',async req=>service.storage(environmentId(req.params)));
 app.get('/api/build-tasks/:id/events',async(req,reply)=>{const id=taskId(req.params);service.get(id);const after=z.coerce.number().int().min(0).parse(req.headers['last-event-id']??0);durableSse(reply,n=>service.events(id,n),()=>service.terminal(id),after);});
}
