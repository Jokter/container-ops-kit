import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const html=await readFile(new URL('../../index.html',import.meta.url),'utf8');
const pause=()=>new Promise(r=>setTimeout(r,100));
test('MR roles and repository override settings can be edited and saved from the page',async()=>{
 let saved;const config={roles:{reviewers:['r123'],approvers:[],assignees:[]},repositories:[],notifications:true,autoRepair:true,contact:'',pipelineSeconds:60,reviewSeconds:300,maxRepairRounds:3,reminderMinutes:120,workHours:{weekdaysOnly:true,start:9,end:18},welinkAccounts:{}};
 const dom=new JSDOM(html,{url:'http://localhost/#/automation/settings',runScripts:'dangerously',beforeParse(w){w.scrollTo=()=>{};w.fetch=async(url,options)=>({ok:true,status:200,json:async()=>{if(url==='/api/auto-ut/mr-settings'){if(options?.method==='PUT'){saved=JSON.parse(options.body);return saved;}return structuredClone(config);}return [];}});}});
 try{await pause();const d=dom.window.document;d.querySelector('[data-qw-drawer="mr-settings"]').click();await pause();
 const reviewers=d.querySelector('[data-mr-config="roles.reviewers"]');reviewers.value='r123, r456';reviewers.dispatchEvent(new dom.window.Event('input'));
 d.querySelector('[data-mr-add]').click();const repository=d.querySelector('[data-mr-repository]');repository.value='Demo';repository.dispatchEvent(new dom.window.Event('input'));
 const override=d.querySelector('[data-mr-repo-role][data-role="approvers"]');override.value='a123';override.dispatchEvent(new dom.window.Event('input'));
 const notifications=d.querySelector('[data-mr-config="notifications"]');notifications.click();
 d.querySelector('[data-qw-save]').click();await pause();assert.deepEqual(saved.roles.reviewers,['r123','r456']);assert.deepEqual(saved.repositories,[{repository:'Demo',roles:{approvers:['a123']}}]);assert.equal(saved.notifications,false);assert.equal(d.querySelector('[role=dialog]'),null);
 }finally{await pause();dom.window.close();}
});
test('pending MR detail shows tracking controls without claiming completion',()=>{
 const dom=new JSDOM(html,{url:'http://localhost/',runScripts:'dangerously',beforeParse(w){w.scrollTo=()=>{};}});
 try{const output=dom.window.autoUtTaskDetail({id:'task',repository:'Demo',status:'MR_PENDING',nextStage:'TRACK',progress:92,message:'等待检视',pullRequestUrl:'https://example.com/merge_requests/1',mr:{iid:'1',phase:'REVIEW',paused:false,error:'',rounds:1,config:{maxRepairRounds:3}},governance:{mrState:'PENDING'}});const holder=dom.window.document.createElement('div');holder.innerHTML=output;
 assert.equal(holder.querySelector('.ut-agent-result'),null);assert.match(holder.textContent,/等待检视/);assert.ok(holder.querySelector('[data-mr-control="pause"]'));assert.ok(holder.querySelector('[data-mr-control="apply-settings"]'));assert.match(holder.querySelector('.ut-task-timeline .current').textContent,/跟踪合入/);
 }finally{dom.window.close();}
});
