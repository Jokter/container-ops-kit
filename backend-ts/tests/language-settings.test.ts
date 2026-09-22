import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TaskStore} from '../src/platform/store.js';
import {AutomationLanguageSettings} from '../src/modules/automation/language-settings.js';
import {createApp} from '../src/app.js';
import {readConfig} from '../src/config.js';

test('Java Maven 搜索配置持久化，支持修改清除，不应用到其他语言',async()=>{
 const root=await mkdtemp(join(tmpdir(),'java-settings-')),database=join(root,'tasks.sqlite');let store=new TaskStore(database);
 try{
  let settings=new AutomationLanguageSettings(store);assert.equal(settings.get().java.mavenRepository,'');
  settings.save({java:{mavenRepository:' D:/Maven Cache/repository/ '}});
  store.close();store=new TaskStore(database);settings=new AutomationLanguageSettings(store);
  assert.equal(settings.get().java.mavenRepository,'D:\\Maven Cache\\repository');
  const prompt=settings.searchContext('Java',root);
  assert.ok(prompt.includes(JSON.stringify('D:\\Maven Cache\\repository')));assert.ok(prompt.includes(JSON.stringify(root)));
  assert.match(prompt,/禁止 find \/|sources.jar|groupId\/artifactId/);assert.equal(settings.searchContext('Python',root),'');
  settings.save({java:{mavenRepository:'/opt/maven/repo'}});assert.match(settings.searchContext('java',root),/\/opt\/maven\/repo/);
  settings.save({java:{mavenRepository:''}});assert.match(settings.searchContext('Java',root),/未配置/);assert.doesNotMatch(settings.searchContext('Java',root),/Maven Cache|\/opt\/maven\/repo/);
 }finally{store.close();await rm(root,{recursive:true,force:true});}
});

test('Java 配置 API 校验绝对目录，拒绝根目录且失败不覆盖已保存值',async t=>{
 const app=await createApp({...readConfig({}),database:':memory:',workers:1,taskTimeoutMs:5000});t.after(()=>app.close());
 const url='/api/automation/language-settings';assert.deepEqual((await app.inject(url)).json(),{java:{mavenRepository:''}});
 assert.equal((await app.inject({method:'PUT',url,payload:{java:{mavenRepository:'D:/repo'}}})).statusCode,200);
 for(const path of ['relative/repo','D:repo','/','D:/','D:/repo/..','/repo\nfind /'])assert.equal((await app.inject({method:'PUT',url,payload:{java:{mavenRepository:path}}})).statusCode,400,path);
 assert.equal((await app.inject({method:'PUT',url,payload:{}})).statusCode,400);
 assert.equal((await app.inject(url)).json().java.mavenRepository,'D:\\repo');
 assert.equal((await app.inject({method:'PUT',url,payload:{java:{mavenRepository:''}}})).statusCode,200);
});
