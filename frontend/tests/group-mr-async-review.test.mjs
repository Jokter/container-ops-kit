import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {JSDOM} from 'jsdom'

const html=await readFile(new URL('../../index.html',import.meta.url),'utf8')
const sha='a'.repeat(40)
const flush=()=>new Promise(resolve=>setTimeout(resolve,30))
const row=id=>({id,repo:'MAE-M/FMEMate/FMEMateService',iid:id,url:'https://codehub-y.huawei.com/MAE-M/FMEMate/FMEMateService/merge_requests/'+id,sha,phase:'HUMAN',status:'等待人工审核',sender:'developer',createdAt:'2026-10-31T01:00:00Z',updatedAt:'2026-10-31T01:00:00Z',writePending:'',reviewComments:[],readiness:{sha,checkedAt:new Date().toISOString(),ready:true,reason:''},pipelinePassed:true,humanReviewRequired:true,piReview:{sha,source:'codehub',ok:true,findings:[]},events:[]})
const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>structuredClone(data)})
const reviewButton=(d,id)=>d.querySelector('[data-group-mr-action="review"][data-record-id="'+id+'"]')

async function setup(t,{records=[row('1'),row('2')],write}={}){
 const calls=[],reads=[],timers=new Map(),postReleases=new Map(),readReleases=[]
 let holdReads=false,failReads=false,timerId=100000
 const snapshot=()=>({config:{enabled:true,groupId:'123456789',authorizedSender:'owner'},pending:records.filter(r=>!['DONE','CLOSED'].includes(r.phase)),history:records.filter(r=>['DONE','CLOSED'].includes(r.phase)),metrics:{pending:records.filter(r=>!['DONE','CLOSED'].includes(r.phase)).length,issues:0,mergedToday:0},monitor:{}})
 const accept=(id,status='queued')=>{const r=records.find(r=>r.id===id);r.reviewJob={id:'job-'+id,sha:r.sha,status};return response(r,202)}
 const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'http://localhost/#/automation/group-mr',beforeParse(w){
  w.scrollTo=()=>{}
  const timeout=w.setTimeout.bind(w),clear=w.clearTimeout.bind(w)
  w.setTimeout=(fn,delay,...args)=>{if(delay>=500){const id=++timerId;timers.set(id,{fn,delay,args});return id}return timeout(fn,delay,...args)}
  w.clearTimeout=id=>{if(timers.has(id))timers.delete(id);else clear(id)}
  w.fetch=async(url,options)=>{
   if(options?.method==='POST'){
    const body=JSON.parse(options.body),id=url.split('/').at(-2);calls.push({url,body,id})
    if(write)return write({url,body,id,accept,records})
    return new Promise(resolve=>postReleases.set(id,()=>resolve(accept(id))))
   }
   reads.push(url)
   if(url==='/api/automation/group-mr'||url==='/api/automation/group-mr/status'){
    if(failReads)return response({message:'状态读取失败'},503)
    if(holdReads)return new Promise(resolve=>readReleases.push(()=>resolve(response(snapshot()))))
    return response(snapshot())
   }
   if(url.endsWith('/workspace')){const r=records.find(r=>url.includes('/'+r.id+'/'));return response({sha:r.sha,state:'opened',files:[{path:'src/review.ts',oldPath:'src/review.ts',status:'modified',diff:'@@ -1 +1 @@\n-before\n+after'}],threads:r.reviewComments,readiness:r.readiness,capabilities:{}})}
   if(url==='/api/automation/knowledge')return response({items:[],reviews:[]})
   if(url.startsWith('/api/automation/effectiveness'))return response({total:0,stages:{},reviews:0,merged:0,anomalies:0,rejected:0})
   return response([])
  }
 }})
 t.after(async()=>{holdReads=false;for(const release of postReleases.values())release();postReleases.clear();for(const release of readReleases.splice(0))release();await flush();dom.window.close()})
 for(let i=0;i<20&&!dom.window.document.querySelector('[data-group-mr-record]');i++)await flush()
 return {dom,d:dom.window.document,calls,reads,records,timers,postReleases,accept,holdReads:value=>{holdReads=value},failReads:value=>{failReads=value},releaseReads:()=>{for(const release of readReleases.splice(0))release()},pollDelay:()=>timers.get(dom.window.eval('groupMrUi.poll'))?.delay}
}

async function returnToList(d){d.querySelector('[data-mrw-focus]').click();for(let i=0;i<20&&!d.querySelector('.nav-list');i++)await flush();assert.ok(d.querySelector('.nav-list'))}

