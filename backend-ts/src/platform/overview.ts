import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import type {TaskStore} from './store.js';
import type {GroupMrService} from '../modules/automation/group-mr.js';
interface MrOverviewSource {summary():{pending:Array<{id:string;repo:string;iid:string;phase:string;status:string;updatedAt:string;running:boolean}>}}

const summaryRecord=z.object({id:z.string(),status:z.string(),createdAt:z.string(),updatedAt:z.string().optional(),
  repository:z.string().optional(),module:z.string().optional(),namespace:z.string().optional(),
  governance:z.object({mrState:z.string().optional(),classResults:z.array(z.object({status:z.string()})).optional()}).optional()});
const utActive=new Set(['DISCOVERED','PREPARING','BASELINE_RUNNING','REPAIRING','VERIFYING','PR_CREATING','MR_PENDING','MR_REPAIRING']);
interface Todo {id:string;kind:'ut'|'mr'|'build'|'deploy'|'quality'|'report';title:string;reason:string;time:string;domain:'automation'|'container';page:string}
/** Read stored state only. Opening the overview must not start remote checks or jobs. */
export function platformOverview(store:TaskStore,groupMr:MrOverviewSource){
  const records=(domain:string)=>store.records<unknown>(domain).flatMap(value=>{const parsed=summaryRecord.safeParse(value);return parsed.success?[parsed.data]:[];});
  const ut=[...new Map([...records('auto-ut-governance'),...records('auto-ut-task')].map(item=>[item.id,item])).values()];
  const builds=records('build-task'),deployments=records('deployment-task'),mr=groupMr.summary().pending,todos:Todo[]=[];
  let running=0;
  for(const item of ut){
    if(utActive.has(item.status)||(item.status==='RESOLVED'&&item.governance?.mrState==='PENDING')){running++;continue;}
    if(['RESOLVED','NO_CHANGE'].includes(item.status)&&!item.governance?.classResults?.some(c=>c.status==='FAILED'))continue;
    todos.push({id:item.id,kind:'ut',title:item.repository||'UT 治理',reason:'UT 任务需要处理',time:item.updatedAt||item.createdAt,domain:'automation',page:'tasks'});
  }
  for(const item of mr){if(item.running||item.phase==='QUEUED')running++;else todos.push({id:item.id,kind:'mr',title:`${item.repo} !${item.iid}`,reason:item.phase==='HUMAN'?'等待人工审核':item.status,time:item.updatedAt,domain:'automation',page:'group-mr'});}
  for(const [kind,items] of [['build',builds],['deploy',deployments]] as const)for(const item of items){
    if(['PENDING','RUNNING','ANALYZING','PREPARING','DEPLOYING'].includes(item.status))running++;
    if(['FAILED','AWAITING_REVIEW'].includes(item.status))todos.push({id:item.id,kind,title:item.module||item.id,reason:item.status==='AWAITING_REVIEW'?'部署等待确认':kind==='build'?'构建失败':'部署失败',time:item.updatedAt||item.createdAt,domain:'container',page:kind});
  }
  for(const [kind,domain] of [['quality','quality-job'],['report','auto-ut-report-run']] as const)for(const item of records(domain)){
    if(['RUNNING','QUEUED','FETCHING'].includes(item.status))running++;
    if(['FAILED','PARTIAL','INTERRUPTED'].includes(item.status))todos.push({id:item.id,kind,title:kind==='quality'?'质量检查':'UT 报告获取',reason:kind==='quality'?'质量检查需要处理':'报告获取需要处理',time:item.updatedAt||item.createdAt,domain:'automation',page:'tasks'});
  }
  const counts=store.db.prepare("SELECT count(*) AS total, coalesce(sum(CASE WHEN connection_status='REACHABLE' THEN 1 ELSE 0 END),0) AS reachable FROM environments").get();
  const applications=store.db.prepare('SELECT count(*) AS count FROM domain_records WHERE domain=?').get('platform-application');
  return {updatedAt:new Date().toISOString(),running,attention:todos.length,environments:{total:Number(counts?.total||0),reachable:Number(counts?.reachable||0)},applications:Number(applications?.count||0),todos:todos.sort((a,b)=>b.time.localeCompare(a.time)).slice(0,100)};
}
export function overviewRoutes(app:FastifyInstance,store:TaskStore,groupMr:GroupMrService){app.get('/api/platform/overview',async()=>platformOverview(store,groupMr));}
