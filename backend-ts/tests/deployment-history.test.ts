import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {ZodError} from 'zod';
import {TaskStore} from '../src/platform/store.js';
import {DeploymentService,deploymentRoutes} from '../src/modules/deployment/deployment.js';
import {BuildService} from '../src/modules/build/build.js';
import {EnvironmentService} from '../src/modules/environment/environment.js';
import {SshOperations} from '../src/infrastructure/ssh.js';
test('部署历史删除仅作用于已结束记录，校验 revision，保留其他任务与构建产物',async()=>{
 const store=new TaskStore(':memory:'),ssh=new SshOperations(),env=new EnvironmentService(store,ssh),builds=new BuildService(store,env,ssh),service=new DeploymentService(store,builds,env,ssh,'',''),app=Fastify();
 deploymentRoutes(app,service);app.setErrorHandler((e,_req,reply)=>reply.code(e instanceof ZodError?400:e instanceof Error&&'statusCode' in e&&typeof e.statusCode==='number'?e.statusCode:500).send({message:e instanceof Error?e.message:'error'}));
 const id='11111111-1111-4111-8111-111111111111',now=new Date().toISOString();
 const seed=(status:string)=>store.putRecord('deployment-task',id,{id,mode:'QUICK',status,artifactId:1,environmentId:1,module:'swm',namespace:'mae',revision:2,createdAt:now,services:{svc:{values:'secret'}},events:[],sequence:0});
 try{
  store.putRecord('build-artifact','artifact',{id:1});store.putRecord('deployment-task','other',{id:'other',status:'FAILED',services:{},events:[],revision:1});
  for(const status of ['PENDING','ANALYZING','AWAITING_REVIEW','PREPARING','DEPLOYING']){seed(status);assert.equal((await app.inject({method:'DELETE',url:'/api/deployment-tasks/'+id,payload:{expectedRevision:2}})).statusCode,409);}
  for(const status of ['SUCCEEDED','FAILED']){seed(status);const list=await app.inject({method:'GET',url:'/api/deployment-tasks'});assert.equal(list.statusCode,200);assert.doesNotMatch(list.body,/secret|values/);
   assert.equal((await app.inject({method:'DELETE',url:'/api/deployment-tasks/'+id,payload:{expectedRevision:1}})).statusCode,409);
   assert.equal((await app.inject({method:'DELETE',url:'/api/deployment-tasks/'+id,payload:{expectedRevision:2,deleteResources:true}})).statusCode,400);
   assert.equal((await app.inject({method:'DELETE',url:'/api/deployment-tasks/'+id,payload:{expectedRevision:2}})).statusCode,204);assert.equal(service.terminal(id),true);assert.deepEqual(service.events(id,0),[]);
  }
  assert.ok(store.getRecord('build-artifact','artifact'));assert.ok(store.getRecord('deployment-task','other'));
  assert.equal((await app.inject({method:'GET',url:'/api/deployment-tasks/'+id})).statusCode,404);
 }finally{await app.close();await builds.close();store.close();}
});
