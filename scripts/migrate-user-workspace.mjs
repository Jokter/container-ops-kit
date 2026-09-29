// Offline, explicit assignment of the pre-login database to one allowlisted account.
import {existsSync,copyFileSync,mkdirSync,readFileSync,chmodSync,lstatSync,readdirSync,constants} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {readConfig} from '../dist/backend-ts/src/config.js';
import {readAuthConfig,accountSchema} from '../dist/backend-ts/src/auth/session.js';
import {TaskStore} from '../dist/backend-ts/src/platform/store.js';

function copyMissing(source,target){
 if(!existsSync(source))return;
 const info=lstatSync(source);if(info.isSymbolicLink())return;
 if(existsSync(target)&&lstatSync(target).isSymbolicLink())throw Error('迁移目标不能为符号链接');
 if(info.isDirectory()){mkdirSync(target,{recursive:true,mode:0o700});for(const name of readdirSync(source))copyMissing(join(source,name),join(target,name));}
 else if(info.isFile()&&!existsSync(target)){mkdirSync(dirname(target),{recursive:true,mode:0o700});copyFileSync(source,target,constants.COPYFILE_EXCL);chmodSync(target,0o600);}
}
function migrate(){
 const account=accountSchema.parse(process.argv[2]??'w00789509'),config=readConfig();
 if(!readAuthConfig(config.authFile).allowedAccounts.includes(account))throw Error('迁移目标必须先加入 auth-config.json 白名单');
 if(!existsSync(config.database))throw Error('旧数据库不存在，请检查 PLATFORM_DATA_DIR 或将原 data/platform 目录放回项目根目录');
 const root=join(dirname(config.database),'users',account),target=join(root,'tasks.sqlite');
 const store=new TaskStore(target);
 const copyHistory=()=>{
  copyMissing(resolve(process.env.PLATFORM_LOG_DIR?.trim()||'data/logs'),join(root,'logs'));
  copyMissing(join(dirname(config.database),'pi-sessions'),join(root,'pi-sessions'));
 };
 try{
  const db=store.db;
  // Lock both databases before reading or copying anything. An active backend must refuse migration.
  db.prepare('ATTACH DATABASE ? AS legacy').run(config.database);
  db.exec('PRAGMA legacy.busy_timeout=100; PRAGMA legacy.locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE; COMMIT;');
  const previous=store.getRecord('user-data-migration','legacy');
  if(previous){if(previous.account!==account||previous.source!==config.database)throw Error('目标账号已有不同来源的迁移记录，拒绝覆盖');copyHistory();console.log('该账号已迁移过，历史数据库不重复导入；已补齐缺失的历史日志。');return;}
  // A first login creates these two housekeeping records without any user data.
  const occupied=Number(db.prepare(`SELECT (SELECT count(*) FROM environments)+(SELECT count(*) FROM tasks)+
    (SELECT count(*) FROM domain_records WHERE NOT ((domain='automation-migration' AND id='v1') OR (domain='group-mr-monitor' AND id='main'))) AS n`).get().n);
  if(occupied)throw Error('目标用户已有实际配置或任务，拒绝覆盖。请保留现有数据库并先核对数据，不能直接删除后重试');
  const keys=[];
  for(const name of ['welink','codehub','dts']){
   const secret=db.prepare("SELECT payload FROM legacy.domain_records WHERE domain=? AND id='token'").get(name+'-settings');
   if(secret){const from=join(homedir(),'.container-ops-kit',name+'.key'),to=join(root,'home','.container-ops-kit',name+'.key');if(!existsSync(from))throw Error('旧凭据密钥不存在，请在原来运行项目的系统用户下执行或先恢复密钥');if(existsSync(to)&&!readFileSync(from).equals(readFileSync(to)))throw Error('目标密钥与旧密钥不一致，拒绝覆盖');keys.push({from,to,name});}
  }
  const backupDirectory=join(dirname(config.database),'migration-backups',new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID());
  mkdirSync(backupDirectory,{recursive:true,mode:0o700});
  db.prepare('VACUUM legacy INTO ?').run(join(backupDirectory,'tasks.sqlite'));
  for(const key of keys)copyMissing(key.from,join(backupDirectory,'keys',key.name+'.key'));
  db.exec('BEGIN IMMEDIATE;');
  try{
   db.exec('DELETE FROM domain_records; DELETE FROM release_versions; INSERT INTO release_versions SELECT * FROM legacy.release_versions; INSERT INTO environments SELECT * FROM legacy.environments; INSERT INTO tasks SELECT * FROM legacy.tasks; INSERT INTO events SELECT * FROM legacy.events; INSERT INTO domain_records SELECT * FROM legacy.domain_records;');
   const rows=db.prepare('SELECT domain,id,payload FROM domain_records').all();
   for(const row of rows){const value=JSON.parse(String(row.payload));
    if(row.domain==='group-mr-config'){value.enabled=false;value.authorizedSender=account;}
    if(row.domain==='auto-ut-report-config'){value.config.username=account;value.config.workspaceRoot=join(config.workRoot,account);value.config.schedule.enabled=false;value.nextRunAt=null;}
    if(row.domain==='automation-schedule'){value.enabled=false;value.nextRunAt=null;}
    if(row.domain==='auto-ut-mr-settings')value.contact=account;
    if(row.domain==='auto-ut-task'&&value.mr){value.mr.paused=true;value.mr.error='用户迁移后请重新核对工作目录和外部授权，再继续任务';}
    db.prepare('UPDATE domain_records SET payload=? WHERE domain=? AND id=?').run(JSON.stringify(value),String(row.domain),String(row.id));
   }
   // Archive the old CSV scheduler without allowing it to auto-run on startup.
   db.exec("UPDATE domain_records SET domain='legacy-auto-ut-schedule' WHERE domain='auto-ut-schedule';");
   for(const key of keys)copyMissing(key.from,key.to);
   copyHistory();
   const counts={environments:Number(db.prepare('SELECT count(*) AS n FROM environments').get().n),tasks:Number(db.prepare('SELECT count(*) AS n FROM tasks').get().n),records:rows.length};
   store.putRecord('user-data-migration','legacy',{account,source:config.database,at:new Date().toISOString(),backupDirectory,counts});
   db.exec('COMMIT;');
   console.log(`迁移完成：${counts.environments} 个环境、${counts.tasks} 个平台任务、${counts.records} 条业务记录。`);
   console.log(`备份目录：${backupDirectory}`);
  }catch(error){db.exec('ROLLBACK');throw error;}
  console.log('原数据库保留。定时计划、群监听和 MR 自动跟进已暂停，请检查个人配置后手动开启。旧代码工作目录及 CLI 登录缓存不自动迁移。');
 }finally{store.close();}
}
try{migrate();}catch(error){console.error(error?.code==='ERR_SQLITE_ERROR'&&/locked|busy/i.test(error.message)?'数据库正在使用，请先关闭 Ops Studio 后端再运行迁移脚本。':error instanceof Error?error.message:'迁移失败');process.exitCode=1;}
