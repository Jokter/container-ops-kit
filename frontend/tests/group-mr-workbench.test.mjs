import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {JSDOM} from 'jsdom'
const html=await readFile(new URL('../../index.html',import.meta.url),'utf8'),sha='a'.repeat(40),flush=()=>new Promise(r=>setTimeout(r,40))
const row=id=>({id:String(id),repo:'MAE-M/Access/Repo'+id,iid:String(id),sha,phase:'ISSUES',status:'待修改',sender:'developer',events:[],reviewComments:[],writePending:'',updatedAt:'2026-10-22T10:00:00Z'})
async function setup(t,{unsupported=false,failWrite=false,failReloadAfterClose=false,fileCount=0,extraThreads=[]}={}){
 const records=Array.from({length:36},(_,i)=>row(i+1)),writes=[];let closed=false,replies=[]
 const snapshot=()=>({sha,state:'opened',files:[{path:'src/a.ts',oldPath:'src/a.ts',status:'modified',diff:'@@ -1,3 +1,3 @@\n old\n-deleted\n+<script>alert(1)</script>\n tail',unavailable:false},{path:'src/large.bin',status:'added',diff:'',unavailable:true},...Array.from({length:fileCount},(_,i)=>({path:'src/group'+Math.floor(i/16)+'/file'+i+'.ts',oldPath:'src/group'+Math.floor(i/16)+'/file'+i+'.ts',diff:'@@ -1 +1 @@\n-old\n+new',status:'modified'}))],threads:[{id:'thread',body:'修复边界问题',author:'reviewer',resolved:closed,resolvable:true,path:'src/a.ts',line:2,headSha:sha,fingerprint:'f'.repeat(64),notes:[{id:'1',body:'修复边界问题',author:'reviewer'},...replies]},...extraThreads],capabilities:{reply:!unsupported,create:!unsupported,reason:unsupported?'CLI 不支持':''},writePending:'',readAt:'2026-10-22T10:00:00Z'})
 const response=(data,ok=true)=>({ok,status:ok?200:409,json:async()=>data})
 const dom=new JSDOM(html,{runScripts:'dangerously',url:'http://localhost/#/automation/group-mr',beforeParse(w){w.scrollTo=()=>{};const timeout=w.setTimeout.bind(w);w.setTimeout=(fn,delay,...args)=>delay>500?0:timeout(fn,delay,...args);w.fetch=async(url,options)=>{
  if(url.endsWith('/workspace')){if(options?.method==='POST'){const data=JSON.parse(options.body);writes.push(data);if(failWrite)return response({message:'写入结果待核对'},false);if(data.action==='resolve')closed=true;else replies.push({id:'2',body:data.body,author:'owner'});return response({ok:true})}if(closed&&failReloadAfterClose)return response({message:'刷新失败'},false);return response(snapshot())}
  if(url==='/api/automation/group-mr')return response({config:{enabled:false},pending:records,history:[],monitor:{},metrics:{pending:records.length}})
  if(url==='/api/automation/knowledge')return response({items:[],reviews:[]})
  if(url.startsWith('/api/automation/effectiveness'))return response({total:0,stages:{},reviews:0,merged:0,anomalies:0,rejected:0})
  return response([])
 }}})
 t.after(async()=>{for(let i=0;i<20&&dom.window.eval('Object.values(mrWorkbench.cache).some(v=>v.loading)');i++)await flush();dom.window.close()});await flush();return {dom,d:dom.window.document,records,writes}
}
const click=(d,selector)=>{assert.ok(d.querySelector(selector),selector);d.querySelector(selector).click()}
const input=(dom,selector,value)=>{const el=dom.window.document.querySelector(selector);el.value=value;el.dispatchEvent(new dom.window.Event('input',{bubbles:true}))}
test('pagination limits select-all to page, crosses page in continuous review, restores selection and page',async t=>{
 const {dom,d}=await setup(t);assert.equal(d.querySelectorAll('[data-group-mr-record]').length,10);click(d,'[data-group-mr-check-all]');assert.equal(dom.window.eval('groupMrUi.checked.length'),10)
 click(d,'[data-mrw-page="1"]');assert.equal(dom.window.eval('groupMrUi.checked.length'),0);assert.equal(d.querySelector('[data-group-mr-record]').dataset.groupMrRecord,'11')
 click(d,'[data-group-mr-record="20"] td:nth-child(3)');click(d,'[data-mrw-next="1"]');assert.equal(d.querySelector('[data-mr-review-id]').dataset.mrReviewId,'21');assert.ok(d.querySelector('.mr-focus-mode'))
 click(d,'[data-mrw-focus]');for(let i=0;i<20&&!d.querySelector('.nav-list');i++)await flush();assert.equal(d.querySelector('[data-group-mr-record]').dataset.groupMrRecord,'11');assert.match(d.querySelector('.mr-pagination').textContent,/2 \/ 4/)
 input(dom,'#group-mr-search','Repo36');assert.equal(d.querySelectorAll('[data-group-mr-record]').length,1);assert.match(d.querySelector('.mr-pagination').textContent,/1 \/ 1/)
})
test('incoming MR does not reorder the list until explicit refresh; backend retry replaces existing row in place',async t=>{
 const {dom,d,records}=await setup(t);records.unshift(row(100));await dom.window.eval('loadGroupMr()');assert.equal(d.querySelector('[data-group-mr-record]').dataset.groupMrRecord,'1');assert.match(d.querySelector('.mr-new-banner').textContent,/1 条新 MR/)
 click(d,'[data-mrw-refresh]');await flush();assert.equal(d.querySelector('[data-group-mr-record]').dataset.groupMrRecord,'100')
})
test('diff is escaped, files switch, reply draft survives polling and MR switches, closure posts fingerprint',async t=>{
 const {dom,d,writes}=await setup(t);click(d,'.nav-enter[data-mr-open="1"]');await flush();assert.ok(d.querySelector('.mr-code-browser'));assert.equal(d.querySelector('.mr-diff-pane script'),null);assert.match(d.querySelector('.mr-diff-pane').textContent,/<script>/)
 click(d,'[data-mrw-file="1"]');assert.match(d.querySelector('.mr-diff-pane').textContent,/二进制/);click(d,'[data-mrw-file="0"]')
 click(d,'[data-mrw-thread="thread"]');input(dom,'[data-mrw-draft="thread"]','已修复，请确认');await dom.window.eval('loadGroupMr()');assert.equal(d.querySelector('[data-mrw-draft]').value,'已修复，请确认')
 click(d,'[data-mrw-next="1"]');assert.equal(d.querySelector('[data-mrw-stay]'),null);assert.equal(d.querySelector('[data-mr-review-id]').dataset.mrReviewId,'2')
 click(d,'[data-mrw-next="-1"]');assert.equal(d.querySelector('[data-mrw-draft]').value,'已修复，请确认');d.querySelector('[data-mrw-form]').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await flush();await flush();assert.equal(writes.length,1);assert.equal(writes[0].action,'reply');assert.equal(writes[0].sha,sha)
 click(d,'[data-mrw-resolve="thread"]');input(dom,'[data-mrw-draft="thread"]','核对当前差异后确认修复');d.querySelector('[data-mrw-form]').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await flush();await flush();assert.equal(writes[1].action,'resolve');assert.equal(writes[1].fingerprint,'f'.repeat(64));assert.equal(writes[1].confirmed,true);assert.ok(d.querySelector('.mr-inline-note.resolved'))
})
test('unsupported CLI disables new comments and reply, failed writes keep drafts across automatic switches',async t=>{
 const unsupported=await setup(t,{unsupported:true});click(unsupported.d,'.nav-enter[data-mr-open="1"]');await flush();assert.equal(unsupported.d.querySelector('[data-mrw-line]'),null);click(unsupported.d,'[data-mrw-thread="thread"]');assert.equal(unsupported.d.querySelector('[data-mrw-form="reply"]'),null)
 const {dom,d,writes}=await setup(t,{failWrite:true});click(d,'.nav-enter[data-mr-open="1"]');await flush();click(d,'[data-mrw-line="2"]');input(dom,'[data-mrw-draft="new"]','检查新增行');d.querySelector('[data-mrw-form]').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await flush();await flush();assert.equal(writes.length,1);assert.equal(d.querySelector('[data-mrw-draft="new"]').value,'检查新增行')
 click(d,'[data-mrw-next="1"]');click(d,'[data-mrw-next="-1"]');assert.equal(d.querySelector('[data-mrw-draft="new"]').value,'检查新增行')
})

