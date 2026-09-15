import {createApp} from './app.js';
import {readConfig} from './config.js';

const config = readConfig();
const app = await createApp(config);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => {process.exitCode = 0;}, () => {process.exitCode = 1;});
  });
}
try {await app.listen({host: '127.0.0.1', port: config.port});}
catch (error) {await app.close(); throw error;}
