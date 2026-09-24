import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import test from 'node:test'
import {JSDOM} from 'jsdom'

const html=await readFile(new URL('../../index.html',import.meta.url),'utf8')
const response=(data,ok=true)=>({ok,status:ok?200:500,json:async()=>data,text:async()=>JSON.stringify(data)})
const flush=()=>new Promise(r=>setTimeout(r,30))
async function fixture(t,{route='tools',save,records=[],history=[]}={}){
 const writes=[],config={enabled:false,groupId:'1234567891011',authorizedSender:'w00789509',repositoryPrefix:'MAE-M/Access/',intervalSeconds:10}
 const snapshot=()=>({config:{...config},pending:records,history,metrics:{pending:records.length,issues:0,mergedToday:0},monitor:{error:'',at:''}})
 const dom=new JSDOM(html,{runScripts:'dangerously',url:'http://localhost/#/automation/'+route,beforeParse(w){w.scrollTo=()=>{};w.confirm=()=>{throw Error('原生弹窗不应调用')};const timeout=w.setTimeout.bind(w);w.setTimeout=(callback,delay,...args)=>delay>500?0:timeout(callback,delay,...args);w.fetch=async(url,options)=>{
  if(url==='/api/automation/group-mr/config'&&options?.method==='PUT'){const body=JSON.parse(options.body);writes.push(body);if(save)return save(body);Object.assign(config,body);return response({...config})}
  if(url.startsWith('/api/automation/group-mr/records/')){writes.push({url,...options});if(url.endsWith('/delete')){const ids=JSON.parse(options.body).ids;for(const list of [history,records])for(let i=list.length-1;i>=0;i--)if(ids.includes(list[i].id))list.splice(i,1);}else for(const r of history){r.writePending='';if(r.reply)r.reply.status='checked';}return response({ok:true})}
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
 assert.deepEqual([...doc.querySelectorAll('.group-mr-table th')].map(x=>x.textContent),['','MR','触发消息','当前阶段','最新结果','更新时间','操作'])
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

test('无需 MR 记录也可查看监听时间、过滤数量和命令失败日志',async t=>{
 const {dom,doc}=await fixture(t,{route:'group-mr'})
 dom.window.eval(`groupMrUi.monitor={state:'error',error:'welink-cli 未找到',message:'welink-cli 未找到',lastSuccessAt:'2026-09-23T08:30:00Z',readCount:5,newCount:2,matchedCount:0,filteredCount:2,logs:[{time:'2026-09-23T08:30:00Z',level:'error',message:'<script>bad</script> CLI 未找到'}]};render(false)`)
 assert.ok(doc.querySelector('[aria-label="监听运行状态"]'));assert.match(doc.querySelector('.group-mr-monitor-counts').textContent,/过滤 2 条/)
 doc.querySelector('[data-group-mr-logs]').click();assert.match(doc.querySelector('[role="log"]').textContent,/CLI 未找到/);assert.equal(doc.querySelector('[role="log"] script'),null)
 dom.window.eval('render(false)');assert.ok(doc.querySelector('[role="log"]'));assert.match(doc.querySelector('.group-mr-log-path').textContent,/automation\/group-mr-monitor.jsonl/)
})


test('阶段过滤、人工核对和历史删除沿用当前列表布局',async t=>{
 const base={repo:'MAE-M/Access/Demo',iid:'444',phase:'FAILED',stage:'PIPELINE',status:'流水线失败',updatedAt:'2026-09-24T08:00:00Z',events:[]};
 const {dom,doc,writes}=await fixture(t,{route:'group-mr',history:[{...base,id:'failed',writePending:'群消息回复',reply:{status:'unconfirmed',mode:'reference',text:'失败'}},{...base,id:'approve',stage:'APPROVE',phase:'NO_PERMISSION'}]});
 doc.querySelector('[data-group-mr-tab="history"]').click();
 const filter=doc.querySelector('#group-mr-phase');filter.value='stage:APPROVE';filter.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
 assert.equal(doc.querySelectorAll('[data-group-mr-record]').length,1);assert.ok(doc.querySelector('[data-group-mr-record="approve"]'));
 doc.querySelector('#group-mr-phase').value='FAILED';doc.querySelector('#group-mr-phase').dispatchEvent(new dom.window.Event('change',{bubbles:true}));
 assert.equal(doc.querySelector('[data-group-mr-action="delete"]').disabled,true);
 doc.querySelector('[data-group-mr-action="ack"]').click();doc.querySelector('[data-studio-confirm]').click();await flush();await flush();
 assert.equal(writes[0].url,'/api/automation/group-mr/records/failed/acknowledge-reply');assert.deepEqual(JSON.parse(writes[0].body),{confirmed:true});
 assert.match(doc.querySelector('.group-mr-reply').textContent,/已人工核对/);
 assert.ok(doc.querySelector('td:last-child [data-group-mr-action="delete"]'));assert.equal(doc.querySelector('.group-mr-detail [data-group-mr-action="delete"]'),null);
 doc.querySelector('[data-group-mr-action="delete"]').click();doc.querySelector('[data-studio-confirm]').click();await flush();await flush();
 assert.equal(writes[1].method,'POST');assert.deepEqual(JSON.parse(writes[1].body),{ids:['failed']});assert.equal(doc.querySelectorAll('[data-group-mr-record]').length,0);
});


test('批量删除只选中当前过滤下可删除的记录，取消不写入',async t=>{
 const base={repo:'MAE-M/Access/Demo',iid:'444',phase:'FAILED',stage:'PIPELINE',status:'失败',events:[]};
 const {doc,dom,writes}=await fixture(t,{route:'group-mr',history:[{...base,id:'a'},{...base,id:'b'},{...base,id:'blocked',writePending:'群消息回复'}]});
 doc.querySelector('[data-group-mr-tab="history"]').click();
 assert.equal(doc.querySelectorAll('.group-mr-table th').length,7);
 doc.querySelector('[data-group-mr-check-all]').click();
 assert.equal(doc.querySelectorAll('[data-group-mr-check]:checked').length,2);
 assert.equal(doc.querySelector('[data-group-mr-check="blocked"]').disabled,true);
 doc.querySelector('[data-group-mr-action="batch"]').click();assert.equal(writes.length,0);
 doc.querySelector('[data-studio-cancel]').click();await flush();assert.equal(writes.length,0);
 doc.querySelector('[data-group-mr-action="batch"]').click();doc.querySelector('[data-studio-confirm]').click();await flush();await flush();
 assert.deepEqual(JSON.parse(writes[0].body),{ids:['a','b']});assert.equal(doc.querySelectorAll('[data-group-mr-record]').length,1);
});

test('居中确认和输入弹窗支持取消、键盘、焦点与安全文本',async t=>{
 const {dom,doc}=await fixture(t);const opener=doc.querySelector('[data-group-mr-toggle]');opener.focus();
 const result=dom.window.studioConfirm('<img src=x>\n确认删除？');
 const overlayStyle=dom.window.getComputedStyle(doc.querySelector('.studio-confirm-backdrop'));assert.equal(overlayStyle.position,'fixed');assert.equal(overlayStyle.display,'grid');assert.equal(overlayStyle.placeItems,'center');assert.equal(overlayStyle.zIndex,'10000');assert.equal(doc.querySelector('#app').inert,true);
 assert.equal(doc.querySelector('.studio-confirm-dialog img'),null);assert.match(doc.querySelector('#studio-confirm-message').textContent,/<img/);
 assert.equal(doc.activeElement,doc.querySelector('[data-studio-cancel]'));assert.equal(await dom.window.studioConfirm('重复'),false);
 dom.window.eval('render(false)');assert.ok(doc.querySelector('.studio-confirm-dialog'));
 doc.querySelector('.studio-confirm-dialog').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(await result,false);assert.equal(doc.querySelector('.studio-confirm-backdrop'),null);assert.ok(!doc.querySelector('#app').inert);assert.equal(doc.body.style.overflow,'');
 const input=dom.window.studioPrompt('填写原因');const field=doc.querySelector('[data-studio-input]');assert.equal(doc.activeElement,field);assert.equal(doc.querySelector('[data-studio-confirm]').disabled,true);
 field.value=' 已核对 ';field.dispatchEvent(new dom.window.Event('input',{bubbles:true}));doc.querySelector('[data-studio-confirm]').click();assert.equal(await input,'已核对');assert.equal(doc.body.style.overflow,'');
 const confirm=dom.window.studioConfirm('确认');doc.querySelector('[data-studio-confirm]').click();assert.equal(await confirm,true);
});

test('流水线失败仍展示已完成的 Pi 检视，不显示流水线已通过',async t=>{
 const sha='a'.repeat(40);const {doc}=await fixture(t,{route:'group-mr',records:[{id:'pi-complete',repo:'MAE-M/Access/Demo',iid:'444',sha,phase:'FAILED',stage:'PIPELINE',pipelinePassed:false,piReview:{sha,summary:'通过'},status:'Pi 检视已通过；当前MR提交流水线失败',events:[]}]});
 const steps=[...doc.querySelectorAll('.group-mr-flow li')];assert.ok(steps[3].classList.contains('stop'));assert.ok(!steps[3].classList.contains('done'));assert.ok(steps[1].classList.contains('done'));assert.match(steps[1].textContent,/Pi 检视已通过/);
});

test('Pi 阶段待处理不会将流水线误标为已通过',async t=>{
 const {doc}=await fixture(t,{route:'group-mr',records:[{id:'issues',repo:'MAE-M/Access/Demo',iid:'444',sha:'a'.repeat(40),phase:'ISSUES',stage:'PI',pipelinePassed:false,status:'发现问题',events:[]}]});
 const steps=[...doc.querySelectorAll('.group-mr-flow li')];
 assert.deepEqual(steps.map(s=>s.querySelector('b').textContent),['收到消息','Pi 检视','检视意见','流水线','检视','审核','合并']);
 assert.match(steps[1].textContent,/待处理/);assert.doesNotMatch(steps[1].textContent,/已停止/);assert.match(steps[3].textContent,/待处理/);assert.ok(!steps[3].classList.contains('done'));
});

test('待处理支持批量删除，执行中和未确认操作不可选',async t=>{
 const records=[{id:'waiting',phase:'PIPELINE'},{id:'issues',phase:'ISSUES'},{id:'busy',phase:'PIPELINE',running:true},{id:'blocked',phase:'ISSUES',writePending:'Pi 提交检视意见'}].map(r=>({repo:'MAE-M/Access/Demo',iid:r.id,events:[],...r}));
 const {doc,writes}=await fixture(t,{route:'group-mr',records});
 assert.equal(doc.querySelectorAll('[data-group-mr-action="delete"]').length,4);
 assert.equal(doc.querySelectorAll('[data-group-mr-check]:not(:disabled)').length,2);
 doc.querySelector('[data-group-mr-check-all]').click();doc.querySelector('[data-group-mr-action="batch"]').click();
 await flush();doc.querySelector('[data-studio-confirm]').click();await flush();
 assert.deepEqual(JSON.parse(writes[0].body).ids,['waiting','issues']);assert.equal(records.length,2);
});