test('diff rows keep table layout with all styles loaded, and live removal does not switch focused MR',async t=>{
 const {dom,d,records}=await setup(t)
 for(const path of ['quality-workspace.css','studio-workspace.css','home-workbench.css','platform-workspace.css','workspace-layout.css']){const style=d.createElement('style');style.textContent=await readFile(new URL('../src/'+path,import.meta.url),'utf8');d.head.append(style)}
 click(d,'.nav-enter[data-mr-open="1"]');await flush();const css=el=>dom.window.getComputedStyle(el)
 assert.equal(css(d.querySelector('.mr-diff-scroll tr')).display,'table-row');assert.equal(css(d.querySelector('.mr-diff-scroll tbody')).display,'table-row-group');assert.equal(css(d.querySelector('.mr-diff-scroll td:last-child')).whiteSpace,'pre');assert.equal(css(d.querySelector('.mr-code-browser')).display,'grid')
 records.splice(0,1);await dom.window.eval('loadGroupMr()');assert.equal(d.querySelector('[data-mr-review-id]').dataset.mrReviewId,'1');assert.match(d.querySelector('.nav-current').textContent,/已移出筛选结果/);assert.equal(d.querySelector('[data-mrw-resolve]').disabled,true)
})


test('large file tree scrolls independently, search reveals collapsed folders and view survives rerender',async t=>{
 const {dom,d}=await setup(t,{fileCount:240});click(d,'.nav-enter[data-mr-open="1"]');await flush();assert.equal(d.querySelectorAll('[data-mrw-file]').length,2);click(d,'[data-mrw-folders]');click(d,'[data-mrw-folders]');assert.equal(d.querySelectorAll('[data-mrw-file]').length,242)
 d.querySelector('.mr-file-scroll').scrollTop=500;d.querySelector('.mr-diff-scroll').scrollTop=240;d.querySelector('.mr-diff-scroll').scrollLeft=80
 await dom.window.eval('loadGroupMr()');assert.equal(d.querySelector('.mr-file-scroll').scrollTop,500);assert.equal(d.querySelector('.mr-diff-scroll').scrollTop,240);assert.equal(d.querySelector('.mr-diff-scroll').scrollLeft,80)
 click(d,'[data-mrw-folders]');assert.equal(d.querySelectorAll('[data-mrw-file]').length,0);input(dom,'#mr-file-search','file239');assert.equal(d.querySelectorAll('[data-mrw-file]').length,1);click(d,'[data-mrw-file="241"]');assert.match(d.querySelector('.mr-diff-pane>header').textContent,/file239/)
 input(dom,'#mr-file-search','');assert.ok(d.querySelector('[data-mrw-file="241"]'));click(d,'[data-mrw-file-step="-1"]');assert.match(d.querySelector('.mr-code-footer').textContent,/241 \/ 242/)
 const style=d.createElement('style');style.textContent=await readFile(new URL('../src/studio-workspace.css',import.meta.url),'utf8');d.head.append(style);assert.equal(dom.window.getComputedStyle(d.querySelector('.mr-file-scroll')).overflowY,'scroll');assert.equal(dom.window.getComputedStyle(d.querySelector('.mr-diff-scroll')).minHeight,'0px');assert.equal(d.querySelector('[data-demo-viewed]'),null)
})

