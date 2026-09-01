import {defineConfig} from 'vite'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const frontendDirectory=resolve(fileURLToPath(import.meta.url),'..')

export default defineConfig({
 root:resolve(frontendDirectory,'..'),
 plugins:[{
  name:'resource-center-runtime',
  transformIndexHtml:{
   order:'pre',
   handler(html){
    return html.replace('</body>','<script type="module" src="/frontend/src/prototype-runtime.js"></script><script type="module" src="/frontend/src/container-resource-runtime.js"></script></body>')
   }
  }
 }],
 server:{proxy:{'/api':'http://localhost:8080'}},
 build:{outDir:resolve(frontendDirectory,'dist'),emptyOutDir:true}
})
