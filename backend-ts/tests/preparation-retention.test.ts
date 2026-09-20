import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,readdir,rm,utimes,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pruneDeploymentPreparations} from '../src/modules/deployment/preparation-retention.js';

test('保留最近十个任务的 Chart，保护执行中任务并在结束后收敛',async t=>{
  const root=await mkdtemp(join(tmpdir(),'chart-retention-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const ids=Array.from({length:12},(_,i)=>`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`);
  for(const [i,id]of ids.entries()){
    const path=join(root,id);
    await mkdir(join(path,'service'),{recursive:true});
    await writeFile(join(path,'service','Chart.yaml'),'name: sample');
    await utimes(path,new Date(1000*i),new Date(1000*i));
  }
  await mkdir(join(root,'unrelated'));
  const active=new Set(ids.slice(0,11));
  await pruneDeploymentPreparations(root,active);
  assert.equal((await readdir(root)).filter(name=>ids.includes(name)).length,11);
  active.clear();
  assert.deepEqual(await pruneDeploymentPreparations(root,active),[ids[0]]);
  assert.equal((await readdir(root)).filter(name=>ids.includes(name)).length,10);
  assert.ok((await readdir(root)).includes('unrelated'));
  assert.deepEqual(await pruneDeploymentPreparations(root,active),[]);
});

test('尚未生成 Chart 时不需要创建目录',async()=>{
  const root=await mkdtemp(join(tmpdir(),'chart-retention-empty-'));
  try{assert.deepEqual(await pruneDeploymentPreparations(join(root,'missing'),new Set()),[]);}
  finally{await rm(root,{recursive:true,force:true});}
});