test('line comments collapse together, retain drafts and survive polling and file switches',async t=>{
 const {dom,d}=await setup(t);click(d,'.nav-enter[data-mr-open="1"]');await flush();assert.equal(d.querySelector('.mr-inline-row').previousElementSibling.dataset.mrwLineRow,'2')
 click(d,'[data-mrw-thread="thread"]');input(dom,'[data-mrw-draft="thread"]','保留这份草稿');click(d,'.mr-inline-note [data-mrw-note-toggle]');assert.equal(d.querySelector('[data-mrw-draft="thread"]'),null);assert.equal(d.querySelector('.mr-inline-note p'),null);assert.equal(d.querySelector('[data-mrw-note-card] p'),null)
 assert.match(d.querySelector('.mr-inline-note').textContent,/新代码第 2 行/);await dom.window.eval('loadGroupMr()');click(d,'[data-mrw-file="1"]');click(d,'[data-mrw-file="0"]');assert.equal(d.querySelector('.mr-inline-note p'),null)
 click(d,'[data-mrw-notes-toggle]');assert.equal(d.querySelector('[data-mrw-draft="thread"]').value,'保留这份草稿');assert.match(d.querySelector('.mr-inline-note p').textContent,/修复边界/)
 click(d,'[data-mrw-notes-toggle]');click(d,'[data-mr-view="notes"]');click(d,'[data-mrw-note-code="thread"]');assert.ok(d.querySelector('.mr-inline-note p'));assert.ok(d.querySelector('[data-mrw-line-row="2"]').classList.contains('highlight'))
})

