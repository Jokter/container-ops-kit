import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import test from 'node:test'
import {JSDOM} from 'jsdom'

const html=await readFile(new URL('../../index.html',import.meta.url),'utf8')
const sha='a'.repeat(40),currentSha='b'.repeat(40),flush=()=>new Promise(resolve=>setTimeout(resolve,30))

async function setup(t,{pending='检视',stale=true,running=false,failAck=false,failReload=false,operationId=''}={}){
 const head=stale?currentSha:sha
 const record={id:'pending-approval',repo:'Demo/Service',iid:'1',sha,phase:'ISSUES',stage:'REVIEW',running,writePending:pending,status:'上次结果待核对',events:[],pipelinePassed:true,readiness:{sha:head,checkedAt:'2026-10-26T08:00:00Z',ready:!stale,reason:stale?'提交已变化':''}}
 if(operationId)record.approvalPending={operationId,sha,action:pending,username:'reviewer'}
 const threads=[{id:'history',body:'核对历史意见',path:'src/a.ts',line:1,outdated:true,headSha:sha,resolved:false,resolvable:true,fingerprint:'history-fingerprint',notes:[]}]
 const writes=[],reads=[]
 const response=(data,ok=true)=>({ok,status:ok?200:409,json:async()=>structuredClone(data)})
 const dom=new JSDOM(html,{runScripts:'dangerously',url:'http://localhost/#/automation/group-mr',beforeParse(w){
  w.scrollTo=()=>{};const timeout=w.setTimeout.bind(w);w.setTimeout=(fn,delay,...args)=>delay>500?0:timeout(fn,delay,...args)
  w.fetch=async(url,options)=>{
   if(options?.method==='POST'){
    writes.push({url,body:JSON.parse(options.body)})
    if(url.endsWith('/acknowledge-approval')){
     if(writes.at(-1).body.operationId!==(record.approvalPending?.operationId||''))return response({message:'待核对操作已变化，请刷新后核对'},false)
     if(failAck)return response({message:'核对远端失败，拦截保留'},false)
     record.writePending='';record.status='已人工核对本次结果并解除拦截';return response({ok:true})
    }
    return response({message:'恢复不能自动执行远端写操作'},false)
   }
   if(url.endsWith('/workspace')){
    reads.push(url)
    if(failReload&&reads.filter(v=>v.endsWith('/workspace')).length>1)return response({message:'远端读取失败'},false)
    return response({sha:head,stale,state:'opened',files:[{path:'src/a.ts',diff:'@@ -1 +1 @@\n-before\n+after',status:'modified'}],threads,capabilities:{reply:true,create:true},writePending:record.workspaceWritePending??record.writePending,readiness:record.readiness,pipelinePassed:true,readAt:'2026-10-26T08:00:00Z'})
   }
   if(['/api/automation/group-mr','/api/automation/group-mr/status'].includes(url)){reads.push(url);return response({config:{enabled:false},pending:[record],history:[],monitor:{},metrics:{pending:1}})}
   if(url==='/api/automation/knowledge')return response({items:[],reviews:[]})
   if(url.startsWith('/api/automation/effectiveness'))return response({total:0,stages:{},reviews:0,merged:0,anomalies:0,rejected:0})
   return response([])
  }
 }})
 t.after(async()=>{for(let i=0;i<30&&dom.window.eval('groupMrUi.actionBusy||groupMrUi.loading||Object.values(mrWorkbench.cache).some(v=>v.loading)');i++)await flush();dom.window.close()})
 await flush();const d=dom.window.document;d.querySelector('.nav-enter[data-mr-open="pending-approval"]').click();await flush()
 return {dom,d,record,writes,reads}
}

for(const pending of ['检视','审核'])test(pending+' recovery is available in code, opinions and processing records with accurate blocked text',async t=>{
 const {dom,d,writes}=await setup(t,{pending})
 await dom.window.eval('loadGroupMr()')
 assert.equal(d.querySelector('.mr-code-section [data-group-mr-action="ack-approval"]').disabled,false)
 assert.equal(d.querySelector('[data-mrw-resolve="history"]').disabled,true)
 assert.match(d.querySelector('.mr-code-section').textContent,/先核对并解除上次操作的拦截/)
 assert.doesNotMatch(d.querySelector('.mr-code-section').textContent,/仍可关闭历史意见|重新发送该 MR 链接完成检视/)
 d.querySelector('[data-mr-view="notes"]').click()
 assert.ok(d.querySelector('.nav-review-body [data-group-mr-action="ack-approval"]'))
 assert.doesNotMatch(d.querySelector('.nav-review-body').textContent,/仍可关闭历史意见|刷新核对最新代码后可关闭/)
 d.querySelector('[data-mr-records]').click()
 assert.ok(d.querySelector('.group-mr-detail [data-group-mr-action="ack-approval"]'))
 assert.equal(writes.length,0)
})

