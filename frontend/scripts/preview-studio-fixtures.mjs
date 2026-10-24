// Test-only preview of the production build. Never imported by Vite or the backend.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,dirname,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {productionFixturePage} from '../tests/helpers/studio-harness.mjs';

const dist=resolve(dirname(fileURLToPath(import.meta.url)),'../dist');
const mime={'.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{
  try {
    const pathname=new URL(req.url,'http://127.0.0.1').pathname;
    if(pathname==='/'||pathname==='/index.html'){
      const html=await productionFixturePage();
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(html);return;
    }
    const file=resolve(dist,'.'+decodeURIComponent(pathname));
    if(!file.startsWith(dist+sep)||!mime[extname(file)]){res.writeHead(404);res.end();return;}
    const contents=await readFile(file);
    res.writeHead(200,{'Content-Type':mime[extname(file)],'Cache-Control':'no-store'});res.end(contents);
  } catch {res.writeHead(404);res.end();}
});
server.listen(5175,'127.0.0.1',()=>console.log('Production build with isolated test fixtures: http://127.0.0.1:5175/'));