test('old line locations map to deleted rows; historical, missing lines and MR-wide notes remain distinct',async t=>{
 const extraThreads=[{id:'old',path:'src/a.ts',oldPath:'src/a.ts',oldLine:2,line:null,headSha:sha,body:'旧代码问题',author:'reviewer',resolved:false},{id:'history',path:'src/a.ts',line:3,headSha:'b'.repeat(40),body:'历史意见',author:'reviewer',resolved:false},{id:'missing',path:'src/a.ts',line:999,headSha:sha,body:'范围外意见',resolved:false},{id:'general',body:'整体意见',resolved:false}]
 const {d}=await setup(t,{extraThreads});click(d,'.nav-enter[data-mr-open="1"]');await flush();click(d,'[data-mr-view="notes"]');assert.match(d.querySelector('[data-mrw-note-card="old"]').textContent,/旧代码第 2 行/);assert.match(d.querySelector('[data-mrw-note-card="general"]').textContent,/MR 整体意见/)
 click(d,'[data-mrw-note-code="old"]');assert.ok(d.querySelector('[data-mrw-old-row="2"]').classList.contains('del'));assert.ok(d.querySelector('[data-mrw-old-row="2"]').classList.contains('highlight'));assert.match(d.querySelector('[data-mrw-old-row="2"]').nextElementSibling.textContent,/旧代码问题/)
 click(d,'[data-mr-view="notes"]');click(d,'[data-mrw-note-code="history"]');assert.equal(d.querySelector('.mr-diff-scroll .highlight'),null);assert.match(d.querySelector('.mr-code-section [role="status"]').textContent,/历史提交/);assert.ok(!d.querySelector('.mr-diff-scroll').textContent.includes('历史意见'))
 click(d,'[data-mr-view="notes"]');click(d,'[data-mrw-note-code="missing"]');assert.match(d.querySelector('.mr-code-section [role="status"]').textContent,/未出现在当前 diff/)
})

