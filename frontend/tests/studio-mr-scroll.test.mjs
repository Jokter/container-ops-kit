import test from 'node:test';
import assert from 'node:assert/strict';
import {createStudio} from './helpers/studio-harness.mjs';

// JSDOM has no layout. Model the browser clamping offsets while the replacement
// review DOM still has the compact, unenhanced layout instead of its final height.
function layoutScroll(w){
  let pageTop=0;
  Object.defineProperty(w,'scrollY',{configurable:true,get:()=>pageTop});
  w.scrollTo=(x,y)=>{pageTop=w.document.querySelector('.nav-review')&&!w.document.querySelector('.studio-shell.ux-shell')?0:Number(typeof x==='object'?x.top:y)||0;};
  for(const axis of ['scrollTop','scrollLeft']){
    const offsets=new WeakMap();
    Object.defineProperty(w.HTMLElement.prototype,axis,{configurable:true,get(){return offsets.get(this)||0;},set(value){
      const pending=this.matches('.mr-diff-scroll,.mr-file-scroll')&&!this.closest('.ux-shell');
      offsets.set(this,pending?0:Number(value)||0);
    }});
  }
}

function pollClock(w){
  const timers=new Map(),timeout=w.setTimeout.bind(w),clear=w.clearTimeout.bind(w);let sequence=100000;
  w.setTimeout=(fn,delay,...args)=>{if(delay===10000){const id=++sequence;timers.set(id,()=>fn(...args));return id;}return timeout(fn,delay,...args);};
  w.clearTimeout=id=>{if(!timers.delete(id))clear(id);};
  return ()=>{const id=w.eval('groupMrUi.poll'),run=timers.get(id);assert.ok(run,'MR refresh must be scheduled');timers.delete(id);run();};
}

function position(s,{page=310,code=740,left=140,tree=190}={}){
  s.w.scrollTo(0,page);s.find('.mr-diff-scroll').scrollTop=code;s.find('.mr-diff-scroll').scrollLeft=left;s.find('.mr-file-scroll').scrollTop=tree;
  return {page,code,left,tree};
}
function assertPosition(s,expected){
  assert.equal(s.w.scrollY,expected.page,'document position');
  assert.equal(s.find('.mr-diff-scroll').scrollTop,expected.code,'code vertical position');
  assert.equal(s.find('.mr-diff-scroll').scrollLeft,expected.left,'code horizontal position');
  assert.equal(s.find('.mr-file-scroll').scrollTop,expected.tree,'directory position');
}

test('MR background and manual refresh preserve page, code and directory offsets after the final layout',async t=>{
  let poll;
  const s=await createStudio({route:'automation/group-mr',beforeParse(w){layoutScroll(w);poll=pollClock(w);}});t.after(s.close);
  await s.click('.nav-enter[data-mr-open="1"]');
  const expected=position(s);
  for(let i=0;i<2;i++){poll();await s.wait(80);assertPosition(s,expected);}
  await s.click('[data-mrw-load]');await s.wait(80);assertPosition(s,expected);
  assert.equal(s.requests.filter(r=>r.method!=='GET').length,0);assert.deepEqual(s.errors,[]);
});

test('MR file changes retain each file position without moving the document',async t=>{
  const s=await createStudio({route:'automation/group-mr',beforeParse:layoutScroll});t.after(s.close);
  await s.click('.nav-enter[data-mr-open="1"]');
  const first=position(s);
  await s.click('[data-mrw-file="1"]');
  assert.equal(s.w.scrollY,first.page);assert.equal(s.find('.mr-diff-scroll').scrollTop,0);
  const second=position(s,{page:first.page,code:410,left:80,tree:first.tree});
  await s.click('[data-mrw-file="0"]');assertPosition(s,first);
  await s.click('[data-mrw-file="1"]');assertPosition(s,second);
  assert.deepEqual(s.errors,[]);
});

test('MR inline reply and resolution keep the current reading position through asynchronous refresh',async t=>{
  const s=await createStudio({route:'automation/group-mr',beforeParse:layoutScroll});t.after(s.close);
  await s.click('.nav-enter[data-mr-open="1"]');
  const expected=position(s);
  for(const [action,button,text] of [['reply','thread','已补充异常路径断言'],['resolve','resolve','已核对当前提交']]){
    await s.click('[data-mrw-'+button+'="thread-1"]');assertPosition(s,expected);
    await s.input('[data-mrw-draft="thread-1"]',text);
    s.find('[data-mrw-form]').dispatchEvent(new s.w.Event('submit',{bubbles:true,cancelable:true}));
    await s.wait(100);assertPosition(s,expected);
    assert.equal(s.requests.filter(r=>r.method==='POST'&&r.path.endsWith('/workspace')&&r.body.action===action).length,1);
  }
  assert.deepEqual(s.errors,[]);
});
