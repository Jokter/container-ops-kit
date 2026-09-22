import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const html=await readFile(new URL('../../index.html',import.meta.url),'utf8');
const config={versions:[{version:'R27C10',baseBranch:'release/27'},{version:'R27C00',baseBranch:'release/26'}],dateMode:'yesterday',username:'tester',ticket:'DTS1',workspaceRoot:'/tmp',schedule:{enabled:false,frequency:'weekdays',weekday:1,time:'09:00',timezone:'Asia/Shanghai',action:'FETCH'}};
const settings={url:'http://grafana/api/tsdb/query',datasourceId:4,timeoutSeconds:60,parallel:2,auth:'none'};
const pause=()=>new Promise(r=>setTimeout(r,10));
function page(extra,url='http://localhost'){return new JSDOM(html,{runScripts:'dangerously',url,beforeParse(w){w.scrollTo=()=>{};w.fetch=async(path,options)=>({ok:true,status:200,json:async()=>{const result=extra?.(path,options);if(result!==undefined)return result;if(path==='/api/auto-ut/report-settings')return{config:structuredClone(config),nextRunAt:null};if(path==='/api/quality/settings')return settings;if(path==='/api/auto-ut/schedule')return null;return[];}});}});}
function open(dom,name){const d=dom.window.document;d.querySelector('[data-platform-domain="automation"]').click();d.querySelector(`[data-automation-capability="${name}"]`).click();if(name==='auto-ut')d.querySelector('[data-qw-auto-tab="plan"]').click();return d;}
test('Auto-UT 获取按钮保存多版本分支并按版本选择修复，无转入按钮',async()=>{
 const calls=[];let captured;const run={id:'r1',jobId:'q1',status:'READY',createdAt:'2026-09-20',config,trigger:'MANUAL',messages:[],claimed:[],taskIds:[],plan:config.versions.map(v=>({version:v.version,repository:'Demo',baseBranch:v.baseBranch,repairBranch:v.baseBranch+'_tester_DTS1_'+v.version,failedTests:1,lineCoverage:.5,lineGoal:.8,configured:true,repositoryUrl:'ssh://git@example/Demo.git'}))};
 const dom=page((path,o)=>{calls.push(path);if(path==='/api/auto-ut/report-settings'&&o?.method==='PUT'){captured=JSON.parse(o.body);return{config:captured,nextRunAt:null};}if(path==='/api/auto-ut/reports'&&o?.method==='POST')return run;if(path==='/api/auto-ut/reports/r1/tasks'){const body=JSON.parse(o.body);assert.deepEqual(body.selected,['R27C00/Demo']);assert.equal(body.mode,'AUTOMATIC');return run;}});
 try{const d=open(dom,'auto-ut');await pause();assert.equal(d.querySelector('[data-auto-ut-mode-switch]'),null);assert.match(d.body.textContent,/全自动执行/);assert.equal(d.querySelector('#qw-report-date'),null);assert.match(d.body.textContent,/自动获取最新数据/);d.querySelector('[data-qw-drawer="versions"]').click();assert.equal(d.querySelectorAll('[data-report-version]').length,2);d.querySelector('[data-qw-close]').click();assert.ok(d.querySelector('[data-report-fetch]'));assert.ok(!d.body.textContent.includes('转入 Auto-UT'));d.querySelector('[data-report-fetch]').click();await pause();assert.deepEqual(captured.versions,config.versions);assert.equal(d.querySelectorAll('[data-report-select]').length,2);const first=d.querySelector('[data-report-select]');first.checked=false;first.dispatchEvent(new dom.window.Event('change'));d.querySelector('[data-auto-ut-start]').click();await pause();assert.ok(calls.includes('/api/auto-ut/reports/r1/tasks'));}finally{dom.window.close();}
});
test('同仓库不同版本的任务进度都显示且不提供 CSV 导入',async()=>{
 const dom=page(path=>path==='/api/auto-ut/tasks'?['R27C10','R27C00'].map((reportVersion,i)=>({id:String(i),repository:'Demo',reportVersion,status:'RESOLVED',nextStage:'DONE',progress:100,workspaceRoot:'/tmp',repairBranch:'repair',message:'完成'})):undefined);
 try{const d=open(dom,'auto-ut');await pause();d.querySelector('[data-qw-auto-tab="tasks"]').click();assert.equal(d.querySelectorAll('[data-auto-ut-task]').length,2);assert.equal(d.querySelector('[data-report-source="csv"]'),null);assert.equal(d.querySelector('#auto-ut-report'),null);}finally{dom.window.close();}
});
test('任务进度使用列表与详情布局并展示按版本隔离的实际目录',async()=>{
 const tasks=[{id:'running',repository:'RunRepo',reportVersion:'R27C10',status:'REPAIRING',nextStage:'REPAIR',progress:45,workspaceRoot:'/tmp',workspacePath:'/tmp/R27C10/runrepo',repairBranch:'repair-run',message:'正在执行 Pi 修复。'},{id:'waiting',repository:'WaitRepo',reportVersion:'R27C00',status:'WAITING_EXTERNAL',nextStage:'VERIFY',progress:70,workspaceRoot:'/tmp',workspacePath:'/tmp/R27C00/waitrepo',repairBranch:'repair-wait',message:'验证失败，请处理。'}];
 const dom=page(path=>path==='/api/auto-ut/tasks'?tasks:undefined);try{const d=open(dom,'auto-ut');await pause();d.querySelector('[data-qw-auto-tab="tasks"]').click();assert.equal(d.querySelectorAll('.ut-task-row').length,2);assert.equal(d.querySelectorAll('.ut-task-timeline>div').length,5);assert.equal(d.querySelector('[data-auto-ut-delete]').disabled,false);assert.equal(d.querySelector('[data-auto-ut-delete]').textContent,'停止并删除');assert.match(d.querySelector('.ut-task-meta').textContent,/实际工作目录.*R27C10\/runrepo/);assert.deepEqual([...d.querySelectorAll('[data-auto-ut-detail-tab]')].map(x=>x.textContent),['执行概览','执行记录','原始日志']);d.querySelector('[data-auto-ut-select="waiting"]').click();assert.match(d.querySelector('.ut-task-detail').textContent,/重试当前步骤/);assert.match(d.querySelector('.ut-task-meta').textContent,/R27C00\/waitrepo/);const status=d.querySelector('#qw-task-status');status.value='waiting';status.dispatchEvent(new dom.window.Event('change'));assert.equal(d.querySelectorAll('.ut-task-row').length,1);assert.match(d.querySelector('.ut-task-row').textContent,/WaitRepo/);assert.doesNotMatch(d.body.textContent,/删除任务和代码|打开 CodeHub MR/);}finally{dom.window.close();}
});
test('UT 任务可手动删除记录与 clone 代码目录',async()=>{
 const task={id:'11111111-1111-4111-8111-111111111111',repository:'Demo',reportVersion:'R27C10',status:'RESOLVED',nextStage:'DONE',progress:100,workspaceRoot:'/tmp',repairBranch:'repair',message:'完成'};let tasks=[task],deleted='';const dom=page((path,o)=>{if(path==='/api/auto-ut/tasks')return tasks;if(path===`/api/auto-ut/tasks/${task.id}`&&o?.method==='DELETE'){deleted=path;tasks=[];return{id:task.id,workspace:'/tmp/R27C10/demo',workspaceDeleted:true};}});
 try{dom.window.confirm=()=>true;const d=open(dom,'auto-ut');await pause();d.querySelector('[data-qw-auto-tab="tasks"]').click();d.querySelector('[data-auto-ut-delete]').click();await pause();assert.equal(deleted,`/api/auto-ut/tasks/${task.id}`);assert.equal(d.querySelectorAll('[data-auto-ut-task]').length,0);assert.match(d.body.textContent,/暂无 UT 治理任务/);}finally{dom.window.close();}
});
test('UT 定时清理可配置保留天数并进入统一计划',async()=>{
 let saved;const dom=page((path,o)=>{if(path==='/api/automation/schedules'&&o?.method==='POST'){saved=JSON.parse(o.body);return{...saved,id:'cleanup',revision:1};}});
 try{const d=open(dom,'auto-ut');await pause();d.querySelector('[data-qw-auto-tab="tasks"]').click();d.querySelector('[data-schedule-new="auto-ut-cleanup"]').click();const retention=d.querySelector('[data-sched-retention]');retention.value='45';retention.dispatchEvent(new dom.window.Event('input'));d.querySelector('[data-qw-save]').click();await pause();assert.equal(saved.task.kind,'auto-ut-cleanup');assert.equal(saved.task.retentionDays,45);assert.equal(saved.enabled,true);}finally{dom.window.close();}
});
test('质量检查独立查询多版本三种类型，结果区区分空数据',async()=>{
 let body;const dom=page((path,o)=>{if(path==='/api/quality/jobs'&&o?.method==='POST'){body=JSON.parse(o.body);return{id:'q1',status:'SUCCEEDED',createdAt:'now',input:body,parts:body.versions.map(version=>({version,kind:'ut',status:'EMPTY',message:'没有有效报告数据，不执行修复',columns:[],rows:[]}))};}});
 try{const d=open(dom,'quality');await pause();d.querySelector('[data-q-fetch]').click();await pause();assert.deepEqual(body.versions,['R27C10','R27C00']);assert.deepEqual(body.kinds,['ut','api','static']);assert.match(d.body.textContent,/没有有效报告数据/);d.querySelector('[data-qw-drawer="export"]').click();assert.equal(d.querySelectorAll('a[href*="/csv?"]').length,2);}finally{dom.window.close();}
});

