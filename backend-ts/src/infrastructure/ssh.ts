import {Client} from 'ssh2';
import type {ConnectConfig, SFTPWrapper} from 'ssh2';
import {dirname, posix} from 'node:path';
import {PassThrough} from 'node:stream';

export interface SshTarget {host: string; port: number; username: string; password: string}
export interface CommandResult {exitCode: number; lines: string[]}
export const shellQuote = (value: string): string => `'${value.replaceAll("'", `'"'"'`)}'`;

export class SshOperations {
  constructor(private readonly connectTimeout = 5000, private readonly commandTimeout = 1_800_000) {}
  private connect(target: SshTarget, signal?: AbortSignal): Promise<Client> {
    return new Promise((resolve, reject) => {
      const client = new Client();
      let settled = false;
      const done = (error?: Error) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', abort);
        if (error) {client.end(); reject(error);} else resolve(client);
      };
      const abort = () => done(new Error('操作已取消'));
      signal?.addEventListener('abort', abort, {once: true});
      client.once('ready', () => done()).once('error', error => done(error));
      const config: ConnectConfig = {host: target.host, port: target.port, username: target.username,
        password: target.password, readyTimeout: this.connectTimeout, keepaliveInterval: 10_000};
      client.connect(config);
    });
  }
  async test(target: SshTarget): Promise<{status: 'REACHABLE' | 'FAILED'; latencyMs: number; error: string | null}> {
    const started = Date.now();
    try {const client = await this.connect(target); client.end(); return {status: 'REACHABLE', latencyMs: Date.now() - started, error: null};}
    catch (error) {return {status: 'FAILED', latencyMs: Date.now() - started, error: classifySshError(error)};}
  }
  async execute(target: SshTarget, command: string, onLine: (line: string) => void = () => {}, signal?: AbortSignal,
                timeout = this.commandTimeout): Promise<CommandResult> {
    const client = await this.connect(target, signal);
    return new Promise((resolve, reject) => {
      let settled = false, timer: NodeJS.Timeout | undefined;
      const lines: string[] = [];
      const finish = (error?: Error, exitCode = 255) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        client.end();
        if (error) reject(error); else resolve({exitCode, lines});
      };
      const abort = () => finish(new Error('操作已取消'));
      signal?.addEventListener('abort', abort, {once: true});
      timer = setTimeout(() => {onLine('远程命令执行超时'); finish(undefined, 124);}, timeout);
      client.exec(`bash -lc ${shellQuote(command)}`, (error, stream) => {
        if (error) {finish(error); return;}
        const consume = (prefix: string) => {
          let pending = '';
          return {push:(chunk: Buffer) => {
            pending += chunk.toString('utf8');
            const split = pending.split(/\r?\n/); pending = split.pop() ?? '';
            for (const value of split) {const line = prefix + value; lines.push(line); onLine(line);}
          },flush:()=>{if(pending){const line=prefix+pending;lines.push(line);onLine(line);pending='';}}};
        };
        const stdout=consume(''),stderr=consume('[stderr] ');
        stream.on('data', stdout.push);stream.stderr.on('data', stderr.push);
        stream.once('close', (code: number | undefined) => {stdout.flush();stderr.flush();finish(undefined, code ?? 255);});
        stream.once('error', finish);
      });
    });
  }
  async readText(target: SshTarget, path: string, signal?: AbortSignal): Promise<string> {
    const result = await this.execute(target, `cat ${shellQuote(path)}`, () => {}, signal);
    if (result.exitCode !== 0) throw new Error(`远程文件读取失败：${path}`);
    return result.lines.map(line => line.replace(/^\[stderr\] /, '')).join('\n') + '\n';
  }
  async stream(target:SshTarget,command:string,signal?:AbortSignal):Promise<PassThrough> {
    if(signal?.aborted)throw new Error('操作已取消');
    const client=await this.connect(target,signal);
    return new Promise((resolve,reject)=>{
      const output=new PassThrough();let started=false,finished=false,stderr='';
      const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);client.end();};
      const fail=(error:Error)=>{if(finished)return;finished=true;cleanup();if(started)output.destroy(error);else{output.destroy();reject(error);}};
      const abort=()=>fail(new Error('下载已取消'));
      const timer=setTimeout(()=>fail(new Error('构建包下载超时')),this.commandTimeout);
      signal?.addEventListener('abort',abort,{once:true});
      client.on('error',fail);
      client.once('close',()=>{if(!finished)fail(new Error('SSH 下载连接已关闭'));});
      output.once('close',()=>{if(!finished){finished=true;cleanup();}});
      if(signal?.aborted){abort();return;}
      client.exec(`bash -lc ${shellQuote(command)}`,(error,channel)=>{
        if(error){fail(error);return;}
        channel.stderr.on('data',(chunk:Buffer)=>{stderr=(stderr+chunk.toString('utf8')).slice(-4000);});
        channel.once('data',()=>{if(!finished){started=true;resolve(output);}});
        channel.pipe(output,{end:false});
        channel.once('error',fail);
        channel.once('close',(code:number|undefined)=>{
          if(finished)return;
          if(code!==0){fail(new Error(stderr.trim()||'构建包下载失败'));return;}
          finished=true;cleanup();if(!started)resolve(output);output.end();
        });
      });
    });
  }
  async uploadFiles(target: SshTarget, remoteDirectory: string, files: ReadonlyMap<string, Buffer>, signal?: AbortSignal): Promise<void> {
    for (const name of files.keys()) if (name.startsWith('/') || name.includes('..') || name.includes('\\')) throw new Error('上传路径不合法');
    const directories = [...new Set([...files.keys()].map(name => posix.join(remoteDirectory, dirname(name))))];
    const mkdir = await this.execute(target, `mkdir -p ${directories.map(shellQuote).join(' ')}`, () => {}, signal);
    if (mkdir.exitCode !== 0) throw new Error('远程目录创建失败');
    const client = await this.connect(target, signal);
    try {
      const sftp = await new Promise<SFTPWrapper>((resolve, reject) => client.sftp((error, value) => error ? reject(error) : resolve(value)));
      for (const [name, content] of files) {
        const remote = posix.join(remoteDirectory, name);
        await new Promise<void>((resolve, reject) => {
          const stream = sftp.createWriteStream(remote, {flags: 'w'});
          stream.once('error', reject).once('close', resolve).end(content);
        });
      }
      sftp.end();
    } finally {client.end();}
  }
}

function classifySshError(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (message.includes('getaddrinfo') || message.includes('resolve')) return '地址无法解析';
  if (message.includes('refused')) return '端口拒绝连接';
  if (message.includes('timeout') || message.includes('timed out')) return '连接超时';
  if (message.includes('auth') || message.includes('password') || message.includes('denied')) return '账号或密码错误';
  if (message.includes('protocol') || message.includes('host key')) return 'SSH 主机校验失败';
  return '连接失败';
}
