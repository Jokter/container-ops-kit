import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {taskInput, taskStatus, terminal} from '../../../shared/contracts.js';
import type {Task, TaskEvent, TaskInput, TaskStatus} from '../../../shared/contracts.js';
import {noFileLogs} from '../infrastructure/file-logs.js';
import type {LogSink} from '../infrastructure/file-logs.js';

export class TaskStore {
  readonly db: DatabaseSync;
  constructor(filename: string,private readonly logs:LogSink=noFileLogs) {
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
      CREATE TABLE IF NOT EXISTS release_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, sort_order INTEGER NOT NULL);
      INSERT OR IGNORE INTO release_versions(code,name,sort_order) VALUES ('R27C10','R27C10',1),('R27C00','R27C00',2);
      CREATE TABLE IF NOT EXISTS environments (
        id INTEGER PRIMARY KEY AUTOINCREMENT, release_version_id INTEGER NOT NULL REFERENCES release_versions(id),
        type TEXT NOT NULL, name TEXT NOT NULL, host TEXT NOT NULL, ssh_port INTEGER NOT NULL,
        password TEXT NOT NULL, root_password TEXT, work_directory TEXT, architecture TEXT,
        business_plane_url TEXT, business_plane_user TEXT, business_plane_password TEXT,
        management_plane_url TEXT, management_plane_user TEXT, management_plane_password TEXT,
        connection_status TEXT NOT NULL DEFAULT 'UNTESTED', last_tested_at TEXT,
        last_test_latency_ms INTEGER, last_test_error TEXT, created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS domain_records (
        domain TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL, PRIMARY KEY(domain,id));
      CREATE INDEX IF NOT EXISTS domain_records_list ON domain_records(domain,created_at DESC);
      COMMIT;`);
    } catch (error) {this.db.close(); throw error;}
  }
  create(input: TaskInput): Task {
    const id = randomUUID(), now = new Date().toISOString();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO tasks VALUES (?, ?, ?, ?, ?)').run(id, JSON.stringify(taskInput.parse(input)), 'QUEUED', now, now);
      this.db.prepare('INSERT INTO events(task_id,status,message,time) VALUES (?,?,?,?)').run(id, 'QUEUED', '任务已排队', now);
      this.logs.task('platform',id,{time:now,status:'QUEUED',message:'任务已排队'});
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
      this.logs.task('platform',id,{time,status,message:message.slice(0,8192)});
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

  putRecord(domain: string, id: string, value: unknown, createdAt = new Date().toISOString()): void {
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO domain_records(domain,id,payload,created_at,updated_at) VALUES(?,?,?,?,?)
      ON CONFLICT(domain,id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at`)
      .run(domain, id, JSON.stringify(value), createdAt, now);
  }
  getRecord<T>(domain: string, id: string): T | undefined {
    const row = this.db.prepare('SELECT payload FROM domain_records WHERE domain=? AND id=?').get(domain, id);
    return row ? JSON.parse(String(row.payload)) as T : undefined;
  }
  records<T>(domain: string): T[] {
    return this.db.prepare('SELECT payload FROM domain_records WHERE domain=? ORDER BY created_at DESC').all(domain)
      .map(row => JSON.parse(String(row.payload)) as T);
  }
  deleteRecord(domain: string, id: string): void {
    this.db.prepare('DELETE FROM domain_records WHERE domain=? AND id=?').run(domain, id);
  }
}
