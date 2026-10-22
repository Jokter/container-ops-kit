import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {JSDOM} from 'jsdom'
const html=await readFile(new URL('../../index.html',import.meta.url),'utf8'),sha='a'.repeat(40),flush=()=>new Promise(r=>setTimeout(r,40))
const row=id=>({id:String(id),repo:'MAE-M/Access/Repo'+id,iid:String(id),sha,phase:'ISSUES',status:'待修改',sender:'developer',events:[],reviewComments:[],writePending:'',updatedAt:'2026-10-22T10:00:00Z'})
async function setup(t,{unsupported=false,failWrite=false,fileCount=0,extraThreads=[]}={}){
 const records=Array.from({length:36},(_,i)=>row(i+1)),writes=[];let closed=false,replies=[]
 const snapshot=()=>({sha,state:'opened',files:[{path:'src/a.ts',oldPath:'src/a.ts',status:'modified',diff:'@@ -1,3 +1,3 @@\n old\n-deleted\n+<script>alert(1)</script>\n tail',unavailable:false},{path:'src/large.bin',status:'added',diff:'',unavailable:true},...Array.from({length:fileCount},(_,i)=>({path:'src/group'+Math.floor(i/16)+'/file'+i+'.ts',oldPath:'src/group'+Math.floor(i/16)+'/file'+i+'.ts',diff:'@@ -1 +1 @@\n-old\n+new',status:'modified'}))],threads:[{id:'thread',body:'修复边界问题',author:'reviewer',resolved:closed,resolvable:true,path:'src/a.ts',line:2,headSha:sha,fingerprint:'f'.repeat(64),notes:[{id:'1',body:'修复边界问题',author:'reviewer'},...replies]},...extraThreads],capabilities:{reply:!unsupported,create:!unsupported,reason:unsupported?'CLI 不支持':''},writePending:'',readAt:'2026-10-22T10:00:00Z'})
 const response=(data,ok=true)=>({ok,status:ok?200:409,json:async()=>data})
 const dom=new JSDOM(html,{runScripts:'dangerously',url:'http://localhost/#/automation/group-mr',beforeParse(w){w.scrollTo=()=>{};const timeout=w.setTimeout.bind(w);w.setTimeout=(fn,delay,...args)=>delay>500?0:timeout(fn,delay,...args);w.fetch=async(url,options)=>{
  if(url.endsWith('/workspace')){if(options?.method==='POST'){const data=JSON.parse(options.body);writes.push(data);if(failWrite)return response({message:'写入结果待核对'},false);if(data.action==='resolve')closed=true;else replies.push({id:'2',body:data.body,author:'owner'});return response({ok:true})}return response(snapshot())}
  if(url==='/api/automation/group-mr')return response({config:{enabled:false},pending:records,history:[],monitor:{},metrics:{pending:records.length}})
  if(url==='/api/automation/knowledge')return response({items:[],reviews:[]})
  if(url.startsWith('/api/automation/effectiveness'))return response({total:0,stages:{},reviews:0,merged:0,anomalies:0,rejected:0})
  return response([])
 }}})
 t.after(()=>dom.window.close());await flush();return {dom,d:dom.window.document,records,writes}
}
const click=(d,selector)=>{assert.ok(d.querySelector(selector),selector);d.querySelector(selector).click()}
const input=(dom,selector,value)=>{const el=dom.window.document.querySelector(selector);el.value=value;el.dispatchEvent(new dom.window.Event('input',{bubbles:true}))}
test('pagination limits select-all to page, crosses page in continuous review, restores selection and page',async t=>{
 const {dom,d}=await setup(t);assert.equal(d.querySelectorAll('[data-group-mr-record]').length,10);click(d,'[data-group-mr-check-all]');assert.equal(dom.window.eval('groupMrUi.checked.length'),10)
 click(d,'[data-mrw-page="1"]');assert.equal(dom.window.eval('groupMrUi.checked.length'),0);assert.equal(d.querySelector('[data-mr-detail-id]').dataset.mrDetailId,'11')
 click(d,'[data-group-mr-record="20"] td:nth-child(3)');click(d,'[data-mrw-focus]');click(d,'[data-mrw-next="1"]');assert.equal(d.querySelector('[data-mr-detail-id]').dataset.mrDetailId,'21');assert.ok(d.querySelector('.mr-focus-mode'))
 click(d,'[data-mrw-focus]');assert.equal(d.querySelector('[data-mr-detail-id]').dataset.mrDetailId,'20');assert.match(d.querySelector('.mr-pagination').textContent,/2 \/ 4/)
 input(dom,'#group-mr-search','Repo36');assert.equal(d.querySelectorAll('[data-group-mr-record]').length,1);assert.match(d.querySelector('.mr-pagination').textContent,/1 \/ 1/)
})
test('incoming MR does not reorder the list until explicit refresh; backend retry replaces existing row in place',async t=>{
 const {dom,d,records}=await setup(t);records.unshift(row(100));await dom.window.eval('loadGroupMr()');assert.equal(d.querySelector('[data-group-mr-record]').dataset.groupMrRecord,'1');assert.match(d.querySelector('.mr-new-banner').textContent,/1 条新 MR/)
 click(d,'[data-mrw-refresh]');await flush();assert.equal(d.querySelector('[data-group-mr-record]').dataset.groupMrRecord,'100')
})
test('diff is escaped, files switch, reply draft survives polling and MR switches, closure posts fingerprint',async t=>{
 const {dom,d,writes}=await setup(t);click(d,'[data-mrw-code]');await flush();assert.ok(d.querySelector('.mr-code-browser'));assert.equal(d.querySelector('.mr-diff-pane script'),null);assert.match(d.querySelector('.mr-diff-pane').textContent,/<script>/)
 click(d,'[data-mrw-file="1"]');assert.match(d.querySelector('.mr-diff-pane').textContent,/二进制/);click(d,'[data-mrw-file="0"]')
 click(d,'[data-mrw-thread="thread"]');input(dom,'[data-mrw-draft="thread"]','已修复，请确认');await dom.window.eval('loadGroupMr()');assert.equal(d.querySelector('[data-mrw-draft]').value,'已修复，请确认')
 click(d,'[data-mrw-next="1"]');assert.ok(d.querySelector('[data-mrw-stay]'));click(d,'[data-mrw-keep]');assert.equal(d.querySelector('[data-mr-detail-id]').dataset.mrDetailId,'2')
 click(d,'[data-mrw-next="-1"]');assert.equal(d.querySelector('[data-mrw-draft]').value,'已修复，请确认');d.querySelector('[data-mrw-form]').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await flush();await flush();assert.equal(writes.length,1);assert.equal(writes[0].action,'reply');assert.equal(writes[0].sha,sha)
 click(d,'[data-mrw-resolve="thread"]');input(dom,'[data-mrw-draft="thread"]','核对当前差异后确认修复');d.querySelector('[data-mrw-form]').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await flush();await flush();assert.equal(writes[1].action,'resolve');assert.equal(writes[1].fingerprint,'f'.repeat(64));assert.equal(writes[1].confirmed,true);assert.ok(d.querySelector('.group-mr-note.resolved'))
})
test('unsupported CLI disables new comments and reply, failed writes keep drafts, discard switch clears editor',async t=>{
 const unsupported=await setup(t,{unsupported:true});click(unsupported.d,'[data-mrw-code]');await flush();assert.equal(unsupported.d.querySelector('[data-mrw-line]'),null);click(unsupported.d,'[data-mrw-thread="thread"]');assert.equal(unsupported.d.querySelector('[data-mrw-form="reply"]'),null)
 const {dom,d,writes}=await setup(t,{failWrite:true});click(d,'[data-mrw-code]');await flush();click(d,'[data-mrw-line="2"]');input(dom,'[data-mrw-draft="new"]','检查新增行');d.querySelector('[data-mrw-form]').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await flush();await flush();assert.equal(writes.length,1);assert.equal(d.querySelector('[data-mrw-draft="new"]').value,'检查新增行')
 click(d,'[data-mrw-next="1"]');click(d,'[data-mrw-discard]');click(d,'[data-mrw-next="-1"]');assert.equal(d.querySelector('[data-mrw-form]'),null)
})

