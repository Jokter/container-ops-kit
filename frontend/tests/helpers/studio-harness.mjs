import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { build } from 'vite';
import ExcelJS from 'exceljs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const bundles = new Map();
async function bundle(enhanced) {
  if (!bundles.has(enhanced)) bundles.set(enhanced, build({
    configFile: false, root, logLevel: 'silent',
    build: {write:false,minify:false,lib:{entry:enhanced ? resolve(root,'frontend/src/studio-runtime.js') : resolve(root,'frontend/tests/fixtures/baseline-runtime.js'),name:'Studio',formats:['iife']}}
  }).then(result => {
    const output = (Array.isArray(result) ? result[0] : result).output;
    return {js:output.find(file=>file.type==='chunk').code,css:output.filter(file=>file.type==='asset'&&file.fileName.endsWith('.css')).map(file=>file.source).join('\n')};
  }));
  return bundles.get(enhanced);
}

let fixture;
async function fixtureScript() {
  if (!fixture) fixture = (async () => {
    const parser = await build({configFile:false,root,logLevel:'silent',build:{write:false,minify:false,lib:{entry:resolve(root,'frontend/tests/fixtures/studio-parser.js'),name:'FixtureParser',formats:['iife']}}});
    const js = (Array.isArray(parser)?parser[0]:parser).output.find(file=>file.type==='chunk').code;
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('测试报文').addRows([['字段','值'],['cmdCode','0b18'],['status',1]]);
    const xlsx = Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64');
    const archive = await readFile(resolve(root,'frontend/tests/fixtures/mock-package.base64'),'utf8');
    return js + '\nwindow.__fixtureXlsx='+JSON.stringify(xlsx)+';window.__fixturePackage='+JSON.stringify(archive)+';\n'+await readFile(resolve(root,'frontend/tests/fixtures/studio-api.js'),'utf8');
  })();
  return fixture;
}

// Bundle the shipped modules and the real index, never the accepted prototype HTML.
export async function studioPage({enhanced=true,styles=false,mock=false}={}) {
  const runtime = await bundle(enhanced);
  let html = await readFile(resolve(root,'index.html'),'utf8');
  if (styles) {
    for (const match of [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)]) html=html.replace(match[0],'<style>'+await readFile(resolve(root,match[1].slice(1)),'utf8')+'</style>');
    html=html.replace('</head>',()=>'<style>'+runtime.css+'</style></head>');
  } else html=html.replace(/<style>[\s\S]*?<\/style>/g,'').replace(/<link rel="stylesheet"[^>]+>/g,'');
  if (mock) {
    const api=await fixtureScript();
    html=html.replace('<head>',"<head><meta http-equiv=\"Content-Security-Policy\" content=\"connect-src 'none'; frame-src 'none'; form-action 'none'\">").replace('<script>',()=>'<script>'+escapeScript(api)+'</script><script>');
  }
  return html.replace('</body>',()=>'<script>'+escapeScript(runtime.js)+'</script></body>');
}
function escapeScript(source) { return source.replaceAll('</script','<\\/script'); }
// Preview gets fixture initialization before the app, without adding a production mock mode.
export async function fixturePage() { return studioPage({styles:true,mock:true}); }

export async function productionFixturePage() {
  const html=await readFile(resolve(root,'frontend/dist/index.html'),'utf8');
  const api=await fixtureScript();
  return html.replace('<head>',()=>"<head><meta http-equiv=\"Content-Security-Policy\" content=\"connect-src 'none'; frame-src 'none'; form-action 'none'\"><script>"+escapeScript(api)+'</script>');
}

export async function createStudio({route='home/tools',beforeParse,enhanced=true,mock=true}={}) {
  const [html,api] = await Promise.all([studioPage({enhanced}),mock?fixtureScript():Promise.resolve('')]);
  const errors=[],virtualConsole=new VirtualConsole();
  virtualConsole.on('jsdomError',error=>{if(!error.message.includes('Not implemented'))errors.push(error.message)});
  const dom=new JSDOM(html,{url:'http://studio.test/#/'+route,runScripts:'dangerously',virtualConsole,beforeParse(w){
    w.Response=Response;w.Headers=Headers;w.Request=Request;w.TextEncoder=TextEncoder;w.TextDecoder=TextDecoder;w.scrollTo=()=>{};
    w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
    w.HTMLElement.prototype.scrollIntoView=function(){};
    w.HTMLElement.prototype.getBoundingClientRect=function(){return {left:100,right:380,top:100,bottom:136,width:280,height:36}};
    w.HTMLDialogElement.prototype.showModal=function(){this.open=true};
    w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'))};
    w.URL.createObjectURL=()=> 'blob:http://studio.test/fixture';w.URL.revokeObjectURL=()=>{};
    w.confirm=()=>true;w.alert=()=>{};w.fetch=()=>Promise.reject(new Error('Unexpected live request'));w.EventSource=class{close(){}};
    if(api)w.eval(api);
    beforeParse?.(w);
  }});
  const w=dom.window,d=w.document,wait=(ms=35)=>new Promise(resolve=>setTimeout(resolve,ms));
  const find=selector=>{const node=d.querySelector(selector);assert.ok(node,'Missing control: '+selector);return node};
  const click=async selector=>{find(selector).click();await wait()};
  const input=async(selector,value,event='input')=>{const node=find(selector);node.value=value;node.dispatchEvent(new w.Event(event,{bubbles:true}));await wait()};
  const navigate=async path=>{w.location.hash='#/'+path;await wait(80)};
  await wait(100);
  return {dom,w,d,errors,requests:w.__fixtureRequests||[],wait,click,input,route:navigate,find,close:()=>w.close()};
}
