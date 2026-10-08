import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Fastify from 'fastify';
import {ZodError} from 'zod';
import {TaskStore} from '../src/platform/store.js';
import {ApplicationService,applicationRoutes} from '../src/modules/applications/applications.js';
import {platformOverview} from '../src/platform/overview.js';
const input={name:'研发日志',url:'http://192.0.2.20:5601',description:'查询日志',category:'日志检索',openMode:'embedded',workspace:'container',environment:'研发',owner:'运维'};

test('application CRUD persists in the existing SQLite and rejects stale edits/deletes',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'ops-apps-')),file=join(directory,'tasks.sqlite');let store=new TaskStore(file);
 try{
  let service=new ApplicationService(store);const first=service.create(input);assert.equal(first.url,'http://192.0.2.20:5601/');
  store.close();store=new TaskStore(file);service=new ApplicationService(store);
  assert.equal(service.list()[0]?.name,input.name);
  const updated=service.update(first.id,{...input,name:'新名称',revision:first.revision});assert.equal(updated.revision,1);
  assert.throws(()=>service.update(first.id,{...input,revision:0}),{statusCode:409});
  assert.throws(()=>service.remove(first.id,{revision:0}),{statusCode:409});
  service.remove(first.id,{revision:1});assert.deepEqual(service.list(),[]);
  assert.throws(()=>service.update(first.id,{...input,revision:1}),{statusCode:404});
 }finally{store.close();await rm(directory,{recursive:true,force:true});}
});
test('application routes validate protocol, credentials and all fields without remote access',async()=>{
 const store=new TaskStore(':memory:'),app=Fastify();applicationRoutes(app,new ApplicationService(store));
 app.setErrorHandler((error,_req,reply)=>reply.code(error instanceof ZodError?400:error instanceof Error&&'statusCode' in error&&typeof error.statusCode==='number'?error.statusCode:500).send({message:error instanceof Error?error.message:'Unknown error'}));
 try{
  for(const url of ['javascript:alert(1)','file:///etc/passwd','data:text/html,test','https://user:password@example.com','not-a-url']){
   const r=await app.inject({method:'POST',url:'/api/platform/applications',payload:{...input,url}});assert.equal(r.statusCode,400,url);
  }
  assert.equal((await app.inject({method:'POST',url:'/api/platform/applications',payload:{...input,scope:'private'}})).statusCode,400);
  const created=await app.inject({method:'POST',url:'/api/platform/applications',payload:input});assert.equal(created.statusCode,201);
  const id:string=created.json().id;
  assert.equal((await app.inject({method:'GET',url:'/api/platform/applications'})).json().length,1);
  assert.equal((await app.inject({method:'PUT',url:'/api/platform/applications/'+id,payload:{...input,revision:0,openMode:'newtab'}})).statusCode,200);
  assert.equal((await app.inject({method:'DELETE',url:'/api/platform/applications/'+id,payload:{revision:0}})).statusCode,409);
  assert.equal((await app.inject({method:'DELETE',url:'/api/platform/applications/'+id,payload:{revision:1}})).statusCode,204);
 }finally{await app.close();store.close();}
});
test('global overview uses stored state, de-duplicates UT and excludes secrets and completed tasks',()=>{
 const store=new TaskStore(':memory:'),now=new Date().toISOString();
 try{
  store.putRecord('auto-ut-governance','ut',{id:'ut',status:'WAITING_EXTERNAL',repository:'service',createdAt:now});
  store.putRecord('auto-ut-task','ut',{id:'ut',status:'REPAIRING',repository:'service',createdAt:now,password:'secret'});
  store.putRecord('build-task','build',{id:'build',status:'FAILED',module:'module',createdAt:now,workspaceRoot:'/private/path'});
  store.putRecord('deployment-task','deploy',{id:'deploy',status:'AWAITING_REVIEW',module:'module',createdAt:now,services:{token:'secret'}});
  store.putRecord('quality-job','quality',{id:'quality',status:'RUNNING',createdAt:now});
  store.putRecord('build-task','done',{id:'done',status:'SUCCEEDED',createdAt:now});
  new ApplicationService(store).create(input);
  const result=platformOverview(store,{summary:()=>({pending:[{id:'mr',repo:'team/repo',iid:'12',phase:'HUMAN',status:'等待人工审核',updatedAt:now,running:false}]})});
  assert.equal(result.running,2);assert.equal(result.attention,3);assert.equal(result.applications,1);
  assert.deepEqual(result.todos.map(x=>x.kind).sort(),['build','deploy','mr']);
  assert.doesNotMatch(JSON.stringify(result),/secret|private\/path/);
 }finally{store.close();}
});
