import {createHash} from 'node:crypto';
import {stripVTControlCharacters} from 'node:util';
import {z} from 'zod';
import {jsonValues} from '../autout/mr-codehub.js';
const obj=(v:unknown):Record<string,unknown>|undefined=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:undefined;
const str=(v:unknown)=>typeof v==='string'?v:typeof v==='number'?String(v):'';
const line=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0?v:null;
export const reviewSha=z.string().regex(/^[a-f0-9]{40}$/i);
const path=z.string().min(1).max(2048).refine(v=>!/[\x00-\x1f]/.test(v));
export const reviewAction=z.discriminatedUnion('action',[
 z.object({action:z.literal('resolve'),sha:reviewSha,operationId:z.uuid(),discussionId:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/),fingerprint:z.string().regex(/^[a-f0-9]{64}$/),reason:z.string().trim().min(1).max(4000),confirmed:z.literal(true)}).strict(),
 z.object({action:z.literal('reply'),sha:reviewSha,operationId:z.uuid(),discussionId:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/),fingerprint:z.string().regex(/^[a-f0-9]{64}$/),body:z.string().trim().min(1).max(10000)}).strict(),
 z.object({action:z.literal('create'),sha:reviewSha,operationId:z.uuid(),path,line:z.number().int().positive(),body:z.string().trim().min(1).max(10000)}).strict()
]);
export interface ReviewNote {id:string;body:string;author:string;time:string;system:boolean;}
export interface ReviewThread {id:string;body:string;author:string;resolved:boolean;resolvable:boolean;path:string;oldPath:string;line:number|null;oldLine:number|null;headSha:string;notes:ReviewNote[];fingerprint:string;}
export interface ReviewFile {path:string;oldPath:string;diff:string;status:string;unavailable:boolean;}
// A partial list must never be treated as proof that a comment is absent or resolved.
function rows(output:string,keys:string[]):unknown[]{
 const values=jsonValues(output);
 const visit=(value:unknown,depth=0):unknown[]|undefined=>{
  if(Array.isArray(value))return value;
  const o=obj(value);if(!o||depth>4)return;
  if(o.truncated===true||o.overflow===true||o.has_more===true||o.hasMore===true||o.next_page||o.nextPage)throw Error('CodeHub 返回分页或截断结果，无法确认完整数据；请检查 CLI 版本');
  if(o.resultCode!==undefined&&o.resultCode!==0&&o.resultCode!=='0')throw Error('CodeHub 返回业务失败');
  for(const key of keys)if(key in o){const found=visit(o[key],depth+1);if(found){if(typeof o.total==='number'&&o.total>found.length)throw Error('CodeHub 列表不完整');return found;}}
 };
 for(const value of values){const result=visit(value);if(result)return result;}
 throw Error('CodeHub 返回格式不完整，未更新检视数据');
}
export function reviewThreads(output:string):ReviewThread[]{
 return rows(output,['discussions','items','data','result']).map(value=>{
  const o=obj(value),id=str(o?.discussion_id??o?.discussionId??o?.id);
  if(!id||!Array.isArray(o?.notes)||!o.notes.length)throw Error('检视意见缺少 ID 或讨论内容');
  const notes=o.notes.map(value=>{const n=obj(value);if(!n||typeof n.body!=='string')throw Error('讨论内容格式不完整');return {id:str(n.id),body:n.body,author:str(obj(n.author)?.username??obj(n.author)?.name??n.author),time:str(n.created_at??n.updated_at),system:n.system===true};});
  const first=obj(o.notes[0])!,position=obj(first.position??o.position),resolvable=o.resolvable!==false&&!o.notes.every(n=>obj(n)?.resolvable===false);
  const item={id,body:notes[0]!.body,author:notes[0]!.author,resolved:o.resolved===true||o.resolved===null||(o.resolved===undefined&&first.resolved===true),resolvable,path:str(position?.new_path??first.path??o.path),oldPath:str(position?.old_path),line:line(position?.new_line??first.line),oldLine:line(position?.old_line),headSha:str(position?.head_sha),notes};
  return {...item,fingerprint:createHash('sha256').update(JSON.stringify(item)).digest('hex')};
 });
}
export function reviewFiles(output:string):ReviewFile[]{
 return rows(output,['changes','diffs','items','data','result']).map(value=>{
  const o=obj(value),name=str(o?.new_path??o?.path??o?.old_path);if(!name)throw Error('变更缺少文件路径');
  return {path:name,oldPath:str(o?.old_path),diff:str(o?.diff??o?.patch),status:o?.deleted_file?'deleted':o?.new_file?'added':o?.renamed_file?'renamed':'modified',unavailable:typeof (o?.diff??o?.patch)!=='string'||o?.too_large===true||o?.collapsed===true||o?.binary===true};
 });
}
export function addedLines(diff:string):Set<number>{
 let next=0,inHunk=false;const result=new Set<number>();
 for(const text of diff.split('\n')){const h=text.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);if(h){next=Number(h[1]);inHunk=true;continue;}if(!inHunk)continue;if(text.startsWith('+'))result.add(next++);else if(text.startsWith(' '))next++;else if(!text.startsWith('-')&&!text.startsWith('\\'))inHunk=false;}
 return result;
}
export interface ReviewWorkspace {sha:string;state:string|undefined;files:ReviewFile[];threads:ReviewThread[];capabilities:ReviewCapabilities;writePending:string;stale:boolean;readAt:string;confirmedOperationId:string;}
export interface ReviewCapabilities {reply:boolean;create:boolean;reason:string;}
// Only allow a known adapter when local help confirms BOTH positional arguments and flags.
// Unknown CLI versions fail closed; help text never supplies executable tokens.
export function supportsReviewCommand(help:string,kind:'reply'|'create'):boolean{
 help=stripVTControlCharacters(help);
 const usage=help.match(new RegExp('(?:codehub-cli\\s+)?mr\\s+review\\s+'+kind+'\\s+([^\\n]+)','i'))?.[1]??'';
 const args=[...usage.matchAll(/<([^>]+)>/g)].map(m=>m[1]!.toLowerCase().replaceAll('_','-'));
 const flags=help.split('\n').filter(s=>/^\s*(?:-[a-z],?\s*)?--[a-z]/i.test(s)).join('\n');
 return ['iid','mr-iid','mr-id','mr'].includes(args[0]??'')&&args.length===(kind==='reply'?2:1)&&(kind!=='reply'||['discussion-id','discussion'].includes(args[1]??''))&&/--body\s+[<[]/.test(flags)&&/(?:-p,?\s*)?--(?:project|repo|repository)\s+[<[]/.test(flags)&&(kind!=='create'||/--path\s+[<[]/.test(flags)&&/--line\s+[<[]/.test(flags));
}
