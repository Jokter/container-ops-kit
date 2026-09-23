import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import test from 'node:test'
import {JSDOM} from 'jsdom'

const html=await readFile(new URL('../../index.html',import.meta.url),'utf8')
const response=(data,ok=true)=>({ok,status:ok?200:500,json:async()=>data,text:async()=>JSON.stringify(data)})
const flush=()=>new Promise(r=>setTimeout(r,30))
async function fixture(t,{route='tools',save,records=[]}={}){
 const writes=[],config={enabled:false,groupId:'1234567891011',authorizedSender:'w00789509',repositoryPrefix:'MAE-M/Access/',intervalSeconds:10}
 const snapshot=()=>({config:{...config},pending:records,history:[],metrics:{pending:records.length,issues:0,mergedToday:0},monitor:{error:'',at:''}})
 const dom=new JSDOM(html,{runScripts:'dangerously',url:'http://localhost/#/automation/'+route,beforeParse(w){w.scrollTo=()=>{};const timeout=w.setTimeout.bind(w);w.setTimeout=(callback,delay,...args)=>delay>500?0:timeout(callback,delay,...args);w.fetch=async(url,options)=>{
  if(url==='/api/automation/group-mr/config'&&options?.method==='PUT'){const body=JSON.parse(options.body);writes.push(body);if(save)return save(body);Object.assign(config,body);return response({...config})}
  if(url==='/api/automation/group-mr')return response(snapshot())
  return response([])
 }}})
 t.after(()=>dom.window.close());await flush();return {dom,doc:dom.window.document,writes,config}
}
test('工具卡片独立开关，设置留在侧栏，键盘可以进入 MR 页面',async t=>{
 const {dom,doc,writes}=await fixture(t)
 assert.deepEqual([...doc.querySelectorAll('[data-automation-capability]')].map(x=>x.dataset.automationCapability),['auto-ut','quality','group-mr'])
 assert.equal(doc.querySelectorAll('main [data-automation-nav="settings"]').length,0)
 assert.ok(doc.querySelector('aside [data-automation-nav="settings"]'))
 const toggle=doc.querySelector('[data-group-mr-toggle]');assert.equal(toggle.getAttribute('role'),'switch')
 toggle.click();await flush();assert.equal(writes.length,1);assert.equal(writes[0].enabled,true)
 assert.equal(dom.window.location.hash,'#/automation/tools');assert.equal(doc.querySelector('[data-group-mr-toggle]').getAttribute('aria-checked'),'true')
 doc.querySelector('[data-automation-capability="group-mr"]').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await flush()
 assert.equal(dom.window.location.hash,'#/automation/group-mr');assert.equal(doc.querySelectorAll('.group-mr-overview>.panel').length,4)
 assert.deepEqual([...doc.querySelectorAll('.group-mr-table th')].map(x=>x.textContent),['MR','触发消息','当前阶段','最新结果','更新时间'])
 assert.ok(doc.querySelector('[data-group-mr-config]'));assert.equal(doc.querySelector('#group-mr-form'),null)
})
test('开关写入期间禁止重复请求，失败恢复原状态',async t=>{
 let finish;const {doc,writes}=await fixture(t,{save:()=>new Promise(r=>finish=r)})
 doc.querySelector('[data-group-mr-toggle]').click();doc.querySelector('[data-group-mr-toggle]').click()
 assert.equal(writes.length,1);assert.equal(doc.querySelector('[data-group-mr-toggle]').disabled,true)
 finish(response({message:'保存失败'},false));await flush()
 assert.equal(doc.querySelector('[data-group-mr-toggle]').getAttribute('aria-checked'),'false');assert.equal(doc.querySelector('[data-group-mr-toggle]').disabled,false)
})
test('监听配置独立页面，刷新保留草稿，保存后回到列表',async t=>{
 const {dom,doc,writes}=await fixture(t,{route:'group-mr'})
 doc.querySelector('[data-group-mr-config]').click();const input=doc.querySelector('[name="groupId"]');input.value='9999912345';input.dispatchEvent(new dom.window.Event('input',{bubbles:true}))
 await dom.window.eval('loadGroupMr()');assert.equal(doc.querySelector('[name="groupId"]').value,'9999912345')
 doc.querySelector('#group-mr-form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await flush()
 assert.equal(writes[0].groupId,'9999912345');assert.equal(doc.querySelector('#group-mr-form'),null);assert.ok(doc.querySelector('.group-mr-table'))
})
test('列表选择、搜索与详情只展示真实状态，转义不可信内容',async t=>{
 const row={id:'r1',repo:'MAE-M/Access/Demo',iid:'444',sha:'a'.repeat(40),url:'https://codehub-y.huawei.com/MAE-M/Access/Demo/merge_requests/444',sender:'w00789509',phase:'NO_PERMISSION',stage:'APPROVE',status:'当前账号无审核权限，本次处理结束',events:[],updatedAt:'2026-09-23T08:00:00Z',reviewComments:[{id:'n',body:'<img src=x onerror=alert(1)>',resolved:true}],reply:{text:'无审核权限',mode:'reference',status:'unconfirmed'}}
 const {doc,dom}=await fixture(t,{route:'group-mr',records:[row,{...row,id:'r2',repo:'MAE-M/Access/Second',iid:'555',reply:undefined}]})
 assert.equal(doc.querySelectorAll('.group-mr-flow li').length,7);assert.match(doc.querySelector('.group-mr-flow .stop').textContent,/审核/)
 assert.match(doc.querySelector('.group-mr-reply').textContent,/发送结果待核对/);assert.match(doc.querySelector('.group-mr-note').textContent,/已标记 OK/);assert.equal(doc.querySelector('.group-mr-note img'),null)
 doc.querySelector('[data-group-mr-record-button="r2"]').click();assert.match(doc.querySelector('.group-mr-detail h3').textContent,/Second/);assert.match(doc.querySelector('.group-mr-reply').textContent,/暂无已记录的回复/)
 const search=doc.querySelector('#group-mr-search');search.value='missing';search.dispatchEvent(new dom.window.Event('input',{bubbles:true}));assert.match(doc.querySelector('.group-mr-empty').textContent,/没有匹配/);assert.equal(doc.querySelector('.group-mr-detail'),null)
})
