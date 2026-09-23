import {z} from 'zod';
import type {FastifyInstance} from 'fastify';
import type {TaskStore} from '../../platform/store.js';
import type {SshOperations, SshTarget} from '../../infrastructure/ssh.js';

const kind = z.enum(['BUILD', 'CONTAINER']);
const user = z.enum(['HUAWEI', 'SOPUSER', 'ROOT']);
const nullableText = z.string().max(2000).nullable().optional().transform(value => value?.trim() || null);
const webGroup = (url: string | null, name: string | null, password: string | null): boolean => {
  const count = [url, name, password].filter(Boolean).length;
  if (count !== 0 && count !== 3) return false;
  if (!url) return true;
  try {return ['http:', 'https:'].includes(new URL(url).protocol);} catch {return false;}
};
export const environmentInput = z.object({
  releaseVersionId: z.number().int().positive(), type: kind, name: z.string().trim().min(1).max(128),
  host: z.string().trim().min(1).max(255), sshPort: z.number().int().min(1).max(65535), password: z.string().min(1).max(512),
  rootPassword: nullableText, workDirectory: nullableText, architecture: nullableText,
  businessPlaneUrl: nullableText, businessPlaneUser: nullableText, businessPlanePassword: nullableText,
  managementPlaneUrl: nullableText, managementPlaneUser: nullableText, managementPlanePassword: nullableText,
  version: z.number().int().nonnegative().nullable().optional(),
}).strict().superRefine((value, context) => {
  if (value.type === 'CONTAINER' && !value.rootPassword) context.addIssue({code: 'custom', message: '容器环境必须配置 root 密码'});
  if (!webGroup(value.businessPlaneUrl, value.businessPlaneUser, value.businessPlanePassword)) context.addIssue({code: 'custom', message: '业务面地址、账号和密码需要同时填写'});
  if (!webGroup(value.managementPlaneUrl, value.managementPlaneUser, value.managementPlanePassword)) context.addIssue({code: 'custom', message: '管理面地址、账号和密码需要同时填写'});
});
type EnvironmentInput = z.infer<typeof environmentInput>;

export async function testEnvironmentConnection(ssh: SshOperations, target: SshTarget) {
  const result = await ssh.test(target);
  let architecture: string | null = null;
  let architectureError: string | null = null;
  if (result.status === 'REACHABLE') {
    try {
      const detected = await ssh.execute(target, 'uname -m', () => {}, undefined, 5000);
      const value = detected.lines.filter(line => !line.startsWith('[stderr] ')).join('\n').trim().toLowerCase();
      if (detected.exitCode === 0) architecture = ['amd64','x86_64'].includes(value) ? 'x86_64' : ['arm64','aarch64'].includes(value) ? 'aarch64' : null;
      if (!architecture) architectureError = '系统架构未识别，请重新测试连接';
    } catch { architectureError = '系统架构检测失败，请重新测试连接'; }
  }
  return {...result, architecture, architectureError};
}