test('one MR approval leaves another MR approval and read-only navigation available',async t=>{
 const {dom,d,calls}=await setup(t)
 reviewButton(d,'1').click()
 assert.equal(reviewButton(d,'1').disabled,true)
 assert.equal(reviewButton(d,'2').disabled,false)
 d.querySelector('[data-mr-open="2"]').click();await flush()
 assert.equal(dom.window.eval('groupMrUi.selected'),'2')
 assert.ok(d.querySelector('.nav-review'))
 assert.equal(d.querySelector('[data-mrw-focus]').disabled,false)
 const previous=d.querySelector('[data-mrw-next="-1"]');assert.equal(previous.disabled,false);previous.click();await flush()
 assert.equal(dom.window.eval('groupMrUi.selected'),'1')
 await returnToList(d)
 assert.equal(calls.length,1)
 assert.match(calls[0].url,/\/records\/1\/review-jobs$/)
})

test('separate MR submissions may overlap while repeat clicks on the same MR are deduplicated',async t=>{
 const {dom,d,calls,postReleases}=await setup(t)
 const first=reviewButton(d,'1');first.click();first.click()
 await dom.window.eval("groupMrRecordAction('review','1')")
 reviewButton(d,'2').click()
 assert.deepEqual(calls.map(c=>c.id),['1','2'])
 assert.equal(reviewButton(d,'1').disabled,true)
 assert.equal(reviewButton(d,'2').disabled,true)
 postReleases.get('2')();postReleases.delete('2');await flush()
 assert.equal(reviewButton(d,'1').disabled,true)
 const panels=[...d.querySelectorAll('[data-mr-review-feedback]')];assert.equal(panels.length,2)
 assert.match(panels.find(el=>el.textContent.includes('!1')).textContent,/提交/)
 assert.match(panels.find(el=>el.textContent.includes('!2')).textContent,/已提交|已受理|等待/)
 postReleases.get('1')();postReleases.delete('1');await flush()
 assert.deepEqual(calls.map(c=>c.id),['1','2'])
})

test('202 acceptance does not claim that human review or merge has succeeded',async t=>{
 const {dom,d,calls}=await setup(t,{write:async({id,accept})=>accept(id)})
 reviewButton(d,'1').click();await flush()
 assert.equal(calls.length,1)
 assert.equal(dom.window.eval("groupMrUi.pending.find(r=>r.id==='1').humanReview"),undefined)
 const feedback=d.querySelector('[data-mr-review-feedback]').textContent
 assert.match(feedback,/已提交|已受理|等待/)
 assert.doesNotMatch(feedback,/1 条审核已保存|1 条已合入/)
 assert.equal(reviewButton(d,'1')?.disabled,true)
 assert.equal(reviewButton(d,'2').disabled,false)
})

test('POST completion does not keep unrelated controls waiting for a list refresh',async t=>{
 const {dom,d,postReleases,holdReads,calls}=await setup(t)
 reviewButton(d,'1').click()
 holdReads(true)
 postReleases.get('1')();postReleases.delete('1');await flush()
 assert.equal(reviewButton(d,'2').disabled,false)
 d.querySelector('[data-mr-open="2"]').click();await flush()
 assert.equal(dom.window.eval('groupMrUi.selected'),'2')
 assert.equal(d.querySelector('[data-mrw-focus]').disabled,false)
 await returnToList(d)
 reviewButton(d,'2').click()
 assert.deepEqual(calls.map(c=>c.id),['1','2'])
})

test('status polling uses local snapshots at three seconds for active jobs and ten seconds when idle',async t=>{
 const {dom,d,records,reads,pollDelay}=await setup(t,{write:async({id,accept})=>accept(id)})
 dom.window.eval('scheduleGroupMrPolling()');assert.equal(pollDelay(),10000)
 reviewButton(d,'1').click();await flush()
 dom.window.eval('scheduleGroupMrPolling()');assert.equal(pollDelay(),3000)
 records[0].reviewJob.status='failed';records[0].reviewJob.error='流水线未通过';records[0].running=false;records[0].queued=false
 await dom.window.eval('loadGroupMr()')
 dom.window.eval('scheduleGroupMrPolling()');assert.equal(pollDelay(),10000)
 assert.ok(reads.includes('/api/automation/group-mr/status'))
})

