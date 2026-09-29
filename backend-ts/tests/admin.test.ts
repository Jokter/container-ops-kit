import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createApp} from '../src/app.js';
import {readConfig} from '../src/config.js';
import {readAuthConfig} from '../src/auth/session.js';
import {TaskStore} from '../src/platform/store.js';

test('admin reporting is read-only, paginated, secret-free and revocable; disabled users remain visible',async t=>{
 const root=await mkdtemp(join(tmpdir(),'ops-admin-')),authFile=join(root,'auth.json');
 const config={...readConfig({}),authFile,database:join(root,'data','tasks.sqlite'),workRoot:join(root,'work')};
 const write=(admins=['alice'],allowed=['alice','bob'])=>writeFile(authFile,JSON.stringify({defaultPassword:'test-password',allowedAccounts:allowed,adminAccounts:admins}));await write();
 const seed=new TaskStore(join(root,'data','users','bob','tasks.sqlite'));
 for(let i=0;i<3;i++)seed.putRecord('quality-job','job-'+i,{id:'job-'+i,status:'SUCCEEDED',input:{version:'R27C10'},connection:{token:'private-token'},output:'private-log'},'2026-01-01T00:00:00Z');
 seed.putRecord('welink-settings','token',{encrypted:'private-token'});seed.close();
 // A renamed migration backup must not be mistaken for a user.
 await mkdir(join(root,'data','users','bob-backup-20260101'));
 let app=await createApp(config);t.after(async()=>{await app.close();await rm(root,{recursive:true,force:true});});
 const login=async(account:string)=>{const response=await app.inject({method:'POST',url:'/api/auth/login',payload:{account,password:'test-password'}});assert.equal(response.statusCode,200,response.body);return{response,headers:{cookie:String(response.headers['set-cookie']).split(';')[0]!}};};
 const alice=await login('alice'),bob=await login('bob');assert.equal(alice.response.json().isAdmin,true);assert.equal(bob.response.json().isAdmin,false);
 assert.equal((await app.inject('/api/admin/users')).statusCode,401);
 for(const url of ['/api/admin/users','/api/admin/tasks?account=alice'])assert.equal((await app.inject({url,headers:bob.headers})).statusCode,403);
 const overview=await app.inject({url:'/api/admin/users',headers:alice.headers});assert.equal(overview.statusCode,200,overview.body);const users=overview.json().users;assert.equal(users.length,2);assert.equal(users.find((u:{account:string})=>u.account==='bob').tasks,3);assert.equal(users[0].loginCount,1);assert.ok(users[0].lastLoginAt);
 const first=await app.inject({url:'/api/admin/tasks?account=bob&pageSize=2',headers:alice.headers});assert.equal(first.statusCode,200);assert.equal(first.json().total,3);assert.equal(first.json().items.length,2);assert.doesNotMatch(first.body,/private-token|private-log|connection/);
 const second=await app.inject({url:'/api/admin/tasks?account=bob&pageSize=2&page=2',headers:alice.headers});assert.equal(second.json().items.length,1);assert.notEqual(second.json().items[0].id,first.json().items[0].id);
 assert.equal((await app.inject({url:'/api/admin/tasks?account=bob&kind=platform',headers:alice.headers})).json().total,0);
 assert.equal((await app.inject({url:'/api/admin/tasks?account=..%2Fbob',headers:alice.headers})).statusCode,400);
 assert.equal((await app.inject({url:'/api/admin/tasks?account=bob&pageSize=101',headers:alice.headers})).statusCode,400);
 assert.equal((await app.inject({method:'DELETE',url:'/api/admin/tasks?account=bob',headers:alice.headers})).statusCode,404);
 assert.deepEqual((await app.inject({url:'/api/environments',headers:alice.headers})).json(),[]);
 await write([]);assert.equal((await app.inject({url:'/api/admin/users',headers:alice.headers})).statusCode,403);assert.equal((await app.inject({url:'/api/auth/me',headers:alice.headers})).json().isAdmin,false);
 await app.close();await write(['alice'],['alice']);app=await createApp(config);const relogin=await login('alice');
 const disabled=await app.inject({url:'/api/admin/users',headers:relogin.headers});assert.equal(disabled.json().users.find((u:{account:string})=>u.account==='bob').allowed,false);assert.equal(disabled.json().users.find((u:{account:string})=>u.account==='bob').tasks,3);
 assert.equal((await app.inject({url:'/api/admin/tasks?account=bob',headers:relogin.headers})).json().total,3);
});
test('admin config remains backward compatible and requires allowlisted admins',async t=>{
 const root=await mkdtemp(join(tmpdir(),'ops-admin-config-')),path=join(root,'auth.json');t.after(()=>rm(root,{recursive:true,force:true}));
 await writeFile(path,JSON.stringify({defaultPassword:'test-password',allowedAccounts:['alice']}));assert.deepEqual(readAuthConfig(path).adminAccounts,[]);
 await writeFile(path,JSON.stringify({defaultPassword:'test-password',allowedAccounts:['alice'],adminAccounts:['bob']}));assert.throws(()=>readAuthConfig(path),/登录配置不可用/);
});
