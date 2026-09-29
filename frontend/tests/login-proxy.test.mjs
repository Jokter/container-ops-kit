import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer as httpServer,request} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer,loadConfigFromFile} from 'vite';

test('login proxy preserves browser Host and Origin for localhost and LAN; does not rewrite foreign Origin',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ops-proxy-'));
 const backend=httpServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({host:req.headers.host,origin:req.headers.origin}));});
 await new Promise(resolve=>backend.listen(0,'127.0.0.1',resolve));
 let vite;
 try{
  const loaded=await loadConfigFromFile({command:'serve',mode:'test'},fileURLToPath(new URL('../vite.config.ts',import.meta.url)));
  const configured=loaded.config.server.proxy['/api'];
  const proxy=typeof configured==='string'?{target:configured,changeOrigin:true}:{...configured};
  proxy.target=`http://127.0.0.1:${backend.address().port}`;
  vite=await createServer({configFile:false,root,logLevel:'silent',server:{host:'127.0.0.1',port:0,proxy:{'/api':proxy}}});await vite.listen();
  const send=(host,origin)=>new Promise((resolve,reject)=>{const req=request({host:'127.0.0.1',port:vite.httpServer.address().port,path:'/api/auth/login',method:'POST',headers:{host,origin,'Content-Type':'application/json'}},res=>{let data='';res.on('data',part=>data+=part);res.on('end',()=>{try{resolve(JSON.parse(data));}catch(e){reject(e);}});});req.on('error',reject);req.end('{}');});
  for(const host of ['localhost:5173','127.0.0.1:5173','192.168.1.20:5173']){const headers=await send(host,`http://${host}`);assert.equal(headers.host,host);assert.equal(headers.origin,`http://${host}`);}
  const foreign=await send('localhost:5173','https://foreign.example');assert.equal(foreign.host,'localhost:5173');assert.equal(foreign.origin,'https://foreign.example');
 }finally{await vite?.close();await new Promise(resolve=>backend.close(resolve));await rm(root,{recursive:true,force:true});}
});