test('设置以抽屉呈现；取消恢复配置，保存持久化多版本映射',async()=>{
 let saved;const dom=page((path,o)=>{if(path==='/api/auto-ut/report-settings'&&o?.method==='PUT'){saved=JSON.parse(o.body);return{config:saved,nextRunAt:null};}});
 try{const d=open(dom,'auto-ut');await pause();assert.equal(d.querySelector('[data-q-connection]'),null);assert.equal(d.querySelector('#auto-ut-username'),null);assert.equal(d.querySelector('[data-report-version]'),null);
 d.querySelector('[data-qw-drawer="versions"]').click();let input=d.querySelector('[data-report-branch]');input.value='changed';input.dispatchEvent(new dom.window.Event('input'));d.querySelector('[data-qw-close]').click();assert.match(d.querySelector('.qw-version-chip').textContent,/release\/27/);
 d.querySelector('[data-qw-drawer="versions"]').click();input=d.querySelector('[data-report-branch]');input.value='release/new';input.dispatchEvent(new dom.window.Event('input'));d.querySelector('[data-qw-save]').click();await pause();assert.equal(saved.versions[0].baseBranch,'release/new');assert.equal(d.querySelector('[role=dialog]'),null);assert.match(d.querySelector('.qw-version-chip').textContent,/release\/new/);
 }finally{dom.window.close();}
});
test('轮询刷新保持输入焦点、光标和抽屉滚动；Escape 取消编辑',async()=>{
 const dom=page();try{const d=open(dom,'auto-ut');await pause();d.querySelector('[data-qw-drawer="execution"]').click();let input=d.querySelector('#auto-ut-username');input.focus();input.value='tester-edit';input.dispatchEvent(new dom.window.Event('input'));input.setSelectionRange(3,3);d.querySelector('.qw-drawer-body').scrollTop=77;dom.window.render(false);input=d.querySelector('#auto-ut-username');assert.equal(d.activeElement,input);assert.equal(input.value,'tester-edit');assert.equal(input.selectionStart,3);assert.equal(d.querySelector('.qw-drawer-body').scrollTop,77);d.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape'}));assert.equal(d.querySelector('[role=dialog]'),null);d.querySelector('[data-qw-drawer="execution"]').click();assert.equal(d.querySelector('#auto-ut-username').value,'tester');}finally{dom.window.close();}
});
test('多选版本控件保持展开；结果类型可直接切换',async()=>{
 const dom=page();try{const d=open(dom,'quality');await pause();const picker=d.querySelector('[data-qw-open="picker-versions"]');picker.open=true;const selected=d.querySelector('[data-qw-pick="versions"][value="R26C10"]');selected.checked=true;selected.dispatchEvent(new dom.window.Event('change'));assert.equal(d.querySelector('[data-qw-open="picker-versions"]').open,true);assert.match(d.querySelector('[data-qw-open="picker-versions"] summary').textContent,/3/);d.querySelector('[data-qw-tab="api"]').click();assert.equal(d.querySelector('[data-qw-tab="api"]').getAttribute('aria-pressed'),'true');}finally{dom.window.close();}
});

test('定时规则通过统一 API 保存，不改写手动报告配置',async()=>{
 let saved;const dom=page((path,o)=>{if(path==='/api/automation/schedules'&&o?.method==='POST'){saved=JSON.parse(o.body);return{...saved,id:'s1'};}});
 try{const d=open(dom,'auto-ut');await pause();d.querySelector('[data-schedule-new="auto-ut"]').click();assert.equal(d.querySelector('#sched-weekday').hidden,true);assert.equal(d.querySelector('#sched-date'),null);assert.match(d.querySelector('.qw-drawer-body').textContent,/自动获取每个版本的最新 UT 报告/);const freq=d.querySelector('[data-sched-time="frequency"]');freq.value='weekly';freq.dispatchEvent(new dom.window.Event('change'));assert.equal(d.querySelector('#sched-weekday').hidden,false);d.querySelector('[data-qw-save]').click();await pause();assert.equal(saved.timing.frequency,'weekly');assert.equal(saved.enabled,true);assert.deepEqual(saved.task.config.versions,config.versions);}finally{dom.window.close();}
});
test('质量表分页、筛选与行详情使用同一份结果',async()=>{
 const rows=Array.from({length:25},(_,i)=>({'代码仓':'Repo'+i,'PL组':'Access_智能驾舱组','语言':'Java','失败用例':1,'行覆盖率':.5,'行覆盖率目标':.8,'分支覆盖率':.4,'分支覆盖率目标':.7}));const dom=page((path,o)=>path==='/api/quality/jobs'&&o?.method==='POST'?{id:'q1',status:'SUCCEEDED',createdAt:'now',input:JSON.parse(o.body),parts:[{version:'R27C10',kind:'ut',status:'SUCCEEDED',message:'查询完成',rows,columns:Object.keys(rows[0])}]}:undefined);
 try{const d=open(dom,'quality');await pause();d.querySelector('[data-q-fetch]').click();await pause();assert.equal(d.querySelectorAll('.qw-table tbody tr').length,20);d.querySelector('[data-qw-pager="quality"][data-step="1"]').click();assert.equal(d.querySelectorAll('.qw-table tbody tr').length,5);d.querySelector('[data-qw-detail]').click();assert.match(d.querySelector('#qw-drawer-title').textContent,/Repo20/);d.querySelector('[data-qw-close]').click();const search=d.querySelector('#q-search');search.value='Repo24';search.dispatchEvent(new dom.window.Event('input'));assert.equal(d.querySelectorAll('.qw-table tbody tr').length,1);assert.match(d.querySelector('.qw-table tbody').textContent,/Repo24/);}finally{dom.window.close();}
});

test('UT 覆盖率百分数字符串显示当前值和达标线',async()=>{
 const row={'代码仓':'PercentRepo','PL组':'Access_智能驾舱组','语言':'Java','失败用例':1,'行覆盖率':'75.5%','行覆盖率目标':'85%','分支覆盖率':'60%','分支覆盖率目标':'75%'};
 const dom=page((path,o)=>path==='/api/quality/jobs'&&o?.method==='POST'?{id:'percent',status:'SUCCEEDED',createdAt:'now',input:JSON.parse(o.body),parts:[{version:'R27C10',kind:'ut',status:'SUCCEEDED',message:'查询完成',rows:[row],columns:Object.keys(row)}]}:undefined);
 try{const d=open(dom,'quality');await pause();d.querySelector('[data-q-fetch]').click();await pause();const cells=d.querySelector('.qw-table tbody tr').cells;assert.match(cells[4].textContent,/75\.5%\s*\/\s*80%/);assert.match(cells[5].textContent,/60\.0%\s*\/\s*70%/);}finally{dom.window.close();}
});

test('固定导航、浏览器前进后退保留查询条件与滚动位置',async()=>{
 const dom=page();try{const w=dom.window,d=open(dom,'quality');await pause();let scroll=0;Object.defineProperty(w,'scrollY',{get:()=>scroll});w.scrollTo=(_x,y)=>{scroll=y;};const input=d.querySelector('[data-q-field="domain"]');input.value='Access_Custom';input.dispatchEvent(new w.Event('input'));w.scrollTo(0,320);d.querySelector('[data-automation-nav="auto-ut"]').click();await pause();assert.equal(w.location.hash,'#/automation/auto-ut');assert.equal(d.querySelector('.qw-topnav'),null);assert.equal(d.querySelector('.page-head h1').textContent,'UT 治理');w.history.back();await new Promise(r=>setTimeout(r,30));assert.equal(w.location.hash,'#/automation/quality');assert.equal(d.querySelector('[data-q-field="domain"]').value,'Access_Custom');assert.equal(w.scrollY,320);w.history.forward();await new Promise(r=>setTimeout(r,30));assert.equal(d.querySelector('.page-head h1').textContent,'UT 治理');}finally{dom.window.close();}
});
test('独立地址直接打开定时管理页，面包屑返回概览',async()=>{
 const dom=page(undefined,'http://localhost/#/automation/schedules');try{await pause();const d=dom.window.document;assert.equal(d.querySelector('.page-head h1').textContent,'定时任务');assert.equal(d.querySelector('[data-automation-nav="schedules"]').getAttribute('aria-current'),'page');d.querySelector('[data-automation-back]').click();assert.equal(dom.window.location.hash,'#/automation');assert.equal(d.querySelector('.page-head h1').textContent,'自动化工具');await pause();}finally{dom.window.close();}
});
test('质量检查创建计划自动带入范围，并可在统一页暂停与立即执行',async()=>{
 let records=[],created,patched,executed=false;const dom=page((path,o)=>{if(path==='/api/automation/schedules'&&o?.method==='POST'){created=JSON.parse(o.body);const s={...created,id:'s1',revision:1,nextRunAt:'2026-09-22T01:00:00Z',running:false,lastRun:null};records=[s];return s;}if(path==='/api/automation/schedules')return records;if(path==='/api/automation/schedules/s1'&&o?.method==='PATCH'){patched=JSON.parse(o.body);records[0]={...records[0],...patched,revision:2,nextRunAt:null};return records[0];}if(path==='/api/automation/schedules/s1/runs'&&o?.method==='POST'){executed=true;return{id:'r1'};}});
 try{const d=open(dom,'quality');await pause();d.querySelector('[data-schedule-new="quality"]').click();assert.equal(d.querySelector('[data-sched-quality="versions"]').value,'R27C10, R27C00');d.querySelector('[data-qw-save]').click();await pause();assert.equal(created.task.kind,'quality');assert.deepEqual(created.task.query.kinds,['ut','api','static']);d.querySelector('[data-automation-nav="schedules"]').click();await pause();assert.match(d.querySelector('.qw-table tbody').textContent,/每日质量检查/);d.querySelector('[data-schedule-toggle]').click();await pause();assert.equal(patched.enabled,false);assert.equal(patched.revision,1);d.querySelector('[data-schedule-run]').click();await pause();assert.equal(executed,true);}finally{dom.window.close();}
});

test('三类质量报告独立展示组名，过滤与全量排序保留正确详情',async()=>{
 const parts=['ut','api','static'].map(kind=>({kind,version:'R27C10',status:'SUCCEEDED',message:'完成',columns:[],rows:Array.from({length:25},(_,i)=>kind==='static'?{'组名':i===24?'A组':'Z组','问题数':i+1}:{'代码仓':'Repo'+i,'语言':'Java','PL组':i===24?'A组':'Z组','失败用例':i+1,'失败用例数':i+1})}));
 const dom=page((path,o)=>path==='/api/quality/jobs'&&o?.method==='POST'?{id:'groups',status:'SUCCEEDED',createdAt:'now',input:JSON.parse(o.body),parts}:undefined);
 try{const d=open(dom,'quality');await pause();d.querySelector('[data-q-fetch]').click();await pause();
 for(const kind of ['ut','api','static']){d.querySelector(`[data-qw-tab="${kind}"]`).click();const groupIndex=kind==='static'?0:1;const cells=()=>[...d.querySelectorAll('.qw-table tbody tr')].map(r=>r.cells[groupIndex].textContent);
 assert.equal(d.querySelectorAll('.qw-table th')[groupIndex].textContent.trim(),'组名 ↕');assert.equal(cells()[0],'Z组');d.querySelector('[data-qw-group-sort]').click();assert.equal(cells()[0],'A组');assert.equal(d.querySelector('th[aria-sort]').getAttribute('aria-sort'),'ascending');d.querySelector('[data-qw-detail]').click();assert.match(d.querySelector('.qw-drawer-body').textContent,/A组/);d.querySelector('[data-qw-close]').click();d.querySelector('[data-qw-group-sort]').click();assert.equal(cells()[0],'Z组');d.querySelector('[data-qw-group-sort]').click();
 d.querySelector('[data-qw-pager="quality"][data-step="1"]').click();const select=d.querySelector('#q-group');select.value='A组';select.dispatchEvent(new dom.window.Event('change'));assert.deepEqual(cells(),['A组']);assert.match(d.querySelector('.qw-table-foot').textContent,/共 1 条/);assert.match(d.querySelector('.qw-page-controls').textContent,/1 \/ 1/);
 }
 }finally{dom.window.close();}
});

test('选择框点击外部收起，内部多选保留展开，切换选择框与 Escape 正常',async()=>{
 const dom=page();try{const d=open(dom,'quality');await pause();const picker=key=>d.querySelector(`[data-qw-open="picker-${key}"]`);
 picker('versions').querySelector('summary').click();assert.equal(picker('versions').open,true);
 d.querySelector('[data-qw-pick="versions"][value="R26C10"]').click();assert.equal(picker('versions').open,true);assert.equal(d.querySelector('[data-qw-pick="versions"][value="R26C10"]').checked,true);
 picker('teams').querySelector('summary').click();assert.equal(picker('versions').open,false);assert.equal(picker('teams').open,true);
 d.querySelector('.page-head h1').click();assert.equal(picker('teams').open,false);dom.window.render(false);assert.equal(picker('teams').open,false);
 picker('versions').querySelector('summary').click();d.querySelector('[data-qw-tab="api"]').click();assert.equal(picker('versions').open,false);assert.equal(d.querySelector('[data-qw-tab="api"]').getAttribute('aria-pressed'),'true');
 picker('versions').querySelector('summary').click();d.querySelector('#qw-add-versions').focus();d.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape'}));assert.equal(picker('versions').open,false);assert.equal(d.activeElement,picker('versions').querySelector('summary'));
 assert.equal(d.querySelector('.platform-switch').tagName,'NAV');assert.equal(d.querySelector('[data-platform-domain="automation"]').getAttribute('aria-current'),'page');d.querySelector('[data-platform-domain="container"]').click();assert.equal(d.querySelector('[data-platform-domain="container"]').getAttribute('aria-current'),'page');
 }finally{dom.window.close();}
});

test('执行设置自动建单回填单号，保留用户名目录并阻止重复点击',async()=>{
 let calls=0;
 const dom=page(path=>path==='/api/auto-ut/tickets'?(calls++,{ticket:'DTS2609220015806',status:'READY',message:'单号已填入'}):undefined);
 try{const d=open(dom,'auto-ut');await pause();d.querySelector('[data-qw-drawer="execution"]').click();
 const ticket=d.querySelector('#auto-ut-ticket');ticket.value='';ticket.dispatchEvent(new dom.window.Event('input'));
 d.querySelector('#auto-ut-create-ticket').click();assert.equal(d.querySelector('#auto-ut-create-ticket').disabled,true);await pause();
 assert.equal(d.querySelector('#auto-ut-ticket').value,'DTS2609220015806');assert.equal(d.querySelector('#auto-ut-username').value,'tester');assert.match(d.querySelector('.auto-ut-workspace').textContent,/\/tmp/);
 d.querySelector('#auto-ut-create-ticket').click();await pause();assert.equal(calls,1);
 }finally{dom.window.close();}
});

test('DTS Token 仅在密码框输入，保存后不回显并支持清除',async()=>{
 let configured=false,received='';
 const dom=page((path,options)=>{if(path!=='/api/auto-ut/dts-settings')return;if(options?.method==='PUT'){received=JSON.parse(options.body).token;configured=true;}if(options?.method==='DELETE')configured=false;return{configured};});
 try{const d=open(dom,'auto-ut');await pause();d.querySelector('[data-qw-drawer="execution"]').click();d.querySelector('#dts-configure').click();await pause();
 assert.equal(d.querySelector('#dts-token').type,'password');assert.match(d.querySelector('#dts-status').textContent,/未配置/);
 d.querySelector('#dts-token').value='test-secret-token';d.querySelector('#dts-save').click();await pause();assert.equal(received,'test-secret-token');assert.equal(d.querySelector('#dts-token').value,'');assert.match(d.querySelector('#dts-status').textContent,/已配置/);assert.ok(!d.documentElement.outerHTML.includes('test-secret-token'));assert.ok(!JSON.stringify(dom.window.sessionStorage).includes('test-secret-token'));
 d.querySelector('#dts-clear').click();await pause();assert.match(d.querySelector('#dts-status').textContent,/未配置/);
 }finally{dom.window.close();}
});
