import {fork} from 'node:child_process';
import type {ChildProcess} from 'node:child_process';
import {workerEvent} from '../../../shared/contracts.js';
import type {TaskInput, TaskStatus} from '../../../shared/contracts.js';
import {TaskStore} from './store.js';

interface Running {process: ChildProcess; timer: NodeJS.Timeout; closed: Promise<void>}
export class TaskRunner {
  private readonly active = new Map<string, Running>();
  private stopping = false;
  constructor(readonly store: TaskStore, private readonly concurrency: number, private readonly timeoutMs: number) {
    store.interruptUnfinished();
  }
  submit(input: TaskInput) {
    if (this.stopping) throw new Error('执行器正在关闭');
    const task = this.store.create(input);
    this.pump();
    return task;
  }
  cancel(id: string): void {
    this.store.record(id, 'CANCELLED', '任务已取消');
    this.active.get(id)?.process.kill('SIGKILL');
    this.pump();
  }
  private pump(): void {
    if (this.stopping) return;
    while (this.active.size < this.concurrency) {
      const task = this.store.next();
      if (!task) break;
      this.store.record(task.id, 'RUNNING', '独立 Worker 已启动');
      const child = fork(new URL('./worker.js', import.meta.url), [], {stdio: ['ignore', 'ignore', 'ignore', 'ipc'], execArgv: []});
      let finished = false;
      const finish = (status: TaskStatus, message: string) => {
        if (finished) return;
        finished = true;
        this.store.record(task.id, status, message);
        child.kill('SIGKILL');
      };
      const timer = setTimeout(() => finish('FAILED', '任务超时，Worker 已终止'), this.timeoutMs);
      const closed = new Promise<void>(resolve => {
        child.once('close', () => {
          clearTimeout(timer);
          if (!finished) this.store.record(task.id, 'FAILED', 'Worker 异常退出');
          this.active.delete(task.id);
          resolve();
          this.pump();
        });
      });
      this.active.set(task.id, {process: child, timer, closed});
      child.on('message', (message: unknown) => {
        if (finished) return;
        const parsed = workerEvent.safeParse(message);
        if (!parsed.success) {finish('FAILED', 'Worker 输出不符合协议'); return;}
        const event = parsed.data;
        if (event.type === 'progress') this.store.record(task.id, 'RUNNING', event.message);
        else finish(event.ok ? 'SUCCEEDED' : 'FAILED', event.message);
      });
      child.once('error', () => finish('FAILED', 'Worker 启动失败'));
      child.send(task.input, error => {if (error) finish('FAILED', 'Worker 通信失败');});
    }
  }
  async close(): Promise<void> {
    this.stopping = true;
    const jobs = [...this.active.values()];
    this.store.interruptUnfinished();
    for (const job of jobs) {clearTimeout(job.timer); job.process.kill('SIGKILL');}
    await Promise.all(jobs.map(job => job.closed));
  }
}
