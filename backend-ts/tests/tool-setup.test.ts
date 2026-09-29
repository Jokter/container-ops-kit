import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {initializePersonalTools,importLocalToolFiles,gitFailureHint} from '../src/auth/tool-setup.js';
import {makeWorkspace,inWorkspace,processEnvironment} from '../src/auth/workspace.js';

test('explicit personal setup preserves current files and imports neither sessions nor other users',t=>{
 const root=mkdtempSync(join(tmpdir(),'tools-import-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const source=join(root,'original'),alice=join(root,'alice'),bob=join(root,'bob');
 for(const folder of [join(source,'.ssh'),join(source,'.pi','agent','sessions'),join(alice,'.ssh'),bob])mkdirSync(folder,{recursive:true});
 writeFileSync(join(source,'.ssh','known_hosts'),'trusted-host');writeFileSync(join(source,'.ssh','id_ed25519'),'private-key');writeFileSync(join(source,'.pi','agent','auth.json'),'private-provider-auth');writeFileSync(join(source,'.pi','agent','sessions','old.jsonl'),'old-history');writeFileSync(join(alice,'.ssh','known_hosts'),'existing-trust');
 const result=importLocalToolFiles(source,alice);assert.equal(result.kept,1);assert.equal(readFileSync(join(alice,'.ssh','known_hosts'),'utf8'),'existing-trust');assert.equal(readFileSync(join(alice,'.ssh','id_ed25519'),'utf8'),'private-key');assert.equal(existsSync(join(alice,'.pi','agent','sessions')),false);assert.equal(existsSync(join(bob,'.ssh')),false);assert.equal(readFileSync(join(source,'.ssh','id_ed25519'),'utf8'),'private-key');assert.doesNotMatch(JSON.stringify(result),/private/);
 assert.equal(importLocalToolFiles(source,alice).copied,0);
});
test('personal setup rejects target symlinks and does not follow source symlinks',{skip:process.platform==='win32'},t=>{
 const root=mkdtempSync(join(tmpdir(),'tools-symlink-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const source=join(root,'source'),target=join(root,'target'),outside=join(root,'outside');for(const path of [join(source,'.ssh'),target,outside])mkdirSync(path,{recursive:true});writeFileSync(join(source,'.ssh','id_rsa'),'private');symlinkSync(outside,join(target,'.ssh'));assert.throws(()=>importLocalToolFiles(source,target),/符号链接/);assert.equal(existsSync(join(outside,'id_rsa')),false);
});
test('Git SSH explicitly uses personal trust and identity paths without lowering host checks',t=>{
 const root=mkdtempSync(join(tmpdir(),"tools space 'quote-"));t.after(()=>rmSync(root,{recursive:true,force:true}));const workspace=makeWorkspace('alice',root,join(root,'work'),'/usr1/wytest');mkdirSync(join(workspace.home,'.ssh'));writeFileSync(join(workspace.home,'.ssh','id_ed25519'),'fixture-only');
 const previous=process.env.GIT_SSH_COMMAND;process.env.GIT_SSH_COMMAND='unsafe-shared-agent';
 try{const env=inWorkspace(workspace,processEnvironment);assert.equal(env.GIT_CONFIG_GLOBAL,join(workspace.home,'.gitconfig'));assert.doesNotMatch(env.GIT_SSH_COMMAND!,/unsafe-shared-agent/);assert.match(env.GIT_SSH_COMMAND!,/StrictHostKeyChecking=yes/);assert.match(env.GIT_SSH_COMMAND!,/IdentityAgent=none/);
  if(process.platform!=='win32'&&spawnSync('ssh',['-V']).status===0){const result=spawnSync('sh',['-c',env.GIT_SSH_COMMAND+' -G example.invalid'],{env,encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/stricthostkeychecking true/);assert.ok(result.stdout.includes('identityfile '+join(workspace.home,'.ssh','id_ed25519')));assert.ok(result.stdout.includes(join(workspace.home,'.ssh','known_hosts')));}
 }finally{if(previous===undefined)delete process.env.GIT_SSH_COMMAND;else process.env.GIT_SSH_COMMAND=previous;}
});
test('Git errors distinguish changed hosts, missing trust, public-key authorization and commit identity',()=>{
 assert.match(gitFailureHint('REMOTE HOST IDENTIFICATION HAS CHANGED! Host key verification failed','/user'),/密钥发生变化/);
 assert.match(gitFailureHint('Host key verification failed','/user'),/known_hosts/);
 assert.match(gitFailureHint('Permission denied (publickey)','/user'),/公钥/);
 assert.match(gitFailureHint('Author identity unknown','/user'),/提交身份/);
 assert.equal(gitFailureHint('some other failure','/user'),'');
});

test('automatic setup initializes only the designated owner once and preserves existing files',async t=>{
 const root=mkdtempSync(join(tmpdir(),'tools-owner-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const source=join(root,'source');mkdirSync(join(source,'.ssh'),{recursive:true});
 writeFileSync(join(source,'.ssh','known_hosts'),'fixture-host');
 writeFileSync(join(source,'.gitconfig'),'[user]\nname = Fixture Owner\nemail = fixture@example.invalid\n');
 const owner=makeWorkspace('w00789509',root,join(root,'work'),'/work');
 const other=makeWorkspace('alice',root,join(root,'work'),'/work');
 assert.equal(await initializePersonalTools(other,source),false);
 assert.equal(existsSync(join(other.home,'.ssh')),false);
 assert.equal(await initializePersonalTools(owner,source),true);
 assert.equal(readFileSync(join(owner.home,'.ssh','known_hosts'),'utf8'),'fixture-host');
 assert.match(readFileSync(join(owner.home,'.gitconfig'),'utf8'),/Fixture Owner/);
 writeFileSync(join(owner.home,'.ssh','known_hosts'),'personal-trust');
 writeFileSync(join(source,'.ssh','id_rsa'),'new-fixture-key');
 assert.equal(await initializePersonalTools(owner,source),false);
 assert.equal(existsSync(join(owner.home,'.ssh','id_rsa')),false);
 assert.equal(readFileSync(join(owner.home,'.ssh','known_hosts'),'utf8'),'personal-trust');
});
