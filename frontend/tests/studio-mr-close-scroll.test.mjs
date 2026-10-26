import test from 'node:test';
import assert from 'node:assert/strict';
import {createStudio} from './helpers/studio-harness.mjs';

async function historicalWorkspace(t){
  const s=await createStudio({route:'automation/group-mr',beforeParse(w){
    const fetch=w.fetch;
    w.fetch=async(url,options={})=>{
      const response=await fetch(url,options);
      if(!String(url).endsWith('/workspace')||options.method==='POST')return response;
      const data=await response.json(),thread=data.threads?.[0];
      if(thread){
        thread.outdated=true;thread.headSha='b'.repeat(40);
        thread.notes=[...thread.notes,{id:'changed-lines',author:'CodeHub',system:true,body:'changed this line\n'+Array.from({length:30},(_,i)=>'旧版本代码第 '+(i+1)+' 行').join('\n')}];
        data.threads.push({...thread,id:'other-history',path:'tests/connection.test.ts',line:3,body:'另一个文件的历史意见'});
      }
      return new Response(JSON.stringify(data));
    };
  }});
  t.after(s.close);
  await s.click('.nav-enter[data-mr-open="1"]');
  return s;
}

test('historical opinion scroll survives opening closure, submitting and remote refresh',async t=>{
  const s=await historicalWorkspace(t),panel=()=>s.find('.mr-history-notes');
  panel().scrollTop=170;
  await s.click('[data-mrw-resolve="thread-1"]');
  assert.ok(s.d.querySelector('.mr-history-notes [data-mrw-form="resolve"]'));
  assert.equal(panel().scrollTop,170,'opening the closure editor must retain the historical thread position');
  await s.input('[data-mrw-draft="thread-1"]','已对照当前代码确认修复');
  panel().scrollTop=240;
  s.find('[data-mrw-form="resolve"]').dispatchEvent(new s.w.Event('submit',{bubbles:true,cancelable:true}));
  await s.wait(100);
  assert.equal(panel().scrollTop,240,'the close acknowledgement and subsequent reload must retain history scrolling');
  assert.ok(s.d.querySelector('.mr-history-notes .mr-inline-note.resolved'));
  const writes=s.requests.filter(r=>r.method==='POST'&&r.path.endsWith('/workspace'));
  assert.equal(writes.length,1);assert.equal(writes[0].body.action,'resolve');
  await s.click('[data-mrw-load]');await s.wait(80);
  assert.equal(panel().scrollTop,240,'manual reload must retain history scrolling');
  assert.deepEqual(s.errors,[]);
});

test('historical opinion scroll is retained independently for each compared file',async t=>{
  const s=await historicalWorkspace(t),panel=()=>s.find('.mr-history-notes');
  panel().scrollTop=170;
  await s.click('[data-mrw-file="1"]');
  assert.equal(panel().scrollTop,0,'another file must not inherit the previous history offset');
  panel().scrollTop=310;
  await s.click('[data-mrw-file="0"]');assert.equal(panel().scrollTop,170);
  await s.click('[data-mrw-file="1"]');assert.equal(panel().scrollTop,310);
  assert.equal(s.requests.filter(r=>r.method==='POST').length,0);assert.deepEqual(s.errors,[]);
});