test('list actions open opinions or records directly; picker and browser history restore filters and checks',async t=>{
 const {dom,d,records}=await setup(t)
 records[1].phase='FAILED';records[1].stage='PIPELINE';records[1].status='流水线失败';await dom.window.eval('loadGroupMr()')
 assert.equal(d.querySelector('.group-mr-detail-section'),null);assert.equal(d.querySelector('[data-group-mr-record="2"] .nav-stage').textContent,'流水线')
 click(d,'[data-group-mr-record="2"] [data-mr-target="records"]');await flush();assert.ok(d.querySelector('.nav-flow-records'));assert.match(d.querySelector('.nav-flow-records').textContent,/流水线失败/)
 click(d,'[data-mrw-focus]');for(let i=0;i<20&&!d.querySelector('.nav-list');i++)await flush()
 input(dom,'#group-mr-search','Repo1');click(d,'[data-group-mr-check="1"]');click(d,'[data-group-mr-record="1"] [data-mr-target="notes"]');await flush()
 assert.ok(d.querySelector('.mr-review-notes'));assert.equal(d.querySelector('.mr-code-browser'),null);assert.ok(d.querySelector('.nav-flow-card'))
 click(d,'[data-mr-picker]');input(dom,'#mr-picker-search','Repo10');assert.equal(d.querySelectorAll('.nav-picker [data-mr-open]').length,1);click(d,'.nav-picker [data-mr-open="10"]');await flush()
 assert.equal(d.querySelector('[data-mr-review-id]').dataset.mrReviewId,'10');dom.window.history.back();for(let i=0;i<20&&!d.querySelector('.nav-list');i++)await flush()
 assert.equal(d.querySelector('#group-mr-search').value,'Repo1');assert.equal(d.querySelector('[data-group-mr-check="1"]').checked,true)
 dom.window.history.forward();for(let i=0;i<20&&!d.querySelector('.nav-review');i++)await flush();assert.equal(d.querySelector('[data-mr-review-id]').dataset.mrReviewId,'10')
 await flush()
})

test('a changed commit disables inline closure and preserves the old draft without writing',async t=>{
 const {dom,d,records,writes}=await setup(t);click(d,'.nav-enter[data-mr-open="1"]');await flush();click(d,'[data-mrw-resolve="thread"]');input(dom,'[data-mrw-draft="thread"]','核对旧提交')
 records[0].sha='b'.repeat(40);await dom.window.eval('loadGroupMr()');dom.window.eval('render(false)')
 assert.equal(d.querySelector('[data-mrw-resolve="thread"]').disabled,true);assert.equal(d.querySelector('.mr-inline-note [data-mrw-form]'),null);assert.match(d.querySelector('[role="alert"]').textContent,/提交已变化/)
 click(d,'[data-mrw-next="1"]');await flush();click(d,'[data-mrw-next="-1"]');assert.equal(dom.window.eval('mrDraft("1").thread.body'),'核对旧提交');assert.equal(writes.length,0)
})


test('remote merge disables writes immediately even when the cached diff still says opened',async t=>{
 const {dom,d,records,writes}=await setup(t);click(d,'.nav-enter[data-mr-open="1"]');await flush();assert.equal(d.querySelector('[data-mrw-resolve="thread"]').disabled,false)
 records[0].phase='DONE';records[0].status='已确认远端 MR 已合入';await dom.window.eval('loadGroupMr()')
 assert.equal(d.querySelector('[data-mrw-resolve="thread"]').disabled,true);assert.equal(d.querySelector('[data-mrw-line]'),null);assert.equal(d.querySelector('[data-mr-review-id]').dataset.mrReviewId,'1');assert.equal(writes.length,0)
})

test('nested tree keeps search expansion separate, aggregates opinions and reveals a hidden selected file',async t=>{
 const {dom,d}=await setup(t,{fileCount:48,extraThreads:[{id:'nested',path:'src/group2/file47.ts',body:'检查边界',resolved:false}]});click(d,'.nav-enter[data-mr-open="1"]');await flush()
 assert.equal(d.querySelector('[data-tree-folder="src"] .mr-tree-count').textContent,'50')
 assert.equal(d.querySelector('[data-tree-folder="src"] .mr-tree-discussion').textContent,'2')
 assert.equal(d.querySelector('[data-tree-folder="src/group2"]').getAttribute('aria-expanded'),'false')
 input(dom,'#mr-file-search','file47');assert.equal(d.querySelectorAll('[data-mrw-file]').length,1)
 assert.equal(d.querySelector('[data-tree-folder="src/group2"]').closest('ul').getAttribute('role'),'group')
 click(d,'[data-tree-folder="src/group2"]');assert.equal(d.querySelectorAll('[data-mrw-file]').length,0)
 input(dom,'#mr-file-search','');assert.equal(d.querySelector('[data-tree-folder="src/group2"]').getAttribute('aria-expanded'),'false')
 click(d,'[data-mrw-folders]');click(d,'[data-tree-reveal]');assert.ok(d.querySelector('[data-mrw-file="0"]'))
 input(dom,'#mr-file-search','file47');click(d,'[data-mrw-file="49"]');input(dom,'#mr-file-search','')
 assert.equal(d.querySelector('[data-tree-folder="src/group2"]').getAttribute('aria-expanded'),'true')
 await dom.window.eval('loadGroupMr()');assert.ok(d.querySelector('[data-mrw-file="49"]').classList.contains('selected'))
 assert.equal(d.querySelector('[data-tree-folder="src/group1"]').getAttribute('aria-expanded'),'false')
})

