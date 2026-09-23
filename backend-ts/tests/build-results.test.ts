import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync,spawnSync} from 'node:child_process';
import {remoteResultsScript} from '../src/modules/build/remote-results.js';
import {downloadQuery} from '../src/modules/build/results.js';

type Report={packages:Array<{service:string;filename:string;kind:string}>,comparison:Array<{service:string;status:string;files:Array<{path:string;patch:string;binary:boolean;truncated:boolean}>}>};
async function setup(t:test.TestContext){const root=await mkdtemp(join(tmpdir(),'build-results-'));t.after(()=>rm(root,{recursive:true,force:true}));const a=join(root,'a'),b=join(root,'b');await mkdir(a);await mkdir(b);return{root,a,b};}
async function chart(root:string,name:string,value:string){const path=join(root,name);await mkdir(path,{recursive:true});await writeFile(join(path,'Chart.yaml'),`apiVersion: v2\nname: ${name}\nversion: 1.0.0\n`);await writeFile(join(path,'values.yaml'),value);return path;}
function run(roots:string[],action='inspect',services:string[]=[]){return execFileSync('python3',['-c',remoteResultsScript,JSON.stringify({roots,action,services})],{maxBuffer:16*1024*1024});}
function inspect(roots:string[]){return JSON.parse(run(roots).toString()) as Report;}

test('按服务区分四类差异，文本、二进制、空文件与大文件均不丢失变化',async t=>{
 const{a,b}=await setup(t);
 await chart(a,'same','replicas: 2\n');await chart(b,'same','replicas: 2\n');
 await chart(a,'changed','replicas: 2\n');const changed=await chart(b,'changed','replicas: 3\n');
 await writeFile(join(changed,'empty.txt'),'');await writeFile(join(changed,'data.bin'),Buffer.from([0,1]));await writeFile(join(changed,'large.txt'),'a'.repeat(300000));
 await chart(a,'removed','old: true');await chart(b,'added','new: true');
 const result=inspect([a,b]);assert.deepEqual(Object.fromEntries(result.comparison.map(r=>[r.service,r.status])),{added:'ADDED',changed:'MODIFIED',removed:'REMOVED',same:'UNCHANGED'});
 const files=result.comparison.find(r=>r.service==='changed')!.files;assert.match(files.find(f=>f.path==='values.yaml')!.patch,/-replicas: 2\n\+replicas: 3/);assert.equal(files.find(f=>f.path==='data.bin')!.binary,true);assert.equal(files.find(f=>f.path==='large.txt')!.binary,true);assert.equal(files.find(f=>f.path==='empty.txt')!.binary,false);
});
test('保留原始 tgz 字节，目录与压缩包对比忽略包装元数据；批量包包含选中服务',async t=>{
 const{root,a,b}=await setup(t);const chartA=await chart(a,'demo','replicas: 2\n');await chart(a,'second','value: true\n');
 const archive=join(b,'demo-1.0.0.tgz');execFileSync('tar',['-czf',archive,'-C',a,'demo']);
 assert.equal(inspect([a,b]).comparison.find(r=>r.service==='demo')!.status,'UNCHANGED');
 assert.deepEqual(run([b],'download',['demo']),await readFile(archive));
 const batch=join(root,'batch.tgz');await writeFile(batch,run([a],'download',['demo','second']));const list=execFileSync('tar',['-tzf',batch]).toString();assert.match(list,/demo\/demo.tgz/);assert.match(list,/second\/second.tgz/);
 const single=join(root,'single.tgz');await writeFile(single,run([a],'download',['demo']));assert.match(execFileSync('tar',['-tzf',single]).toString(),/demo\/values.yaml/);assert.ok(chartA);
});
test('拒绝包内路径穿越、符号链接与不存在的产物目录',async t=>{
 const{root,a}=await setup(t);await chart(a,'demo','x: 1');await symlink(root,join(a,'demo','escape'));
 let result=spawnSync('python3',['-c',remoteResultsScript,JSON.stringify({roots:[a],action:'inspect'})]);assert.notEqual(result.status,0);
 await rm(join(a,'demo','escape'));execFileSync('python3',['-c',`import tarfile,io,sys\nwith tarfile.open(sys.argv[1],'w:gz') as t:\n m=tarfile.TarInfo('../escape');m.size=1;t.addfile(m,io.BytesIO(b'x'))`,join(a,'bad.tgz')]);
 result=spawnSync('python3',['-c',remoteResultsScript,JSON.stringify({roots:[a],action:'inspect'})]);assert.notEqual(result.status,0);assert.match(result.stderr.toString(),/路径不合法/);
 result=spawnSync('python3',['-c',remoteResultsScript,JSON.stringify({roots:[join(root,'missing')],action:'inspect'})]);assert.notEqual(result.status,0);
});
test('下载输入拒绝路径、重复服务、未知版本和超量选择',()=>{
 for(const input of [{side:'single',services:'../x'},{side:'single',services:'a,a'},{side:'unknown',services:'a'},{side:'single',services:Array.from({length:101},(_,i)=>'s'+i).join(',')}])assert.equal(downloadQuery.safeParse(input).success,false);
 assert.deepEqual(downloadQuery.parse({side:'baseline',services:'demo,other'}).services,['demo','other']);
});