test('diff rows keep table layout with all styles loaded, and live removal does not switch focused MR',async t=>{
 const {dom,d,records}=await setup(t)
 for(const path of ['quality-workspace.css','studio-workspace.css','home-workbench.css','platform-workspace.css','workspace-layout.css']){const style=d.createElement('style');style.textContent=await readFile(new URL('../src/'+path,import.meta.url),'utf8');d.head.append(style)}
 click(d,'[data-mrw-code]');await flush();const css=el=>dom.window.getComputedStyle(el)
 assert.equal(css(d.querySelector('.mr-diff-scroll tr')).display,'table-row');assert.equal(css(d.querySelector('.mr-diff-scroll tbody')).display,'table-row-group');assert.equal(css(d.querySelector('.mr-diff-scroll td:last-child')).whiteSpace,'pre');assert.equal(css(d.querySelector('.mr-code-browser')).display,'grid')
 records.splice(0,1);await dom.window.eval('loadGroupMr()');assert.equal(d.querySelector('[data-mr-detail-id]').dataset.mrDetailId,'1');assert.match(d.querySelector('.mr-current-bar').textContent,/已移出筛选结果/)
})


test('large file tree scrolls independently, search reveals collapsed folders and view survives rerender',async t=>{
 const {dom,d}=await setup(t,{fileCount:240});click(d,'[data-mrw-code]');await flush();assert.equal(d.querySelectorAll('[data-mrw-file]').length,242)
 d.querySelector('.mr-file-scroll').scrollTop=500;d.querySelector('.mr-diff-scroll').scrollTop=240;d.querySelector('.mr-diff-scroll').scrollLeft=80
 await dom.window.eval('loadGroupMr()');assert.equal(d.querySelector('.mr-file-scroll').scrollTop,500);assert.equal(d.querySelector('.mr-diff-scroll').scrollTop,240);assert.equal(d.querySelector('.mr-diff-scroll').scrollLeft,80)
 click(d,'[data-mrw-folders]');assert.equal(d.querySelectorAll('[data-mrw-file]').length,0);input(dom,'#mr-file-search','file239');assert.equal(d.querySelectorAll('[data-mrw-file]').length,1);click(d,'[data-mrw-file="241"]');assert.match(d.querySelector('.mr-diff-pane>header').textContent,/file239/)
 input(dom,'#mr-file-search','');assert.ok(d.querySelector('[data-mrw-file="241"]'));click(d,'[data-mrw-file-step="-1"]');assert.match(d.querySelector('.mr-code-footer').textContent,/241 \/ 242/)
 const style=d.createElement('style');style.textContent=await readFile(new URL('../src/studio-workspace.css',import.meta.url),'utf8');d.head.append(style);assert.equal(dom.window.getComputedStyle(d.querySelector('.mr-file-scroll')).overflowY,'scroll');assert.equal(dom.window.getComputedStyle(d.querySelector('.mr-diff-scroll')).minHeight,'0px');assert.equal(d.querySelector('[data-demo-viewed]'),null)
})

