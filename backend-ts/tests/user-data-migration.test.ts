import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {TaskStore} from '../src/platform/store.js';
import {WelinkSettings} from '../src/modules/autout/welink-settings.js';

function fixture(t:test.TestContext){
 const root=mkdtempSync(join(tmpdir(),'ops-migrate-')),data=join(root,'data'),home=join(root,'home'),logs=join(root,'logs');mkdirSync(home);mkdirSync(logs);const auth=join(root,'auth.json');writeFileSync(auth,JSON.stringify({defaultPassword:'test-password',allowedAccounts:['w00789509']}));
 const env={...process.env,HOME:home,USERPROFILE:home,PLATFORM_AUTH_FILE:auth,PLATFORM_DATA_DIR:data,PLATFORM_LOG_DIR:logs,PLATFORM_WORK_ROOT:join(root,'work')};
 const source=join(data,'tasks.sqlite'),target=join(data,'users','w00789509','tasks.sqlite');
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const run=()=>spawnSync(process.execPath,['scripts/migrate-user-workspace.mjs'],{env,encoding:'utf8',timeout:10000});
 return{data,home,logs,source,target,run};
}
test('legacy migration backs up and preserves records, keys and logs after first login; repeat is idempotent',t=>{
 const f=fixture(t),source=new TaskStore(f.source);
 source.putRecord('group-mr-config','main',{enabled:true,authorizedSender:'old'});
 source.putRecord('auto-ut-task','historical',{username:'w00789509',history:[{message:'old result'}],mr:{paused:false}});
 source.putRecord('automation-schedule','daily',{enabled:true,nextRunAt:'2099-01-01'});
 source.putRecord('auto-ut-schedule','daily',{report:'saved-csv'});
 const key=join(f.home,'.container-ops-kit','welink.key');new WelinkSettings(source,key).save('private-test-token');source.close();
 const initial=new TaskStore(f.target);initial.putRecord('automation-migration','v1',{});initial.putRecord('group-mr-monitor','main',{state:'waiting'});initial.close();
 writeFileSync(join(f.logs,'old.jsonl'),'history');mkdirSync(join(f.data,'pi-sessions'));writeFileSync(join(f.data,'pi-sessions','old.jsonl'),'session');
 const result=f.run();assert.equal(result.status,0,result.stderr+result.stdout);assert.doesNotMatch(result.stdout+result.stderr,/private-test-token/);
 const target=new TaskStore(f.target);
 assert.deepEqual(target.getRecord('group-mr-config','main'),{enabled:false,authorizedSender:'w00789509'});
 assert.equal(target.getRecord<{mr:{paused:boolean}}>('auto-ut-task','historical')?.mr.paused,true);
 assert.equal(target.getRecord<{enabled:boolean}>('automation-schedule','daily')?.enabled,false);
 assert.deepEqual(target.getRecord('legacy-auto-ut-schedule','daily'),{report:'saved-csv'});
 assert.equal(target.getRecord('auto-ut-schedule','daily'),undefined);
 assert.equal(new WelinkSettings(target,join(f.data,'users','w00789509','home','.container-ops-kit','welink.key')).token(),'private-test-token');
 target.close();
 assert.equal(readFileSync(join(f.data,'users','w00789509','logs','old.jsonl'),'utf8'),'history');
 assert.equal(readFileSync(join(f.data,'users','w00789509','pi-sessions','old.jsonl'),'utf8'),'session');
 const folders=readdirSync(join(f.data,'migration-backups'));assert.equal(folders.length,1);
 const backup=new TaskStore(join(f.data,'migration-backups',folders[0]!,'tasks.sqlite'));assert.equal(backup.getRecord<{enabled:boolean}>('group-mr-config','main')?.enabled,true);backup.close();
 const original=new TaskStore(f.source);assert.equal(original.getRecord<{enabled:boolean}>('group-mr-config','main')?.enabled,true);original.close();
 const repeat=f.run();assert.equal(repeat.status,0,repeat.stderr);assert.match(repeat.stdout,/已迁移过/);assert.equal(readdirSync(join(f.data,'migration-backups')).length,1);
});
test('migration refuses actual user data without overwriting it',t=>{
 const f=fixture(t),source=new TaskStore(f.source);source.putRecord('settings','main',{old:true});source.close();
 const target=new TaskStore(f.target);target.putRecord('settings','main',{current:true});target.close();
 const result=f.run();assert.notEqual(result.status,0);assert.match(result.stderr,/已有实际配置或任务/);
 const verify=new TaskStore(f.target);assert.deepEqual(verify.getRecord('settings','main'),{current:true});verify.close();assert.equal(existsSync(join(f.data,'migration-backups')),false);
});
test('migration refuses a running backend before making backups or importing records',t=>{
 const f=fixture(t),source=new TaskStore(f.source);source.putRecord('settings','main',{old:true});
 try{const result=f.run();assert.notEqual(result.status,0);assert.match(result.stderr,/先关闭 Ops Studio 后端/);assert.equal(existsSync(join(f.data,'migration-backups')),false);}finally{source.close();}
});