test('a lost submission response blocks repeat writes until a read reconciles the accepted job',async t=>{
 let accepted=false
 const {dom,d,calls,records,holdReads,releaseReads}=await setup(t,{write:async({id,accept})=>{accept(id);accepted=true;throw Error('网络连接断开')}})
 holdReads(true)
 reviewButton(d,'1').click();await flush()
 assert.equal(accepted,true)
 assert.equal(reviewButton(d,'1').disabled,true)
 assert.equal(reviewButton(d,'2').disabled,false)
 await dom.window.eval("groupMrRecordAction('review','1')")
 assert.equal(calls.length,1)
 assert.match(d.querySelector('[data-mr-review-feedback]').textContent,/核对|未确认|不明/)
 holdReads(false);releaseReads();await flush();await dom.window.eval('loadGroupMr()')
 assert.equal(dom.window.eval("groupMrUi.pending.find(r=>r.id==='1').reviewJob.id"),'job-1')
 assert.equal(reviewButton(d,'1').disabled,true)
 assert.equal(calls.length,1)
 records[0].reviewJob.status='failed';records[0].reviewJob.error='流水线未通过';records[0].running=false;records[0].queued=false
 await dom.window.eval('loadGroupMr()')
 assert.equal(reviewButton(d,'1').disabled,false)
})

test('a pending approval does not prevent paging to other MR records',async t=>{
 const {d,calls}=await setup(t,{records:Array.from({length:12},(_,i)=>row(String(i+1)))})
 reviewButton(d,'1').click()
 d.querySelector('[data-mrw-page="1"]').click()
 assert.equal(d.querySelector('[data-group-mr-record]').dataset.groupMrRecord,'11')
 assert.equal(reviewButton(d,'11').disabled,false)
 d.querySelector('[data-mrw-page="-1"]').click()
 assert.equal(reviewButton(d,'1').disabled,true)
 assert.equal(calls.length,1)
})

test('closing accepted-task feedback leaves the backend job and repeat-write protection intact',async t=>{
 const {dom,d,calls,records}=await setup(t,{write:async({id,accept})=>accept(id)})
 reviewButton(d,'1').click();await flush()
 const close=d.querySelector('[data-mr-review-feedback] [data-mr-review-dismiss]')
 assert.ok(close);close.click()
 assert.equal(d.querySelector('[data-mr-review-feedback]'),null)
 assert.equal(reviewButton(d,'1').disabled,true)
 assert.equal(dom.window.eval("groupMrUi.pending.find(r=>r.id==='1').reviewJob.status"),'queued')
 records[0].humanReview={sha,decision:'pass'};records[0].reviewJob.status='completed';records[0].phase='DONE'
 await dom.window.eval('loadGroupMr()')
 assert.equal(d.querySelector('[data-group-mr-record="1"]'),null)
 assert.equal(calls.length,1)
})


test('an older job for the same SHA cannot confirm a lost new submission response',async t=>{
 const existing=row('1');existing.reviewJob={id:'previous-job',sha,status:'failed',error:'上次流水线未通过'}
 const {dom,d,calls,records}=await setup(t,{records:[existing,row('2')],write:async()=>{throw Error('连接断开，受理结果未知')}})
 reviewButton(d,'1').click();await flush()
 await dom.window.eval('loadGroupMr()')
 assert.equal(reviewButton(d,'1').disabled,true)
 assert.match(d.querySelector('[data-mr-review-feedback]').textContent,/提交结果待核对|受理结果未确认/)
 assert.doesNotMatch(d.querySelector('[data-mr-review-feedback]').textContent,/审核任务未完成：上次流水线未通过/)
 await dom.window.eval("groupMrRecordAction('review','1')");assert.equal(calls.length,1)
 delete records[0].reviewJob;await dom.window.eval('loadGroupMr()');assert.equal(reviewButton(d,'1').disabled,true)
 records[0].reviewJob={id:'new-job',sha,status:'failed',error:'本次核验失败'}
 await dom.window.eval('loadGroupMr()')
 assert.equal(reviewButton(d,'1').disabled,false)
 assert.equal(calls.length,1)
})

test('active job submission and local status polling retain the current diff DOM and scroll position',async t=>{
 const {dom,d,records}=await setup(t,{write:async({id,accept})=>accept(id)})
 d.querySelector('[data-mr-open="1"]').click();await flush()
 const diff=d.querySelector('.mr-diff-scroll');assert.ok(diff);diff.scrollTop=240;diff.scrollLeft=70
 reviewButton(d,'1').click();await flush()
 assert.equal(d.querySelector('.mr-diff-scroll'),diff)
 records[0].reviewJob.status='checking';records[0].status='正在核对流水线与意见'
 await dom.window.eval('loadGroupMr()')
 assert.equal(d.querySelector('.mr-diff-scroll'),diff)
 assert.equal(diff.scrollTop,240);assert.equal(diff.scrollLeft,70)
 assert.match(d.querySelector('[data-mr-review-feedback]').textContent,/正在核对/)
})

