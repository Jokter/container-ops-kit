import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {TaskStore} from '../src/platform/store.js';
import {GroupMrService,type Entry} from '../src/modules/automation/group-mr.js';
import {effectivenessRoutes} from '../src/modules/automation/effectiveness.js';
test('metrics deduplicate retries and UT archive, keep empty samples null, and include a whole repeated stage',async()=>{
 const store=new TaskStore(':memory:'),service=new GroupMrService(store),app=Fastify();effectivenessRoutes(app,store,service);
 try{let response=await app.inject('/api/automation/effectiveness?days=30');assert.equal(response.json().waitMedianMs,null);assert.equal(response.json().total,0);
 const now=new Date().toISOString(),start=new Date(Date.now()-60000).toISOString(),middle=new Date(Date.now()-30000).toISOString();
 const row:Entry={id:'old',repo:'Demo',iid:'1',url:'',sha:'a'.repeat(40),previousSha:'',messageId:'',sender:'',shortcut:false,phase:'FAILED',status:'',detail:'',createdAt:start,updatedAt:start,writePending:'',events:[{time:start,phase:'PI',message:''},{time:middle,phase:'PI',message:''},{time:now,phase:'FAILED',message:''}]};
 store.putRecord('group-mr-entry','old',row);store.putRecord('group-mr-entry','new',{...row,id:'new',phase:'DONE',createdAt:now,updatedAt:now,events:[]});
 for(const domain of ['auto-ut-task','auto-ut-governance'])store.putRecord(domain,'ut1',{id:'ut1',createdAt:now});
 response=await app.inject('/api/automation/effectiveness?days=30');const metrics=response.json();assert.equal(metrics.total,1);assert.equal(metrics.merged,1);assert.equal(metrics.anomalies,1);assert.equal(metrics.tasks,2);assert.equal(metrics.stages.PI,60000);assert.equal(metrics.aiConfirmedRate,null);
 }finally{await app.close();await service.close();store.close();}
});
