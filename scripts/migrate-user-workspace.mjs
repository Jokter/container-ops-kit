// Offline, explicit assignment of the pre-login database to one allowlisted account.
import {existsSync,copyFileSync,mkdirSync,readFileSync,chmodSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {homedir} from 'node:os';
import {readConfig} from '../dist/backend-ts/src/config.js';
import {readAuthConfig,accountSchema} from '../dist/backend-ts/src/auth/session.js';
import {TaskStore} from '../dist/backend-ts/src/platform/store.js';
const account=accountSchema.parse(process.argv[2]),config=readConfig();
if(!readAuthConfig(config.authFile).allowedAccounts.includes(account))throw Error('迁移目标必须先加入白名单');
if(!existsSync(config.database))throw Error('旧数据库不存在');
const root=join(dirname(config.database),'users',account),target=join(root,'tasks.sqlite');
const store=new TaskStore(target);
try{
 const db=store.db;
 if(Number(db.prepare('SELECT (SELECT count(*) FROM environments)+(SELECT count(*) FROM domain_records)+(SELECT count(*) FROM tasks) AS n').get().n))throw Error('目标用户已有数据，拒绝覆盖');
 db.prepare('ATTACH DATABASE ? AS legacy').run(config.database);
 db.exec('PRAGMA legacy.busy_timeout=100; PRAGMA legacy.locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE;');
 try{
  for(const name of ['welink','codehub','dts']){
   const secret=db.prepare("SELECT payload FROM legacy.domain_records WHERE domain=? AND id='token'").get(name+'-settings');
   if(secret){const from=join(homedir(),'.container-ops-kit',name+'.key'),to=join(root,'home','.container-ops-kit',name+'.key');if(!existsSync(from))throw Error('旧凭据密钥不存在，请先恢复密钥');mkdirSync(dirname(to),{recursive:true,mode:0o700});if(existsSync(to)&&!readFileSync(from).equals(readFileSync(to)))throw Error('目标密钥与旧密钥不一致，拒绝覆盖');if(!existsSync(to)){copyFileSync(from,to);chmodSync(to,0o600);}}
  }
  db.exec('DELETE FROM release_versions; INSERT INTO release_versions SELECT * FROM legacy.release_versions; INSERT INTO environments SELECT * FROM legacy.environments; INSERT INTO tasks SELECT * FROM legacy.tasks; INSERT INTO events SELECT * FROM legacy.events; INSERT INTO domain_records SELECT * FROM legacy.domain_records;');
  const rows=db.prepare('SELECT domain,id,payload FROM domain_records').all();
  for(const row of rows){const value=JSON.parse(String(row.payload));
   if(row.domain==='group-mr-config'){value.enabled=false;value.authorizedSender=account;}
   if(row.domain==='auto-ut-report-config'){value.config.username=account;value.config.workspaceRoot=join(config.workRoot,account);value.config.schedule.enabled=false;value.nextRunAt=null;}
   if(row.domain==='automation-schedule'){value.enabled=false;value.nextRunAt=null;}
   if(row.domain==='auto-ut-mr-settings')value.contact=account;
   if(row.domain==='auto-ut-task'&&value.mr){value.mr.paused=true;value.mr.error='用户迁移后请重新核对工作目录和外部授权，再继续任务';}
   db.prepare('UPDATE domain_records SET payload=? WHERE domain=? AND id=?').run(JSON.stringify(value),String(row.domain),String(row.id));
  }
  db.exec("DELETE FROM domain_records WHERE domain='auto-ut-schedule'; COMMIT;");
 }catch(error){db.exec('ROLLBACK');throw error;}
 console.log('旧数据已分配给指定账号；原数据库保留。定时计划与群监听已暂停，请检查配置后手动开启。');
}finally{store.close();}
