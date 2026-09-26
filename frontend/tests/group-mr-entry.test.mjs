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
  if(url==='/api/automation/knowledge')return response({items:[],reviews:[]})
  if(url.startsWith('/api/automation/effectiveness'))return response({total:0,stages:{},reviews:0,merged:0,anomalies:0,rejected:0})
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
 assert.equal(doc.querySelectorAll('.group-mr-flow li').length,8);assert.match(doc.querySelector('.group-mr-flow .stop').textContent,/审核/)
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
 assert.deepEqual(steps.map(s=>s.querySelector('b').textContent),['收到消息','Pi 检视','检视意见','流水线','人工审核','检视','审核','合并']);
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

test('快捷合入显示意见闭环及无权限检视跳过',async t=>{
 const {doc}=await fixture(t,{route:'group-mr',records:[{id:'shortcut',repo:'MAE-M/Access/Demo',iid:'1',sha:'a'.repeat(40),phase:'APPROVE',stage:'APPROVE',shortcut:true,reviewSkipped:true,pipelinePassed:true,reviewComments:[{id:'others',body:'意见',resolved:true}],events:[]}]});
 const steps=[...doc.querySelectorAll('.group-mr-flow li')];
 assert.match(steps.find(s=>s.querySelector('b').textContent==='Pi 检视').textContent,/已跳过/);
 assert.match(steps.find(s=>s.querySelector('b').textContent==='检视意见').textContent,/已通过/);
 assert.match(steps.find(s=>s.querySelector('b').textContent==='检视').textContent,/已跳过/);
 assert.match(steps.find(s=>s.querySelector('b').textContent==='人工审核').textContent,/已跳过/);
 assert.equal(doc.querySelector('[data-human-review]'),null);assert.match(doc.querySelector('main').textContent,/无需页面人工审核/);
});

test('Pi 待核对详情显示最终回复和人工解除入口，不重新运行任务',async t=>{
 const row={id:'pi-unknown',repo:'MAE-M/Access/Demo',iid:'1',phase:'INTERRUPTED',stage:'PI',writePending:'Pi 提交检视意见',piOutput:'<b>检视完成</b>',events:[]};
 const {doc,writes}=await fixture(t,{route:'group-mr',history:[row]});
 doc.querySelector('[data-group-mr-tab="history"]').click();await flush();
 assert.match(doc.querySelector('.group-mr-detail').textContent,/<b>检视完成<\/b>/);
 doc.querySelector('[data-group-mr-action="ack-pi"]').click();await flush();doc.querySelector('[data-studio-confirm]').click();await flush();
 assert.equal(writes[0].url,'/api/automation/group-mr/records/pi-unknown/acknowledge-pi');assert.deepEqual(JSON.parse(writes[0].body),{confirmed:true});
});

test('人工审核只在提交时写入，携带当前 SHA 和理由，草稿经刷新保留',async t=>{
 const row={id:'human',repo:'MAE-M/Access/Demo',iid:'444',phase:'HUMAN',sha:'a'.repeat(40),status:'等待人工审核',events:[],writePending:'',updatedAt:new Date().toISOString()};
 const {dom,doc,writes}=await fixture(t,{route:'group-mr',records:[row]});
 doc.querySelector('[data-group-mr-record]').click();await flush();
 let form=doc.querySelector('[data-human-review]');assert.ok(form);
 form.querySelector('[value="reject"]').click();const reason=form.querySelector('textarea');reason.value='接口缺省行为改变';reason.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
 assert.equal(writes.length,0);doc.querySelector('[data-group-mr-refresh]').click();await flush();
 form=doc.querySelector('[data-human-review]');assert.equal(form.querySelector('textarea').value,'接口缺省行为改变');
 form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await flush();
 assert.equal(writes.length,1);const body=JSON.parse(writes[0].body);assert.equal(body.sha,row.sha);assert.equal(body.decision,'reject');assert.equal(body.reason,'接口缺省行为改变');
});
test('后台提交变化后旧审核表单不能提交新 SHA，旧草稿不会套到新版本',async t=>{
 const row={id:'human-sha',repo:'MAE-M/Access/Demo',iid:'1',phase:'HUMAN',sha:'a'.repeat(40),status:'等待人工审核',events:[],writePending:'',updatedAt:new Date().toISOString()};
 const {dom,doc,writes}=await fixture(t,{route:'group-mr',records:[row]});
 const form=doc.querySelector('[data-human-review]');form.querySelector('[value="pass"]').click();const reason=form.querySelector('textarea');reason.value='认可旧提交';reason.dispatchEvent(new dom.window.Event('input',{bubbles:true}));reason.focus();
 row.sha='b'.repeat(40);doc.querySelector('[data-group-mr-refresh]').click();await flush();
 assert.equal(form.dataset.reviewSha,'a'.repeat(40));form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await flush();
 assert.equal(writes.length,0);assert.equal(doc.querySelector('[data-human-review]').dataset.reviewSha,row.sha);assert.equal(doc.querySelector('[data-human-review] textarea').value,'');
});

