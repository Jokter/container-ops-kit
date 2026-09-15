import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {taskInput, taskStatus, terminal} from '../../../shared/contracts.js';
import type {Task, TaskEvent, TaskInput, TaskStatus} from '../../../shared/contracts.js';

export class TaskStore {
  private readonly db: DatabaseSync;
  constructor(filename: string) {
    if (filename !== ':memory:') mkdirSync(dirname(filename), {recursive: true});
    this.db = new DatabaseSync(filename);
    try {
      // A second server must fail before it can mark this process's running jobs INTERRUPTED.
      // SQLite releases the exclusive lock even after a crash; no stale PID files to delete.
      this.db.exec(`PRAGMA busy_timeout=100; PRAGMA locking_mode=EXCLUSIVE;
      PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      BEGIN EXCLUSIVE;
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY, input TEXT NOT NULL, status TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL REFERENCES tasks(id),
        status TEXT NOT NULL, message TEXT NOT NULL, time TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS events_task_sequence ON events(task_id, sequence);
      CREATE INDEX IF NOT EXISTS tasks_status ON tasks(status);
      COMMIT;`);
    } catch (error) {this.db.close(); throw error;}
  }
  create(input: TaskInput): Task {
    const id = randomUUID(), now = new Date().toISOString();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO tasks VALUES (?, ?, ?, ?, ?)').run(id, JSON.stringify(taskInput.parse(input)), 'QUEUED', now, now);
      this.db.prepare('INSERT INTO events(task_id,status,message,time) VALUES (?,?,?,?)').run(id, 'QUEUED', '任务已排队', now);
      this.db.exec('COMMIT');
    } catch (error) {this.db.exec('ROLLBACK'); throw error;}
    return this.get(id)!;
  }
  get(id: string): Task | undefined {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id=?').get(id);
    if (!row) return undefined;
    return {id: String(row.id), input: taskInput.parse(JSON.parse(String(row.input))), status: taskStatus.parse(row.status),
      createdAt: String(row.created_at), updatedAt: String(row.updated_at)};
  }
  list(limit = 100): Task[] {
    return this.db.prepare('SELECT id FROM tasks ORDER BY created_at DESC, rowid DESC LIMIT ?').all(limit)
      .map(row => this.get(String(row.id))!);
  }
  next(): Task | undefined {
    const row = this.db.prepare("SELECT id FROM tasks WHERE status='QUEUED' ORDER BY rowid LIMIT 1").get();
    return row ? this.get(String(row.id)) : undefined;
  }
  record(id: string, status: TaskStatus, message: string): TaskEvent | undefined {
    const task = this.get(id);
    if (!task || terminal(task.status)) return undefined;
    if (status === 'QUEUED' || (status === 'SUCCEEDED' && task.status !== 'RUNNING')) throw new Error('Invalid task transition');
    const time = new Date().toISOString();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('UPDATE tasks SET status=?,updated_at=? WHERE id=?').run(status, time, id);
      const row = this.db.prepare('INSERT INTO events(task_id,status,message,time) VALUES (?,?,?,?)')
        .run(id, status, message.slice(0, 8192), time);
      this.db.exec('COMMIT');
      return {sequence: Number(row.lastInsertRowid), taskId: id, status, message: message.slice(0, 8192), time};
    } catch (error) {this.db.exec('ROLLBACK'); throw error;}
  }
  events(id: string, after = 0, limit = 200): TaskEvent[] {
    return this.db.prepare('SELECT * FROM events WHERE task_id=? AND sequence>? ORDER BY sequence LIMIT ?').all(id, after, limit)
      .map(row => ({sequence: Number(row.sequence), taskId: String(row.task_id), status: taskStatus.parse(row.status),
        message: String(row.message), time: String(row.time)}));
  }
  interruptUnfinished(): void {
    for (const row of this.db.prepare("SELECT id FROM tasks WHERE status IN ('QUEUED','RUNNING')").all()) {
      this.record(String(row.id), 'INTERRUPTED', '执行进程已停止；需要人工重新发起，不自动重试');
    }
  }
  close(): void {this.db.close();}
}
