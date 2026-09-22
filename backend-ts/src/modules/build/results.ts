import {z} from 'zod';
import {posix} from 'node:path';
import type {TaskStore} from '../../platform/store.js';
import type {EnvironmentService} from '../environment/environment.js';
import {shellQuote,type SshOperations,type SshTarget} from '../../infrastructure/ssh.js';
import type {BuildModule,BuildTask} from './build.js';
import {remoteResultsScript} from './remote-results.js';

const serviceName=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/);
const packageSchema=z.object({service:serviceName,kind:z.enum(['directory','archive']),filename:z.string().min(1).max(255).refine(s=>!/[\\/\r\n\x00-\x1f]/.test(s)),size:z.number().nonnegative(),version:z.string().max(200)});
const fileSchema=z.object({path:z.string().max(4096),status:z.enum(['ADDED','REMOVED','MODIFIED']),binary:z.boolean(),truncated:z.boolean(),patch:z.string().max(64000),beforeBytes:z.number().nonnegative().nullable(),afterBytes:z.number().nonnegative().nullable()});
const comparisonSchema=z.object({service:serviceName,status:z.enum(['ADDED','REMOVED','MODIFIED','UNCHANGED']),baseline:packageSchema.nullable(),candidate:packageSchema.nullable(),files:z.array(fileSchema).max(20000)});
const resultSchema=z.object({packages:z.array(packageSchema).max(1000),comparison:z.array(comparisonSchema).max(2000).nullable()});
export type BuildResults=z.infer<typeof resultSchema>&{createdAt:string};
export const downloadQuery=z.object({side:z.enum(['single','baseline','candidate']),services:z.string().transform(s=>s.split(',')).pipe(z.array(serviceName).min(1).max(100)).refine(a=>new Set(a).size===a.length)});
export function resultCommand(action:'inspect'|'download',roots:string[],services:string[]=[],boundary?:string){
  return `python3 -c ${shellQuote(remoteResultsScript)} ${shellQuote(JSON.stringify({action,roots,services,boundary}))}`;
}
export class BuildResultsService {
  private readonly pending=new Map<string,Promise<BuildResults>>();
  private readonly readers=new Map<string,number>();
  private readonly controllers=new Set<AbortController>();
  private closed=false;
  constructor(private readonly store:TaskStore,private readonly environments:EnvironmentService,private readonly ssh:SshOperations){}
  busy(id:string){return this.pending.has(id)||(this.readers.get(id)??0)>0;}
  remove(id:string){this.store.deleteRecord('build-result',id);}
  saved(id:string){return this.store.getRecord<BuildResults>('build-result',id);}
  async close(){this.closed=true;for(const controller of this.controllers)controller.abort();await Promise.allSettled(this.pending.values());}
  private roots(task:BuildTask,module:BuildModule){
    const root=task.workspaceRoot;
    if(!root.startsWith('/')||posix.normalize(root)!==root||!root.endsWith(`/container-ops-kit/builds/${task.id}`))throw Object.assign(new Error('构建目录不合法'),{statusCode:409});
    return (task.mode==='SINGLE'?['single']:['baseline','candidate']).map(side=>`${root}/${side}/ArchDesign/${module.archDirectory}/target/${module.chartsPath}`);
  }
  async inspect(task:BuildTask,module:BuildModule,target?:SshTarget,signal?:AbortSignal){
    if(this.closed)throw new Error('服务正在停止');
    const saved=this.saved(task.id);if(saved)return saved;
    const pending=this.pending.get(task.id);if(pending)return pending;
    const controller=new AbortController();this.controllers.add(controller);
    const effectiveSignal=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
    const work=(async()=>{
      const result=await this.ssh.execute(target??this.environments.target(this.environments.get(task.environmentId)),resultCommand('inspect',this.roots(task,module),[],task.workspaceRoot),()=>{},effectiveSignal,180000);
      effectiveSignal.throwIfAborted();
      if(result.exitCode!==0)throw Object.assign(new Error(result.lines.filter(l=>l.startsWith('[stderr]')).join('\n').slice(-2000)||'读取构建产物失败，请确认构建环境已安装 Python 3 且产物目录存在'),{statusCode:409});
      const raw=result.lines.filter(l=>!l.startsWith('[stderr]')).join('\n');
      const parsed=resultSchema.parse(JSON.parse(raw));
      const value:BuildResults={...parsed,createdAt:new Date().toISOString()};
      this.store.putRecord('build-result',task.id,value,value.createdAt);return value;
    })();
    this.pending.set(task.id,work);try{return await work;}finally{this.pending.delete(task.id);this.controllers.delete(controller);}
  }
  async download(task:BuildTask,module:BuildModule,input:unknown,signal?:AbortSignal){
    if(this.closed)throw new Error('服务正在停止');
    const {side,services}=downloadQuery.parse(input);
    if(task.status!=='SUCCEEDED')throw Object.assign(new Error('仅成功构建可以下载产物'),{statusCode:409});
    if((task.mode==='SINGLE')!==(side==='single'))throw Object.assign(new Error('构建版本不匹配'),{statusCode:400});
    this.readers.set(task.id,(this.readers.get(task.id)??0)+1);
    const controller=new AbortController();this.controllers.add(controller);
    const effectiveSignal=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
    let released=false;const release=()=>{if(released)return;released=true;this.controllers.delete(controller);const n=(this.readers.get(task.id)??1)-1;if(n)this.readers.set(task.id,n);else this.readers.delete(task.id);};
    try{
      const results=await this.inspect(task,module);
      const entries=side==='single'?results.packages:(results.comparison??[]).flatMap(r=>{const p=r[side];return p?[p]:[];});
      const selected=services.map(name=>entries.find(e=>e.service===name));
      if(selected.some(e=>!e))throw Object.assign(new Error('所选服务在此版本没有构建产物'),{statusCode:404});
      const root=this.roots(task,module)[side==='candidate'?1:0]!;
      effectiveSignal.throwIfAborted();
      const stream=await this.ssh.stream(this.environments.target(this.environments.get(task.environmentId)),resultCommand('download',[root],services,task.workspaceRoot),effectiveSignal);
      stream.once('close',release);
      return {stream,filename:selected.length===1?selected[0]!.filename:`${task.module}-${side}-${task.id.slice(0,8)}.tar.gz`};
    }catch(error){release();throw error;}
  }
}
