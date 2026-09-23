import {z} from 'zod';
export function jsonValues(output:string):unknown[]{
 const values:unknown[]=[];let start=-1,depth=0,quoted=false,escape=false;
 for(let i=0;i<output.length;i++){const c=output[i];if(start<0){if(c==='{'||c==='['){start=i;depth=1;}continue;}if(quoted){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')quoted=false;continue;}if(c==='"'){quoted=true;continue;}if(c==='{'||c==='[')depth++;else if((c==='}'||c===']')&&--depth===0){try{values.push(JSON.parse(output.slice(start,i+1)));}catch{/* log fragment */}start=-1;}}
 return values;
}
const id=z.union([z.string().regex(/^\d+$/),z.number().int().nonnegative()]).transform(String);
const member=z.object({username:z.string().optional(),name_cn:z.string().optional(),approved:z.boolean().optional(),has_approved:z.boolean().optional(),reviewed:z.boolean().optional(),state:z.string().optional(),status:z.union([z.string(),z.number()]).optional()}).passthrough();
export const mrSchema=z.object({id:id.optional(),iid:id.optional(),mr_url:z.string().optional(),web_url:z.string().optional(),state:z.enum(['opened','merged','closed','locked']).optional(),title:z.string().optional(),source_branch:z.string().optional(),target_branch:z.string().optional(),sha:z.string().optional(),diff_refs:z.object({head_sha:z.string().optional()}).optional(),e2e_issues:z.array(z.object({title:z.string().optional(),id:z.union([z.string(),z.number()]).optional(),issue_num:z.string().optional(),issue_id:z.string().optional(),number:z.string().optional()})).optional(),approval_merge_request_reviewers:z.array(member).optional(),approval_merge_request_approvers:z.array(member).optional(),merge_request_assignee_list:z.array(member).optional()}).passthrough();
export type MrView=z.infer<typeof mrSchema>;
export const pipelineSchema=z.object({id,status:z.string(),sha:z.string().optional(),commit_id:z.string().optional(),commit:z.object({id:z.string()}).optional()}).passthrough();
export const gateSchema=z.object({ci_state_passed:z.boolean().optional(),quality_gate:z.object({passed:z.boolean().optional()}).optional(),merge_gate_passed:z.boolean().optional(),conflict_passed:z.boolean().optional(),approval_reviewers_required_passed:z.boolean().optional(),approval_approvers_required_passed:z.boolean().optional(),pipeline:pipelineSchema.optional()}).passthrough();
export function parseObject<T>(schema:z.ZodType<T>,output:string,predicate:(value:T)=>boolean):T {for(const value of jsonValues(output)){const parsed=schema.safeParse(value);if(parsed.success&&predicate(parsed.data))return parsed.data;}throw Error('CodeHub 返回缺少必要字段，请检查 CLI 版本与输出。');}
export function parseMr(output:string):MrView{
 const candidates=jsonValues(output).flatMap(v=>Array.isArray(v)?v:[v]).flatMap(v=>{const parsed=mrSchema.safeParse(v);return parsed.success&&(parsed.data.iid||parsed.data.id||parsed.data.mr_url||parsed.data.web_url)?[parsed.data]:[];});
 if(candidates.length!==1)throw Error('CodeHub 返回缺少必要字段或包含多个 MR，请检查 CLI 版本与输出。');
 return candidates[0]!;
}
export function mrIid(m:MrView):string {const url=m.mr_url||m.web_url;const number=m.iid||url?.match(/merge_requests\/(\d+)/)?.[1]||(m.mr_url?m.id:undefined);if(!number)throw Error('CodeHub 返回缺少 MR IID');return number;}
export function listObjects(output:string):unknown[]{if(output.trim()==='null')return [];const values=jsonValues(output);for(const value of values){if(Array.isArray(value))return value;if(value&&typeof value==='object'){const obj=value as Record<string,unknown>;for(const key of ['items','data','merge_requests','pipelines'])if(Array.isArray(obj[key]))return obj[key];}}throw Error('CodeHub 列表返回格式不正确，不能确认远端状态。');}
export function roleMembers(m:MrView,role:'reviewers'|'approvers'|'assignees'){return (role==='reviewers'?m.approval_merge_request_reviewers:role==='approvers'?m.approval_merge_request_approvers:m.merge_request_assignee_list)??[];}
export function pendingMembers(m:MrView,role:'reviewers'|'approvers'|'assignees'){return roleMembers(m,role).filter(p=>p.username&&p.approved!==true&&p.has_approved!==true&&p.reviewed!==true&&!['approved','passed','reviewed'].includes(String(p.state||p.status))).map(p=>p.username!);}
export function issueTitle(m:MrView,ticket:string){return m.e2e_issues?.find(i=>[i.id,i.issue_num,i.issue_id,i.number].some(n=>String(n)===ticket))?.title;}
export function safeMrUrl(value:string){const url=new URL(value);if(!['https:','http:'].includes(url.protocol)||url.username||url.password||!url.pathname.match(/\/merge_requests\/\d+/))throw Error('MR 地址无效');return value;}

// A generic 404 can hide a permissions problem; require an explicit MR-specific absence.
export function explicitlyMissingMr(exitCode:number,output:string):boolean{return exitCode!==0&&/error:\s*HTTP 404:\s*(?:merge request(?: \d+)? (?:not found|does not exist)|the merge request does not exist)\.?\s*$/i.test(output.trim());}