test('line comments collapse together, retain drafts and survive polling and file switches',async t=>{
 const {dom,d}=await setup(t);click(d,'[data-mrw-code]');await flush();assert.equal(d.querySelector('.mr-inline-row').previousElementSibling.dataset.mrwLineRow,'2')
 click(d,'[data-mrw-thread="thread"]');input(dom,'[data-mrw-draft="thread"]','保留这份草稿');click(d,'.mr-inline-note [data-mrw-note-toggle]');assert.equal(d.querySelector('[data-mrw-draft="thread"]'),null);assert.equal(d.querySelector('.mr-inline-note p'),null);assert.equal(d.querySelector('[data-mrw-note-card] p'),null)
 assert.match(d.querySelector('[data-mrw-note-card]').textContent,/新代码第 2 行/);await dom.window.eval('loadGroupMr()');click(d,'[data-mrw-file="1"]');click(d,'[data-mrw-file="0"]');assert.equal(d.querySelector('.mr-inline-note p'),null)
 click(d,'[data-mrw-notes-toggle]');assert.equal(d.querySelector('[data-mrw-draft="thread"]').value,'保留这份草稿');assert.match(d.querySelector('.mr-inline-note p').textContent,/修复边界/)
 click(d,'[data-mrw-notes-toggle]');click(d,'[data-mrw-note-code="thread"]');assert.ok(d.querySelector('.mr-inline-note p'));assert.ok(d.querySelector('[data-mrw-line-row="2"]').classList.contains('highlight'))
})

test('old line locations map to deleted rows; historical, missing lines and MR-wide notes remain distinct',async t=>{
 const extraThreads=[{id:'old',path:'src/a.ts',oldPath:'src/a.ts',oldLine:2,line:null,headSha:sha,body:'旧代码问题',author:'reviewer',resolved:false},{id:'history',path:'src/a.ts',line:3,headSha:'b'.repeat(40),body:'历史意见',author:'reviewer',resolved:false},{id:'missing',path:'src/a.ts',line:999,headSha:sha,body:'范围外意见',resolved:false},{id:'general',body:'整体意见',resolved:false}]
 const {d}=await setup(t,{extraThreads});click(d,'[data-mrw-code]');await flush();assert.match(d.querySelector('[data-mrw-note-card="old"]').textContent,/旧代码第 2 行/);assert.match(d.querySelector('[data-mrw-note-card="general"]').textContent,/MR 整体意见/)
 click(d,'[data-mrw-note-code="old"]');assert.ok(d.querySelector('[data-mrw-old-row="2"]').classList.contains('del'));assert.ok(d.querySelector('[data-mrw-old-row="2"]').classList.contains('highlight'));assert.match(d.querySelector('[data-mrw-old-row="2"]').nextElementSibling.textContent,/旧代码问题/)
 click(d,'[data-mrw-note-code="history"]');assert.equal(d.querySelector('.mr-diff-scroll .highlight'),null);assert.match(d.querySelector('.mr-code-section [role="status"]').textContent,/历史提交/);assert.ok(!d.querySelector('.mr-diff-scroll').textContent.includes('历史意见'))
 click(d,'[data-mrw-note-code="missing"]');assert.match(d.querySelector('.mr-code-section [role="status"]').textContent,/未出现在当前 diff/)
})
