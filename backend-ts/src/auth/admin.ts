import type {DatabaseSync} from 'node:sqlite';

export const taskDomains=['auto-ut-task','group-mr-entry','quality-job','auto-ut-report-run','build-task','deployment-task','automation-schedule-run'] as const;
const placeholders=taskDomains.map(()=>'?').join(',');
function object(value:unknown):Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};}
function text(value:unknown){return typeof value==='string'?value.slice(0,300):'';}
// Project only task metadata, never connection settings, credentials, prompts or command output.
export function usage(db:DatabaseSync){
 const groups=db.prepare(`SELECT domain AS kind,count(*) AS count FROM domain_records WHERE domain IN (${placeholders}) GROUP BY domain`).all(...taskDomains);
 const platform=Number(db.prepare('SELECT count(*) AS n FROM tasks').get()?.n??0);
 const latest=db.prepare(`SELECT max(time) AS time FROM (SELECT max(updated_at) AS time FROM tasks UNION ALL SELECT max(updated_at) FROM environments UNION ALL SELECT max(updated_at) FROM domain_records WHERE domain IN (${placeholders}))`).get(...taskDomains);
 return {environments:Number(db.prepare('SELECT count(*) AS n FROM environments').get()?.n??0),schedules:Number(db.prepare("SELECT count(*) AS n FROM domain_records WHERE domain='automation-schedule'").get()?.n??0),tasks:platform+groups.reduce((n,row)=>n+Number(row.count),0),byKind:[{kind:'platform',count:platform},...groups.map(row=>({kind:String(row.kind),count:Number(row.count)}))],lastActivityAt:latest?.time??null};
}
export function taskPage(db:DatabaseSync,kind:string,page:number,pageSize:number){
 const domains=kind==='all'?[...taskDomains]:taskDomains.filter(d=>d===kind),includePlatform=kind==='all'||kind==='platform';
 const parts:string[]=[],params:string[]=[];
 if(domains.length){parts.push(`SELECT domain AS kind,id,payload,created_at,updated_at,NULL AS platform_status FROM domain_records WHERE domain IN (${domains.map(()=>'?').join(',')})`);params.push(...domains);}
 if(includePlatform)parts.push("SELECT 'platform' AS kind,id,input AS payload,created_at,updated_at,status AS platform_status FROM tasks");
 const query=parts.join(' UNION ALL '),total=Number(db.prepare(`SELECT count(*) AS n FROM (${query})`).get(...params)?.n??0);
 const rows=db.prepare(`SELECT * FROM (${query}) ORDER BY updated_at DESC,kind,id LIMIT ? OFFSET ?`).all(...params,pageSize,(page-1)*pageSize);
 return {page,pageSize,total,items:rows.map(row=>{const value=object(JSON.parse(String(row.payload))),input=object(value.input);return {id:String(row.id),kind:String(row.kind),title:text(value.repository)||text(value.repo)||text(value.module)||text(value.environmentName)||text(input.version)||text(value.kind)||String(row.kind),status:text(row.platform_status)||text(value.phase)||text(value.status),progress:typeof value.progress==='number'?value.progress:null,stage:text(value.nextStage)||text(value.stage),version:text(value.reportVersion),branch:text(value.baseBranch),createdAt:String(row.created_at),updatedAt:String(row.updated_at)};})};
}
