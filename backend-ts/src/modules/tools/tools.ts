import {createHash} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import ExcelJS from 'exceljs';
import {z} from 'zod';
import type {TaskStore} from '../../platform/store.js';
import {builtinDefinitions} from './builtins.js';
import {bad,parseFrame,validateFields} from './parser.js';
import type {Field,ParseResult} from './parser.js';
const codeSchema=z.string().regex(/^[a-fA-F0-9]{4}$/).transform(s=>s.toLowerCase());
const definition=z.object({code:codeSchema,name:z.string().trim().min(1).max(100),sample:z.string().max(262144).default(''),fields:z.unknown()}).strict();
interface Command {code:string;name:string;sample:string;fields:Field[];revision:string;builtin:boolean;}
const revision=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0,24);
function command(input:unknown,builtin:boolean):Command{const d=definition.parse(input);const fields=validateFields(d.fields,d.code);return {...d,fields,builtin,revision:revision({...d,fields})};}
export const builtins=z.array(z.unknown()).parse(builtinDefinitions).map(v=>command(v,true));
const registration=z.object({definition:z.unknown(),expectedRevision:z.string().max(24).nullable().default(null)}).strict();
const parseInput=z.object({code:codeSchema,text:z.string().min(1).max(1048576),batch:z.boolean().default(false),feature:z.number().int().min(0).max(0xffffffff).nullable().default(null),revision:z.string().max(24).optional()}).strict();
export interface RecordResult {line:number;status:'success'|'filtered'|'error';result?:ParseResult;error?:string;}
export interface BatchResult {code:string;revision:string;records:RecordResult[];summary:{total:number;success:number;filtered:number;errors:number};}
const domain='tools-binlog-command';
export class ToolsService {
 constructor(private readonly store:TaskStore){}
 list():Command[]{const custom=this.store.records<unknown>(domain).map(v=>command(v,false));return [...builtins.filter(b=>!custom.some(c=>c.code===b.code)),...custom].sort((a,b)=>a.code.localeCompare(b.code));}
 get(code:string){const found=this.list().find(c=>c.code===code);if(!found)throw Object.assign(new Error('命令不存在'),{statusCode:404});return found;}
 validate(input:unknown){const d=command(input,false),existing=this.list().find(c=>c.code===d.code);return {...d,conflict:existing?{name:existing.name,revision:existing.revision,builtin:existing.builtin}:null};}
 save(input:unknown){const req=registration.parse(input),d=command(req.definition,false),existing=this.list().find(c=>c.code===d.code);
  if((existing?.revision??null)!==req.expectedRevision)throw Object.assign(new Error('命令已存在或已更新，请重新校验并确认覆盖'),{statusCode:409});
  if(!existing&&this.list().length>=100)bad('最多保存 100 个命令');
  this.store.putRecord(domain,d.code,{code:d.code,name:d.name,sample:d.sample,fields:d.fields},new Date().toISOString());return d;
 }
 remove(code:string,input:unknown){const req=z.object({revision:z.string()}).strict().parse(input),current=this.get(code);if(current.builtin)bad('内置命令不能删除');if(current.revision!==req.revision)throw Object.assign(new Error('配置已更新，请刷新'),{statusCode:409});this.store.deleteRecord(domain,code);}
 parse(input:unknown):BatchResult{
  const req=parseInput.parse(input),cmd=this.get(req.code);
  if(req.revision&&req.revision!==cmd.revision)throw Object.assign(new Error('命令配置已更新，请重新解析后导出'),{statusCode:409});
  const lines=req.batch?req.text.split(/\r?\n/).map((text,i)=>({text,line:i+1})).filter(x=>x.text.trim()&&!x.text.trim().startsWith('#')):[{text:req.text,line:1}];
  if(!lines.length||lines.length>500)bad('每批需要 1 至 500 条报文');
  const records:RecordResult[]=[];let fieldCount=0;
  for(const {text,line} of lines){
   let record:RecordResult;
   try{const result=parseFrame(cmd.code,cmd.fields,text,req.feature);fieldCount+=result.fields.length;record={line,status:result.matched?'success':'filtered',result};}
   catch(e){record={line,status:'error',error:e instanceof Error?e.message:'解析失败'};}
   if(fieldCount>50000)bad('本批次超过 50000 个字段，请拆分文件');records.push(record);
  }
  return {code:cmd.code,revision:cmd.revision,records,summary:{total:records.length,success:records.filter(r=>r.status==='success').length,filtered:records.filter(r=>r.status==='filtered').length,errors:records.filter(r=>r.status==='error').length}};
 }
}
export function toolsRoutes(app:FastifyInstance,service:ToolsService){
 app.get('/api/tools/binlog/commands',async()=>service.list());
 app.post('/api/tools/binlog/commands/validate',async req=>service.validate(req.body));
 app.post('/api/tools/binlog/commands',async(req,reply)=>reply.code(201).send(service.save(req.body)));
 app.delete('/api/tools/binlog/commands/:code',async(req,reply)=>{service.remove(codeSchema.parse(z.object({code:z.string()}).parse(req.params).code),req.body);return reply.code(204).send();});
 app.post('/api/tools/binlog/parse',async req=>service.parse(req.body));
 app.post('/api/tools/binlog/export',async(req,reply)=>{
  const result=service.parse(req.body),book=new ExcelJS.Workbook(),sheet=book.addWorksheet('解析结果');
  sheet.columns=[['原始行号',10],['状态',12],['分组',24],['TAG',10],['字段',50],['含义',24],['值',30],['枚举 / 无效值',24],['单位',12],['说明 / 错误',60]].map(([header,width])=>({header:String(header),width:Number(width)}));
  for(const record of result.records){
   if(record.error)sheet.addRow([record.line,record.status,'','','','','','','',record.error]);
   for(const field of record.result?.fields??[])sheet.addRow([record.line,record.status,field.group,field.tag,field.path,field.label,field.value,field.meaning,field.unit,field.description]);
   for(const warning of record.result?.warnings??[])sheet.addRow([record.line,'warning','','','','','','','',warning]);
  }
  sheet.views=[{state:'frozen',ySplit:1}];sheet.getRow(1).font={bold:true};sheet.autoFilter='A1:J1';
  return reply.header('content-disposition',`attachment; filename="binlog-${result.code}.xlsx"`).type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(Buffer.from(await book.xlsx.writeBuffer()));
 });
}
