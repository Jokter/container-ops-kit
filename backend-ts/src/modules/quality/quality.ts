import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {FastifyInstance} from 'fastify';
import type {TaskStore} from '../../platform/store.js';
import {noFileLogs,type LogSink} from '../../infrastructure/file-logs.js';

export const releaseVersion=z.string().trim().toUpperCase().regex(/^R\d{2}C(?:00|10)$/);
const label=z.string().trim().min(1).max(120).regex(/^[\p{L}\p{N}_. -]+$/u);
export const qualityInput=z.object({versions:z.array(releaseVersion).min(1).max(10).refine(v=>new Set(v).size===v.length),date:z.iso.date(),latest:z.boolean().default(false),domain:label.default('Access'),teams:z.array(label).min(1).max(30),kinds:z.array(z.enum(['ut','api','static'])).min(1).max(3).refine(v=>new Set(v).size===v.length)});
export type QualityInput=z.infer<typeof qualityInput>;
const connectionSchema=z.object({url:z.url().max(2000).refine(value=>{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&!u.search&&!u.hash;}),datasourceId:z.number().int().positive(),timeoutSeconds:z.number().int().min(5).max(180),parallel:z.number().int().min(1).max(4),auth:z.enum(['none','token'])});
export type QualityConnection=z.infer<typeof connectionSchema>;
type Cell=string|number|null;export type QualityRow=Record<string,Cell>;
export interface QualityPart{version:string;kind:'ut'|'api'|'static';status:'QUEUED'|'RUNNING'|'SUCCEEDED'|'EMPTY'|'FAILED'|'INTERRUPTED';message:string;columns:string[];rows:QualityRow[];sourceCount:number;eligibleCount:number;}
export interface QualityJob{id:string;input:QualityInput;connection:QualityConnection;status:'RUNNING'|'SUCCEEDED'|'PARTIAL'|'FAILED'|'INTERRUPTED';createdAt:string;updatedAt:string;parts:QualityPart[];}
export const utColumns=['代码仓','语言','PL组','失败用例','行覆盖率','行覆盖率目标','分支覆盖率','分支覆盖率目标','总行数','总分支数'];
const utFields=['repo','language','team','case_failed','line_coverage','line_coverage_goal','branch_coverage','branch_coverage_goal','line_sum','branch_sum'];
const staticTools: [string,string][]=[["lint", "PcLint"], ["findbugs", "Findbugs"], ["fortify", "Fortify"], ["codemars", "Codemars"], ["secbrella", "SecBrella"], ["molint", "Molint"], ["binscope", "Binscope"], ["cppcheck", "CppCheck"], ["pylint", "PyLint"], ["compile_warnings", "编译告警"], ["warning_suppression", "告警抑制"], ["dangerous_functions", "危险函数"], ["redundant_codes", "冗余代码"], ["huge_folder", "超大目录"], ["coderule_cpp", "C++规范"], ["coderule_java", "Java规范"], ["coderule_python", "Python规范"], ["coderule_javascript", "JS规范"], ["coderule_lua", "Lua规范"], ["coderule_scala", "Scala规范"], ["coderule_shell", "Shell规范"], ["compile_option_check", "编译选项"], ["pmd", "PMD"], ["binary", "Binary"]];
const sqlText=(s:string)=>`'${s.replaceAll("'","''")}'`;
export function qualitySql(input:QualityInput,version:string,kind:QualityPart['kind']){
 qualityInput.parse(input);releaseVersion.parse(version);
 const teams=input.teams.map(sqlText).join(','),where=`version=${sqlText(version)} and domain=${sqlText(input.domain)} and team in (${teams})`;
 if(kind==='ut'){const table='static_check.mae_ut_report',date=input.latest?`(select max(report_date) from ${table} where ${where})`:sqlText(input.date);return `select ${utFields.map((f,i)=>`${f} as '${utColumns[i]}'`).join(',')} from ${table} where report_date=${date} and ${where} order by repo`;}
 if(kind==='api'){const table='static_check.mae_api_test',date=input.latest?`(select max(report_date) from ${table} where ${where})`:sqlText(input.date);return `select repo as '代码仓',lang as '语言',department as '部门',team as 'PL组',owner as '责任人',api_num_text as '当前总数(文本)',ir_count as '当前完成IR数',er_count as '当前完成ER数',total_api_number as '当前总数(工具)',finish_api_number as '当前已完成接口数',failed_case_number as '失败用例数',if(is_achieved='达标',0,1) as '是否达标',case when status='success' then 0 when status='error' then 1 else 2 end as '状态' from ${table} where report_date=${date} and ${where} order by repo`;}
 // Include zero-count teams so a successful clean snapshot differs from missing data.
 return `select t.team as '组名',${staticTools.map(([,name],i)=>`ifnull(s${i}.val,0) as '${name}'`).join(',')} from (select distinct plteam_name as team from static_check.codeowner_person_model where plteam_name in (${teams})) t ${staticTools.map(([suffix],i)=>`left join (select team,count(1) as val from static_check.${version}_${suffix} where ${where} ${suffix==='redundant_codes'?"and repo != 'BuildPackageWorkaround'":''} group by team) s${i} on t.team=s${i}.team`).join(' ')} order by t.team`;
}
export function metric(value:Cell|undefined,percent=false){
 if(value===null||value===undefined||value==='')throw new Error('报告指标缺失，禁止据此启动修复');
 const number=typeof value==='string'&&value.endsWith('%')?Number(value.slice(0,-1))/100:Number(value);
 if(!Number.isFinite(number)||number<0||percent&&number>1)throw new Error('报告指标格式无效');return number;
}
const payloadSchema=z.object({results:z.object({A:z.object({error:z.unknown().optional(),tables:z.array(z.object({columns:z.array(z.object({text:z.string()})),rows:z.array(z.array(z.union([z.string(),z.number(),z.null()]))) })).optional()})})});
export function normalizeQuality(payload:unknown,kind:QualityPart['kind']){
 const parsed=payloadSchema.safeParse(payload);if(!parsed.success)throw new Error('Grafana 响应格式无效');
 const result=parsed.data.results.A;if(result.error)throw new Error('Grafana 数据源返回查询错误，请检查数据源与表权限');
 if(!result.tables?.length)throw new Error('Grafana 未返回表格，无法判定报告是否正常');
 const rows:QualityRow[]=[];let sourceCount=0,eligibleCount=0;let columns:string[]=[];
 for(const table of result.tables){const names=table.columns.map(c=>c.text);const required=kind==='ut'?utColumns:kind==='api'?['代码仓','语言','PL组','失败用例数','是否达标','状态']:['组名',...staticTools.map(t=>t[1])];
  if(required.some(c=>!names.includes(c)))throw new Error('Grafana 报告缺少必要列');columns=names;
  for(const values of table.rows){if(values.length!==names.length)throw new Error('Grafana 报告列数不匹配');sourceCount++;
   const row:QualityRow=Object.fromEntries(names.map((name,i)=>[name,values[i]!]));
   if(kind==='ut'){
    if(metric(row['总行数'])===0)continue;eligibleCount++;
    const failed=metric(row['失败用例']),line=metric(row['行覆盖率'],true),goal=metric(row['行覆盖率目标'],true),cpp=row['语言']==='Cpp';
    const branch=cpp?1:metric(row['分支覆盖率'],true),branchGoal=cpp?0:metric(row['分支覆盖率目标'],true);
    row['行覆盖率']=line;row['行覆盖率目标']=goal;
    if(!cpp){row['分支覆盖率']=branch;row['分支覆盖率目标']=branchGoal;}
    if(failed===0&&line>=Math.min(goal,.8)&&branch>=Math.min(branchGoal,.7))continue;
    row['待补充行数']=Math.ceil(Math.max(0,Math.min(goal,.8)-line)*metric(row['总行数'])-1e-9);row['待补充分支数']=cpp?0:Math.ceil(Math.max(0,Math.min(branchGoal,.7)-branch)*metric(row['总分支数'])-1e-9);
   }else if(kind==='api'){eligibleCount++;if(metric(row['失败用例数'])===0&&metric(row['是否达标'])===0&&metric(row['状态'])===0)continue;}
   else {eligibleCount++;if(staticTools.every(([,name])=>metric(row[name])===0))continue;}
   rows.push(row);
  }
 }
 if(kind==='ut')columns=[...columns,'待补充行数','待补充分支数'];return{rows,columns,sourceCount,eligibleCount};
}
export function qualityCsv(part:Pick<QualityPart,'columns'|'rows'>){const cell=(v:Cell|undefined)=>{let s=String(v??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};return '\ufeff'+[part.columns.map(cell).join(','),...part.rows.map(r=>part.columns.map(c=>cell(r[c])).join(','))].join('\r\n');}
export class QualityService{
 private active=new Map<string,Promise<void>>();private controllers=new Set<AbortController>();private jobControllers=new Map<string,Set<AbortController>>();private cancelled=new Set<string>();private closing=false;
 constructor(private readonly store:TaskStore,private readonly logs:LogSink=noFileLogs,private readonly request:typeof fetch=fetch){for(const job of this.list().filter(j=>j.status==='RUNNING')){job.status='INTERRUPTED';for(const p of job.parts)if(['RUNNING','QUEUED'].includes(p.status)){p.status='INTERRUPTED';p.message='服务重启，需手动重新查询';}this.save(job);}}
 connection(){return this.store.getRecord<QualityConnection>('quality-config','connection')??{url:'http://10.244.166.217:3000/api/tsdb/query',datasourceId:4,timeoutSeconds:60,parallel:2,auth:'none'};}
 saveConnection(value:unknown){const config=connectionSchema.parse(value);if(config.auth==='token'&&!process.env.QUALITY_GRAFANA_TOKEN)throw Object.assign(new Error('请先配置后端环境变量 QUALITY_GRAFANA_TOKEN'),{statusCode:400});this.store.putRecord('quality-config','connection',config);return config;}
 list(){return this.store.records<QualityJob>('quality-job').filter(j=>!this.store.getRecord('quality-record-hidden',j.id));}get(id:string){const job=this.store.getRecord<QualityJob>('quality-job',id);if(!job)throw Object.assign(new Error('查询任务不存在'),{statusCode:404});return job;}
 private save(job:QualityJob){job.updatedAt=new Date().toISOString();this.store.putRecord('quality-job',job.id,job,job.createdAt);}
 start(value:unknown){if(this.closing||this.active.size>=4)throw Object.assign(new Error('查询任务较多，请稍后重试'),{statusCode:409});const input=qualityInput.parse(value),now=new Date().toISOString();const job:QualityJob={id:randomUUID(),input,connection:this.connection(),status:'RUNNING',createdAt:now,updatedAt:now,parts:input.versions.flatMap(version=>input.kinds.map(kind=>({version,kind,status:'QUEUED',message:'等待查询',columns:[],rows:[],sourceCount:0,eligibleCount:0})))};this.save(job);
 const promise=this.execute(job).finally(()=>this.active.delete(job.id));this.active.set(job.id,promise);return this.get(job.id);}
 async stop(id:string){this.cancelled.add(id);for(const c of this.jobControllers.get(id)??[])c.abort();await this.active.get(id);}
 async remove(id:string,preserveForReport=false){await this.stop(id);if(preserveForReport)this.store.putRecord('quality-record-hidden',id,{id,deletedAt:new Date().toISOString()});else{this.store.deleteRecord('quality-job',id);this.store.deleteRecord('quality-record-hidden',id);}this.cancelled.delete(id);}
 async wait(id:string){await this.active.get(id);return this.get(id);}
 private async execute(job:QualityJob){let next=0;await Promise.all(Array.from({length:job.connection.parallel},async()=>{while(next<job.parts.length){const part=job.parts[next++]!;if(this.cancelled.has(job.id)){part.status='INTERRUPTED';part.message='用户停止任务';continue;}part.status='RUNNING';part.message='正在查询 Grafana';this.save(job);const controller=new AbortController();this.controllers.add(controller);const owners=this.jobControllers.get(job.id)??new Set<AbortController>();owners.add(controller);this.jobControllers.set(job.id,owners);const timeout=setTimeout(()=>controller.abort(),job.connection.timeoutSeconds*1000);
 try{if(this.closing)throw new Error('服务正在停止');const stamp=String(Date.now());const headers:Record<string,string>={'Content-Type':'application/json'};if(job.connection.auth==='token'){if(!process.env.QUALITY_GRAFANA_TOKEN)throw new Error('后端未配置 Grafana Token');headers.Authorization=`Bearer ${process.env.QUALITY_GRAFANA_TOKEN}`;}
 const response=await this.request(job.connection.url,{method:'POST',headers,redirect:'error',signal:controller.signal,body:JSON.stringify({from:stamp,to:stamp,queries:[{refId:'A',intervalMs:60000,maxDataPoints:10000,datasourceId:job.connection.datasourceId,rawSql:qualitySql(job.input,part.version,part.kind),format:'table'}]})});
 if(!response.ok)throw new Error(`Grafana HTTP ${response.status}，请检查地址、认证与数据源`);
 const reader=response.body?.getReader();if(!reader)throw new Error('Grafana 响应为空');const chunks:Uint8Array[]=[];let size=0;try{while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>20*1024*1024){await reader.cancel();throw new Error('报告超过 20MB 限制');}chunks.push(chunk.value);}}finally{reader.releaseLock();}const text=Buffer.concat(chunks).toString('utf8');Object.assign(part,normalizeQuality(JSON.parse(text),part.kind));part.status=part.eligibleCount?'SUCCEEDED':'EMPTY';part.message=part.eligibleCount?`查询完成：${part.rows.length} 条异常 / ${part.eligibleCount} 条有效记录`:'没有有效报告数据，不执行修复';
 }catch(error){part.status=this.closing||this.cancelled.has(job.id)?'INTERRUPTED':'FAILED';part.message=controller.signal.aborted?'查询超时或服务停止':error instanceof Error&&/^(Grafana|报告|后端|服务)/.test(error.message)?error.message:'Grafana 请求失败，请检查网络或响应格式';}
 finally{clearTimeout(timeout);this.controllers.delete(controller);owners.delete(controller);if(!owners.size)this.jobControllers.delete(job.id);this.logs.task('quality',job.id,{time:new Date().toISOString(),version:part.version,kind:part.kind,status:part.status,message:part.message});this.save(job);}
 }}));const failed=job.parts.filter(p=>['FAILED','INTERRUPTED'].includes(p.status)).length;job.status=this.closing||this.cancelled.has(job.id)?'INTERRUPTED':failed===job.parts.length?'FAILED':failed?'PARTIAL':'SUCCEEDED';this.save(job);}
 async close(){this.closing=true;this.controllers.forEach(c=>c.abort());await Promise.all(this.active.values());}
}
export function qualityRoutes(app:FastifyInstance,service:QualityService){app.get('/api/quality/settings',async()=>service.connection());app.put('/api/quality/settings',async req=>service.saveConnection(req.body));app.post('/api/quality/jobs',async(req,reply)=>reply.code(202).send(service.start(req.body)));app.get('/api/quality/jobs',async()=>service.list().map(({parts,...job})=>({...job,parts:parts.map(({rows,...part})=>({...part,rowCount:rows.length}))})));app.get('/api/quality/jobs/:id',async req=>service.get(z.object({id:z.uuid()}).parse(req.params).id));app.get('/api/quality/jobs/:id/csv',async(req,reply)=>{const job=service.get(z.object({id:z.uuid()}).parse(req.params).id),q=z.object({version:releaseVersion,kind:z.enum(['ut','api','static'])}).parse(req.query),part=job.parts.find(p=>p.version===q.version&&p.kind===q.kind);if(!part||!['SUCCEEDED','EMPTY'].includes(part.status))return reply.code(409).send({message:'该报告尚不可导出'});return reply.header('Content-Disposition',`attachment; filename="${q.kind}_${q.version}_${job.input.date}.csv"`).type('text/csv; charset=utf-8').send(qualityCsv(part));});}
