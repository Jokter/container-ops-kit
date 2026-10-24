import test from 'node:test';
import assert from 'node:assert/strict';
import {createStudio} from './helpers/studio-harness.mjs';

const base='/api/platform/applications';
const id='71111111-1111-4111-8111-111111111111';
const saved={id,revision:7,name:'日志 <img src=x>',description:'说明 <script>bad()</script>',url:'https://example.test/logs?q=%3Cscript%3E',category:'日志检索',openMode:'embedded',workspace:'container',environment:'集成环境',owner:'平台组'};
const fields=['name','url','description','category','openMode','workspace','environment','owner'];
const reply=(data,status=200)=>new Response(status===204?null:JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const deferred=()=>{let release;const promise=new Promise(resolve=>{release=resolve});return {promise,release}};

async function applicationScene({initial=[],route='applications'}={}){
  const rows=new Map(initial.map(item=>[item.id,structuredClone(item)])),calls=[],opened=[],policy={error:null,gate:null};
  const s=await createStudio({route,beforeParse(w){
    const fallback=w.fetch;w.open=(...args)=>{opened.push(args);return null};
    w.fetch=async(url,options={})=>{
      const path=new URL(String(url),'http://studio.test').pathname;
      if(path!==base&&!path.startsWith(base+'/'))return fallback(url,options);
      const method=options.method||'GET',body=options.body?JSON.parse(options.body):null;calls.push({path,method,body});
      if(path===base&&method==='GET')return reply([...rows.values()]);
      assert.ok(['POST','PUT','DELETE'].includes(method),'Unexpected application request method');
      assert.match(options.headers['Content-Type'],/application\/json/);
      const current=rows.get(path.slice(base.length+1));
      if(method==='POST'){assert.equal(path,base);assert.deepEqual(Object.keys(body).sort(),[...fields].sort())}
      else{assert.ok(current,'Edit/delete addresses a stored application');assert.equal(body.revision,current.revision);assert.deepEqual(Object.keys(body).sort(),(method==='DELETE'?['revision']:[...fields,'revision']).sort())}
      if(policy.gate)await policy.gate.promise;
      if(policy.error)return reply({message:policy.error.message},policy.error.status);
      if(method==='POST'){const item={...body,id,revision:0};rows.set(id,item);return reply(item,201)}
      if(method==='PUT'){const item={...body,id:current.id,revision:current.revision+1};rows.set(current.id,item);return reply(item)}
      rows.delete(current.id);return reply(null,204);
    };
  }});
  const choose=async(name,value)=>{
    const selector='#ac-form select[name="'+name+'"]',select=s.find(selector);assert.ok(select.hasAttribute('data-ux-select'));
    const index=[...select.options].findIndex(option=>option.value===value);assert.ok(index>=0);
    await s.click(selector);assert.ok(s.find('#ac-form .ux-select-menu'),'The dropdown remains inside its application dialog');
    await s.click('.ux-select-options [data-index="'+index+'"]');assert.equal(s.find(selector).value,value);
  };
  return {...s,rows,calls,opened,policy,choose,writes:method=>calls.filter(call=>call.method===method)};
}

test('production application create/edit uses original form and styled selects, retains all fields, and submits once while pending',async()=>{
  const s=await applicationScene();
  try{
    assert.ok(s.find('.pf-apps'));await s.click('.page-head [data-app-create]');assert.equal(s.d.activeElement,s.find('#ac-form [name=name]'));
    const draft={name:'新应用 <img src=x>',url:'https://example.test/new-app?a=1&b=2',description:'功能 <script>bad()</script>',category:'研发工具',openMode:'newtab',workspace:'container',environment:'测试集群',owner:'应用团队'};
    for(const name of ['name','url','description','environment','owner'])await s.input('#ac-form [name='+name+']',draft[name]);
    for(const name of ['category','openMode','workspace'])await s.choose(name,draft[name]);
    s.policy.gate=deferred();const submit=s.find('#ac-form button[type=submit]');submit.click();submit.click();await s.wait();
    assert.equal(s.writes('POST').length,1);assert.deepEqual(s.writes('POST')[0].body,draft);assert.equal(submit.disabled,true);
    assert.ok([...s.d.querySelectorAll('#ac-form input,#ac-form select,#ac-form textarea')].every(control=>control.disabled));
    s.policy.gate.release();await s.wait(80);assert.equal(s.d.querySelector('#ac-overlay'),null);assert.equal(s.find('.pf-app-identity h2').textContent,draft.name);
    assert.equal(s.d.querySelector('.ac-card img'),null);assert.equal(s.d.querySelector('.ac-card script'),null);assert.equal(s.find('.ac-url').textContent,draft.url);
    await s.click('[data-app-edit="'+id+'"]');assert.equal(s.find('#ac-form [name=description]').value,draft.description);assert.equal(s.find('#ac-form [name=workspace]').value,'container');
    await s.input('#ac-form [name=name]','更新后的应用');await s.input('#ac-form [name=url]','http://192.0.2.25:8080/console');await s.choose('category','监控诊断');await s.choose('openMode','embedded');
    s.policy.gate=deferred();const save=s.find('#ac-form button[type=submit]');save.click();save.click();await s.wait();assert.equal(s.writes('PUT').length,1);
    assert.deepEqual(s.writes('PUT')[0].body,{...draft,name:'更新后的应用',url:'http://192.0.2.25:8080/console',category:'监控诊断',openMode:'embedded',revision:0});
    s.policy.gate.release();await s.wait(80);assert.equal(s.rows.get(id).revision,1);assert.equal(s.find('.pf-app-identity h2').textContent,'更新后的应用');
    await s.click('[data-app-edit="'+id+'"]');await s.input('#ac-form [name=name]','取消的草稿');await s.click('#ac-form footer [data-app-close]');
    assert.equal(s.find('.pf-app-identity h2').textContent,'更新后的应用');assert.equal(s.writes('PUT').length,1);assert.deepEqual(s.errors,[]);
  }finally{s.close()}
});

test('production application failed edit/delete preserve drafts and confirmation; explicit confirmed deletion uses current revision once',async()=>{
  const s=await applicationScene({initial:[saved]});
  try{
    await s.click('[data-app-favorite="'+id+'"]');await s.click('[data-app-edit="'+id+'"]');await s.input('#ac-form [name=name]','保留的编辑草稿');
    s.policy.error={status:409,message:'应用已被其他人修改'};s.policy.gate=deferred();const save=s.find('#ac-form button[type=submit]');save.click();save.click();await s.wait();
    assert.equal(s.writes('PUT').length,1);s.policy.gate.release();await s.wait(80);
    assert.match(s.find('#ac-form-error').textContent,/应用已被其他人修改/);assert.equal(s.find('#ac-form [name=name]').value,'保留的编辑草稿');assert.equal(s.find('#ac-form button[type=submit]').disabled,false);
    await s.click('#ac-form select[name=category]');s.find('.ux-select-options').dispatchEvent(new s.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await s.wait(100);
    assert.ok(s.find('#ac-form'));assert.equal(s.writes('PUT').length,1,'Dismissing a select does not replay a failed edit or close its form');
    await s.click('#ac-form footer [data-app-close]');assert.equal(s.find('.pf-app-identity h2').textContent,saved.name);
    await s.click('[data-app-edit="'+id+'"]');await s.click('[data-app-delete]');assert.equal(s.writes('DELETE').length,0);assert.equal(s.find('#ac-delete-check').hidden,false);
    await s.click('[data-app-delete-cancel]');assert.equal(s.find('#ac-delete-check').hidden,true);assert.equal(s.writes('DELETE').length,0);
    s.policy.error={status:503,message:'删除结果未确认，请检查应用列表'};s.policy.gate=deferred();await s.click('[data-app-delete]');const remove=s.find('[data-app-delete-confirm]');remove.click();remove.click();await s.wait();
    assert.equal(s.writes('DELETE').length,1);assert.deepEqual(s.writes('DELETE')[0].body,{revision:7});s.policy.gate.release();await s.wait(100);
    assert.match(s.find('#ac-form-error').textContent,/删除结果未确认/);assert.ok(s.rows.has(id));assert.equal(s.writes('DELETE').length,1);
    await s.click('#ac-form footer [data-app-close]');await s.click('[data-app-edit="'+id+'"]');s.policy.error=null;s.policy.gate=deferred();await s.click('[data-app-delete]');
    const confirmed=s.find('[data-app-delete-confirm]');confirmed.click();confirmed.click();await s.wait();assert.equal(s.writes('DELETE').length,2,'Only the new explicit confirmation sends the second attempt');
    s.policy.gate.release();await s.wait(80);assert.equal(s.d.querySelector('#ac-overlay'),null);assert.equal(s.d.querySelector('.ac-card'),null);assert.equal(s.rows.has(id),false);
    assert.ok(!JSON.parse(s.w.localStorage.getItem('ops-application-favorites')).includes(id));assert.deepEqual(s.errors,[]);
  }finally{s.close()}
});

test('production application form rejects unsafe URLs and remote unsafe entries never open or execute markup',async()=>{
  const unsafe={...saved,url:'javascript:window.bad=true',openMode:'newtab'};
  const s=await applicationScene({initial:[unsafe]});
  try{
    await s.click('[data-pr-app="'+id+'"]');assert.equal(s.opened.length,0);assert.equal(s.d.querySelector('#ac-frame'),null);assert.equal(s.w.location.hash,'#/applications');assert.match(s.d.body.textContent,/应用地址格式无效/);
    await s.click('.page-head [data-app-create]');await s.input('#ac-form [name=name]','合法名称');
    for(const url of ['javascript:alert(1)','data:text/html,<script>bad()</script>','https://user:password@example.test/app']){
      await s.input('#ac-form [name=url]',url);await s.click('#ac-form button[type=submit]');assert.equal(s.writes('POST').length,0);assert.match(s.find('#ac-form-error').textContent,/HTTP \/ HTTPS/);
    }
    await s.input('#ac-form [name=url]','https://example.test/app');await s.input('#ac-form [name=name]','   ');await s.click('#ac-form button[type=submit]');assert.equal(s.writes('POST').length,0);
    await s.click('#ac-form footer [data-app-close]');await s.route('applications/app/'+id);assert.equal(s.d.querySelector('#ac-frame'),null);assert.match(s.find('.quality-workspace').textContent,/应用地址格式无效/);assert.equal(s.d.querySelector('.quality-workspace img'),null);assert.equal(s.d.querySelector('.quality-workspace script'),null);assert.equal(s.w.bad,undefined);
    await s.click('[data-app-back]');assert.equal(s.w.location.hash,'#/applications');assert.equal(s.writes('PUT').length,0);assert.deepEqual(s.errors,[]);
  }finally{s.close()}
});

test('production embedded applications keep iframe identity during presentation/background refresh and return to their originating workspace',async()=>{
  const s=await applicationScene({initial:[saved]});
  try{
    await s.click('[data-pr-app="'+id+'"]');assert.equal(s.w.location.hash,'#/applications/app/'+id);
    const frame=s.find('#ac-frame');assert.equal(frame.getAttribute('src'),saved.url);assert.equal(frame.title,saved.name);assert.equal(frame.getAttribute('referrerpolicy'),'no-referrer');
    assert.match(frame.getAttribute('sandbox'),/allow-scripts/);assert.doesNotMatch(frame.getAttribute('sandbox'),/allow-top-navigation/);assert.equal(s.d.querySelector('.quality-workspace img'),null);
    const external=s.find('.page-head a[target="_blank"]');assert.equal(external.href,saved.url);assert.match(external.rel,/noopener/);assert.match(external.rel,/noreferrer/);
    await s.click('[data-ux-density]');assert.equal(s.find('#ac-frame'),frame);
    // Simulate the existing background render path; opening, reload and return below use actual UI controls.
    s.w.render(false);await s.wait();assert.equal(s.find('#ac-frame'),frame,'A same-route render must not reload an embedded application');
    let reloads=0;const observer=new s.w.MutationObserver(records=>{reloads+=records.filter(record=>record.attributeName==='src').length});observer.observe(frame,{attributes:true});
    await s.click('[data-app-reload]');observer.disconnect();assert.equal(reloads,1);assert.equal(s.find('#ac-frame'),frame);assert.equal(frame.getAttribute('src'),saved.url);
    await s.click('[data-app-back]');assert.equal(s.w.location.hash,'#/applications');assert.equal(frame.isConnected,false);assert.ok(s.find('.pf-apps'));
    await s.click('[data-platform-domain="container"]');await s.click('[data-page="build"]');await s.click('.pr-related [data-pr-app="'+id+'"]');assert.equal(s.w.location.hash,'#/container/app/'+id);
    const related=s.find('#ac-frame');await s.click('[data-app-back]');assert.equal(s.w.location.hash,'#/container/build');assert.equal(related.isConnected,false);assert.ok(s.find('#single-build-form'));
    await s.route('applications/app/'+id);assert.ok(s.find('#ac-frame'));assert.equal(s.find('#ac-frame').getAttribute('src'),saved.url);assert.ok(s.calls.every(call=>call.method==='GET'));assert.deepEqual(s.errors,[]);
  }finally{s.close()}
});
