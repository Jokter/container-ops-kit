import test from 'node:test';
import assert from 'node:assert/strict';
import {createStudio} from './helpers/studio-harness.mjs';

function clock(w){
  const timers=new Map(),timeout=w.setTimeout.bind(w),clear=w.clearTimeout.bind(w);let sequence=100000,visibility='visible';
  w.setTimeout=(fn,delay,...args)=>{if(delay===10000||delay===3000){const id=++sequence;timers.set(id,()=>fn(...args));return id}return timeout(fn,delay,...args)};
  w.clearTimeout=id=>{if(!timers.delete(id))clear(id)};
  Object.defineProperty(w.document,'visibilityState',{configurable:true,get:()=>visibility});
  return {take(){const id=w.eval('groupMrUi.poll'),fn=timers.get(id);assert.ok(fn,'MR auto-refresh must be scheduled');timers.delete(id);return fn},visibility(value){visibility=value;w.document.dispatchEvent(new w.Event('visibilitychange'))}};
}
const reads=s=>s.requests.filter(r=>['/api/automation/group-mr','/api/automation/group-mr/status'].includes(r.path)).length;

test('MR polling includes new rows and changed states without resetting pagination, selection or filters even when listener is paused',async t=>{
  let timer,changed=false;
  const s=await createStudio({route:'automation/group-mr',beforeParse(w){timer=clock(w);const fetch=w.fetch;w.fetch=async(url,options)=>{
    const response=await fetch(url,options);if(!['/api/automation/group-mr','/api/automation/group-mr/status'].includes(String(url)))return response;
    const data=await response.json();data.config.enabled=false;
    if(changed){data.pending.find(r=>r.id==='21').status='远端意见已更新';data.pending.unshift({...data.pending[0],id:'new-mr',iid:'999',status:'新接收的 MR'});}
    return new Response(JSON.stringify(data));
  }}});t.after(s.close);
  assert.match(s.find('[data-group-mr-auto-refresh]').textContent,/每 10 秒自动刷新/);
  await s.input('#group-mr-search','Demo/Platform');await s.click('[data-mrw-page="1"]');await s.click('[data-mrw-page="1"]');await s.click('[data-group-mr-check="21"]');
  const table=s.find('.qw-table-wrap');table.scrollTop=240;changed=true;timer.take()();await s.wait(60);
  assert.match(s.find('[data-group-mr-record="21"]').textContent,/远端意见已更新/);assert.ok(s.find('[data-group-mr-record="new-mr"]'));
  assert.equal(s.find('[data-group-mr-check="21"]').checked,true);assert.equal(s.find('#group-mr-search').value,'Demo/Platform');assert.match(s.find('.mr-pagination').textContent,/3 \/ 3/);assert.equal(s.find('.qw-table-wrap').scrollTop,240);
  assert.equal(s.d.querySelector('.mr-new-banner'),null);assert.equal(s.requests.filter(r=>r.method!=='GET').length,0);assert.deepEqual(s.errors,[]);
});

test('MR polling pauses in hidden tabs and other pages then refreshes immediately when the page returns',async t=>{
  let timer;
  const s=await createStudio({route:'automation/group-mr',beforeParse(w){timer=clock(w)}});t.after(s.close);
  const staleTimer=timer.take(),before=reads(s);timer.visibility('hidden');staleTimer();await s.wait();assert.equal(reads(s),before);assert.equal(s.w.eval('groupMrUi.poll'),null);
  timer.visibility('visible');await s.wait();assert.equal(reads(s),before+1);
  await s.route('home/tools');const afterLeave=reads(s);assert.equal(s.w.eval('groupMrUi.poll'),null);timer.visibility('hidden');timer.visibility('visible');await s.wait();assert.equal(reads(s),afterLeave);
  await s.route('automation/group-mr');assert.equal(reads(s),afterLeave+1);assert.ok(s.w.eval('groupMrUi.poll'));assert.deepEqual(s.errors,[]);
});

test('MR automatic and manual refresh share one read; failed reads retry on the next poll',async t=>{
  let timer,hold=false,release,fail=false,attempts=0;
  const s=await createStudio({route:'automation/group-mr',beforeParse(w){timer=clock(w);const fetch=w.fetch;w.fetch=async(url,options)=>{
    if(['/api/automation/group-mr','/api/automation/group-mr/status'].includes(String(url))){attempts++;if(hold)await new Promise(resolve=>release=resolve);if(fail)return new Response(JSON.stringify({message:'模拟状态读取失败'}),{status:503});}return fetch(url,options);
  }}});t.after(s.close);
  const initial=attempts;hold=true;timer.take()();await s.wait();const manual=s.w.eval('loadGroupMr()');const another=s.w.eval('loadGroupMr()');assert.equal(attempts,initial+1);
  hold=false;release();await Promise.all([manual,another]);assert.equal(attempts,initial+1);
  fail=true;timer.take()();await s.wait();assert.match(s.find('[data-group-mr-auto-refresh]').textContent,/将自动重试/);assert.match(s.d.body.textContent,/模拟状态读取失败/);
  fail=false;timer.take()();await s.wait();assert.match(s.find('[data-group-mr-auto-refresh]').textContent,/每 10 秒自动刷新/);assert.doesNotMatch(s.find('.nav-list').textContent,/模拟状态读取失败/);assert.deepEqual(s.errors,[]);
});

test('MR polling preserves an active discussion editor and refreshes remote opinions after editing focus leaves',async t=>{
  let timer,changed=false;
  const s=await createStudio({route:'automation/group-mr',beforeParse(w){timer=clock(w);const fetch=w.fetch;w.fetch=async(url,options)=>{
    const response=await fetch(url,options);if(changed&&String(url).endsWith('/1/workspace')&&options?.method!=='POST'){const data=await response.json();data.threads.push({id:'new-remote',body:'最新远端意见',resolvable:true,resolved:false,notes:[]});return new Response(JSON.stringify(data));}return response;
  }}});t.after(s.close);
  await s.click('.nav-enter[data-mr-open="1"]');await s.click('[data-mrw-thread="thread-1"]');await s.input('[data-mrw-draft="thread-1"]','正在填写的核对意见');
  const editor=s.find('[data-mrw-draft="thread-1"]');editor.focus();editor.setSelectionRange(3,6);const panel=s.find('[data-mr-scroll="code"]');panel.scrollTop=275;changed=true;
  const before=s.requests.filter(r=>r.path.endsWith('/1/workspace')).length;timer.take()();await s.wait();
  assert.equal(s.requests.filter(r=>r.path.endsWith('/1/workspace')).length,before);assert.equal(s.find('[data-mrw-draft="thread-1"]'),editor);assert.equal(editor.value,'正在填写的核对意见');assert.equal(editor.selectionStart,3);assert.equal(editor.selectionEnd,6);assert.equal(panel.scrollTop,275);
  editor.blur();timer.take()();await s.wait(80);
  assert.equal(s.requests.filter(r=>r.path.endsWith('/1/workspace')).length,before+1);assert.equal(s.find('[data-mrw-draft="thread-1"]').value,'正在填写的核对意见');assert.equal(s.find('[data-mr-scroll="code"]').scrollTop,275);assert.match(s.find('[data-mr-view="notes"]').textContent,/未关闭 2/);
  assert.equal(s.requests.filter(r=>r.method!=='GET').length,0);assert.deepEqual(s.errors,[]);
});
