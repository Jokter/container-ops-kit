import {z} from 'zod';

export const taskStatus = z.enum(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED']);
export type TaskStatus = z.infer<typeof taskStatus>;
export const terminal = (status: TaskStatus): boolean => status !== 'QUEUED' && status !== 'RUNNING';

// Only registered, read-only jobs are exposed. Never accept executable/args over HTTP.
export const taskInput = z.object({
  kind: z.literal('workspace-inspect'),
  path: z.string().trim().min(1).max(4096),
}).strict();
export type TaskInput = z.infer<typeof taskInput>;
export interface Task {
  id: string;
  input: TaskInput;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
}
export interface TaskEvent {
  sequence: number;
  taskId: string;
  status: TaskStatus;
  message: string;
  time: string;
}
export interface DirectoryEntry {name: string; path: string; writable: boolean}
export interface DirectoryListing {
  current: string;
  parent: string;
  writable: boolean;
  directories: DirectoryEntry[];
}
export const workerEvent = z.discriminatedUnion('type', [
  z.object({type: z.literal('progress'), message: z.string().max(8192)}).strict(),
  z.object({type: z.literal('result'), ok: z.boolean(), message: z.string().max(8192)}).strict(),
]);
