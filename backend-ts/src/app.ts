import Fastify from 'fastify';
import {ZodError} from 'zod';
import type {Config} from './config.js';
import {TaskStore} from './platform/store.js';
import {TaskRunner} from './platform/tasks.js';
import {taskRoutes} from './platform/routes.js';
import {SshOperations} from './infrastructure/ssh.js';
import {EnvironmentService,environmentRoutes} from './modules/environment/environment.js';
import {BuildService,buildRoutes} from './modules/build/build.js';
import {AutoUtService,autoUtRoutes} from './modules/autout/autout.js';
import {ContainerResourceService,containerResourceRoutes} from './modules/containerresource/containerresource.js';
import {DeploymentService,deploymentRoutes} from './modules/deployment/deployment.js';
import {FileLogs} from './infrastructure/file-logs.js';

export async function createApp(config: Config) {
  const logs=new FileLogs();
  const app = Fastify({bodyLimit: 1024 * 1024, forceCloseConnections: true, logger: {
    level: 'info', redact: ['req.headers.authorization', 'req.headers.cookie'],
    // Queries may contain local paths. Bodies/passwords are never logged.
    serializers: {req: request => ({method: request.method, url: request.url.split('?')[0] ?? ''})},stream:logs.backendStream(),
  }});
  const store = new TaskStore(config.database,logs);
  const runner = new TaskRunner(store, config.workers, config.taskTimeoutMs);
  const ssh=new SshOperations(),environments=new EnvironmentService(store,ssh),builds=new BuildService(store,environments,ssh,logs),autoUt=new AutoUtService(store,logs),containers=new ContainerResourceService(environments,ssh,config.kubectlKubeconfig,config.helmKubeconfig),deployments=new DeploymentService(store,builds,environments,ssh,config.kubectlKubeconfig,config.helmKubeconfig,logs);
  app.addHook('onClose', async () => {autoUt.close();await builds.close();await runner.close();store.close();});
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
    if (status >= 500) request.log.error({status,err:error}, 'Request failed');
    return reply.code(status).send({message: status >= 500 ? '服务暂不可用，请检查后端日志' : error instanceof Error ? error.message : '请求失败'});
  });
  app.get('/api/platform/health', async () => ({status:'UP',backend:'typescript',migrationStage:'complete'}));
  app.get('/api/health', async () => ({status:'UP'}));
  taskRoutes(app, runner);
  environmentRoutes(app,environments,ssh);buildRoutes(app,builds);await autoUtRoutes(app,autoUt);containerResourceRoutes(app,containers);deploymentRoutes(app,deployments);
  return app;
}
