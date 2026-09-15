import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {taskInput, terminal} from '../../../shared/contracts.js';
import type {TaskRunner} from './tasks.js';

export function taskRoutes(app: FastifyInstance, runner: TaskRunner): void {
  const store = runner.store;
  const idSchema = z.object({id: z.uuid()});
  const find = (params: unknown) => {
    const {id} = idSchema.parse(params);
    const task = store.get(id);
    if (!task) throw Object.assign(new Error('任务不存在'), {statusCode: 404});
    return task;
  };
  app.get('/api/platform/tasks', async request => {
    const {limit} = z.object({limit: z.coerce.number().int().min(1).max(200).default(100)}).parse(request.query);
    return store.list(limit);
  });
  app.post('/api/platform/tasks', async (request, reply) => reply.code(202).send(runner.submit(taskInput.parse(request.body))));
  app.get('/api/platform/tasks/:id', async request => find(request.params));
  app.post('/api/platform/tasks/:id/cancel', async request => {
    const task = find(request.params);
    runner.cancel(task.id);
    return store.get(task.id);
  });

  // Poll the durable event log, not an in-memory subscription: reconnects cannot lose events.
  const clients = new Set<() => void>();
  app.addHook('preClose', async () => {for (const close of clients) close();});
  app.get('/api/platform/tasks/:id/events', async (request, reply) => {
    const task = find(request.params);
    const cursor = z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
    const query = z.object({afterSequence: cursor.default(0)}).parse(request.query);
    let after = Math.max(query.afterSequence, cursor.parse(request.headers['last-event-id'] ?? 0));
    let blocked = false, closed = false;
    let lastHeartbeat = Date.now();
    reply.hijack();
    const response = reply.raw;
    response.writeHead(200, {'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no'});
    response.flushHeaders();
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      clients.delete(close);
      response.off('drain', drain);
      response.end();
    };
    const drain = () => {blocked = false;};
    const flush = () => {
      if (closed || blocked) return;
      const events = store.events(task.id, after);
      for (const event of events) {
        after = event.sequence;
        if (!response.write(`id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`)) {blocked = true; break;}
      }
      if (blocked) return;
      if (terminal(store.get(task.id)!.status) && store.events(task.id, after, 1).length === 0) {close(); return;}
      if (Date.now() - lastHeartbeat >= 15000) {
        blocked = !response.write(': heartbeat\n\n');
        lastHeartbeat = Date.now();
      }
    };
    const timer = setInterval(flush, 250);
    timer.unref();
    clients.add(close);
    response.on('drain', drain);
    response.once('close', close);
    flush();
  });
}
