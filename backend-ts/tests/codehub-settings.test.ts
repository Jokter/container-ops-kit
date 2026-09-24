import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {TaskStore} from '../src/platform/store.js';
import {CodehubSettings} from '../src/modules/autout/codehub-settings.js';

test('CodeHub token is encrypted, survives restart, can be replaced and cleared independently',()=>{
 const root=mkdtempSync(join(tmpdir(),'codehub-settings-')),db=join(root,'db'),key=join(root,'key');let store=new TaskStore(db);
 try{let settings=new CodehubSettings(store,key);settings.save('private-codehub-token');assert.deepEqual(settings.status(),{configured:true});assert.doesNotMatch(JSON.stringify(store.getRecord('codehub-settings','token')),/private-codehub-token/);store.close();assert.equal(readFileSync(db).includes(Buffer.from('private-codehub-token')),false);store=new TaskStore(db);settings=new CodehubSettings(store,key);assert.equal(settings.token(),'private-codehub-token');settings.save('replacement');assert.equal(settings.token(),'replacement');store.putRecord('welink-settings','token',{sentinel:'keep'});settings.clear();assert.deepEqual(settings.status(),{configured:false});assert.throws(()=>settings.token(),/配置 CodeHub Token/);assert.deepEqual(store.getRecord('welink-settings','token'),{sentinel:'keep'});}
 finally{store.close();rmSync(root,{recursive:true,force:true});}
});
