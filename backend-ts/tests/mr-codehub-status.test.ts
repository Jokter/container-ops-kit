import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseMr,pendingMembers,roleMemberCompleted} from '../src/modules/autout/mr-codehub.js';

test('CodeHub string completion states are recognized only for their matching role',()=>{
 const view=parseMr(JSON.stringify({iid:1756,approval_merge_request_reviewers:[{username:'reviewer',state:'true'}],approval_merge_request_approvers:[{username:'approver',state:'approve'}]}));
 const reviewer=view.approval_merge_request_reviewers?.[0],approver=view.approval_merge_request_approvers?.[0];
 assert.equal(roleMemberCompleted(reviewer,'reviewers'),true);
 assert.equal(roleMemberCompleted(reviewer,'approvers'),false);
 assert.equal(roleMemberCompleted(approver,'approvers'),true);
 assert.equal(roleMemberCompleted(approver,'reviewers'),false);
 assert.equal(roleMemberCompleted(reviewer,'assignees'),false);
 assert.equal(roleMemberCompleted(approver,'assignees'),false);
 assert.deepEqual(pendingMembers(view,'reviewers'),[]);
 assert.deepEqual(pendingMembers(view,'approvers'),[]);
});

test('incomplete, rejected and other-person states never confirm this member completed an operation',()=>{
 for(const role of ['reviewers','approvers','assignees'] as const){
  for(const state of ['optional','required','reject','false','passed','unknown','']){
   assert.equal(roleMemberCompleted({state},role),false,`${role}: ${state}`);
  }
  assert.equal(roleMemberCompleted(undefined,role),false);
 }
 // Explicit remote state takes precedence over incompatible leftover flags.
 for(const state of ['optional','required','reject','passed']){
  assert.equal(roleMemberCompleted({state,approved:true,has_approved:true,reviewed:true},'reviewers'),false);
 }
});

test('legacy completion flags and aliases remain supported without truthy coercion',()=>{
 for(const role of ['reviewers','approvers','assignees'] as const){
  for(const completed of [{approved:true},{has_approved:true},{reviewed:true},{state:'approved'},{state:'reviewed'},{status:'reviewed'}]){
   assert.equal(roleMemberCompleted(completed,role),true);
  }
  assert.equal(roleMemberCompleted({approved:false,has_approved:false,reviewed:false,status:1},role),false);
 }
 assert.equal(roleMemberCompleted({state:' TRUE '},'reviewers'),true);
 assert.equal(roleMemberCompleted({status:' APPROVE '},'approvers'),true);
});

test('pending reminders retain optional reviewers and exclude completed or satisfied-by-others members',()=>{
 const view=parseMr(JSON.stringify({iid:1756,approval_merge_request_reviewers:[
  {username:'current-user',state:'optional'},
  {username:'someone-else',state:'true'},
  {username:'required-user',state:'required'},
  {username:'satisfied-user',state:'passed'},
  {state:'optional'}
 ],approval_merge_request_approvers:[
  {username:'approved-user',state:'approve'},
  {username:'pending-user',state:'optional'},
  {username:'other-approved-user',state:'passed'}
 ]}));
 assert.equal(roleMemberCompleted(view.approval_merge_request_reviewers?.find(p=>p.username==='current-user'),'reviewers'),false);
 assert.deepEqual(pendingMembers(view,'reviewers'),['current-user','required-user']);
 assert.deepEqual(pendingMembers(view,'approvers'),['pending-user']);
});
