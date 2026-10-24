import test from 'node:test';
import assert from 'node:assert/strict';
import {createStudio} from './helpers/studio-harness.mjs';

const pause=()=>new Promise(resolve=>setTimeout(resolve,230));
const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>structuredClone(data)});
const command={code:'abcd',name:'业务命令 <img src=x>',fields:[],sample:'abcd0000',builtin:true,revision:'real-command-r3'};
const fields=[
  {tag:'',group:'报文头',path:'cmdCode',label:'命令码',value:'abcd',meaning:'',unit:'',description:'命令标识'},
  {tag:'0001',group:'业务字段',path:'state',label:'运行状态',value:1,meaning:'在线',unit:'',description:'<script>bad()</script>'}
];
const parseResult={revision:command.revision,summary:{total:2,success:1,errors:1,filtered:0},records:[
  {line:1,status:'success',result:{bytes:4,warnings:[],fields}},
  {line:2,status:'error',error:'报文截断 <img src=x>'}
]};
function controls(page){
  const {d,w}=page;
  const find=selector=>{const node=d.querySelector(selector);assert.ok(node,selector);return node};
  const click=async selector=>{find(selector).click();await pause()};
  const input=async(selector,value)=>{const node=find(selector);node.value=value;node.dispatchEvent(new w.Event('input',{bubbles:true}));await pause()};
  return {find,click,input};
}

test('studio JSON entry preserves source tokens, original format/search/export hooks and reversible edits',async()=>{
  const page=await createStudio({route:'tools/json'}),{d,w}=page,{find,click,input}=controls(page);
  try{
    await pause();assert.ok(find('.dt-json-workbench'));
    const precise='{"same":900719925474099312345,"same":"second","nested":[{"flag":true}],"markup":"<img onerror=bad()>"}';
    await input('#ct-json-input',precise);
    const duplicates=d.querySelectorAll('[aria-label="定位 same"]');assert.equal(duplicates.length,2);
    duplicates[0].click();let editor=find('#ct-json-input');assert.equal(editor.value.slice(editor.selectionStart,editor.selectionEnd),'900719925474099312345');
    duplicates[1].click();assert.equal(editor.value.slice(editor.selectionStart,editor.selectionEnd),'"second"');assert.equal(d.querySelector('.dt-outline-tree img'),null);
    editor.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true}));await pause();
    assert.match(find('#ct-json-input').value,/\n/);assert.match(find('#ct-json-input').value,/900719925474099312345/);
    await click('[data-dt-undo]');assert.equal(find('#ct-json-input').value,precise);
    await input('#ct-json-search','same');await click('[data-json-find="next"]');editor=find('#ct-json-input');assert.equal(editor.value.slice(editor.selectionStart,editor.selectionEnd),'same');
    await click('[data-json-action="escape"]');await click('[data-dt-undo]');assert.equal(find('#ct-json-input').value,precise);
    await input('#ct-json-input','{"broken":');await click('[data-json-action="validate"]');assert.equal(find('#ct-json-input').value,'{"broken":');assert.match(find('.dt-outline-tree').textContent,/暂时无法生成结构/);
    await input('#ct-json-input',JSON.stringify({large:'x'.repeat(200000)}));assert.match(find('.dt-outline-tree').textContent,/内容较长/);assert.ok(find('[data-json-action="copy"]'));assert.ok(find('[data-json-action="download"]'));
    assert.deepEqual(page.errors,[]);
  }finally{page.close()}
});

