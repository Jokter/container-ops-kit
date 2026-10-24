import test from 'node:test';
import assert from 'node:assert/strict';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';
import {JSDOM,VirtualConsole} from 'jsdom';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
// Exercise the release config and its transformIndexHtml hook, not the test harness's library build.
const result=await build({configFile:resolve(root,'frontend/vite.config.ts'),logLevel:'silent',build:{write:false,emptyOutDir:false}});
const output=(Array.isArray(result)?result:[result]).flatMap(item=>item.output);
const assets=new Map(output.map(item=>[item.fileName,item]));
const text=item=>item.type==='chunk'?item.code:typeof item.source==='string'?item.source:Buffer.from(item.source).toString('utf8');
const html=text(assets.get('index.html'));
const css=output.filter(item=>item.type==='asset'&&item.fileName.endsWith('.css')).map(text).join('\n');
const complete=output.map(text).join('\n');
const modules=output.filter(item=>item.type==='chunk').flatMap(item=>Object.keys(item.modules).map(path=>path.replaceAll('\\','/')));

test('Vite release HTML resolves its production runtime and includes every accepted workspace stylesheet',()=>{
  const dom=new JSDOM(html),d=dom.window.document;
  try{
    const scripts=[...d.querySelectorAll('script[type="module"][src]')];assert.equal(scripts.length,1,'Release HTML has one unified module entry');
    for(const reference of [...scripts.map(node=>node.getAttribute('src')),...d.querySelectorAll('link[rel="stylesheet"][href]')].map(node=>typeof node==='string'?node:node.getAttribute('href'))){
      assert.ok(assets.has(reference.replace(/^\//,'')),'Build emits referenced asset '+reference);
    }
    for(const file of ['studio-runtime.js','prototype-runtime.js','container-resource-runtime.js','studio/workspace-experience.js','studio/workspace-controls.js','studio/container-experience.js','studio/developer-tools.js','studio/portal-refinements.js','studio/automation-refinements.js']){
      assert.ok(modules.some(path=>path.endsWith('/frontend/src/'+file)),'Release imports '+file);
    }
    for(const selector of ['.ux-shell','.dt-json-workbench','.dt-command-picker','.dt-tag-picker','.pf-apps','.cx-code-surface','.ax-action-menu','.ux-select-menu','.ux-nav-scrim']){
      assert.ok(css.includes(selector),'Release CSS contains '+selector);
    }
    assert.ok(complete.includes('/api/platform/applications'));assert.ok(complete.includes('/api/tools/binlog/parse'));assert.ok(complete.includes('/api/deployment-tasks'));assert.ok(complete.includes('/api/container-resource-changes/apply'));
  }finally{dom.window.close()}
});

test('Vite release excludes fixture modules, mock data hooks, test network interception and prototype CSP',()=>{
  assert.ok(modules.every(path=>!path.includes('/frontend/tests/')&&!path.includes('/frontend/prototypes/')),'Test and prototype files are outside the release module graph');
  for(const marker of ['__fixtureRequests','__fixtureBinlog','__fixtureYaml','__fixturePackage','__fixtureXlsx','__mockRequests','current-project-mock','ops-studio-prototype.html','prototype-mode-note','mock-build.tar.gz','独立原型禁止外部网络请求','原型禁用真实 WebSocket','模拟外部链接：本原型不打开真实系统']){
    assert.equal(complete.includes(marker),false,'Release must not contain '+marker);
  }
  assert.doesNotMatch(complete,/(?:window|globalThis)\.(?:fetch|EventSource|WebSocket|open)\s*=/);
  assert.doesNotMatch(complete,/navigator\.sendBeacon\s*=/);
  const dom=new JSDOM(html);
  try{
    const policies=[...dom.window.document.querySelectorAll('meta[http-equiv]')].filter(node=>node.getAttribute('http-equiv').toLowerCase()==='content-security-policy');
    assert.ok(policies.every(node=>!/(?:connect-src|frame-src|form-action)\s+'none'/.test(node.getAttribute('content'))),'Fixture CSP does not block real API calls, embedded applications or forms');
  }finally{dom.window.close()}
});

test('compiled release boots the redesigned tools without replacing real browser transport functions',async()=>{
  const assetDom=new JSDOM(html),moduleNode=assetDom.window.document.querySelector('script[type="module"][src]');
  const entry=assets.get(moduleNode.getAttribute('src').replace(/^\//,''));
  assert.equal(entry.type,'chunk');assert.deepEqual(entry.imports,[],'Startup smoke test expects the current single release entry chunk');
  moduleNode.remove();
  // JSDOM does not execute module tags. Run the already-built entry at its deferred position,
  // retaining module-local scope; the other inline production scripts are unchanged.
  const compiled=entry.code.replaceAll('</script','<\\/script');
  const executable=assetDom.serialize().replace('</body>',()=>'<script>(()=>{'+compiled+'})();</script></body>');assetDom.window.close();
  const errors=[],requests=[],vc=new VirtualConsole();vc.on('jsdomError',error=>{if(!error.message.includes('Not implemented'))errors.push(error.message)});
  const fetch=async(url,options={})=>{requests.push({url,method:options.method||'GET'});return {ok:true,status:200,json:async()=>[]}};
  const EventSource=class{close(){}};const WebSocket=class{};const open=()=>null;
  const dom=new JSDOM(executable,{url:'http://release.test/#/tools/json',runScripts:'dangerously',virtualConsole:vc,beforeParse(w){
    w.Response=Response;w.Headers=Headers;w.Request=Request;w.scrollTo=()=>{};w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
    w.HTMLElement.prototype.scrollIntoView=function(){};w.fetch=fetch;w.EventSource=EventSource;w.WebSocket=WebSocket;w.open=open;
  }});
  try{
    await new Promise(resolve=>setTimeout(resolve,150));const w=dom.window,d=w.document;
    assert.deepEqual(errors,[],'Built entry starts without errors');
    assert.ok(d.querySelector('.dt-json-workbench'));assert.ok(d.querySelector('.dt-outline-tree'));assert.equal(d.querySelector('#prototype-mode-note'),null);
    assert.equal(w.fetch,fetch);assert.equal(w.EventSource,EventSource);assert.equal(w.WebSocket,WebSocket);assert.equal(w.open,open);
    assert.ok(requests.some(item=>item.url==='/api/platform/applications'));assert.ok(requests.every(item=>item.method==='GET'),'Initial navigation never submits a write');
    assert.deepEqual(errors,[]);
  }finally{dom.window.close()}
});