test('a definitive submission rejection releases that MR immediately even if the following status read stalls',async t=>{
 const {d,calls,holdReads}=await setup(t,{write:async()=>response({message:'本次请求未受理'},409)})
 holdReads(true)
 reviewButton(d,'1').click();assert.equal(reviewButton(d,'1').disabled,true);await flush()
 assert.equal(reviewButton(d,'1').disabled,false)
 assert.equal(reviewButton(d,'2').disabled,false)
 assert.match(d.querySelector('[data-mr-review-feedback]').textContent,/本次请求未受理/)
 assert.equal(calls.length,1)
})


for(const [phase,label] of [['DONE','已合入'],['CLOSED','已关闭']])test('terminal MR status remains authoritative when its background review job failed: '+phase,async t=>{
 const {dom,d,records,calls}=await setup(t,{write:async({id,accept})=>accept(id)})
 reviewButton(d,'1').click();await flush()
 records[0].phase=phase;records[0].reviewJob.status='failed';records[0].reviewJob.error='远端已结束，停止后台任务';records[0].running=false;records[0].queued=false
 await dom.window.eval('loadGroupMr()')
 assert.match(d.querySelector('[data-mr-review-feedback]').textContent,new RegExp(label))
 assert.doesNotMatch(d.querySelector('[data-mr-review-feedback]').textContent,/审核任务未完成/)
 assert.equal(calls.length,1)
})


test('an unconfirmed submission can be unlocked only after a successful status check and explicit confirmation',async t=>{
 const {dom,d,calls}=await setup(t,{write:async()=>{throw Error('响应丢失')}})
 reviewButton(d,'1').click();await flush();await dom.window.eval('loadGroupMr()')
 assert.equal(reviewButton(d,'1').disabled,true)
 d.querySelector('[data-mr-review-dismiss]').click()
 assert.ok(d.querySelector('[data-mr-review-feedback]'),'unknown results must retain their recovery entry')
 const unblock=d.querySelector('[data-mr-review-unblock="1"]');assert.ok(unblock);unblock.click()
 assert.ok(d.querySelector('[data-studio-confirm]'));assert.equal(calls.length,1)
 d.querySelector('[data-studio-confirm]').click();await flush()
 assert.equal(calls.length,1,'unlocking cannot replay the submission')
 assert.equal(reviewButton(d,'1').disabled,false)
 reviewButton(d,'1').click();await flush()
 assert.equal(calls.length,2,'only another explicit user click may create a new submission')
})

test('failed status reads do not expose the unconfirmed-submission unlock action',async t=>{
 const {dom,d,calls,failReads}=await setup(t,{write:async()=>{throw Error('响应丢失')}})
 failReads(true);reviewButton(d,'1').click();await flush();await dom.window.eval('loadGroupMr()')
 assert.equal(d.querySelector('[data-mr-review-unblock="1"]'),null)
 assert.equal(reviewButton(d,'1').disabled,true)
 assert.equal(calls.length,1)
 failReads(false);await dom.window.eval('loadGroupMr()')
 assert.ok(d.querySelector('[data-mr-review-unblock="1"]'))
 assert.equal(calls.length,1)
})

test('unblocking a local submission warning preserves an independent backend uncertain-write marker',async t=>{
 const {dom,d,calls,records}=await setup(t,{write:async()=>{throw Error('响应丢失')}})
 reviewButton(d,'1').click();await flush()
 records[0].writePending='合并';await dom.window.eval('loadGroupMr()')
 d.querySelector('[data-mr-review-unblock="1"]').click();d.querySelector('[data-studio-confirm]').click();await flush()
 assert.equal(dom.window.eval("groupMrUi.pending.find(r=>r.id==='1').writePending"),'合并')
 assert.equal(d.querySelector('[data-group-mr-action="review"][data-record-id="1"]:not(:disabled)'),null)
 assert.equal(d.querySelector('[data-group-mr-action="merge"][data-record-id="1"]:not(:disabled)'),null)
 await dom.window.eval("groupMrRecordAction('review','1')")
 assert.equal(calls.length,1)
})