export class EnvironmentService {
  constructor(private readonly store: TaskStore, private readonly ssh: SshOperations) {}
  versions() {return this.store.db.prepare('SELECT id,code,name,sort_order sortOrder FROM release_versions ORDER BY sort_order').all();}
  list() {return this.store.db.prepare('SELECT id FROM environments ORDER BY updated_at DESC').all().map(row => this.get(Number(row.id)));}
  get(id: number) {
    const row = this.store.db.prepare(`SELECT e.*,r.id rv_id,r.code rv_code,r.name rv_name,r.sort_order rv_sort
      FROM environments e JOIN release_versions r ON r.id=e.release_version_id WHERE e.id=?`).get(id);
    if (!row) throw Object.assign(new Error('环境不存在'), {statusCode: 404});
    return {id: Number(row.id), releaseVersion: {id: Number(row.rv_id), code: String(row.rv_code), name: String(row.rv_name), sortOrder: Number(row.rv_sort)},
      type: String(row.type), name: String(row.name), host: String(row.host), sshPort: Number(row.ssh_port), password: String(row.password),
      rootPassword: row.root_password == null ? null : String(row.root_password), workDirectory: row.work_directory == null ? null : String(row.work_directory), architecture: row.architecture == null ? null : String(row.architecture),
      businessPlaneUrl: row.business_plane_url == null ? null : String(row.business_plane_url), businessPlaneUser: row.business_plane_user == null ? null : String(row.business_plane_user), businessPlanePassword: row.business_plane_password == null ? null : String(row.business_plane_password),
      managementPlaneUrl: row.management_plane_url == null ? null : String(row.management_plane_url), managementPlaneUser: row.management_plane_user == null ? null : String(row.management_plane_user), managementPlanePassword: row.management_plane_password == null ? null : String(row.management_plane_password),
      connectionStatus: String(row.connection_status), lastTestedAt: row.last_tested_at == null ? null : String(row.last_tested_at), lastTestLatencyMs: row.last_test_latency_ms == null ? null : Number(row.last_test_latency_ms),
      lastTestError: row.last_test_error == null ? null : String(row.last_test_error), version: Number(row.version)};
  }
  private version(id: number) {
    if (!this.store.db.prepare('SELECT id FROM release_versions WHERE id=?').get(id)) throw Object.assign(new Error('发布版本不存在'), {statusCode: 404});
  }
  create(input: EnvironmentInput) {
    this.version(input.releaseVersionId);
    const now = new Date().toISOString();
    const result = this.store.db.prepare(`INSERT INTO environments(release_version_id,type,name,host,ssh_port,password,root_password,work_directory,architecture,
      business_plane_url,business_plane_user,business_plane_password,management_plane_url,management_plane_user,management_plane_password,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(input.releaseVersionId,input.type,input.name,input.host,input.sshPort,input.password,input.type==='CONTAINER'?input.rootPassword:null,
        input.workDirectory,input.architecture,input.businessPlaneUrl,input.businessPlaneUser,input.businessPlanePassword,input.managementPlaneUrl,input.managementPlaneUser,input.managementPlanePassword,now,now);
    return this.get(Number(result.lastInsertRowid));
  }
  update(id: number, input: EnvironmentInput) {
    const current = this.get(id);
    if (input.version == null || input.version !== current.version) throw Object.assign(new Error('环境已被其他请求修改，请刷新后重试'), {statusCode: 409});
    this.version(input.releaseVersionId);
    const connectionChanged = input.host !== current.host || input.sshPort !== current.sshPort || input.password !== current.password || input.rootPassword !== current.rootPassword || input.type !== current.type;
    const result = this.store.db.prepare(`UPDATE environments SET release_version_id=?,type=?,name=?,host=?,ssh_port=?,password=?,root_password=?,work_directory=?,architecture=?,
      business_plane_url=?,business_plane_user=?,business_plane_password=?,management_plane_url=?,management_plane_user=?,management_plane_password=?,
      connection_status=?,last_tested_at=?,last_test_latency_ms=?,last_test_error=?,updated_at=?,version=version+1 WHERE id=? AND version=?`)
      .run(input.releaseVersionId,input.type,input.name,input.host,input.sshPort,input.password,input.type==='CONTAINER'?input.rootPassword:null,input.workDirectory,input.architecture??(connectionChanged?null:current.architecture),
        input.businessPlaneUrl,input.businessPlaneUser,input.businessPlanePassword,input.managementPlaneUrl,input.managementPlaneUser,input.managementPlanePassword,
        connectionChanged?'UNTESTED':current.connectionStatus,connectionChanged?null:current.lastTestedAt,connectionChanged?null:current.lastTestLatencyMs,connectionChanged?null:current.lastTestError,new Date().toISOString(),id,input.version);
    if (!result.changes) throw Object.assign(new Error('环境已被其他请求修改，请刷新后重试'), {statusCode: 409});
    return this.get(id);
  }
  delete(id: number) {this.get(id); this.store.db.prepare('DELETE FROM environments WHERE id=?').run(id);}
  target(environment: ReturnType<EnvironmentService['get']>, sshUser?: z.infer<typeof user>): SshTarget {
    const selected = sshUser ?? (environment.type === 'BUILD' ? 'HUAWEI' : 'SOPUSER');
    if ((environment.type === 'BUILD') !== (selected === 'HUAWEI')) throw Object.assign(new Error('SSH 用户与环境类型不匹配'), {statusCode: 400});
    const username = {HUAWEI: 'huawei', SOPUSER: 'sopuser', ROOT: 'root'}[selected];
    const password = selected === 'ROOT' ? environment.rootPassword : environment.password;
    if (!password) throw Object.assign(new Error(`${username} 密码未配置`), {statusCode: 400});
    return {host: String(environment.host), port: environment.sshPort, username, password: String(password)};
  }
  async testSaved(id: number, sshUser: z.infer<typeof user>) {
    const environment = this.get(id); const result = await testEnvironmentConnection(this.ssh, this.target(environment, sshUser));
    const saved = this.store.db.prepare(`UPDATE environments SET connection_status=?,last_tested_at=?,last_test_latency_ms=?,last_test_error=?,architecture=?,updated_at=?,version=version+1 WHERE id=? AND version=?`)
      .run(result.status,new Date().toISOString(),result.latencyMs,result.error,result.architecture,new Date().toISOString(),id,environment.version);
    if (!saved.changes) throw Object.assign(new Error('环境已修改，请重新测试连接'), {statusCode:409});
    return {...result, version: this.get(id).version};
  }
}

export function environmentRoutes(app: FastifyInstance, service: EnvironmentService, ssh: SshOperations): void {
  const id = (value: unknown) => z.object({id: z.coerce.number().int().positive()}).parse(value).id;
  app.get('/api/release-versions', async () => service.versions());
  app.get('/api/environments', async () => service.list());
  app.get('/api/environments/:id', async request => service.get(id(request.params)));
  app.post('/api/environments', async (request, reply) => reply.code(201).send(service.create(environmentInput.parse(request.body))));
  app.put('/api/environments/:id', async request => service.update(id(request.params), environmentInput.parse(request.body)));
  app.delete('/api/environments/:id', async (request, reply) => {service.delete(id(request.params)); return reply.code(204).send();});
  app.post('/api/connection-tests/preview', async request => {
    const input = z.object({user: user.default('HUAWEI'), host: z.string().trim().min(1), sshPort: z.number().int().min(1).max(65535), password: z.string().min(1)}).passthrough().parse(request.body);
    return testEnvironmentConnection(ssh, {host: input.host, port: input.sshPort, username: {HUAWEI:'huawei',SOPUSER:'sopuser',ROOT:'root'}[input.user], password: input.password});
  });
  app.post('/api/environments/:id/connection-test', async request => service.testSaved(id(request.params), z.object({user: user}).parse(request.body).user));
  app.post('/api/environments/connection-tests/batch', async () => Promise.all(service.list().map(environment => service.testSaved(environment.id, environment.type === 'BUILD' ? 'HUAWEI' : 'SOPUSER'))));
}
