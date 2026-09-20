import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const html=await readFile(new URL('../../index.html',import.meta.url),'utf8');
const config={versions:[{version:'R27C10',baseBranch:'release/27'},{version:'R27C00',baseBranch:'release/26'}],dateMode:'yesterday',username:'tester',ticket:'DTS1',workspaceRoot:'/tmp',schedule:{enabled:false,frequency:'weekdays',weekday:1,time:'09:00',timezone:'Asia/Shanghai',action:'FETCH'}};
const settings={url:'http://grafana/api/tsdb/query',datasourceId:4,timeoutSeconds:60,parallel:2,auth:'none'};
const pause=()=>new Promise(r=>setTimeout(r,10));
function page(extra){return new JSDOM(html,{runScripts:'dangerously',url:'http://localhost',beforeParse(w){w.scrollTo=()=>{};w.fetch=async(path,options)=>({ok:true,status:200,json:async()=>{const result=extra?.(path,options);if(result!==undefined)return result;if(path==='/api/auto-ut/report-settings')return{config:structuredClone(config),nextRunAt:null};if(path==='/api/quality/settings')return settings;if(path==='/api/auto-ut/schedule')return null;return[];}});}});}
function open(dom,name){const d=dom.window.document;d.querySelector('[data-platform-domain="automation"]').click();d.querySelector(`[data-automation-capability="${name}"]`).click();return d;}
test('Auto-UT 获取按钮保存多版本分支并按版本选择修复，无转入按钮',async()=>{
 const calls=[];let captured;const run={id:'r1',jobId:'q1',status:'READY',createdAt:'2026-09-20',config,trigger:'MANUAL',messages:[],claimed:[],taskIds:[],plan:config.versions.map(v=>({version:v.version,repository:'Demo',baseBranch:v.baseBranch,repairBranch:v.baseBranch+'_tester_DTS1_'+v.version,failedTests:1,lineCoverage:.5,lineGoal:.8,configured:true,repositoryUrl:'ssh://git@example/Demo.git'}))};
 const dom=page((path,o)=>{calls.push(path);if(path==='/api/auto-ut/report-settings'&&o?.method==='PUT'){captured=JSON.parse(o.body);return{config:captured,nextRunAt:null};}if(path==='/api/auto-ut/reports'&&o?.method==='POST')return run;if(path==='/api/auto-ut/reports/r1/tasks'){assert.deepEqual(JSON.parse(o.body).selected,['R27C00/Demo']);return run;}});
 try{const d=open(dom,'auto-ut');await pause();assert.equal(d.querySelectorAll('[data-report-version]').length,2);assert.ok(d.querySelector('[data-report-fetch]'));assert.ok(!d.body.textContent.includes('转入 Auto-UT'));d.querySelector('[data-report-fetch]').click();await pause();assert.deepEqual(captured.versions,config.versions);assert.equal(d.querySelectorAll('[data-report-select]').length,2);const first=d.querySelector('[data-report-select]');first.checked=false;first.dispatchEvent(new dom.window.Event('change'));d.querySelector('[data-auto-ut-start]').click();await pause();assert.ok(calls.includes('/api/auto-ut/reports/r1/tasks'));}finally{dom.window.close();}
});
test('同仓库不同版本的任务进度都显示，CSV 入口保留',async()=>{
 const dom=page(path=>path==='/api/auto-ut/tasks'?['R27C10','R27C00'].map((reportVersion,i)=>({id:String(i),repository:'Demo',reportVersion,status:'RESOLVED',nextStage:'DONE',progress:100,workspaceRoot:'/tmp',repairBranch:'repair',message:'完成'})):undefined);
 try{const d=open(dom,'auto-ut');await pause();assert.equal(d.querySelectorAll('[data-auto-ut-task]').length,2);d.querySelector('[data-report-source="csv"]').click();assert.equal(d.querySelector('.auto-ut-file').hidden,false);assert.ok(d.querySelector('#auto-ut-report'));}finally{dom.window.close();}
});
test('质量检查独立查询多版本三种类型，结果区区分空数据',async()=>{
 let body;const dom=page((path,o)=>{if(path==='/api/quality/jobs'&&o?.method==='POST'){body=JSON.parse(o.body);return{id:'q1',status:'SUCCEEDED',createdAt:'now',input:body,parts:body.versions.map(version=>({version,kind:'ut',status:'EMPTY',message:'没有有效报告数据，不执行修复',columns:[],rows:[]}))};}});
 try{const d=open(dom,'quality');await pause();d.querySelector('[data-q-fetch]').click();await pause();assert.deepEqual(body.versions,['R27C10','R27C00']);assert.deepEqual(body.kinds,['ut','api','static']);assert.match(d.body.textContent,/没有有效报告数据/);assert.equal(d.querySelectorAll('a[href*="/csv?"]').length,2);}finally{dom.window.close();}
});