import Fastify from 'fastify';
import {PassThrough} from 'node:stream';
import {TaskStore} from '../src/platform/store.js';
import {EnvironmentService,environmentInput} from '../src/modules/environment/environment.js';
import {SshOperations,type SshTarget,type CommandResult} from '../src/infrastructure/ssh.js';
import {BuildService,buildRoutes,type BuildTask} from '../src/modules/build/build.js';

test('结果持久化、下载版本校验、并发清理保护及重启后查看',async t=>{
 class FakeSsh extends SshOperations {
   inspections=0;auto=false;output:PassThrough|null=null;
   override async execute(_target:SshTarget,_command:string):Promise<CommandResult>{this.inspections++;return{exitCode:0,lines:[JSON.stringify({packages:[{service:'demo',filename:'demo-1.0.tgz',version:'1.0',size:10,kind:'archive'}],comparison:null})]};}
   override async stream(){const output=new PassThrough();this.output=output;if(this.auto)setImmediate(()=>output.end(Buffer.from([31,139,8,0])));return output;}
 }
 const store=new TaskStore(':memory:'),ssh=new FakeSsh(),environments=new EnvironmentService(store,ssh);
 const environment=environments.create(environmentInput.parse({releaseVersionId:1,type:'BUILD',name:'build',host:'localhost',sshPort:22,password:'test',workDirectory:'/opt/build'}));
 const service=new BuildService(store,environments,ssh),id='00000000-0000-4000-8000-000000000001';
 const task:BuildTask={id,mode:'SINGLE',environmentId:environment.id,environmentName:'build',module:'mae-access',baseline:{cbbWebDevBranch:'master',archDesignBranch:'master'},candidate:null,status:'SUCCEEDED',progress:100,error:null,createdAt:new Date().toISOString(),startedAt:null,finishedAt:null,workspaceRoot:`/opt/build/container-ops-kit/builds/${id}`,steps:[],events:[],sequence:0,completedSteps:0};store.putRecord('build-task',id,task);
 const app=Fastify();buildRoutes(app,service);t.after(async()=>{await app.close();store.close();});
 let response=await app.inject(`/api/build-tasks/${id}/results`);assert.equal(response.statusCode,200);assert.equal(ssh.inspections,1);
 const restarted=new BuildService(store,environments,ssh);await restarted.result(id);assert.equal(ssh.inspections,1);
 response=await app.inject(`/api/build-tasks/${id}/packages?side=baseline&services=demo`);assert.equal(response.statusCode,400);
 response=await app.inject(`/api/build-tasks/${id}/packages?side=single&services=missing`);assert.equal(response.statusCode,404);
 ssh.auto=true;response=await app.inject(`/api/build-tasks/${id}/packages?side=single&services=demo`);assert.equal(response.statusCode,200);assert.deepEqual(response.rawPayload,Buffer.from([31,139,8,0]));assert.match(String(response.headers['content-disposition']),/demo-1.0.tgz/);ssh.auto=false;
 const {stream}=await service.download(id,{side:'single',services:'demo'});await assert.rejects(service.delete(id,true),/正在读取或下载/);assert.ok(store.getRecord('build-task',id));
 stream.destroy();await new Promise(resolve=>setImmediate(resolve));await service.delete(id,false);assert.equal(store.getRecord('build-task',id),undefined);assert.equal(store.getRecord('build-result',id),undefined);
});

