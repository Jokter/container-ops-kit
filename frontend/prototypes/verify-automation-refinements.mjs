import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM,VirtualConsole} from '../node_modules/jsdom/lib/api.js';
const html=await readFile(process.argv[2]||new URL('./ops-studio-prototype.html',import.meta.url),'utf8');
const errors=[],vc=new VirtualConsole();vc.on('jsdomError',error=>{if(!error.message.includes('Not implemented'))errors.push(error.message)});
const dom=new JSDOM(html,{url:'http://localhost/#/automation',runScripts:'dangerously',virtualConsole:vc,beforeParse(w){
  w.Response=Response;w.Headers=Headers;w.scrollTo=()=>{};w.matchMedia=()=>({matches:false});
  w.HTMLElement.prototype.scrollIntoView=function(){};
  w.HTMLElement.prototype.getBoundingClientRect=function(){return {left:100,right:220,top:100,bottom:136,width:120,height:36}};
}});
const w=dom.window,d=w.document,wait=()=>new Promise(resolve=>setTimeout(resolve,140));
const find=selector=>{const node=d.querySelector(selector);assert.ok(node,selector);return node};
const click=async selector=>{find(selector).click();await wait()};
const route=async path=>{w.location.hash='#/'+path;await wait()};
try{
  await wait();assert.ok(find('.ax-workspace'));
  assert.equal(d.querySelectorAll('[data-overview-outcome]').length>=6,true);
  assert.doesNotMatch(find('.governance-dashboard').textContent,/undefined|NaN/);
  for(const outcome of ['fixed','added','waiting'])assert.match(find('[data-overview-outcome="'+outcome+'"]>strong').textContent,/^\d+$/,'Governance outcomes finish loading');
  assert.match(find('.ov-results>.studio-section-head').textContent,/连续执行 \d+ 天/);
  const governance=await (await w.fetch('/api/auto-ut/governance?version=R27C10&days=7')).json();
  assert.ok(governance.records.length>0);assert.ok(governance.records.every(task=>task.reportVersion==='R27C10'));
  for(const value of Object.values(governance.metrics))assert.equal(typeof value,'number');
  const emptyVersion=await (await w.fetch('/api/auto-ut/governance?version=R27C00&days=0')).json();
  assert.equal(emptyVersion.records.length,0);assert.equal(emptyVersion.metrics.streak,0);
  const sample=governance.records[0],oldDate=new Date(Date.now()-10*86400000).toISOString();
  await w.fetch('/api/auto-ut/tasks/'+sample.id,{method:'PUT',body:JSON.stringify({createdAt:oldDate})});
  const recent=await (await w.fetch('/api/auto-ut/governance?version=R27C10&days=7')).json();
  const allTime=await (await w.fetch('/api/auto-ut/governance?version=R27C10&days=0')).json();
  assert.equal(recent.records.some(task=>task.id===sample.id),false,'Days filtering excludes earlier records');
  assert.equal(allTime.records.some(task=>task.id===sample.id),true,'All-time filtering preserves earlier records');
  await w.fetch('/api/auto-ut/tasks/'+sample.id,{method:'PUT',body:JSON.stringify({createdAt:sample.createdAt})});
  const data=await (await w.fetch('/api/automation/effectiveness?days=30')).json();
  const records=await (await w.fetch('/api/automation/group-mr')).json();
  assert.equal(data.total,records.pending.length+records.history.length);
  assert.equal(data.merged,records.history.filter(record=>record.phase==='DONE').length);
  for(const key of ['tasks','humanTouches','pending','missed','falsePositive','knowledge','knowledgeUses'])assert.equal(typeof data[key],'number',key);

  await route('automation/tasks');
  const all=find('.ax-select-all [data-record-select-all]');
  assert.equal(d.querySelectorAll('[data-record-select-all]').length,1,'The original select-all is moved, never cloned');
  assert.ok([...d.querySelectorAll('.ax-record-cards tbody td')].every(cell=>cell.dataset.label));
  all.click();await wait();
  assert.ok([...d.querySelectorAll('[data-record-select]')].every(input=>input.checked),'Moved select-all retains original state change handler');
  assert.equal(find('[data-cleanup-records]').disabled,false);
  await click('.ax-select-all [data-record-select-all]');assert.equal(find('[data-cleanup-records]').disabled,true);
  await click('.ux-row-more summary');assert.ok(find('.ux-row-more[open]>.ax-action-menu'));
  await click('.page-head h1');assert.equal(d.querySelector('.ux-row-more[open]'),null);
  await click('.ux-row-more summary');const menu=find('.ux-row-more[open]');menu.querySelector('button').focus();
  d.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  assert.equal(menu.open,false);assert.equal(d.activeElement,menu.querySelector('summary'));

  await route('automation/schedules');
  assert.ok(find('.ax-record-cards [data-label="执行频率"]'));
  await click('.ux-row-more summary');
  const more=[...d.querySelectorAll('.ux-row-more')];more[1].querySelector('summary').click();await wait();
  assert.equal(d.querySelectorAll('.ux-row-more[open]').length,1,'Only one row menu stays open');
  assert.equal(more[0].open,false);
  const toggle=find('.ux-row-more[open] [data-schedule-toggle]'),id=toggle.dataset.scheduleToggle;
  const count=w.__mockRequests.filter(request=>request.path==='/api/automation/schedules/'+id&&request.method==='PATCH').length;
  toggle.click();await wait();
  assert.equal(w.__mockRequests.filter(request=>request.path==='/api/automation/schedules/'+id&&request.method==='PATCH').length,count+1,'Original toggle action runs once');
  await click('[data-schedule-edit]');assert.ok(find('.qw-drawer [data-sched-field=name]'));
  await click('[data-qw-close]');

  await route('automation/quality');
  const domain=find('[data-q-field=domain]');domain.value='DomainChanged';domain.dispatchEvent(new w.Event('input',{bubbles:true}));
  const date=find('[data-q-field=date]');date.value='2026-10-12';date.dispatchEvent(new w.Event('input',{bubbles:true}));
  assert.match(find('.ux-preparation-copy small').textContent,/DomainChanged/);
  assert.match(find('.ux-preparation-copy small').textContent,/2026-10-12/);
  await click('[data-q-fetch]');
  const jobs=await (await w.fetch('/api/quality/jobs')).json();
  assert.equal(jobs[0].input.domain,'DomainChanged');assert.equal(jobs[0].input.date,'2026-10-12');
  assert.ok(find('.ax-table-hint'));

  await route('automation/settings');
  const second=find('.ux-section-nav button:nth-of-type(2)');second.click();await wait();
  assert.equal(second.getAttribute('aria-current'),'location');
  assert.equal(d.querySelectorAll('.ux-section-nav [aria-current=location]').length,1);
  await click('[data-qw-drawer=codehub]');assert.ok(find('.qw-drawer'));await click('[data-qw-close]');

  await route('home/overview');
  const summary=await (await w.fetch('/api/platform/overview')).json();
  assert.equal(summary.attention,summary.todos.length,'Every counted mock todo is available in the list');
  assert.equal(d.querySelectorAll('[data-platform-todo]').length,summary.attention);
  assert.doesNotMatch(find('.pr-home').textContent,/展示最近 100 条/);
  assert.ok(summary.todos.every(todo=>['ut','mr','build','deploy','quality','report'].includes(todo.kind)));
  const mrTodo=summary.todos.filter(todo=>todo.kind==='mr').at(-1),utTodo=summary.todos.find(todo=>todo.kind==='ut');
  await click('[data-platform-todo="mr:'+mrTodo.id+'"]');assert.equal(w.location.hash,'#/automation/group-mr');
  assert.equal(w.eval('groupMrUi.selected'),mrTodo.id,'Overview preserves the requested MR instead of falling back to the first row');
  await route('home/overview');await click('[data-platform-todo="ut:'+utTodo.id+'"]');assert.equal(w.location.hash,'#/automation/tasks');
  assert.equal(w.eval('workspaceUi.selectedTaskId'),utTodo.id);
  for(const kind of ['build','deploy']){
    await route('home/overview');const todo=summary.todos.find(item=>item.kind===kind);
    assert.match(todo.id,/^[a-f0-9-]{36}$/i,'Delivery mock IDs pass the original navigation guard');
    const before=w.__mockRequests.length;await click('[data-platform-todo="'+kind+':'+todo.id+'"]');
    assert.equal(w.location.hash,'#/container/'+kind);
    assert.ok(w.__mockRequests.slice(before).some(request=>request.path==='/api/'+(kind==='build'?'build-tasks':'deployment-tasks')+'/'+todo.id&&request.method==='GET'),'Overview loads the original delivery detail');
    assert.ok(w.__mockRequests.slice(before).every(request=>request.method==='GET'),'Opening a todo never starts or retries a task');
  }
  const failedBuild=summary.todos.find(todo=>todo.kind==='build');
  await w.fetch('/api/build-tasks/'+failedBuild.id,{method:'PUT',body:JSON.stringify({status:'SUCCEEDED'})});
  const refreshed=await (await w.fetch('/api/platform/overview')).json();
  assert.equal(refreshed.attention,summary.attention-1,'Counts reflect the current in-memory task state');
  assert.equal(refreshed.todos.some(todo=>todo.kind==='build'&&todo.id===failedBuild.id),false);
  assert.deepEqual(errors,[]);
  process.stdout.write('PASS: derived automation/platform metrics; original record select-all; responsive field labels; menu outside/Escape/only-one-open; original schedule toggle/edit; live quality summary and submitted scope; settings actions; exact MR/UT/delivery todo navigation without writes\n');
}finally{w.close()}
