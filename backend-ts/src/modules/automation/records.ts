import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import type {AutoUtService} from '../autout/autout.js';
import type {AutoUtReports} from '../autout/reports.js';
import type {QualityService} from '../quality/quality.js';
const entrySchema=z.object({kind:z.enum(['ut','quality','report']),id:z.uuid()});
type Entry=z.infer<typeof entrySchema>;
export class AutomationRecords {
 private busy=false;
 constructor(private readonly autoUt:AutoUtService,private readonly reports:AutoUtReports,private readonly quality:QualityService){}
 async cleanup(value:unknown){
  const {entries}=z.object({entries:z.array(entrySchema).min(1).max(1000)}).parse(value);
  if(this.busy)throw Object.assign(new Error('记录正在清理，请等待本次完成'),{statusCode:409});
  this.busy=true;const deleted:Entry[]=[],failed:Array<Entry&{message:string}>=[];
  try{for(const entry of [...new Map(entries.map(e=>[e.kind+':'+e.id,e])).values()]){
   try{
    if(entry.kind==='ut')await this.autoUt.removeExecutionRecord(entry.id);
    else if(entry.kind==='report')await this.reports.remove(entry.id);
    else{for(const run of this.reports.list().filter(r=>r.jobId===entry.id))await this.reports.remove(run.id);await this.quality.remove(entry.id);}
    deleted.push(entry);
   }catch(error){failed.push({...entry,message:error instanceof Error?error.message:'停止或清理失败'});}
  }return{deleted,failed};}finally{this.busy=false;}
 }
}
export function automationRecordRoutes(app:FastifyInstance,service:AutomationRecords){app.post('/api/automation/records/cleanup',async req=>service.cleanup(req.body));}
