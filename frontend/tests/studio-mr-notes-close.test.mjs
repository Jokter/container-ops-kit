import test from 'node:test';
import assert from 'node:assert/strict';
import {createStudio} from './helpers/studio-harness.mjs';

test('unresolved opinions open closure before long replies and submit exactly once from the notes tab',async t=>{
  const s=await createStudio({route:'automation/group-mr',beforeParse(w){
    const fetch=w.fetch;w.fetch=async(url,options={})=>{
      const response=await fetch(url,options);
      if(String(url).endsWith('/workspace')&&options.method!=='POST'){
        const data=await response.json();data.threads[0].notes.push({id:'long-system',author:'CodeHub',system:true,body:'代码位置已变化\n'.repeat(300)});
        return new Response(JSON.stringify(data));
      }
      return response;
    };
  }});t.after(s.close);
  await s.click('.nav-enter[data-mr-open="1"]');await s.click('[data-mrw-open-notes]');
  await s.click('[data-mrw-resolve="thread-1"]');
  const form=s.find('[data-mrw-form="resolve"]'),discussion=form.closest('.mr-thread');
  assert.equal(discussion.firstElementChild,form,'closure editor must precede long discussion history');
  assert.equal(s.d.activeElement,s.find('[data-mrw-draft="thread-1"]'),'requested editor is focused');
  assert.equal(s.requests.filter(r=>r.method==='POST'&&r.path.endsWith('/workspace')).length,0);
  await s.input('[data-mrw-draft="thread-1"]','已核对当前版本的修复');
  s.find('[data-mrw-form="resolve"] button[type="submit"]').click();await s.wait(120);
  const writes=s.requests.filter(r=>r.method==='POST'&&r.path.endsWith('/workspace'));
  assert.equal(writes.length,1);assert.equal(writes[0].body.action,'resolve');assert.equal(writes[0].body.discussionId,'thread-1');
  assert.equal(s.d.querySelector('[data-mrw-note-card="thread-1"]'),null,'closed opinion leaves unresolved filter');
  assert.deepEqual(s.errors,[]);
});

test('revealing a notes editor scrolls only its container and only when outside the viewport',async t=>{
  let page=280;
  const s=await createStudio({route:'automation/group-mr',beforeParse(w){
    Object.defineProperty(w,'scrollY',{get:()=>page});w.scrollTo=(x,y)=>{page=y;};
    const rect=w.HTMLElement.prototype.getBoundingClientRect;
    w.HTMLElement.prototype.getBoundingClientRect=function(){
      if(this.matches('.mr-review-notes'))return {top:100,bottom:400,height:300};
      if(this.matches('[data-mrw-form]'))return {top:330,bottom:510,height:180};
      return rect.call(this);
    };
  }});t.after(s.close);
  await s.click('.nav-enter[data-mr-open="1"]');await s.click('[data-mrw-open-notes]');
  page=280;s.find('.mr-review-notes').scrollTop=600;
  await s.click('[data-mrw-resolve="thread-1"]');
  assert.equal(s.find('.mr-review-notes').scrollTop,722);assert.equal(page,280);assert.deepEqual(s.errors,[]);
});
