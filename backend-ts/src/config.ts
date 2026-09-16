import {resolve} from 'node:path';
import {z} from 'zod';

const environment = z.object({
  PLATFORM_PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  PLATFORM_DATA_DIR: z.string().min(1).default('data/platform'),
  PLATFORM_WORKERS: z.coerce.number().int().min(1).max(16).default(2),
  PLATFORM_TASK_TIMEOUT_MS: z.coerce.number().int().min(100).max(3600000).default(300000),
});
export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = environment.parse(env);
  return {
    port: parsed.PLATFORM_PORT,
    database: resolve(parsed.PLATFORM_DATA_DIR, 'tasks.sqlite'),
    workers: parsed.PLATFORM_WORKERS,
    taskTimeoutMs: parsed.PLATFORM_TASK_TIMEOUT_MS,
  };
}
export type Config = ReturnType<typeof readConfig>;
