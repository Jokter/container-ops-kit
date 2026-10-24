import {createServer} from '../frontend/node_modules/vite/dist/node/index.js';
const server = await createServer({configFile:new URL('../frontend/vite.config.ts',import.meta.url).pathname,server:{host:'127.0.0.1',port:5173,strictPort:true,proxy:{'/api':'http://127.0.0.1:8081'}}});
await server.listen();
server.printUrls();