test('studio Binlog uses real command/parse contracts once and retains dropdown, Tag and message interactions',async()=>{
  const calls=[];
  const page=await createStudio({route:'tools/binlog',beforeParse(w){
    const fetch=w.fetch;
    w.fetch=async(url,options={})=>{
      if(url==='/api/tools/binlog/commands'){calls.push({url,...options});return response([command])}
      if(url==='/api/tools/binlog/parse'){calls.push({url,...options});return response(parseResult)}
      return fetch(url,options);
    };
  }}),{d,w}=page,{find,click,input}=controls(page);
  try{
    await pause();assert.equal(d.querySelectorAll('[data-bin-command]').length,1);assert.equal(d.querySelector('.ct-command img'),null);
    await click('.dt-command-picker>summary');await click('#ct-command-search');assert.equal(find('.dt-command-picker').open,true);
    await click('#ct-bin-input');assert.equal(find('.dt-command-picker').open,false);
    await click('[data-ux-focus]');await click('.dt-command-picker>summary');
    find('#ct-command-search').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(find('.dt-command-picker').open,false);assert.equal(d.activeElement,find('.dt-command-picker>summary'));assert.equal(d.body.classList.contains('ux-focus'),true);
    await click('[data-ux-focus]');await click('.dt-command-picker>summary');find('#ct-bin-input').focus();assert.equal(find('.dt-command-picker').open,false);
    await input('#ct-command-search','missing');assert.equal(find('.dt-command-empty').hidden,false);await input('#ct-command-search','abcd');assert.equal(find('.dt-command-empty').hidden,true);await input('#ct-command-search','');
    assert.equal(find('.dt-tag-picker summary small').textContent,'Tag');assert.equal(find('#ct-feature').getAttribute('aria-label'),'特性标识');
    await click('[data-bin-mode="batch"]');await click('[data-bin-sample]');assert.equal(find('#ct-bin-input').value,command.sample);
    await input('#ct-bin-input',command.sample+'\ninvalid');await input('#ct-feature','3');await click('[data-bin-parse]');
    const parsed=calls.filter(item=>item.url==='/api/tools/binlog/parse');assert.equal(parsed.length,1);assert.deepEqual(JSON.parse(parsed[0].body),{code:'abcd',text:command.sample+'\ninvalid',batch:true,feature:3});
    assert.equal(find('.dt-bin-workbench').dataset.pane,'result');assert.equal(find('[data-bin-excel]').disabled,false);assert.equal(find('[data-bin-json]').disabled,false);
    await click('.dt-tag-picker>summary');await click('[data-bin-tag="0001"]');assert.equal(find('.dt-tag-picker').open,false);assert.match(find('.dt-result-status').textContent,/1 \/ 2/);assert.equal(d.querySelector('#ct-bin-results script'),null);
    await click('[data-bin-message="1"]');assert.match(find('.dt-results-scroll').textContent,/报文截断/);assert.equal(d.querySelector('.dt-results-scroll img'),null);
    await click('[data-bin-message="0"]');assert.equal(find('[data-bin-tag="0001"]').getAttribute('aria-pressed'),'true');await input('#ct-bin-search','missing');assert.equal(find('#ct-bin-search-empty').hidden,false);
    await input('#ct-bin-search','');
    for(const selector of ['[data-bin-mode="single"]','[data-bin-sample]','[data-bin-clear]','[data-bin-command="abcd"]']){
      await click('[data-dt-input-toggle]');assert.equal(find('.dt-bin-workbench').classList.contains('dt-input-hidden'),true);
      await click(selector);assert.equal(find('.dt-bin-workbench').classList.contains('dt-input-hidden'),false);assert.equal(find('.dt-bin-workbench').dataset.pane,'input');
    }
    await click('[data-dt-input-toggle]');const file=find('#ct-bin-file');Object.defineProperty(file,'files',{value:[{name:'incoming.txt',size:8,text:async()=>command.sample}]});file.dispatchEvent(new w.Event('change',{bubbles:true}));await pause();
    assert.equal(find('#ct-bin-input').value,command.sample);assert.equal(find('.dt-bin-workbench').classList.contains('dt-input-hidden'),false);
    assert.equal(calls.filter(item=>item.url==='/api/tools/binlog/parse').length,1,'Presentation transitions never submit another parse');assert.deepEqual(page.errors,[]);
  }finally{page.close()}
});

test('studio command directory distinguishes empty API data from loading failure without fabricated commands or retry',async()=>{
  for(const failed of [false,true]){
    let reads=0;
    const page=await createStudio({route:'tools/binlog',beforeParse(w){const fetch=w.fetch;w.fetch=async(url,options)=>{if(url==='/api/tools/binlog/commands'){reads++;return failed?response({message:'命令目录暂不可用'},503):response([])}return fetch(url,options)}}}),{find}=controls(page);
    try{
      await pause();assert.equal(page.d.querySelectorAll('[data-bin-command]').length,0);assert.equal(find('[data-bin-parse]').disabled,true);
      if(failed){assert.match(find('.ct-directory .ct-error').textContent,/命令目录暂不可用/);assert.equal(find('.dt-command-empty').hidden,true)}
      else{assert.equal(find('.dt-command-empty').hidden,false);assert.match(find('.dt-command-empty').textContent,/尚未配置命令/)}
      assert.equal(reads,1);assert.deepEqual(page.errors,[]);
    }finally{page.close()}
  }
});

