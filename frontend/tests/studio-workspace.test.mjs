import test from 'node:test';
import assert from 'node:assert/strict';
import {createStudio} from './helpers/studio-harness.mjs';

const routes=['home/tools','home/overview','container/dashboard','container/build','container/deploy','container/resources','container/operations','automation','automation/tools','automation/group-mr','automation/auto-ut','automation/quality','automation/tasks','automation/schedules','automation/settings','automation/knowledge','applications','tools','tools/json','tools/binlog'];
function actions(d) {
  const map=new Map();
  for(const node of d.querySelectorAll('button,input,select,textarea,a,form,summary'))for(const attr of node.attributes) {
    if(!attr.name.startsWith('data-')||/^(data-ux-|data-cx-|data-dt-|data-ax-|data-px-)/.test(attr.name))continue;
    const key=node.tagName+'|'+attr.name+'='+attr.value;map.set(key,(map.get(key)||0)+1);
  }
  return map;
}
test('all 20 production routes preserve original business controls after layout changes',async t=>{
  for(const route of routes) await t.test(route,async()=>{
    const old=await createStudio({route,enhanced:false}),current=await createStudio({route});
    try{
      const expected=actions(old.d),actual=actions(current.d);
      for(const [key,count] of expected)assert.ok((actual.get(key)||0)>=count,'Lost control '+key);
      assert.equal(current.d.querySelector('.ux-prototype-note'),null);
      assert.deepEqual(current.errors,[]);
      assert.ok(current.requests.every(r=>r.method==='GET'),'Opening a route must not write');
    }finally{old.close();current.close()}
  });
});

test('shared selects preserve native change semantics and dismiss on Escape/outside',async t=>{
  const s=await createStudio({route:'container/build'});t.after(s.close);
  const select=s.find('#single-build-form select[name=module]');let changes=0;select.addEventListener('change',()=>changes++);
  await s.click('#single-build-form select[name=module]');
  const options=s.find('.ux-select-options');
  for(const key of ['ArrowDown','Enter'])options.dispatchEvent(new s.w.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));
  await s.wait();assert.equal(changes,1);assert.equal(select.value,'gateway-service');
  await s.click('#single-build-form select[name=module]');s.find('.ux-select-options').dispatchEvent(new s.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  assert.equal(s.d.querySelector('.ux-select-menu'),null);assert.equal(changes,1);assert.equal(s.d.activeElement,select);
  await s.click('#single-build-form select[name=module]');await s.click('.page-head h1');assert.equal(s.d.querySelector('.ux-select-menu'),null);
  assert.equal(s.requests.filter(r=>r.method!=='GET').length,0);assert.deepEqual(s.errors,[]);
});

test('global search, hash entry and history load build storage without retrying actions',async t=>{
  const s=await createStudio({route:'automation/group-mr'});t.after(s.close);
  await s.click('[data-ux-search]');await s.input('.ux-command input','构建');
  await s.click('.ux-command-item[href="#/container/build"]');await s.wait(80);
  assert.match(s.find('.build-storage').textContent,/29.8 GB/);
  assert.equal(s.requests.filter(r=>r.path.endsWith('/storage')).length,1);
  await s.route('automation/group-mr');s.w.history.back();await s.wait(100);
  assert.equal(s.w.location.hash,'#/container/build');assert.equal(s.requests.filter(r=>r.path.endsWith('/storage')).length,1);
  assert.equal(s.requests.filter(r=>r.method!=='GET').length,0);assert.deepEqual(s.errors,[]);
});

for (const width of [390,650,700]) test(`navigation at ${width}px isolates background, restores focus and retains destinations`,async t=>{
  const s=await createStudio({route:'automation/group-mr',beforeParse(w){w.innerWidth=width}});t.after(s.close);
  await s.click('[data-ux-nav]');assert.equal(s.find('#ux-navigation').getAttribute('aria-modal'),'true');assert.equal(s.find('#ux-main').inert,true);
  s.d.dispatchEvent(new s.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await s.wait();
  assert.equal(s.d.body.classList.contains('ux-nav-open'),false);assert.ok(!s.find('#ux-main').inert);assert.equal(s.d.activeElement,s.find('[data-ux-nav]'));
  await s.click('[data-ux-nav]');await s.click('#ux-navigation [data-automation-nav="tasks"]');
  assert.equal(s.w.location.hash,'#/automation/tasks');assert.equal(s.d.body.classList.contains('ux-nav-open'),false);
  assert.deepEqual(s.errors,[]);
});

test('leaving resource creation releases modal isolation on the home route',async t=>{
  const s=await createStudio({route:'container/operations'});t.after(s.close);
  await s.click('[data-connect-resource-environment]');await s.input('#resource-namespace','demo','change');await s.click('[data-load-resource-workspace]');
  await s.click('[data-open-resource-create]');assert.equal(s.find('.ux-command').inert,true);
  await s.route('home/tools');assert.equal(s.d.querySelector('.cr-dialog'),null);assert.ok(!s.find('.ux-command').inert);
  s.d.dispatchEvent(new s.w.KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true,cancelable:true}));await s.wait();assert.equal(s.find('.ux-command').open,true);assert.deepEqual(s.errors,[]);
});
