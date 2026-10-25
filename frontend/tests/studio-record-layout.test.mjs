import test from 'node:test';
import assert from 'node:assert/strict';
import {createStudio} from './helpers/studio-harness.mjs';

const writes=s=>s.requests.filter(request=>!['GET','HEAD'].includes(request.method));

test('record filters and batch selection stay separate while direct deletion still requires confirmation',async t=>{
  const s=await createStudio({route:'automation/tasks'});t.after(s.close);
  const root=s.find('.studio-record-workspace'),bar=s.find('.record-selection-bar');
  assert.ok(root.contains(bar));
  assert.ok(bar.querySelector('[data-record-select-all]'));
  assert.ok(bar.querySelector('[data-cleanup-records]'));
  assert.equal(s.d.querySelectorAll('[data-record-select-all]').length,1);
  assert.equal(s.find('.studio-record-filters').querySelector('[data-record-select-all],[data-cleanup-records]'),null);
  assert.equal(s.find('thead .studio-record-check').textContent.trim(),'');
  await s.click('[data-record-select-all]');
  assert.ok([...s.d.querySelectorAll('[data-record-select]')].every(input=>input.checked));
  assert.equal(s.find('[data-cleanup-records]').disabled,false);
  await s.click('[data-record-select]');
  assert.equal(s.find('[data-record-select-all]').indeterminate,true);
  const remove=s.find('[data-delete-record]');
  assert.equal(remove.closest('.ux-row-more'),null);
  await s.click('[data-delete-record]');
  assert.ok(s.find('.studio-confirm-dialog'));
  assert.equal(writes(s).length,0);
  await s.click('[data-studio-cancel]');
  assert.equal(s.d.querySelector('.studio-confirm-dialog'),null);
  assert.equal(writes(s).length,0);
  assert.deepEqual(s.errors,[]);
});

test('record results expose a complete escaped disclosure and timestamps split date from clock',async t=>{
  const message='异常调用链需要核对。'.repeat(35)+'<img src=x onerror="window.recordInjected=true">';
  const s=await createStudio({route:'automation/tasks',beforeParse(w){
    const fetch=w.fetch;
    w.fetch=async(url,options)=>{
      const response=await fetch(url,options);
      if(String(url)!=='/api/auto-ut/tasks'||options?.method&&options.method!=='GET')return response;
      const data=await response.json();
      Object.assign(data[0],{status:'FAILED',message,updatedAt:'2026-10-25T04:05:06.000Z'});
      return new Response(JSON.stringify(data));
    };
  }});t.after(s.close);
  const row=s.find('[data-auto-ut-task="ut-1"]'),date=row.querySelector('.record-date'),clock=row.querySelector('.record-clock');
  assert.ok(date?.textContent.trim(),'Date is a separate readable item');
  assert.match(clock?.textContent||'',/\d{1,2}:\d{2}/);
  assert.doesNotMatch(date.textContent,/:/);
  const details=row.querySelector('.studio-result'),preview=details.querySelector('.record-result-preview');
  assert.ok(preview.textContent.startsWith('异常调用链需要核对'));
  assert.ok(details.querySelector('.record-result-toggle'),'Disclosure has a dedicated visual affordance');
  assert.equal(details.open,false);
  details.querySelector('summary').click();await s.wait();
  assert.equal(details.open,true);
  assert.equal(details.querySelector('pre').textContent,message);
  assert.equal(details.querySelector('img,script'),null);
  assert.equal(s.w.recordInjected,undefined);
  s.w.eval('render(false)');await s.wait();
  assert.equal(s.find('[data-auto-ut-task="ut-1"] .studio-result').open,true,'Refresh retains the expanded result');
  assert.equal(writes(s).length,0);
  assert.deepEqual(s.errors,[]);
});

test('nonselectable overview records do not acquire the records page toolbar or selection controls',async t=>{
  const s=await createStudio({route:'automation'});t.after(s.close);
  assert.ok(s.find('.ov-recent .studio-record-table'));
  assert.equal(s.d.querySelector('.studio-record-workspace'),null);
  assert.equal(s.d.querySelector('.record-selection-bar'),null);
  assert.equal(s.d.querySelector('[data-record-select-all],[data-record-select]'),null);
  assert.deepEqual(s.errors,[]);
});