for(const mode of ['SINGLE','COMPARE'] as const)for(const failBusiness of [false,true])test(`业务仓顺序、chart目录及失败阻断 ${mode} ${failBusiness}`,async t=>{
 class FakeSsh extends SshOperations{
  commands:string[]=[];
  override async execute(_target:SshTarget,command:string):Promise<CommandResult>{this.commands.push(command);return{exitCode:failBusiness&&command.includes("business-0/chart'")?1:0,lines:[JSON.stringify({packages:[],comparison:mode==='COMPARE'?[]:null})]};}
 }
 const store=new TaskStore(':memory:'),ssh=new FakeSsh(),environments=new EnvironmentService(store,ssh);
 const environment=environments.create(environmentInput.parse({releaseVersionId:1,type:'BUILD',name:'build',host:'localhost',sshPort:22,password:'test',workDirectory:'/opt/build'}));
 const service=new BuildService(store,environments,ssh);t.after(async()=>{await service.close();store.close()});
 const baseline={cbbWebDevBranch:'master',archDesignBranch:'master',businessRepositories:[{repository:'https://codehub.example/Team/One.git',branch:'feature/a'},{repository:'ssh://git@codehub.example:2222/Team/Two.git',branch:'master'}]};
 const task=service.start({mode,environmentId:environment.id,module:'mae-access',baseline,candidate:mode==='COMPARE'?{...baseline,businessRepositories:[{repository:'https://codehub.example/Team/One.git',branch:'feature/b'}]}:null});
 for(let i=0;i<100&&!service.terminal(task.id);i++)await new Promise(resolve=>setImmediate(resolve));
 const saved=service.get(task.id);assert.equal(saved.status,failBusiness?'FAILED':'SUCCEEDED');assert.deepEqual(saved.baseline.businessRepositories,baseline.businessRepositories);
 for(const side of mode==='SINGLE'?['single']:['baseline','candidate']){
  const cmds=ssh.commands.filter(c=>c.includes('/'+side+'/'));
  const builds=cmds.filter(c=>c.includes('mvn clean install'));
  assert.match(builds[0]!,/CBB-Web-Dev\/chart-codegen-plugin/);assert.match(builds[1]!,/business-0\/chart/);
  if(failBusiness){assert.equal(builds.length,2);assert.equal(cmds.some(c=>c.includes('ArchDesign')),false)}
  else{assert.match(builds.at(-1)!,/ArchDesign\/Chart\/mae-access/);assert.equal(builds.length,side==='candidate'?3:4);const response=service.response(saved);assert.ok('directories' in response&&response.directories.some(d=>d.path.endsWith(`/${side}/business-0/chart`)));}
  if(mode==='COMPARE')assert.ok(builds.every(c=>c.includes(`/${side}/.m2/repository`)));
 }
});
test('业务仓输入兼容零仓库并拒绝凭据、命令及路径穿越',async t=>{
 class FakeSsh extends SshOperations{override async execute():Promise<CommandResult>{return{exitCode:0,lines:['{"packages":[],"comparison":null}']}}}
 const store=new TaskStore(':memory:'),ssh=new FakeSsh(),environments=new EnvironmentService(store,ssh),service=new BuildService(store,environments,ssh);t.after(async()=>{await service.close();store.close()});
 const environment=environments.create(environmentInput.parse({releaseVersionId:1,type:'BUILD',name:'build',host:'localhost',sshPort:22,password:'test',workDirectory:'/opt/build'}));
 for(const repository of ['https://user:secret@host/Team/Repo.git','file:///etc/repo.git','https://host/../Repo.git','https://host/Repo.git;touch /tmp/x'])assert.throws(()=>service.start({mode:'SINGLE',environmentId:environment.id,module:'mae-access',baseline:{businessRepositories:[{repository,branch:'master'}]}}));
 for(const baseline of [{},{businessRepositories:[]}]){const task=service.start({mode:'SINGLE',environmentId:environment.id,module:'mae-access',baseline});for(let i=0;i<100&&!service.terminal(task.id);i++)await new Promise(resolve=>setImmediate(resolve));assert.equal(service.get(task.id).status,'SUCCEEDED');assert.equal(service.get(task.id).steps.length,6)}
});
