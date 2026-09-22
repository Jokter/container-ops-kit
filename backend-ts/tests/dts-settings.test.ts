import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,unlinkSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TaskStore} from '../src/platform/store.js';
import {DtsSettings} from '../src/modules/autout/dts-settings.js';

test('DTS Token 加密保存，重启可解密，状态不返回密文或明文，支持替换清除',()=>{
 const root=mkdtempSync(join(tmpdir(),'dts-settings-')),db=join(root,'settings.db'),key=join(root,'secrets','dts.key');let store=new TaskStore(db);
 try{let settings=new DtsSettings(store,key);assert.deepEqual(settings.status(),{configured:false});assert.throws(()=>settings.token(),/配置 DTS Token/);
 settings.save('private-dts-token-1');assert.deepEqual(settings.status(),{configured:true});assert.equal(settings.token(),'private-dts-token-1');assert.ok(!JSON.stringify(store.getRecord('dts-settings','token')).includes('private-dts-token-1'));
 store.close();assert.ok(!readFileSync(db).includes(Buffer.from('private-dts-token-1')));store=new TaskStore(db);settings=new DtsSettings(store,key);assert.equal(settings.token(),'private-dts-token-1');settings.save('private-dts-token-2');assert.equal(settings.token(),'private-dts-token-2');settings.clear();assert.deepEqual(settings.status(),{configured:false});assert.throws(()=>settings.token(),/配置/);
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});
test('密钥缺失或密文被篡改时不返回 Token，重新保存可恢复',()=>{
 const root=mkdtempSync(join(tmpdir(),'dts-key-')),key=join(root,'key'),store=new TaskStore(':memory:');
 try{const settings=new DtsSettings(store,key);settings.save('secret');const original=readFileSync(key);unlinkSync(key);assert.throws(()=>settings.token(),/重新配置/);writeFileSync(key,original);const saved=store.getRecord<{encrypted:string;iv:string;tag:string}>('dts-settings','token')!;saved.encrypted=Buffer.from('tampered').toString('base64');store.putRecord('dts-settings','token',saved);assert.throws(()=>settings.token(),/重新配置/);settings.save('replacement');assert.equal(settings.token(),'replacement');}finally{store.close();rmSync(root,{recursive:true,force:true});}
});
