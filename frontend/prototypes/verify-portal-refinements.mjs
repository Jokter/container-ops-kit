import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM,VirtualConsole} from '../node_modules/jsdom/lib/api.js';

const errors=[],vc=new VirtualConsole();vc.on('jsdomError',error=>{if(!error.message.includes('Not implemented'))errors.push(error.message)});
const dom=new JSDOM(await readFile(new URL('./ops-studio-prototype.html',import.meta.url),'utf8'),{url:'http://localhost/#/applications',runScripts:'dangerously',virtualConsole:vc,beforeParse(w){
  w.Response=Response;w.Headers=Headers;w.scrollTo=()=>{};w.matchMedia=()=>({matches:false});w.HTMLElement.prototype.scrollIntoView=function(){};
}});
const w=dom.window,d=w.document,wait=()=>new Promise(resolve=>setTimeout(resolve,180));
const find=selector=>{const node=d.querySelector(selector);assert.ok(node,selector);return node};
const click=async selector=>{find(selector).click();await wait()};
const fill=async(selector,value)=>{const input=find(selector);input.value=value;input.dispatchEvent(new w.Event('input',{bubbles:true}));await wait()};
const route=async path=>{w.location.hash='#/'+path;await wait()};
try{
  await wait();
  const apps=[...d.querySelectorAll('.ac-card')].map(card=>({name:card.querySelector('h2').textContent,url:card.querySelector('.ac-url').textContent,open:card.querySelector('[data-pr-app]').dataset.prApp,edit:card.querySelector('[data-app-edit]').dataset.appEdit}));
  assert.equal(apps.length,8);
  assert.equal(d.querySelectorAll('.pf-app-identity h2').length,apps.length);
  assert.ok(find('.ac-toolbar .pf-app-controls #ac-search'));assert.ok(find('.ac-toolbar .ux-app-view'));
  await click('[data-ux-app-view="list"]');assert.ok(find('.ac-workspace').classList.contains('ux-app-list'));
  assert.deepEqual([...d.querySelectorAll('.ac-card')].map(card=>({name:card.querySelector('h2').textContent,url:card.querySelector('.ac-url').textContent,open:card.querySelector('[data-pr-app]').dataset.prApp,edit:card.querySelector('[data-app-edit]').dataset.appEdit})),apps,'Card/list rearrangement keeps all URLs and original action hooks');
  await click('[data-ux-app-view="cards"]');
  await fill('#ac-search','不存在的应用');
  assert.equal(d.querySelectorAll('.ac-card').length,0);assert.equal(find('.ac-grid').hidden,true,'No-result state does not promote the add tile');
  assert.ok(find('.pf-app-empty [data-pf-reset-apps]'));assert.ok(find('.page-head [data-app-create]'),'Creation remains available from the header');
  await click('[data-pf-reset-apps]');assert.equal(d.querySelectorAll('.ac-card').length,8);assert.equal(find('#ac-search').value,'');
  await click('[data-app-category="监控诊断"]');await fill('#ac-search','不存在');await click('[data-pf-reset-apps]');
  assert.equal(d.querySelectorAll('.ac-card').length,8,'Reset drives original category filtering');
  await click('[data-app-filter="favorite"]');await wait();
  if(d.querySelector('.pf-app-empty'))await click('[data-pf-reset-apps]');else await click('[data-app-filter="all"]');
  assert.equal(d.querySelectorAll('.ac-card').length,8,'Reset also clears favorite-only scope');
  await fill('#ac-search',apps[0].name);await click('[data-pf-clear="ac-search"]');assert.equal(d.querySelectorAll('.ac-card').length,8);

  await route('home/tools');const originalCards=d.querySelectorAll('.pr-space-card').length;
  await fill('#pr-search','YAML');assert.equal(d.querySelectorAll('.ux-home-result-grid a').length,1);assert.equal(find('.pr-space-grid').hidden,true);assert.equal(find('.ux-home-results').hidden,false);
  await fill('#pr-search','虚机');assert.equal(d.querySelectorAll('.pr-space-card').length,1);assert.equal(find('.pr-space-grid').hidden,false);assert.equal(find('.ux-home-results').hidden,true,'Matching workspace does not coexist with a misleading no-function error');
  await fill('#pr-search','不存在的功能');assert.equal(find('.ux-home-results h2').textContent,'没有搜索结果');assert.equal(find('.pr-space-grid').hidden,true);
  find('#pr-search').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await wait();
  assert.equal(d.querySelectorAll('.pr-space-card').length,originalCards);assert.equal(find('.ux-home-dock').hidden,false,'Clearing restores all original home cards and shortcuts');

  await route('tools/binlog');await click('.dt-command-picker>summary');await fill('#ct-command-search','no-such-command');assert.equal(find('.dt-command-empty').hidden,false);
  await fill('#ct-command-search','0b17');assert.equal(find('.dt-command-empty').hidden,true);await fill('#ct-command-search','');
  for(const selector of ['[data-bin-mode="batch"]','[data-bin-sample]','[data-bin-clear]','[data-bin-command="0b17"]']){
    await click('[data-dt-input-toggle]');assert.ok(find('.dt-bin-workbench').classList.contains('dt-input-hidden'));
    await click(selector);assert.equal(find('.dt-bin-workbench').classList.contains('dt-input-hidden'),false,'Starting input workflow restores the input pane: '+selector);assert.equal(find('.dt-bin-workbench').dataset.pane,'input');
  }
  await click('[data-dt-input-toggle]');const file=find('#ct-bin-file');Object.defineProperty(file,'files',{value:[{name:'incoming.txt',size:4,text:async()=>'0123'}]});file.dispatchEvent(new w.Event('change',{bubbles:true}));await wait();
  assert.equal(find('.dt-bin-workbench').classList.contains('dt-input-hidden'),false);assert.equal(find('#ct-bin-input').value,'0123','Uploading text retains original file handler and reveals the imported content');
  assert.deepEqual(errors,[]);
  process.stdout.write('PASS: application metadata/actions survive layout and view changes; recoverable search/filter empties; home search consistency and reset; Binlog command empty state and input visibility across mode, command, sample, clear and file upload\n');
}finally{w.close()}