test('MR 完整样式加载后筛选可换行、进度网格、审核单选框保留原生尺寸',async t=>{
 const row={id:'layout',repo:'MAE-M/Access/'+ 'LongService'.repeat(20),iid:'444',phase:'HUMAN',sha:'a'.repeat(40),status:'等待人工审核',sender:'w00789509',events:[],updatedAt:new Date().toISOString(),piOutput:'日志'.repeat(2000)};
 const {doc,dom}=await fixture(t,{route:'group-mr',records:[row]});
 for(const file of ['quality-workspace.css','studio-workspace.css','home-workbench.css']){const style=doc.createElement('style');style.textContent=await readFile(new URL('../src/'+file,import.meta.url),'utf8');doc.head.append(style)}
 const css=el=>dom.window.getComputedStyle(el);
 assert.equal(css(doc.querySelector('.group-mr-toolbar')).flexWrap,'wrap');
 assert.equal(css(doc.querySelector('.group-mr-flow')).display,'grid');
 const radio=doc.querySelector('input[type=radio]');assert.equal(css(radio).width,'16px');assert.equal(css(radio).paddingTop,'0px');assert.equal(css(radio.closest('label')).display,'inline-flex');
 assert.equal(css(doc.querySelector('.group-mr-trigger')).overflow,'hidden');
 assert.equal(css(doc.querySelector('.group-mr-events pre')).maxHeight,'360px');
 assert.ok(doc.querySelector('.group-mr-notice').compareDocumentPosition(doc.querySelector('.review-human'))&dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
 assert.equal(doc.querySelectorAll('.group-mr-flow li').length,8);
});
test('未到人工审核阶段不插入空审核面板，已审核历史仍可查阅',async t=>{
 const row={id:'layout-pi',repo:'MAE-M/Access/Demo',iid:'1',phase:'PI',sha:'a'.repeat(40),status:'正在检视',events:[],updatedAt:new Date().toISOString()};
 const {doc,dom}=await fixture(t,{route:'group-mr',records:[row]});assert.equal(doc.querySelector('.review-human'),null);
 dom.window.eval(`reviewUi.reviews=[{id:'review',repo:'MAE-M/Access/Demo',iid:'1',sha:'${'a'.repeat(40)}',decision:'reject',reason:'回归未通过',time:'2026-09-26T00:00:00Z',knowledgeStatus:'done'}];render(false)`);
 assert.match(doc.querySelector('.review-human').textContent,/回归未通过/);assert.equal(doc.querySelector('[data-human-review]'),null);
});

test('并发列表切换详情，刷新排序变化保留选中 MR，排队任务不误标为执行中',async t=>{
 const base={repo:'MAE-M/Access/Demo',sha:'',events:[],phase:'PI',status:'正在检视',running:true};
 const records=[{...base,id:'one',iid:'1'},{...base,id:'two',iid:'2'},{...base,id:'queued',iid:'6',phase:'QUEUED',status:'排队中',running:false,queued:true}];
 const {dom,doc}=await fixture(t,{route:'group-mr',records});
 assert.match(doc.querySelector('.group-mr-detail h3').textContent,/!1/);
 records.reverse();await dom.window.eval('loadGroupMr()');assert.match(doc.querySelector('.group-mr-detail h3').textContent,/!1/);
 doc.querySelector('[data-group-mr-record-button="two"]').click();assert.match(doc.querySelector('.group-mr-detail h3').textContent,/!2/);
 await dom.window.eval('loadGroupMr()');assert.match(doc.querySelector('.group-mr-detail h3').textContent,/!2/);
 doc.querySelector('[data-group-mr-record-button="queued"]').click();assert.match(doc.querySelector('.group-mr-detail h3').textContent,/!6/);
 assert.match(doc.querySelector('.group-mr-detail .group-mr-status').textContent,/排队中/);
 assert.equal(doc.querySelector('.group-mr-flow .now'),null);assert.equal(doc.querySelector('[data-group-mr-check="queued"]').disabled,true);
 dom.window.eval('groupMrUi.monitor={activeCount:5,queuedCount:1,concurrency:5};render(false)');assert.match(doc.querySelector('.group-mr-overview').textContent,/执行中 5 \/ 5 · 排队中 1/);
 const filter=doc.querySelector('#group-mr-phase');filter.value='stage:QUEUED';filter.dispatchEvent(new dom.window.Event('change',{bubbles:true}));assert.equal(doc.querySelectorAll('[data-group-mr-record]').length,1);
});

test('MR 历史展示已关闭状态，重试明细只出现在选中 MR 内',async t=>{
 const base={repo:'MAE-M/Access/Demo',iid:'1856',sha:'a'.repeat(40),events:[],status:'等待处理'};
 const current={...base,id:'current',phase:'INTERRUPTED',attempts:[{...base,id:'old',phase:'INTERRUPTED',status:'上次执行中断'},{...base,id:'current',phase:'INTERRUPTED',status:'本次等待核对'}]};
 const records=[current];const {doc,dom}=await fixture(t,{route:'group-mr',records,history:[{...base,id:'closed',iid:'447',phase:'CLOSED',status:'远端 MR 已关闭'}]});
 assert.equal(doc.querySelectorAll('[data-group-mr-record]').length,1);assert.match(doc.querySelector('.group-mr-detail').textContent,/历次处理（2 次）/);assert.match(doc.querySelector('.group-mr-detail').textContent,/上次执行中断/);
 records[0]={...current,id:'retry'};await dom.window.eval('loadGroupMr()');assert.equal(doc.querySelector('[data-group-mr-record-button="retry"]').getAttribute('aria-current'),'true');
 doc.querySelector('[data-group-mr-tab="history"]').click();assert.equal(doc.querySelectorAll('[data-group-mr-record]').length,1);assert.match(doc.querySelector('.group-mr-detail .group-mr-status').textContent,/已关闭/);assert.match(doc.querySelector('.group-mr-toolbar').textContent,/已合入 \/ 已关闭/);
});
