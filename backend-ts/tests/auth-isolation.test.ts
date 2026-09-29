import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,symlink,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createApp} from '../src/app.js';
import {readConfig} from '../src/config.js';
import {inWorkspace,makeWorkspace,workspacePath,processEnvironment} from '../src/auth/workspace.js';

async function fixture(t:test.TestContext){
 const root=await mkdtemp(join(tmpdir(),'ops-auth-')),authFile=join(root,'auth.json');
 const write=async(accounts=['alice','bob'],password='test-password')=>writeFile(authFile,JSON.stringify({defaultPassword:password,allowedAccounts:accounts}));await write();
 const config={...readConfig({}),authFile,database:join(root,'data','tasks.sqlite'),workRoot:join(root,'work')};
 const app=await createApp(config);t.after(async()=>{await app.close();await rm(root,{recursive:true,force:true});});
 const login=async(account:string,password='test-password')=>app.inject({method:'POST',url:'/api/auth/login',payload:{account,password}});
 const a=await login('alice'),b=await login('bob');assert.equal(a.statusCode,200,a.body);assert.equal(b.statusCode,200,b.body);
 const cookie=(value:typeof a)=>String(value.headers['set-cookie']).split(';')[0]!;
 return{app,root,config,write,login,alice:cookie(a),bob:cookie(b)};
}
test('login gate, whitelist, cookie session, stale account, CSRF and logout',async t=>{
 const f=await fixture(t);
 assert.equal((await f.app.inject('/api/environments')).statusCode,401);
 assert.equal((await f.login('mallory')).statusCode,401);assert.equal((await f.login('alice','wrong')).statusCode,401);
 assert.equal((await f.login('../alice')).statusCode,400);
 const me=await f.app.inject({url:'/api/auth/me',headers:{cookie:f.alice}});assert.equal(me.json().account,'alice');
 assert.equal((await f.app.inject({url:'/api/environments',headers:{cookie:f.bob,'x-ops-account':'alice'}})).statusCode,401);
 assert.equal((await f.app.inject({method:'POST',url:'/api/auth/logout',headers:{cookie:f.alice,origin:'https://attacker.example'}})).statusCode,403);
 await f.app.inject({method:'POST',url:'/api/auth/logout',headers:{cookie:f.alice}});
 assert.equal((await f.app.inject({url:'/api/auth/me',headers:{cookie:f.alice}})).statusCode,401);
 assert.equal((await f.app.inject({url:'/api/auth/me',headers:{cookie:f.bob}})).statusCode,200);
});
test('independent environment IDs, settings, tokens, default identity and local path boundary',async t=>{
 const {app,alice,bob,root}=await fixture(t);
 const payload={releaseVersionId:1,type:'BUILD',name:'Alice private',host:'127.0.0.1',sshPort:22,password:'private-test-secret'};
 const created=await app.inject({method:'POST',url:'/api/environments',headers:{cookie:alice},payload});assert.equal(created.statusCode,201,created.body);
 assert.equal(created.json().workDirectory,'/usr1/wytest/alice');
 assert.deepEqual((await app.inject({url:'/api/environments',headers:{cookie:bob}})).json(),[]);
 assert.equal((await app.inject({url:'/api/environments/1',headers:{cookie:bob}})).statusCode,404);
 assert.equal((await app.inject({method:'DELETE',url:'/api/environments/1',headers:{cookie:bob}})).statusCode,404);
 await app.inject({method:'PUT',url:'/api/automation/codehub-settings',headers:{cookie:alice},payload:{token:'alice-private-token'}});
 assert.equal((await app.inject({url:'/api/automation/codehub-settings',headers:{cookie:bob}})).json().configured,false);
 const report=(await app.inject({url:'/api/auto-ut/report-settings',headers:{cookie:alice}})).json();assert.equal(report.config.username,'alice');assert.equal(report.config.workspaceRoot,join(root,'work','alice'));
 const group=await app.inject({method:'PUT',url:'/api/automation/group-mr/config',headers:{cookie:alice},payload:{enabled:false,groupId:'123456',authorizedSender:'bob',repositoryPrefix:'MAE-M/Access/',intervalSeconds:10}});assert.equal(group.statusCode,200,group.body);assert.equal(group.json().authorizedSender,'alice');
 const outside=await app.inject({method:'POST',url:'/api/platform/tasks',headers:{cookie:alice},payload:{kind:'workspace-inspect',path:join(root,'work','bob')}});
 assert.equal(outside.statusCode,403,outside.body);
});
test('configuration changes revoke removed accounts and password sessions; malformed file fails closed',async t=>{
 const f=await fixture(t);await f.write(['bob']);assert.equal((await f.app.inject({url:'/api/environments',headers:{cookie:f.alice}})).statusCode,401);
 await f.write(['bob'],'changed');assert.equal((await f.app.inject({url:'/api/auth/me',headers:{cookie:f.bob}})).statusCode,401);
 await writeFile(f.config.authFile,'invalid');assert.equal((await f.app.inject({url:'/api/environments',headers:{cookie:f.bob}})).statusCode,503);
});
test('async workspace context and CLI homes do not cross concurrent accounts or symlinks',async t=>{
 const root=await mkdtemp(join(tmpdir(),'ops-context-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const a=makeWorkspace('alice',root,join(root,'work'),'/usr1/wytest'),b=makeWorkspace('bob',root,join(root,'work'),'/usr1/wytest');
 const values=await Promise.all([a,b].map(w=>inWorkspace(w,async()=>{await new Promise(resolve=>setImmediate(resolve));return processEnvironment();})));
 assert.equal(values[0]?.HOME,a.home);assert.equal(values[1]?.USERPROFILE,b.home);assert.notEqual(values[0]?.PI_CODING_AGENT_DIR,values[1]?.PI_CODING_AGENT_DIR);
 await mkdir(join(b.workRoot,'secret'));await symlink(b.workRoot,join(a.workRoot,'escape'),'dir');
 inWorkspace(a,()=>{assert.throws(()=>workspacePath(join(a.workRoot,'escape','secret')));assert.throws(()=>workspacePath(join(a.workRoot,'..','bob')));assert.equal(workspacePath(join(a.workRoot,'new')),join(a.workRoot,'new'));});
});
test('authenticated gateway preserves multipart, task ownership and durable SSE',async t=>{
 const {app,alice,bob,root}=await fixture(t);
 const boundary='ops-test-boundary',field=(name:string,value:string)=>`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
 const payload=field('username','bob')+field('ticket','DTS123')+field('baseBranch','main')+`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="report.csv"\r\nContent-Type: text/csv\r\n\r\n代码仓,语言,PL组,失败用例,行覆盖率,行覆盖率目标,分支覆盖率,分支覆盖率目标\n${'x'.repeat(20000)},Other,Other,0,1,1,1,1\n\r\n--${boundary}--\r\n`;
 const scan=await app.inject({method:'POST',url:'/api/auto-ut/scan',headers:{cookie:alice,'content-type':`multipart/form-data; boundary=${boundary}`},payload});assert.equal(scan.statusCode,200,scan.body);
 const created=await app.inject({method:'POST',url:'/api/platform/tasks',headers:{cookie:alice},payload:{kind:'workspace-inspect',path:join(root,'work','alice')}});assert.equal(created.statusCode,202,created.body);const id=created.json().id;
 for(const url of [`/api/platform/tasks/${id}`,`/api/platform/tasks/${id}/events`])assert.equal((await app.inject({url,headers:{cookie:bob}})).statusCode,404);
 const events=await app.inject({url:`/api/platform/tasks/${id}/events`,headers:{cookie:alice}});assert.equal(events.statusCode,200,events.body);assert.match(String(events.headers['content-type']),/text\/event-stream/);assert.match(events.body,/SUCCEEDED/);
});
test('per-user settings persist across restart while sessions expire',async t=>{
 const f=await fixture(t);await f.app.inject({method:'PUT',url:'/api/automation/codehub-settings',headers:{cookie:f.alice},payload:{token:'alice-token'}});await f.app.close();
 const restarted=await createApp(f.config);
 try{assert.equal((await restarted.inject({url:'/api/auth/me',headers:{cookie:f.alice}})).statusCode,401);const login=await restarted.inject({method:'POST',url:'/api/auth/login',payload:{account:'alice',password:'test-password'}});const cookie=String(login.headers['set-cookie']).split(';')[0]!;assert.equal((await restarted.inject({url:'/api/automation/codehub-settings',headers:{cookie}})).json().configured,true);}finally{await restarted.close();}
});

test('migrated UT history outside user work root allows startup and login but not filesystem access',async t=>{
 const {TaskStore}=await import('../src/platform/store.js');
 const root=await mkdtemp(join(tmpdir(),'ops-migrated-startup-')),authFile=join(root,'auth.json');
 await writeFile(authFile,JSON.stringify({defaultPassword:'test-password',allowedAccounts:['w00789509']}));
 const config={...readConfig({}),authFile,database:join(root,'data','tasks.sqlite'),workRoot:join(root,'work')};
 const oldRoot=join(root,'legacy-work'),oldPath=join(oldRoot,'R27C10','demo');await mkdir(oldPath,{recursive:true});
 const store=new TaskStore(join(root,'data','users','w00789509','tasks.sqlite'));
 const now=new Date().toISOString();
 store.putRecord('auto-ut-task','11111111-1111-4111-8111-111111111111',{id:'11111111-1111-4111-8111-111111111111',repository:'Demo',reportVersion:'R27C10',username:'w00789509',ticket:'DTS1',baseBranch:'main',repairBranch:'repair',reportedFailedTests:1,lineGoal:.8,branchGoal:.7,workspaceRoot:oldRoot,workspacePath:oldPath,executionMode:'MANUAL',status:'RESOLVED',nextStage:'DONE',progress:100,attempts:1,message:'历史任务',pullRequestUrl:'',createdAt:now,updatedAt:now,history:[],liveEvents:[],liveSequence:0});store.close();
 const app=await createApp(config);t.after(async()=>{await app.close();await rm(root,{recursive:true,force:true});});
 const login=await app.inject({method:'POST',url:'/api/auth/login',payload:{account:'w00789509',password:'test-password'}});assert.equal(login.statusCode,200,login.body);
 const headers={cookie:String(login.headers['set-cookie']).split(';')[0]!};
 const list=await app.inject({url:'/api/auto-ut/tasks',headers});assert.equal(list.statusCode,200,list.body);assert.equal(list.json()[0].workspacePath,oldPath);
 const detail=await app.inject({url:'/api/auto-ut/tasks/11111111-1111-4111-8111-111111111111',headers});assert.equal(detail.statusCode,200,detail.body);
 const deletion=await app.inject({method:'DELETE',url:'/api/auto-ut/tasks/11111111-1111-4111-8111-111111111111',headers});assert.equal(deletion.statusCode,403,deletion.body);
 const {stat}=await import('node:fs/promises');assert.ok((await stat(oldPath)).isDirectory());
 const after=await app.inject({url:'/api/auto-ut/tasks',headers});assert.equal(after.json().length,1);
});

test('public login config reveals only the shared password and follows configuration updates',async t=>{
 const f=await fixture(t);
 const initial=await f.app.inject('/api/auth/login-config');assert.equal(initial.statusCode,200);assert.equal(initial.headers['cache-control'],'no-store');assert.deepEqual(initial.json(),{defaultPassword:'test-password'});
 await f.write(['alice'],'updated-public-password');const updated=await f.app.inject('/api/auth/login-config');assert.deepEqual(updated.json(),{defaultPassword:'updated-public-password'});
 assert.equal((await f.login('mallory',updated.json().defaultPassword)).statusCode,401);
 assert.equal((await f.login('alice',updated.json().defaultPassword)).statusCode,200);
 await writeFile(f.config.authFile,'invalid');assert.equal((await f.app.inject('/api/auth/login-config')).statusCode,503);
});
