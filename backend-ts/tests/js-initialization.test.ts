import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {captureJsInitialization,filterJsInitialization,statusPath} from '../src/modules/autout/js-initialization.js';
import {utTestFile} from '../src/modules/autout/languages.js';

test('初始化指纹隔离配置和未改动测试，Agent 修改仍被识别，暂存不得隐藏',async t=>{
 const root=await mkdtemp(join(tmpdir(),'js-initguard-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'website/src'),{recursive:true});
 const config='website/babel.config.js',spec='website/src/demo.test.js';
 await writeFile(join(root,config),'generated configuration');await writeFile(join(root,spec),'test("a",()=>expect(value).toBe(1))');
 const status='?? '+config+'\n?? '+spec+'\n?? website/build/asset-manifest.json\n?? website/node_modules/pkg/x.js';
 const baseline=await captureJsInitialization(root,status);assert.deepEqual(Object.keys(baseline),[config,spec]);assert.equal(baseline[config]!.testContent,undefined);
 assert.equal(await filterJsInitialization(root,status,baseline),'');
 assert.equal(await filterJsInitialization(root,' M '+spec,baseline),' M '+spec,'已提交的生成测试再修改时不能被旧初始化快照隐藏');
 await assert.rejects(captureJsInitialization(root,' M '+spec),/修改了已有测试/);
 await writeFile(join(root,spec),'test("a",()=>expect(value).toBe(2))');assert.equal(await filterJsInitialization(root,status,baseline),'?? '+spec);
 assert.match(await filterJsInitialization(root,'A  '+config,baseline),/^A /);
 await writeFile(join(root,config),'agent configuration');await assert.rejects(filterJsInitialization(root,status,baseline),/非测试文件发生变化/);
 await rm(join(root,config));await assert.rejects(filterJsInitialization(root,'',baseline),/非测试文件发生变化/);
});

test('未记录的配置不能豁免，构建中的测试不能提交，初始化不能接收暂存和删除',async t=>{
 const root=await mkdtemp(join(tmpdir(),'js-initguard-'));t.after(()=>rm(root,{recursive:true,force:true}));
 assert.equal(await filterJsInitialization(root,'?? website/.env\n?? website/build/x.test.js'),'?? website/.env');
 assert.equal(await filterJsInitialization(root,' M website/build/x.test.js'),' M website/build/x.test.js');
 for(const dir of ['node_modules','build','dist','coverage'])assert.equal(utTestFile('website/'+dir+'/x.test.js','JS'),false);
 await assert.rejects(captureJsInitialization(root,'A  website/.env'),/暂存/);await assert.rejects(captureJsInitialization(root,' D website/.env'),/删除/);
 assert.equal(statusPath('?? "website/path with space.js"'),'website/path with space.js');
});
