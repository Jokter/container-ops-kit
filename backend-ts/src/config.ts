import {resolve} from 'node:path';
import {z} from 'zod';

const environment = z.object({
  DEPLOYMENT_KUBECTL_KUBECONFIG: z.string().trim().min(1).default('/root/.kube/config'),
  DEPLOYMENT_HELM_KUBECONFIG: z.string().trim().min(1).default('/opt/kubeconfig/kubeconfig.txt'),
  PLATFORM_AUTH_FILE: z.string().min(1).default('auth-config.json'),
  PLATFORM_WORK_ROOT: z.string().min(1).default(process.platform==='win32'?'data/workspaces':'/usr1/wytest'),
  PLATFORM_REMOTE_WORK_ROOT: z.string().regex(/^\/[A-Za-z0-9_./-]+$/).default('/usr1/wytest'),
  PLATFORM_PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  PLATFORM_DATA_DIR: z.string().min(1).default('data/platform'),
  PLATFORM_WORKERS: z.coerce.number().int().min(1).max(16).default(2),
  PLATFORM_TASK_TIMEOUT_MS: z.coerce.number().int().min(100).max(3600000).default(300000),
});
export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = environment.parse(env);
  return {
    kubectlKubeconfig: parsed.DEPLOYMENT_KUBECTL_KUBECONFIG,
    helmKubeconfig: parsed.DEPLOYMENT_HELM_KUBECONFIG,
    authFile: resolve(parsed.PLATFORM_AUTH_FILE),
    workRoot: resolve(parsed.PLATFORM_WORK_ROOT),
    remoteWorkRoot: parsed.PLATFORM_REMOTE_WORK_ROOT,
    port: parsed.PLATFORM_PORT,
    database: resolve(parsed.PLATFORM_DATA_DIR, 'tasks.sqlite'),
    workers: parsed.PLATFORM_WORKERS,
    taskTimeoutMs: parsed.PLATFORM_TASK_TIMEOUT_MS,
  };
}
export type Config = ReturnType<typeof readConfig>;
