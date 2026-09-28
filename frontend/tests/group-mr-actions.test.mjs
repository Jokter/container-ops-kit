import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {JSDOM} from 'jsdom'
const html=await readFile(new URL('../../index.html',import.meta.url),'utf8')
const sha='a'.repeat(40),flush=()=>new Promise(r=>setTimeout(r,40))
const row=(id,phase='HUMAN')=>({id,repo:'MAE-M/FMEMate/FMEMateService',iid:id,url:'https://codehub-y.huawei.com/MAE-M/FMEMate/FMEMateService/merge_requests/'+id,sha,phase,status:'待处理',sender:'developer',createdAt:'2026-09-28T11:00:00Z',updatedAt:'2026-09-28T11:00:00Z',writePending:'',pipelinePassed:true,humanReviewRequired:true,humanReview:phase==='HUMAN'?undefined:{sha,decision:'pass'},piReview:{sha,source:'codehub',ok:true,findings:[]},events:[]})
async function setup(t,{records=[row('1'),row('2'),row('3','NO_PERMISSION'),row('4','INTERRUPTED')],write}={}){
 const calls=[],history=[],response=(data,ok=true)=>({ok,status:ok?200:409,json:async()=>data})
 const dom=new JSDOM(html,{runScripts:'dangerously',url:'http://localhost/#/automation/group-mr',beforeParse(w){w.scrollTo=()=>{};const timeout=w.setTimeout.bind(w);w.setTimeout=(fn,delay,...args)=>delay>500?0:timeout(fn,delay,...args);w.fetch=async(url,options)=>{
  if(options?.method==='POST'){
   const data=JSON.parse(options.body);calls.push({url,data});if(write)return write(url,data,response)
   const id=url.split('/').at(-2),r=records.find(r=>r.id===id)
   if(url.endsWith('/human-review')){if(id==='2')return response({message:'提交已变化，请重新审核'},false);Object.assign(r,{phase:data.decision==='pass'?'REVIEW':'HUMAN',humanReview:{...data}});return response(r)}
   if(id==='4')return response({...r,status:'无法合入：当前账号无合并权限'})
   r.phase='DONE';records.splice(records.indexOf(r),1);history.push(r);return response(r)
  }
  if(url==='/api/automation/group-mr')return response({config:{enabled:true,groupId:'123456789',authorizedSender:'owner'},pending:records,history,metrics:{pending:records.length,issues:0,mergedToday:history.length},monitor:{}})
  if(url==='/api/automation/knowledge')return response({items:[],reviews:[]})
  if(url.startsWith('/api/automation/effectiveness'))return response({total:0,stages:{},reviews:0,merged:0,anomalies:0,rejected:0})
  return response([])
 }}})
 t.after(()=>dom.window.close());await flush();return {dom,d:dom.window.document,calls,records}
}
function select(d,...ids){for(const id of ids)d.querySelector('[data-group-mr-check="'+id+'"]').click()}
function decide(dom,value,reason=''){const f=dom.window.document.querySelector('#mr-action-review-form');f.querySelector('[value="'+value+'"]').click();const r=f.querySelector('textarea');r.value=reason;r.dispatchEvent(new dom.window.Event('input',{bubbles:true}))}
test('MR 标题打开真实链接，点击行仍可选详情，非法链接不呈现且操作表头左对齐',async t=>{
 const {dom,d}=await setup(t,{records:[row('1'),row('2'),{...row('3'),url:'javascript:alert(1)'},{...row('4','PI'),running:true}]})
 const a=d.querySelector('[data-group-mr-record-button="2"]');assert.equal(a.href,row('2').url);assert.equal(a.target,'_blank');assert.match(a.rel,/noopener/);a.addEventListener('click',e=>e.preventDefault());a.click();assert.equal(dom.window.eval('groupMrUi.selected'),'1')
 d.querySelector('[data-group-mr-record="2"] td:nth-child(3)').click();assert.equal(dom.window.eval('groupMrUi.selected'),'2');assert.equal(d.querySelector('[data-group-mr-record="3"] a'),null)
 assert.equal(d.querySelector('[data-group-mr-action="review"][data-record-id="1"]').disabled,false);assert.equal(d.querySelector('[data-group-mr-action="merge"][data-record-id="1"]').disabled,true);assert.equal(d.querySelector('[data-group-mr-check="4"]').disabled,true)
 const css=await readFile(new URL('../src/studio-workspace.css',import.meta.url),'utf8');assert.match(css,/th\.group-mr-action-cell\{text-align:left/)
})
test('批量审核校验结论和驳回理由，按提交保存并呈现部分失败与跳过',async t=>{
 const {dom,d,calls}=await setup(t);select(d,'1','2','3');d.querySelector('[data-group-mr-action="review"]:not([data-record-id])').click();assert.equal(calls.length,0);assert.match(d.querySelector('.mr-panel-count').textContent,/选中 3 条 · 可审核 2 条/)
 d.querySelector('[data-mr-panel-submit]').click();assert.match(d.querySelector('.mr-form-error').textContent,/请选择审核结论/);decide(dom,'reject');d.querySelector('[data-mr-panel-submit]').click();assert.match(d.querySelector('.mr-form-error').textContent,/请填写不通过原因/)
 decide(dom,'reject','业务边界需补充验证');d.querySelector('[data-mr-panel-submit]').click();await flush();assert.equal(calls.length,2);for(const c of calls)assert.deepEqual(c.data,{sha,decision:'reject',reason:'业务边界需补充验证',category:''})
 assert.match(d.querySelector('.mr-complete-message').textContent,/1 条审核已保存，1 条未完成/);assert.match(d.querySelector('.mr-targets').textContent,/提交已变化/);assert.match(d.querySelector('.mr-targets').textContent,/已跳过/)
})
test('审核取消无写入、刷新保留草稿、提交期间防重复并禁止关闭',async t=>{
 let release;const {dom,d,calls}=await setup(t,{write:(_url,data,response)=>new Promise(resolve=>release=()=>resolve(response({humanReview:data})))})
 d.querySelector('[data-group-mr-action="review"][data-record-id="1"]').click();decide(dom,'pass','验证通过');await dom.window.eval('loadGroupMr()');assert.equal(d.querySelector('#mr-action-reason').value,'验证通过');d.querySelector('[data-mr-panel-close]').click();assert.equal(calls.length,0)
 d.querySelector('[data-group-mr-action="review"][data-record-id="1"]').click();decide(dom,'pass');d.querySelector('[data-mr-panel-submit]').click();await dom.window.eval('submitGroupMrAction()');assert.equal(calls.length,1);assert.equal(d.querySelector('[data-mr-panel-close]').disabled,true);release();await flush();assert.match(d.querySelector('.mr-complete-message').textContent,/1 条审核已保存/)
})
test('批量合入明确确认、跳过未审核项、逐项结果与历史跳转',async t=>{
 const {d,calls}=await setup(t);select(d,'1','3','4');d.querySelector('[data-group-mr-action="merge"]:not([data-record-id])').click();assert.equal(calls.length,0);assert.match(d.querySelector('.mr-panel-count').textContent,/可合入 2 条/)
 d.querySelector('[data-mr-panel-submit]').click();await flush();assert.equal(calls.length,2);assert.deepEqual(calls.map(c=>c.url.split('/').at(-2)),['3','4']);for(const c of calls)assert.deepEqual(c.data,{sha,confirmed:true})
 assert.match(d.querySelector('.mr-complete-message').textContent,/1 条已合入，1 条未完成/);assert.match(d.querySelector('.mr-targets').textContent,/无合并权限/);d.querySelector('[data-mr-panel-results]').click();assert.equal(d.querySelector('.mr-action-overlay'),null);assert.ok(d.querySelector('[data-group-mr-record="3"]'))
})