test('divider drag survives background render, persists width, clamps and restores after sidebar toggle',async t=>{
 const {dom,d}=await setup(t);click(d,'.nav-enter[data-mr-open="1"]');await flush();const w=dom.window
 const pointer=(target,type,x,id=1)=>{const e=new w.MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,button:0});Object.defineProperty(e,'pointerId',{value:id});target.dispatchEvent(e)}
 const width=()=>Number(d.querySelector('.mr-tree-splitter').getAttribute('aria-valuenow'))
 pointer(d.querySelector('.mr-tree-splitter'),'pointerdown',320);pointer(w,'pointermove',430);assert.equal(width(),430)
 await w.eval('loadGroupMr()');pointer(w,'pointermove',470);assert.equal(width(),470);pointer(w,'pointerup',470)
 assert.equal(w.localStorage.getItem('ops-studio-mr-tree-width'),'470');assert.equal(d.body.classList.contains('mr-tree-dragging'),false)
 d.querySelector('.mr-file-scroll').scrollTop=190;click(d,'.mr-tree-title [data-tree-hide]');assert.equal(d.querySelector('.mr-code-browser').style.getPropertyValue('--mr-tree-width'),'42px')
 click(d,'.mr-tree-reopen');assert.equal(width(),470);assert.equal(d.querySelector('.mr-file-scroll').scrollTop,190)
 d.querySelector('.mr-tree-splitter').dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',shiftKey:true,bubbles:true}));assert.equal(width(),510)
 pointer(d.querySelector('.mr-tree-splitter'),'pointerdown',510);pointer(w,'pointermove',2000);assert.equal(width(),560);pointer(w,'pointercancel',2000)
 d.querySelector('.mr-tree-splitter').dispatchEvent(new w.MouseEvent('dblclick',{bubbles:true}));assert.equal(width(),320)
 pointer(d.querySelector('.mr-tree-splitter'),'pointerdown',320);pointer(w,'pointermove',0);assert.equal(width(),220);w.dispatchEvent(new w.Event('blur'));assert.equal(d.body.classList.contains('mr-tree-dragging'),false)
 click(d,'[data-tree-reset]');assert.equal(width(),320)
 const browser=d.querySelector('.mr-code-browser');browser.getBoundingClientRect=()=>({width:600});w.dispatchEvent(new w.Event('resize'));assert.equal(width(),300);assert.equal(w.localStorage.getItem('ops-studio-mr-tree-width'),'320')
 browser.getBoundingClientRect=()=>({width:1000});w.dispatchEvent(new w.Event('resize'));assert.equal(width(),320)
})

test('tree keyboard navigation expands folders and storage denial does not break resizing',async t=>{
 const {dom,d}=await setup(t,{fileCount:16});click(d,'.nav-enter[data-mr-open="1"]');await flush();const w=dom.window
 const key=(selector,key)=>d.querySelector(selector).dispatchEvent(new w.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}))
 d.querySelector('[data-tree-folder="src/group0"]').focus();key('[data-tree-folder="src/group0"]','ArrowRight');assert.ok(d.querySelector('[data-mrw-file="2"]'))
 key('[data-tree-folder="src/group0"]','ArrowRight');assert.equal(d.activeElement.dataset.mrwFile,'2');key('[data-mrw-file="2"]','ArrowLeft');assert.equal(d.activeElement.dataset.treeFolder,'src/group0')
 key('[data-tree-folder="src/group0"]','ArrowLeft');assert.equal(d.querySelector('[data-mrw-file="2"]'),null)
 Object.defineProperty(w,'localStorage',{get(){throw new Error('storage unavailable')}})
 key('.mr-tree-splitter','ArrowRight');assert.equal(d.querySelector('.mr-tree-splitter').getAttribute('aria-valuenow'),'336')
})

