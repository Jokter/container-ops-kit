import test from 'node:test';
import assert from 'node:assert/strict';
import {RepairQueue} from '../src/modules/autout/repair-queue.js';
import {buildFailure} from '../src/modules/autout/pipeline-rebuild.js';
test('两个修复名额，释放后按顺序启动，取消排队不会占名额',async()=>{
 const queue=new RepairQueue(),signal=new AbortController().signal;
 const a=await queue.acquire(signal),b=await queue.acquire(signal),order:string[]=[];
 const cancel=new AbortController();const c=queue.acquire(cancel.signal);const rejected=assert.rejects(c);cancel.abort();await rejected;
 const d=queue.acquire(signal).then(release=>{order.push('d');return release;});
 const e=queue.acquire(signal).then(release=>{order.push('e');return release;});
 await Promise.resolve();assert.deepEqual(order,[]);
 a();const releaseD=await d;assert.deepEqual(order,['d']);a();await Promise.resolve();assert.deepEqual(order,['d']);
 b();const releaseE=await e;assert.deepEqual(order,['d','e']);releaseD();releaseE();
});
test('只有实际超标的构建指标触发重跑，测试和权限证据优先',()=>{
 const metric={field_url:'https://example.invalid/?indicatorType=build2.0_build',value:1};
 assert.equal(buildFailure([{failures:[{metrics:[metric]}]}]),true);
 assert.equal(buildFailure([{failures:[{metrics:[{...metric,value:0}]}]}]),false);
 assert.equal(buildFailure([{message:'BUILD FAILURE compilation failed'}]),false);
 assert.equal(buildFailure([{metrics:[metric],message:'AssertionError'}]),false);
 assert.equal(buildFailure([{metrics:[metric],message:'permission denied'}]),false);
});
