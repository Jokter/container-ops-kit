import {createHash} from 'node:crypto';
import type {AutoUtTask} from './autout.js';
import {type MrSettings} from './mr-settings.js';
import {gateSchema,issueTitle,jsonValues,listObjects,mrIid,mrSchema,parseMr,parseObject,pendingMembers,pipelineSchema,roleMembers,safeMrUrl,type MrView} from './mr-codehub.js';
export type MrPhase='SETUP'|'PIPELINE'|'REVIEW'|'APPROVE'|'MERGE';
export interface MrTracking {
 config:MrSettings;iid:string;sha:string;phase:MrPhase;nextAt:number;paused:boolean;error:string;
 setup:{linked?:boolean;title?:boolean;reviewers?:boolean;approvers?:boolean;assignees?:boolean};
 awaitingSha?:string;awaitingSince?:number;repairBaseSha?:string;repairCommitSha?:string;uploadAttempted?:boolean;writePending?:string;rounds:number;handled:string[];fingerprint?:string;stalled:number;
 notifications:Record<string,{count:number;at:number;pending?:boolean;escalated?:boolean}>;
 queryFailures:number;pipelineId?:string;generation:number;
}
export interface MrHooks {
 run(task:AutoUtTask,args:string[],label:string,required?:boolean):Promise<{exitCode:number;output:string}>;
 save(task:AutoUtTask):void;
 event(task:AutoUtTask,message:string):void;
 state(task:AutoUtTask,state:'MR_PENDING'|'MR_REPAIRING'|'RESOLVED'|'MR_CLOSED'|'WAITING_EXTERNAL',message:string):void;
 repair(task:AutoUtTask,details:string,sha:string):Promise<string>;
}
export function newTracking(config:MrSettings):MrTracking {return {config,iid:'',sha:'',phase:'SETUP',nextAt:0,paused:false,error:'',setup:{},rounds:0,handled:[],stalled:0,notifications:{},queryFailures:0,generation:0};}
export class MrWorkflow {
 constructor(private hooks:MrHooks){}
 private async command(task:AutoUtTask,args:string[],label:string){
  const operation=args.slice(0,2).join(' ');
  const columns=operation==='mr gate'?'ci_state_passed,quality_gate,merge_gate_passed,conflict_passed,approval_reviewers_required_passed,approval_approvers_required_passed,pipeline':operation==='mr pipeline'||operation==='pipeline view'?'id,status,sha,commit_id,commit':operation==='pipeline failure'?'id,status,ref,failures,quality,codecheck,jobs':'id,iid,mr_url,web_url,state,title,description,source_branch,target_branch,sha,diff_refs,e2e_issues,approval_merge_request_reviewers,approval_merge_request_approvers,merge_request_assignee_list';
  return this.hooks.run(task,['codehub-cli',...args,'--format','json','--columns',columns],label);
 }
 private save(task:AutoUtTask){this.hooks.save(task);}
 private pending(task:AutoUtTask,action:string){task.mr!.writePending=action;this.save(task);}
 private done(task:AutoUtTask){delete task.mr!.writePending;this.save(task);}
 async recoverUpload(task:AutoUtTask):Promise<boolean>{
  const response=await this.command(task,['mr','list','--state','opened','--source-branch',task.repairBranch,'--target-branch',task.baseBranch,'--limit','100'],'核对已有MR');
  const candidates=listObjects(response.output).map(v=>mrSchema.parse(v)).filter(m=>m.state==='opened'&&m.source_branch===task.repairBranch&&m.target_branch===task.baseBranch);
  if(candidates.length>1)throw Error('修复分支匹配到多个 opened MR，请人工核对，禁止重复创建。');
  if(!candidates.length)return false;
  this.attach(task,candidates[0]!);return true;
 }
 attach(task:AutoUtTask,m:MrView){const tracking=task.mr!;tracking.iid=mrIid(m);const url=m.mr_url||m.web_url;if(!url)throw Error('MR 已存在但没有地址，请检查 CLI 返回。');task.pullRequestUrl=safeMrUrl(url);task.governance!.mrState='PENDING';delete task.governance!.completedAt;this.done(task);this.hooks.state(task,'MR_PENDING','MR 已创建，正在补齐单号、标题和处理人员。');this.save(task);}
 private async view(task:AutoUtTask){return parseMr((await this.command(task,['mr','view',task.mr!.iid],'读取MR状态与人员')).output);}
 async setup(task:AutoUtTask){
  const tracking=task.mr!;let view=await this.view(task);if(this.terminal(task,view))return;
  // Every write is preceded by a read. An interrupted/failed write is never blindly replayed.
  for(const step of ['linked','title','reviewers','approvers','assignees'] as const){
   if(tracking.setup[step])continue;
   const people=step==='linked'||step==='title'?[]:tracking.config.roles[step];
   const title=issueTitle(view,task.ticket);
   const matches=step==='linked'?!!view.e2e_issues?.some(i=>[i.id,i.issue_num,i.issue_id,i.number].some(n=>String(n)===task.ticket)):step==='title'?!!title&&view.title===title:!people.length||people.every(p=>roleMembers(view,step).some(m=>m.username?.toLowerCase()===p.toLowerCase()));
   if(matches){tracking.setup[step]=true;if(tracking.writePending===step)this.done(task);this.save(task);continue;}
   if(tracking.writePending)throw Error('上次 '+tracking.writePending+' 结果未确认；已读取远端但未满足目标，请重试当前步骤。');
   if(step==='title'&&!title)throw Error('关联单号未返回匹配的标题，请核对 CodeHub E2E 单号字段。');
   const args=step==='linked'?['--e2e-issues',task.ticket]:step==='title'?['--title',title!]:[step==='reviewers'?'--approval-reviewers':step==='approvers'?'--approval-approvers':'--assignees',people.join(',')];
   this.pending(task,step);
   await this.command(task,['mr','update',tracking.iid,...args],step==='linked'?'关联单号':step==='title'?'同步单号标题':'配置MR'+step);
   view=await this.view(task);
   const verified=step==='linked'?!!issueTitle(view,task.ticket):step==='title'?view.title===title:people.every(p=>roleMembers(view,step).some(m=>m.username?.toLowerCase()===p.toLowerCase()));
   if(!verified)throw Error('MR '+step+' 尚未确认生效，请核对权限或配置后重试。');
   tracking.setup[step]=true;this.done(task);
  }
  tracking.phase='PIPELINE';tracking.error='';tracking.paused=false;tracking.nextAt=0;task.nextStage='TRACK';task.progress=92;this.hooks.state(task,'MR_PENDING','MR 已就绪，等待当前提交的流水线。');this.save(task);
 }
 private terminal(task:AutoUtTask,view:MrView){
  if(view.state!=='merged'&&view.state!=='closed')return false;
  const merged=view.state==='merged';task.governance!.mrState=merged?'MERGED':'CLOSED';task.nextStage='DONE';task.progress=merged?100:task.progress;task.mr!.paused=true;task.mr!.error='';
  if(merged)task.governance!.completedAt=new Date().toISOString();
  this.hooks.state(task,merged?'RESOLVED':'MR_CLOSED',merged?'MR 已合入，治理任务完成。':'MR 已关闭，治理任务未合入。');this.save(task);return true;
 }
 async checkTerminal(task:AutoUtTask){return this.terminal(task,await this.view(task));}
 async tick(task:AutoUtTask,now=Date.now()){
  const m=task.mr!;if(!m.iid)return;
  try{
   const view=await this.view(task);if(this.terminal(task,view))return;
   if(m.paused){if(m.error!=='已手动暂停自动处理')await this.notifyIntervention(task,now);return;}
   if(m.writePending){m.paused=true;m.error='检测到未确认的写操作，请重试当前步骤核对远端。';this.save(task);return;}
   if(m.phase==='SETUP'){await this.setup(task);return;}
   const sha=view.diff_refs?.head_sha||view.sha;if(!sha)throw Error('MR 未返回当前提交 SHA，暂停判断流水线。');
   if(m.awaitingSha&&sha!==m.awaitingSha){if(now-(m.awaitingSince||now)>1800000)this.pause(task,'远端 MR 尚未更新到已推送提交，请核对 MR 来源分支。');else this.hooks.state(task,'MR_PENDING','已推送新提交，等待 CodeHub 更新 MR。');return;}delete m.awaitingSha;delete m.awaitingSince;
   if(m.sha!==sha){m.sha=sha;m.phase='PIPELINE';m.generation++;this.hooks.event(task,'检测到 MR 新提交，重新检查流水线与审批状态。');}
   const gate=parseObject(gateSchema,(await this.command(task,['mr','gate',m.iid],'检查MR门禁')).output,g=>g.ci_state_passed!==undefined);
   const pipelines=listObjects((await this.command(task,['mr','pipeline',m.iid],'读取MR流水线')).output).map(p=>pipelineSchema.parse(p));
   let pipeline=pipelines.find(p=>(p.sha||p.commit_id||p.commit?.id)===sha);
   if(!pipeline&&pipelines.length){const newest=pipelines[0]!;const detail=parseObject(pipelineSchema,(await this.command(task,['pipeline','view',newest.id],'核对流水线提交')).output,p=>!!p.id);if((detail.sha||detail.commit_id||detail.commit?.id)===sha)pipeline=detail;}
   m.queryFailures=0;m.error='';
   if(!pipeline){m.phase='PIPELINE';this.hooks.state(task,'MR_PENDING','等待当前提交触发流水线。');return;}
   m.pipelineId=pipeline.id;
   if(['created','pending','running','waiting','preparing','queued'].includes(pipeline.status)){m.phase='PIPELINE';this.hooks.state(task,'MR_PENDING','当前提交流水线执行中。');return;}
   if(pipeline.status==='failed'){m.phase='PIPELINE';await this.failure(task,pipeline.id,sha,now);return;}
   if(pipeline.status!=='success'){this.pause(task,'流水线状态为 '+pipeline.status+'，需要人工处理。');return;}
   if(gate.ci_state_passed!==true||gate.quality_gate?.passed===false||gate.conflict_passed===false){this.pause(task,'流水线执行成功，但质量门禁、CI 或合并冲突检查未通过。');return;}
   const phase=gate.approval_reviewers_required_passed!==true?'REVIEW':gate.approval_approvers_required_passed!==true?'APPROVE':'MERGE';
   if((phase==='REVIEW'&&gate.approval_reviewers_required_passed===undefined)||(phase==='APPROVE'&&gate.approval_approvers_required_passed===undefined))throw Error('CodeHub 未返回检视或审核门禁状态，不能推断已通过。');
   m.phase=phase;this.hooks.state(task,'MR_PENDING',phase==='REVIEW'?'流水线通过，等待检视。':phase==='APPROVE'?'检视通过，等待审核。':'审核通过，等待合并。');
   await this.notifyPhase(task,view,now);
  }catch(error){m.queryFailures++;m.error=error instanceof Error?error.message:'MR 跟踪异常';if(m.writePending)this.pause(task,m.error);else if(m.queryFailures>=3)await this.notifyIntervention(task,now);}
  finally{m.nextAt=now+(m.queryFailures?Math.min(900,60*2**Math.min(m.queryFailures,4)):m.phase==='PIPELINE'?m.config.pipelineSeconds:m.config.reviewSeconds)*1000;this.save(task);}
 }
 pause(task:AutoUtTask,reason:string){task.mr!.paused=true;task.mr!.error=reason;this.hooks.state(task,'WAITING_EXTERNAL',reason);this.save(task);}
 private async failure(task:AutoUtTask,id:string,sha:string,now:number){
  const m=task.mr!,key=sha+':'+id;
  if(m.handled.includes(key)){this.pause(task,'该失败流水线已处理，等待新提交或人工重试，避免重复修复。');return;}
  if(!m.config.autoRepair||m.rounds>=m.config.maxRepairRounds){this.pause(task,'流水线自动修复已关闭或达到轮次上限，请人工处理。');await this.notifyIntervention(task,now);return;}
  const failure=await this.command(task,['pipeline','failure',id],'获取流水线失败详情');
  const details=jsonValues(failure.output).map(v=>JSON.stringify(v)).join('\n').slice(0,40000);
  if(!details||/unauthorized|permission denied|could not resolve dependencies|connection refused|timed? out|无权限|网络异常/i.test(details)||!/(src[\\/]test[\\/]|surefire|AssertionError|test failure|测试失败|失败用例)/i.test(details)){this.pause(task,'流水线失败未定位到可修复的测试代码，请查看失败详情后人工处理。');await this.notifyIntervention(task,now);return;}
  const fingerprint=createHash('sha256').update(details.replace(/[0-9a-f]{40}/g,'SHA').replace(/\d{4}-\d\d-\d\dT[^"\s]+/g,'TIME')).digest('hex');
  m.stalled=m.fingerprint===fingerprint?m.stalled+1:0;m.fingerprint=fingerprint;
  if(m.stalled>=1){this.pause(task,'连续两轮出现相同失败，自动修复已暂停。');return;}
  m.handled.push(key);m.rounds++;this.pending(task,'pipeline-repair');this.hooks.state(task,'MR_REPAIRING','正在修复第 '+m.rounds+' 轮流水线失败。');this.save(task);
  try{m.sha=await this.hooks.repair(task,details,sha);m.awaitingSha=m.sha;m.awaitingSince=now;m.generation++;m.phase='PIPELINE';this.done(task);this.hooks.state(task,'MR_PENDING','测试修复已推送，等待新提交流水线。');}
  catch(error){this.pause(task,error instanceof Error?error.message:'流水线修复失败');await this.notifyIntervention(task,now);}
 }
 private async send(task:AutoUtTask,receiver:string,message:string,key:string,now:number){
  const m=task.mr!,entry=m.notifications[key]??={count:0,at:0};
  if(entry.pending)throw Error('上次通知发送结果未确认，请人工核对：'+receiver);
  entry.pending=true;this.save(task);
  const result=await this.hooks.run(task,['welink-cli','im','send-to-user','--receiver',m.config.welinkAccounts[receiver]||receiver,'--text',message],'发送'+key+'通知',false);
  const success=result.exitCode===0&&jsonValues(result.output).some(v=>{if(!v||typeof v!=='object')return false;const r=v as Record<string,unknown>;return r.resultCode==='0'||r.resultCode===0;});
  if(!success)throw Error('WeLink 通知结果未确认，请检查账号或登录状态：'+receiver);
  entry.pending=false;entry.count++;entry.at=now;this.save(task);
 }
 private async notifyPhase(task:AutoUtTask,view:MrView,now:number){
  const m=task.mr!;if(!m.config.notifications)return;
  const role=m.phase==='REVIEW'?'reviewers':m.phase==='APPROVE'?'approvers':'assignees',label=m.phase==='REVIEW'?'检视':m.phase==='APPROVE'?'审核':'合并';
  const people=pendingMembers(view,role);if(!people.length){this.pause(task,'MR 未返回待处理的'+label+'人员，请配置或核对门禁。');return;}
  for(const receiver of [...new Set(people)]){
   const key=m.sha+':'+m.generation+':'+m.phase+':'+receiver,entry=m.notifications[key];
   if(entry?.pending){m.error='有通知发送结果待确认，请核对 WeLink 发送记录。';await this.notifyIntervention(task,now,m.error);continue;}
   if(entry&&Math.max(0,now-entry.at)/60000<m.config.reminderMinutes)continue;
   if(entry&&entry.count>=2){if(!entry.escalated){await this.notifyIntervention(task,now,label+'已提醒两次仍未处理');entry.escalated=true;this.save(task);}continue;}
   await this.send(task,receiver,`UT 治理 MR 请${label}${entry?'（再次提醒）':''}。\n仓库：${task.repository}\nMR：${task.pullRequestUrl}`,key,now);
  }
 }
 private async notifyIntervention(task:AutoUtTask,now:number,reason=task.mr!.error){
  const m=task.mr!;if(!m.config.notifications||!reason)return;
  const receiver=m.config.contact||task.username,key='intervention:'+m.sha+':'+m.generation+':'+m.phase;
  if(m.notifications[key]?.count||m.notifications[key]?.pending)return;
  try{await this.send(task,receiver,`UT 治理 MR 需要介入。\n仓库：${task.repository}\nMR：${task.pullRequestUrl}\n原因：${reason.slice(0,600)}`,key,now);}catch(error){this.hooks.event(task,error instanceof Error?error.message:'异常通知失败');}
 }
}