test('directory shortcut filters closed and ordinary discussions while including MR-wide opinions',async t=>{
 const extraThreads=[{id:'chat',path:'src/large.bin',body:'普通讨论',resolvable:false,resolved:false},{id:'done',path:'src/a.ts',body:'已修复',resolvable:true,resolved:true},{id:'general',body:'整体待办',resolvable:true,resolved:false}]
 const {dom,d}=await setup(t,{extraThreads});click(d,'.nav-enter[data-mr-open="1"]');await flush()
 assert.match(d.querySelector('[data-mrw-open-notes]').textContent,/未关闭 2/)
 assert.equal(d.querySelector('[data-mrw-file="1"] .mr-tree-discussion'),null)
 assert.equal(d.querySelector('[data-tree-folder="src"] .mr-tree-discussion').textContent,'1')
 assert.ok(d.querySelector('[data-tree-folder="src"]').classList.contains('has-open-notes'))
 assert.ok(d.querySelector('[data-mrw-file="0"]').classList.contains('has-open-notes'))
 assert.ok(d.querySelector('[data-mrw-file="0"] .mr-tree-discussion svg'))
 assert.equal(d.querySelector('[data-mrw-file="1"]').classList.contains('has-open-notes'),false)
 click(d,'[data-mrw-notes-toggle]');click(d,'[data-mrw-open-notes]')
 assert.equal(d.querySelector('[data-mrw-closed]').checked,false)
 assert.deepEqual([...d.querySelectorAll('[data-mrw-note-card]')].map(el=>el.dataset.mrwNoteCard),['thread','general'])
 assert.ok(d.querySelector('[data-mrw-note-card="thread"] p'));click(d,'[data-mrw-note-code="thread"]')
 assert.ok(d.querySelector('[data-mrw-line-row="2"]').classList.contains('highlight'))
})

test('confirmed closure removes badges even if the subsequent workspace refresh fails',async t=>{
 for(const failReloadAfterClose of [false,true]){
  const {dom,d,writes}=await setup(t,{failReloadAfterClose});click(d,'.nav-enter[data-mr-open="1"]');await flush()
  click(d,'[data-mrw-resolve="thread"]');input(dom,'[data-mrw-draft="thread"]','核对当前代码后关闭')
  d.querySelector('[data-mrw-form]').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await flush();await flush()
  assert.equal(writes.length,1);assert.equal(d.querySelectorAll('.mr-tree-discussion').length,0);assert.equal(d.querySelectorAll('.has-open-notes').length,0)
  assert.match(d.querySelector('[data-mrw-open-notes]').textContent,/未关闭 0/)
  if(failReloadAfterClose)assert.match(d.querySelector('[data-mrw-open-notes]').textContent,/待刷新/)
  click(d,'[data-mrw-open-notes]');assert.equal(d.querySelectorAll('[data-mrw-note-card]').length,0)
  assert.match(d.querySelector('.mr-review-notes').textContent,/当前没有未关闭的检视意见/)
 }
})

test('unconfirmed closure keeps unresolved badges and the draft',async t=>{
 const {dom,d}=await setup(t,{failWrite:true});click(d,'.nav-enter[data-mr-open="1"]');await flush()
 click(d,'[data-mrw-resolve="thread"]');input(dom,'[data-mrw-draft="thread"]','已核对')
 d.querySelector('[data-mrw-form]').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await flush();await flush()
 assert.equal(d.querySelector('[data-mrw-file="0"] .mr-tree-discussion').textContent,'1')
 assert.match(d.querySelector('[data-mrw-open-notes]').textContent,/未关闭 1/)
 assert.equal(d.querySelector('[data-mrw-draft="thread"]').value,'已核对')
})
