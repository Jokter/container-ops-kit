import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM,VirtualConsole} from '../node_modules/jsdom/lib/api.js';

// Exercise original handlers after the presentation layer reparents their nodes.
const html=await readFile(new URL('./ops-studio-prototype.html',import.meta.url),'utf8');
const errors=[],vc=new VirtualConsole();
vc.on('jsdomError',e=>{if(!e.message.includes('Not implemented'))errors.push(e.message)});
const dom=new JSDOM(html,{url:'http://localhost/#/home/tools',runScripts:'dangerously',virtualConsole:vc,beforeParse(w){
  w.Response=Response;w.Headers=Headers;w.scrollTo=()=>{};w.matchMedia=()=>({matches:false});
  w.HTMLElement.prototype.scrollIntoView=function(){};
}});
const w=dom.window,d=w.document,wait=()=>new Promise(r=>setTimeout(r,120));
const click=async selector=>{const el=d.querySelector(selector);assert.ok(el,selector);el.click();await wait()};
const input=async(selector,value,event='input')=>{const el=d.querySelector(selector);assert.ok(el,selector);el.value=value;el.dispatchEvent(new w.Event(event,{bubbles:true}));await wait()};
const route=async path=>{w.location.hash='#/'+path;await wait()};
try{
  await wait();await input('#pr-search','JSON');
  assert.equal(d.querySelectorAll('.ux-home-results a').length,1);
  await click('.ux-home-results a');assert.equal(w.location.hash,'#/tools/json');
  await input('#ct-json-input','{"result":1,"nested":{"ok":true}}');
  await click('[data-json-action="format"]');assert.match(d.querySelector('#ct-json-input').value,/\n/);
  await click('[data-json-action="validate"]');assert.match(d.querySelector('#ct-json-message').textContent,/通过/);

  await route('automation/auto-ut');assert.ok(d.querySelector('#qw-plan-search'));
  assert.equal(d.querySelector('[data-ux-disclosure="ut-setup"]').open,false);
  await click('[data-ux-disclosure="ut-setup"]>summary');assert.ok(d.querySelector('[data-ux-disclosure="ut-setup"]').open);
  await input('#qw-plan-search','access-core');assert.equal(d.querySelectorAll('.ux-primary-results tbody tr').length,1);
  assert.ok(d.querySelector('[data-ux-disclosure="ut-setup"]').open,'Keep explicit disclosure choice after filtering');

  await route('automation/quality');await click('[data-q-fetch]');
  assert.equal(d.querySelector('[data-ux-disclosure="quality-setup"]').open,false);
  assert.equal(d.querySelectorAll('.qw-table tbody tr').length,10,'Both requested versions have mock results');
  assert.match(d.querySelector('.qw-table').textContent,/70%/);
  await click('[data-qw-tab="api"]');assert.match(d.querySelector('.qw-table').textContent,/未达标/);
  await click('[data-qw-tab="static"]');assert.match(d.querySelector('.qw-table').textContent,/Checkstyle/);

  await route('tools/binlog');await click('[data-bin-sample]');await click('[data-bin-parse]');
  assert.match(d.querySelector('.ux-parser-result').textContent,/成功 1/);
  await click('.ux-command-picker>summary');await click('[data-bin-command="0b14"]');
  assert.equal(d.querySelector('.ux-command-picker').open,false);
  await click('[data-bin-sample]');await click('[data-bin-parse]');assert.match(d.querySelector('.ux-parser-result').textContent,/成功 1/);

  await route('applications');assert.equal(d.querySelectorAll('.ac-card').length,8);
  await click('[data-ux-app-view="list"]');await click('[data-app-category="日志检索"]');
  assert.equal(d.querySelectorAll('.ac-card').length,2);assert.ok(d.querySelector('.ux-app-list'));
  await input('#ac-search','审计');assert.equal(d.querySelectorAll('.ac-card').length,1);
  await click('[data-app-favorite="demo-app-7"]');assert.equal(d.querySelector('[data-app-favorite="demo-app-7"]').getAttribute('aria-pressed'),'true');
  await click('[data-app-edit="demo-app-7"]');assert.equal(d.querySelector('#ac-form [name="category"]').value,'日志检索');
  await click('[data-app-close]');

  await route('automation/schedules');await click('[data-schedule-run="schedule-1"]');await click('[data-schedule-runs="schedule-1"]');
  assert.match(d.body.textContent,/0 个修复任务/);assert.ok(d.querySelector('[data-schedule-quality="quality-1"]'));
  assert.deepEqual(errors,[]);
  console.log('PASS: portal search → JSON; UT disclosure/filter; quality versions/types; Binlog command/parse; app view/filter/favorite/edit; schedule execution/history');
}finally{w.close()}
