import {defineConfig} from 'vite'
import {resolve} from 'node:path'

export default defineConfig({
 root:resolve(__dirname,'..'),
 plugins:[{
  name:'resource-center-runtime',
  transformIndexHtml(html){
   return html.replace('</body>','<script src="/frontend/src/prototype-runtime.js"></script></body>')
  }
 }],
 server:{proxy:{'/api':'http://localhost:8080'}},
 build:{outDir:resolve(__dirname,'dist'),emptyOutDir:true}
})