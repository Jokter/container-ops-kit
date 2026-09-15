import Fastify from 'fastify';
import proxy from '@fastify/http-proxy';
import {z, ZodError} from 'zod';
import type {Config} from './config.js';
import {browse} from './modules/workspace/directories.js';
import {TaskStore} from './platform/store.js';
import {TaskRunner} from './platform/tasks.js';
import {taskRoutes} from './platform/routes.js';

export async function createApp(config: Config) {
  const app = Fastify({bodyLimit: 1024 * 1024, forceCloseConnections: true, logger: {
    level: 'info', redact: ['req.headers.authorization', 'req.headers.cookie'],
    // Queries may contain local paths. Bodies/passwords are never logged.
    serializers: {req: request => ({method: request.method, url: request.url.split('?')[0] ?? ''})},
  }});
  const store = new TaskStore(config.database);
  const runner = new TaskRunner(store, config.workers, config.taskTimeoutMs);
  app.addHook('onClose', async () => {await runner.close(); store.close();});
  app.addHook('onRequest', async (request, reply) => {
    // Local tools are not an authenticated multi-user service. Reject browser requests from remote origins.
    const local = (host: string) => ['localhost', '127.0.0.1', '[::1]'].includes(host);
    try {
      if (!local(new URL(`http://${request.headers.host ?? ''}`).hostname)) return reply.code(403).send({message: '仅允许本机访问'});
      if (request.headers.origin && !local(new URL(request.headers.origin).hostname)) return reply.code(403).send({message: '不允许跨站访问'});
      if (request.headers['sec-fetch-site'] === 'cross-site') return reply.code(403).send({message: '不允许跨站访问'});
    } catch {return reply.code(403).send({message: '无效请求来源'});}
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({message: '输入不符合接口约定', fields: error.issues.map(issue => issue.path.join('.'))});
    const code = error instanceof Error && 'statusCode' in error ? error.statusCode : 500;
    const status = typeof code === 'number' && code >= 400 && code <= 599 ? code : 500;
    if (status >= 500) request.log.error({status}, 'Request failed');
    return reply.code(status).send({message: status >= 500 ? '服务暂不可用，请检查后端日志' : error instanceof Error ? error.message : '请求失败'});
  });
  app.get('/api/platform/health', async () => ({status: 'UP', backend: 'typescript', migrationStage: 1}));
  // Preserve the old health response, but do not report ready before the remaining Java APIs are ready.
  app.get('/api/health', async (_request, reply) => {
    try {
      const response = await fetch(`${config.legacyUrl}/api/health`, {signal: AbortSignal.timeout(2000), redirect: 'error'});
      const body: unknown = await response.json();
      if (response.ok && z.object({status: z.literal('UP')}).safeParse(body).success) return {status: 'UP'};
    } catch { /* readiness is false while the legacy process is starting */ }
    return reply.code(503).send({status: 'DOWN', message: 'Java 兼容后端尚未就绪'});
  });
  app.get('/api/auto-ut/workspace-directories', async request => {
    const {path} = z.object({path: z.string().max(4096).optional()}).parse(request.query);
    return browse(path);
  });
  taskRoutes(app, runner);
  // Encapsulated streaming proxy preserves multipart bodies, errors, and legacy SSE without buffering/retries.
  await app.register(proxy, {
    upstream: config.legacyUrl,
    prefix: '/api',
    rewritePrefix: '/api',
    http2: false,
    retryMethods: [],
    maxRetriesOn503: 0,
    replyOptions: {retriesCount: 0},
    undici: {connections: 64, headersTimeout: 1800000, bodyTimeout: 0},
  });
  return app;
}