test('studio application layouts preserve arbitrary server metadata and original opening/favorite actions; filter empties recover',async()=>{
  const apps=[
    {id:'11111111-1111-4111-8111-111111111111',revision:4,name:'日志 <img src=x>',description:'详细说明 <script>bad()</script>',url:'https://example.test/logs?view=all',category:'日志检索',openMode:'newtab',workspace:'container',owner:'运维组',environment:'研发'},
    {id:'22222222-2222-4222-8222-222222222222',revision:2,name:'监控',description:'查看健康与资源',url:'https://example.test/metrics',category:'监控诊断',openMode:'embedded',workspace:'container',owner:'平台组',environment:'集成'}
  ];
  const opened=[],writes=[];
  const page=await createStudio({route:'applications',beforeParse(w){const fetch=w.fetch;w.open=(...args)=>opened.push(args);w.fetch=async(url,options={})=>{if(url==='/api/platform/applications'){if(options.method)writes.push(options);return response(apps)}return fetch(url,options)}}}),{d}=page,{find,click,input}=controls(page);
  try{
    await pause();assert.equal(d.querySelectorAll('.pf-app-identity h2').length,2);assert.equal(find('.pf-app-identity h2').textContent,apps[0].name);assert.equal(d.querySelector('.ac-card img'),null);assert.equal(d.querySelector('.ac-card script'),null);
    assert.ok(find('.ac-toolbar .pf-app-controls #ac-search'));assert.ok(find('.ac-toolbar .ux-app-view'));
    const initial=[...d.querySelectorAll('.ac-card')].map(card=>({name:card.querySelector('h2').textContent,url:card.querySelector('.ac-url').textContent,open:card.querySelector('[data-pr-app]').dataset.prApp,edit:card.querySelector('[data-app-edit]').dataset.appEdit}));
    await click('[data-ux-app-view="list"]');assert.equal(find('.ac-workspace').classList.contains('ux-app-list'),true);
    assert.deepEqual([...d.querySelectorAll('.ac-card')].map(card=>({name:card.querySelector('h2').textContent,url:card.querySelector('.ac-url').textContent,open:card.querySelector('[data-pr-app]').dataset.prApp,edit:card.querySelector('[data-app-edit]').dataset.appEdit})),initial);
    await click('[data-pr-app="'+apps[0].id+'"]');assert.deepEqual(opened,[[apps[0].url,'_blank','noopener,noreferrer']]);
    await click('[data-app-favorite="'+apps[0].id+'"]');await click('[data-app-filter="favorite"]');assert.equal(d.querySelectorAll('.ac-card').length,1);
    await input('#ac-search','没有此应用');assert.equal(find('.ac-grid').hidden,true);assert.ok(find('.page-head [data-app-create]'));await click('[data-pf-reset-apps]');assert.equal(d.querySelectorAll('.ac-card').length,2);
    await click('[data-app-category="监控诊断"]');await input('#ac-search','没有此应用');await click('[data-pf-reset-apps]');assert.equal(d.querySelectorAll('.ac-card').length,2);
    await input('#ac-search','日志');await click('[data-pf-clear="ac-search"]');assert.equal(d.querySelectorAll('.ac-card').length,2);assert.deepEqual(writes,[]);
    assert.deepEqual(page.errors,[]);
  }finally{page.close()}
});

test('studio home keeps card actions and presents a single consistent search result state',async()=>{
  const page=await createStudio({route:'home/tools'}),{d,w}=page,{find,click,input}=controls(page);
  try{
    await pause();assert.equal(d.querySelectorAll('.pr-space-card').length,5);assert.ok(find('.ux-home-dock'));
    await input('#pr-search','YAML');assert.equal(d.querySelectorAll('.ux-home-result-grid a').length,1);assert.equal(find('.pr-space-grid').hidden,true);assert.equal(find('.ux-home-results').hidden,false);
    await input('#pr-search','虚机');assert.equal(d.querySelectorAll('.pr-space-card').length,1);assert.equal(find('.pr-space-grid').hidden,false);assert.equal(find('.ux-home-results').hidden,true);
    await input('#pr-search','不存在的功能');assert.equal(find('.ux-home-results h2').textContent,'没有搜索结果');assert.equal(find('.pr-space-grid').hidden,true);
    find('#pr-search').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await pause();assert.equal(d.querySelectorAll('.pr-space-card').length,5);assert.equal(find('.ux-home-dock').hidden,false);
    await click('[data-workspace-card="tools"]');assert.equal(d.querySelectorAll('.dt-tool-preview').length,2);await click('[data-tool-favorite="json"]');assert.equal(find('[data-tool-favorite="json"]').getAttribute('aria-pressed'),'true');
    find('[data-tool-card="json"]').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await pause();assert.ok(find('.dt-json-workbench'));assert.equal(w.location.hash,'#/tools/json');assert.deepEqual(page.errors,[]);
  }finally{page.close()}
});
