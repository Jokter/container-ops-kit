import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const html=await readFile(new URL('../../index.html',import.meta.url),'utf8');
const pause=()=>new Promise(r=>setTimeout(r,150));
test('默认成果看板展示真实指标与失败原因，执行详情按需打开，版本筛选刷新统计',async()=>{
 const requests=[];const now=new Date().toISOString();
 const tasks=[{id:'failed',repository:'FailService',reportVersion:'R27C10',status:'WAITING_EXTERNAL',nextStage:'BASELINE',message:'依赖下载失败',createdAt:now,updatedAt:now,progress:25},
 {id:'done',repository:'FixedService',reportVersion:'R27C00',status:'RESOLVED',nextStage:'DONE',message:'完成',createdAt:now,updatedAt:now,governance:{fixedIds:['X#test'],addedIds:['Y#test'],mrState:'PENDING'},pullRequestUrl:'https://example.com/mr/1'}];
 const dom=new JSDOM(html,{url:'http://localhost/#/automation/auto-ut',runScripts:'dangerously',beforeParse(w){w.scrollTo=()=>{};w.fetch=async url=>{requests.push(url);return{ok:true,status:200,json:async()=>url==='/api/auto-ut/tasks'?tasks:url.startsWith('/api/auto-ut/governance')?{metrics:{streak:7,fixedServices:1,fixedCases:1,supplementedServices:1,addedCases:1},records:tasks}:[]};};}});
 try{
  await pause();const d=dom.window.document;
  assert.equal(d.querySelector('.page-head h1').textContent,'UT 治理');
  assert.equal(d.querySelectorAll('.governance-stats .qw-stat').length,5);
  assert.match(d.querySelector('.governance-stats').textContent,/连续执行7/);
  assert.match(d.querySelector('.governance-dashboard').textContent,/依赖下载失败/);
  assert.equal(d.querySelector('[data-auto-ut-live]'),null);
  const version=d.querySelector('#governance-version');version.value='R27C10';version.dispatchEvent(new dom.window.Event('change'));await pause();
  assert.ok(requests.includes('/api/auto-ut/governance?version=R27C10&days=0'));
  d.querySelector('[data-governance-detail="failed"]').click();
  assert.ok(d.querySelector('[data-auto-ut-live]'));
  assert.match(d.querySelector('.ut-task-detail').textContent,/依赖下载失败/);
 }finally{dom.window.close();}
});
