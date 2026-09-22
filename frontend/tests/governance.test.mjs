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
 const dom=new JSDOM(html,{url:'http://localhost/#/automation',runScripts:'dangerously',beforeParse(w){w.scrollTo=()=>{};w.fetch=async url=>{requests.push(url);return{ok:true,status:200,json:async()=>url==='/api/auto-ut/tasks'?tasks:url.startsWith('/api/auto-ut/governance')?{metrics:{streak:7,fixedServices:1,fixedCases:1,supplementedServices:1,addedCases:1},records:tasks}:[]};};}});
 try{
  await pause();const d=dom.window.document;
  assert.equal(d.querySelector('.page-head h1').textContent,'自动化概览');
  assert.equal(d.querySelectorAll('.governance-stats .studio-stat').length,3);
  assert.match(d.querySelector('.governance-dashboard').textContent,/连续执行 7 天/);
  assert.match(d.querySelector('.governance-dashboard').textContent,/依赖下载失败/);
  assert.equal(d.querySelector('[data-auto-ut-live]'),null);
  const version=d.querySelector('#governance-version');version.value='R27C10';version.dispatchEvent(new dom.window.Event('change'));await pause();
  assert.ok(requests.includes('/api/auto-ut/governance?version=R27C10&days=0'));
  d.querySelector('[data-governance-detail="failed"]').click();
  assert.ok(d.querySelector('[data-auto-ut-live]'));
  assert.match(d.querySelector('.ut-task-detail').textContent,/依赖下载失败/);
 }finally{await pause();dom.window.close();}
});

test('概览聚合三类任务，成果下钻沿用版本与时间范围，记录可按工具筛选',async()=>{
 const now=new Date().toISOString(),old=new Date(Date.now()-40*86400000).toISOString();
 const tasks=[{id:'new',repository:'NewService',reportVersion:'R27C10',status:'RESOLVED',updatedAt:now,governance:{fixedIds:['A#test']}},{id:'old',repository:'OldService',reportVersion:'R27C10',status:'RESOLVED',updatedAt:old,governance:{fixedIds:['B#test']}},{id:'partial',repository:'PartialService',reportVersion:'R27C10',status:'RESOLVED',updatedAt:now,governance:{classResults:[{target:'DemoTest',status:'FAILED',message:'回归失败'}]}}];
 const config={versions:[{version:'R27C10',baseBranch:'master'}],username:'',ticket:'',workspaceRoot:''};
 const report={id:'report',status:'READY',createdAt:now,config,plan:[],claimed:[],messages:[]};
 const dom=new JSDOM(html,{url:'http://localhost/#/automation',runScripts:'dangerously',beforeParse(w){w.scrollTo=()=>{};w.fetch=async url=>({ok:true,status:200,json:async()=>url==='/api/auto-ut/tasks'?tasks:url.startsWith('/api/auto-ut/governance')?{metrics:{fixedCases:2},records:tasks}:url==='/api/auto-ut/report-settings'?{config}:url==='/api/auto-ut/reports'?[report]:url==='/api/quality/settings'?{url:'http://grafana/api/query'}:url==='/api/quality/jobs'?[{id:'quality',status:'FAILED',createdAt:now,input:{versions:['R27C10']}}]:[]});}});
 try{
  await pause();const d=dom.window.document;
  assert.ok(d.querySelector('[data-studio-record="quality"]'));
  assert.ok(d.querySelector('[data-studio-record="report"]'));
  assert.match(d.querySelector('.governance-dashboard').textContent,/DemoTest：回归失败/);
  const days=d.querySelector('#governance-days');days.value='7';days.dispatchEvent(new dom.window.Event('change'));await pause();
  d.querySelector('[data-studio-outcome="fixed"]').click();await pause();
  assert.equal(dom.window.location.hash,'#/automation/tasks');
  assert.deepEqual([...d.querySelectorAll('[data-auto-ut-task]')].map(el=>el.dataset.autoUtTask),['new']);
  d.querySelector('[data-studio-reset-outcome]').click();
  assert.equal(d.querySelectorAll('[data-auto-ut-task]').length,3);
  const kind=d.querySelector('#studio-record-kind');kind.value='quality';kind.dispatchEvent(new dom.window.Event('change'));
  assert.equal(d.querySelectorAll('.studio-record-table tbody tr').length,1);
  assert.ok(d.querySelector('[data-studio-record="quality"]'));
  const switcher=d.querySelector('.studio-workspace');switcher.querySelector('summary').click();assert.equal(switcher.open,true);
  d.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape'}));assert.equal(switcher.open,false);
 }finally{await pause();dom.window.close();}
});

test('超长失败原因默认显示摘要，展开保留完整转义内容',async()=>{
 const reason='失败 <script>unsafe()</script> '+('very-long-path/'.repeat(160))+' 最终错误';
 const dom=new JSDOM(html,{url:'http://localhost/#/automation',runScripts:'dangerously',beforeParse(w){w.scrollTo=()=>{};}});
 try{
  const markup=dom.window.automationRecordTable([{id:'archived',kind:'ut',name:'Demo',version:'R27C10',state:'waiting',result:reason,time:'',task:{}}]);
  const holder=dom.window.document.createElement('div');holder.innerHTML=markup;
  const detail=holder.querySelector('.studio-result');assert.equal(detail.open,false);
  assert.ok(detail.querySelector('summary').textContent.length<=181);
  assert.equal(detail.querySelector('pre').textContent,reason);assert.equal(holder.querySelector('script'),null);
  detail.querySelector('summary').click();assert.equal(detail.open,true);
 }finally{dom.window.close();}
});
