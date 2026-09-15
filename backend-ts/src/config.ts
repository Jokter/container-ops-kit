import {resolve} from 'node:path';
import {z} from 'zod';

const environment = z.object({
  PLATFORM_PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  LEGACY_BACKEND_URL: z.url().default('http://127.0.0.1:8081'),
  PLATFORM_DATA_DIR: z.string().min(1).default('data/platform'),
  PLATFORM_WORKERS: z.coerce.number().int().min(1).max(16).default(2),
  PLATFORM_TASK_TIMEOUT_MS: z.coerce.number().int().min(100).max(3600000).default(300000),
});
export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = environment.parse(env);
  const legacy = new URL(parsed.LEGACY_BACKEND_URL);
  if (legacy.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(legacy.hostname)
      || legacy.username || legacy.password || legacy.pathname !== '/' || legacy.search || legacy.hash) {
    throw new Error('LEGACY_BACKEND_URL must be a local HTTP origin without credentials or path');
  }
  if (Number(legacy.port || 80) === parsed.PLATFORM_PORT) throw new Error('Platform and legacy ports must differ');
  return {
    port: parsed.PLATFORM_PORT,
    legacyUrl: legacy.origin,
    database: resolve(parsed.PLATFORM_DATA_DIR, 'tasks.sqlite'),
    workers: parsed.PLATFORM_WORKERS,
    taskTimeoutMs: parsed.PLATFORM_TASK_TIMEOUT_MS,
  };
}
export type Config = ReturnType<typeof readConfig>;