for(const pending of ['检视','审核'])test(pending+' acknowledgement submits the shown attempt and refreshes without replay',async t=>{
 const {dom,d,writes}=await setup(t,{pending})
 d.querySelector('[data-group-mr-action="ack-approval"]').click()
 assert.equal(writes.length,0)
 assert.match(d.querySelector('#studio-confirm-message').textContent,/核对本次检视或审核的实际结果/)
 assert.match(d.querySelector('#studio-confirm-message').textContent,/不重复提交检视或审核，不自动合入/)
 d.querySelector('[data-studio-confirm]').click();await flush();await flush()
 assert.deepEqual(writes,[{url:'/api/automation/group-mr/records/pending-approval/acknowledge-approval',body:{confirmed:true,sha,action:pending,operationId:''}}])
 assert.equal(d.querySelector('[data-group-mr-action="ack-approval"]'),null)
 assert.equal(dom.window.eval('mrSelected().sha'),sha,'acknowledgement must not renew an old reviewed commit')
 assert.equal(d.querySelector('[data-mrw-resolve="history"]').disabled,false)
 assert.equal(d.querySelector('[data-mrw-line]'),null,'a changed commit still cannot receive a new opinion')
 d.querySelector('[data-mr-records]').click()
 for(const action of ['review','merge'])assert.equal(d.querySelector('.group-mr-detail [data-group-mr-action="'+action+'"]').disabled,true)
 d.querySelector('[data-mrw-resolve="history"]').click()
 assert.ok(d.querySelector('[data-mrw-form="resolve"]'),'historical opinion closure can be opened after acknowledgement')
 assert.equal(writes.length,1)
})

test('cancelling result acknowledgement does not clear pending or make a request',async t=>{
 const {dom,d,writes}=await setup(t)
 d.querySelector('[data-group-mr-action="ack-approval"]').click();d.querySelector('[data-studio-cancel]').click();await flush()
 assert.equal(writes.length,0);assert.equal(dom.window.eval('mrSelected().writePending'),'检视')
 assert.equal(d.querySelector('[data-mrw-resolve="history"]').disabled,true)
})

test('failed acknowledgement leaves the blocker and displays its error',async t=>{
 const {dom,d,writes}=await setup(t,{failAck:true})
 d.querySelector('[data-group-mr-action="ack-approval"]').click();d.querySelector('[data-studio-confirm]').click();await flush();await flush()
 assert.equal(writes.length,1);assert.equal(dom.window.eval('mrSelected().writePending'),'检视')
 assert.ok(d.querySelector('[data-group-mr-action="ack-approval"]'))
 assert.equal(d.querySelector('[data-mrw-resolve="history"]').disabled,true)
 assert.match(d.body.textContent,/核对远端失败，拦截保留/)
})

test('an open acknowledgement remains bound to its original operation when the same commit gets a new attempt',async t=>{
 const {dom,d,record,writes}=await setup(t,{operationId:'original-operation'})
 d.querySelector('[data-group-mr-action="ack-approval"]').click()
 record.approvalPending.operationId='new-operation'
 await dom.window.eval('loadGroupMr()')
 d.querySelector('[data-studio-confirm]').click();await flush();await flush()
 assert.equal(writes.length,1)
 assert.deepEqual(writes[0].body,{confirmed:true,sha,action:'检视',operationId:'original-operation'})
 assert.equal(dom.window.eval('mrSelected().approvalPending.operationId'),'new-operation')
 assert.equal(dom.window.eval('mrSelected().writePending'),'检视')
 assert.equal(d.querySelector('[data-mrw-resolve="history"]').disabled,true)
 assert.ok(d.querySelector('[data-group-mr-action="ack-approval"]'))
 assert.match(d.body.textContent,/待核对操作已变化，请刷新后核对/)
})

test('failed workspace reload after acknowledgement keeps writes unavailable',async t=>{
 const {d,writes}=await setup(t,{failReload:true})
 d.querySelector('[data-group-mr-action="ack-approval"]').click();d.querySelector('[data-studio-confirm]').click();await flush();await flush()
 assert.equal(writes.length,1);assert.match(d.querySelector('.mr-code-section').textContent,/远端读取失败/)
 assert.equal(d.querySelector('[data-mrw-resolve="history"]').disabled,true)
})

test('read-only remote reconciliation refreshes the record instead of leaving a stale approval blocker',async t=>{
 const {dom,d,record,writes,reads}=await setup(t,{stale:false})
 const count=reads.filter(v=>['/api/automation/group-mr','/api/automation/group-mr/status'].includes(v)).length
 record.writePending=''
 await dom.window.eval('mrLoad("pending-approval")');await flush()
 assert.ok(reads.filter(v=>['/api/automation/group-mr','/api/automation/group-mr/status'].includes(v)).length>count)
 assert.equal(dom.window.eval('mrSelected().writePending'),'')
 assert.equal(d.querySelector('[data-mrw-resolve="history"]').disabled,false)
 assert.equal(writes.length,0)
})

test('a record refresh preserves a different pending operation after workspace reconciliation',async t=>{
 const {dom,d,record,writes}=await setup(t,{stale:false})
 record.writePending='合并';record.workspaceWritePending=''
 await dom.window.eval('mrLoad("pending-approval")');await flush()
 assert.equal(dom.window.eval('mrSelected().writePending'),'合并')
 assert.equal(d.querySelector('[data-mrw-resolve="history"]').disabled,true)
 assert.equal(d.querySelector('[data-group-mr-action="ack-approval"]'),null)
 assert.equal(writes.length,0)
})

for(const [pending,existing] of [['Pi 提交检视意见','ack-pi'],['群消息回复','ack'],['合并',null]])test('approval acknowledgement does not replace existing recovery for '+pending,async t=>{
 const {dom,d,writes}=await setup(t,{pending})
 d.querySelector('[data-mr-records]').click()
 await dom.window.eval('loadGroupMr()')
 assert.equal(d.querySelector('[data-group-mr-action="ack-approval"]'),null)
 if(existing)assert.equal(d.querySelector('[data-group-mr-action="'+existing+'"]').disabled,false)
 assert.equal(writes.length,0)
})

test('an executing approval never shows a manual recovery action',async t=>{
 const {d,writes}=await setup(t,{running:true})
 d.querySelector('[data-mr-records]').click()
 assert.equal(d.querySelector('[data-group-mr-action="ack-approval"]'),null)
 assert.equal(writes.length,0)
})
