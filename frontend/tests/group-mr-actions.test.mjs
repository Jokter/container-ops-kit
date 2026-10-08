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
test('MR 标题打开真实链接，点击行仍可选详情，非法链接不呈现且操作表头左对齐',async t=>{
 const {dom,d}=await setup(t,{records:[row('1'),row('2'),{...row('3'),url:'javascript:alert(1)'},{...row('4','PI'),running:true}]})
 const a=d.querySelector('[data-group-mr-record-button="2"]');assert.equal(a.href,row('2').url);assert.equal(a.target,'_blank');assert.match(a.rel,/noopener/);a.addEventListener('click',e=>e.preventDefault());a.click();assert.equal(dom.window.eval('groupMrUi.selected'),'1')
 d.querySelector('[data-group-mr-record="2"] td:nth-child(3)').click();assert.equal(dom.window.eval('groupMrUi.selected'),'2');assert.equal(d.querySelector('[data-group-mr-record="3"] a'),null)
 assert.equal(d.querySelector('[data-group-mr-action="review"][data-record-id="1"]').disabled,false);assert.equal(d.querySelector('[data-group-mr-action="merge"][data-record-id="1"]').disabled,true);assert.equal(d.querySelector('[data-group-mr-check="4"]').disabled,true)
 const css=await readFile(new URL('../src/studio-workspace.css',import.meta.url),'utf8');assert.match(css,/th\.group-mr-action-cell\{text-align:left/)
})
test('批量一键审核直接通过，按当前提交保存并呈现部分失败与跳过',async t=>{
 const {d,calls}=await setup(t);select(d,'1','2','3');const button=d.querySelector('[data-group-mr-action="review"]:not([data-record-id])');assert.match(button.textContent,/批量一键审核/);button.click();
 assert.equal(d.querySelector('#mr-action-review-form'),null);await flush();assert.equal(calls.length,2);for(const c of calls)assert.deepEqual(c.data,{sha,decision:'pass',reason:'',category:''})
 assert.match(d.querySelector('.mr-complete-message').textContent,/1 条审核已保存，1 条未完成/);assert.match(d.querySelector('.mr-targets').textContent,/提交已变化/);assert.match(d.querySelector('.mr-targets').textContent,/已跳过/)
})
test('单条一键审核立即提交，进行中防重复，详情保留通过和不通过',async t=>{
 let release;const {dom,d,calls}=await setup(t,{write:(_url,data,response)=>new Promise(resolve=>release=()=>resolve(response({humanReview:data})))})
 const detail=d.querySelector('[data-human-review="1"]');assert.ok(detail.querySelector('[value="pass"]'));assert.ok(detail.querySelector('[value="reject"]'));assert.equal(calls.length,0)
 const button=d.querySelector('[data-group-mr-action="review"][data-record-id="1"]');assert.equal(button.textContent,'一键审核');button.click();button.click();await dom.window.eval('submitGroupMrAction()');assert.equal(calls.length,1);assert.deepEqual(calls[0].data,{sha,decision:'pass',reason:'',category:''});assert.equal(d.querySelector('[data-mr-panel-close]').disabled,true);release();await flush();assert.match(d.querySelector('.mr-complete-message').textContent,/1 条审核已保存/)
})
test('批量合入明确确认、跳过未审核项、逐项结果与历史跳转',async t=>{
 const {d,calls}=await setup(t);select(d,'1','3','4');d.querySelector('[data-group-mr-action="merge"]:not([data-record-id])').click();assert.equal(calls.length,0);assert.match(d.querySelector('.mr-panel-count').textContent,/可合入 2 条/)
 d.querySelector('[data-mr-panel-submit]').click();await flush();assert.equal(calls.length,2);assert.deepEqual(calls.map(c=>c.url.split('/').at(-2)),['3','4']);for(const c of calls)assert.deepEqual(c.data,{sha,confirmed:true})
 assert.match(d.querySelector('.mr-complete-message').textContent,/1 条已合入，1 条未完成/);assert.match(d.querySelector('.mr-targets').textContent,/无合并权限/);d.querySelector('[data-mr-panel-results]').click();assert.equal(d.querySelector('.mr-action-overlay'),null);assert.ok(d.querySelector('[data-group-mr-record="3"]'))
})

test('MR 分栏保留全部列表字段，刷新保留详情滚动，切换 MR 重置详情位置',async t=>{
 const {dom,d}=await setup(t)
 assert.ok(d.querySelector('.workspace-layout .mr-split > .qw-table-wrap'))
 assert.ok(d.querySelector('.mr-split > .group-mr-detail-section'))
 assert.equal(d.querySelector('[data-group-mr-record="1"]').children.length,7)
 d.querySelector('.group-mr-detail-section').scrollTop=180
 await dom.window.eval('loadGroupMr()')
 assert.equal(d.querySelector('.group-mr-detail-section').scrollTop,180)
 d.querySelector('[data-group-mr-record="2"] td:nth-child(3)').click()
 assert.equal(d.querySelector('.group-mr-detail-section').dataset.mrDetailId,'2')
 assert.equal(d.querySelector('.group-mr-detail-section').scrollTop,0)
 assert.ok(d.querySelector('[data-human-review="2"] [value="reject"]'))
})
