import test from 'node:test';
import assert from 'node:assert/strict';
import {createStudio} from './helpers/studio-harness.mjs';

const buildId='21111111-1111-4111-8111-111111111111';
const deployId='31111111-1111-4111-8111-111111111111';
const now='2026-10-25T01:02:03.000Z';
const release={id:1,code:'R27C10',name:'集成验证'};
const coordinates={namespace:'team-a',group:'apps',version:'v1',resource:'deployments',name:'gateway'};
const originalYaml='apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: gateway\nspec:\n  replicas: 2\n';

async function scene(route,{storageFailure=false}={}){
  const calls=[],streams=[];
  const environment=(id,type,name)=>({id,type,name,host:`192.0.2.${id}`,sshPort:22,releaseVersion:release,version:1,workDirectory:'/srv/build',architecture:'X86_64',connectionStatus:'REACHABLE',rootPasswordConfigured:true});
  const task={id:buildId,mode:'SINGLE',environmentId:1,environmentName:'验证构建机',module:'mae-access',baseline:{cbbWebDevBranch:'main',archDesignBranch:'main',businessRepositories:[]},candidate:null,status:'RUNNING',progress:0,createdAt:now,workspaceRoot:'/srv/build/'+buildId,events:[],directories:[]};
  const deployment={id:deployId,mode:'REVIEW',artifactId:7,environmentId:2,namespace:'team-a',module:'mae-access',status:'ANALYZING',revision:1,createdAt:now,services:{gateway:null}};
  const resource={...coordinates,kind:'Deployment',category:'WORKLOAD',status:'Ready',serviceKey:'helm:gateway'};
  const editable={coordinates,resourceVersion:'42',managedByHelm:true,yaml:originalYaml};
  const types=[{group:'',version:'v1',resource:'configmaps',kind:'ConfigMap'},{group:'apps',version:'v1',resource:'statefulsets',kind:'StatefulSet'}];
  const history=[{...task,status:'SUCCEEDED',progress:100}];
  const app=await createStudio({route,beforeParse(w){
    const fallback=w.fetch;
    w.EventSource=class{
      constructor(url){this.url=String(url);this.listeners=new Map();this.closed=false;streams.push(this)}
      addEventListener(type,listener){this.listeners.set(type,listener)}
      close(){this.closed=true}
      emit(item,lastEventId=''){this.onmessage?.({data:JSON.stringify(item),lastEventId})}
    };
    w.fetch=async(input,options={})=>{
      const url=new URL(String(input),'http://localhost'),path=url.pathname,method=options.method||'GET';
      const body=typeof options.body==='string'?JSON.parse(options.body):options.body;
      const record={path,search:url.search,method,body};
      const reply=(value,status=200)=>{calls.push(record);return new Response(status===204?null:JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}})};
      if(path==='/api/release-versions')return reply([release]);
      if(path==='/api/environments')return reply([environment(1,'BUILD','验证构建机'),environment(2,'CONTAINER','验证集群')]);
      if(path==='/api/environments/2/connection-test')return reply({status:'REACHABLE',architecture:'AARCH64',version:2,latencyMs:18});
      if(path==='/api/environments/2'&&method==='DELETE')return reply({message:'模拟删除失败'},503);
      if(path==='/api/build-configuration')return reply({cbbWebDevRepository:'https://example.test/CBB-Web-Dev.git',archDesignRepository:'https://example.test/ArchDesign.git',defaultBranch:'main',buildCommand:'mvn clean install',modules:[{name:'mae-access'}]});
      if(path==='/api/build-environments/1/storage')return storageFailure?reply({message:'存储读取失败'},503):reply({path:'/srv/build',usedBytes:1024,availableBytes:2048,filesystemUsage:'33%'});
      if(path==='/api/build-tasks'&&method==='POST'){Object.assign(task,body);return reply(task)}
      if(path==='/api/build-tasks')return reply(history);
      if(path==='/api/build-tasks/'+buildId&&method==='DELETE')return reply({message:'模拟删除失败'},503);
      if(path==='/api/build-tasks/'+buildId)return reply(task);
      if(path==='/api/build-tasks/'+buildId+'/results')return reply({taskId:buildId,mode:'SINGLE',packages:[],comparison:null});
      if(path==='/api/build-artifacts')return reply([{id:7,buildTaskId:buildId,module:'mae-access',archDesignBranch:'main',environmentId:1,createdAt:now}]);
      if(path==='/api/deployment-candidates')return reply({module:'mae-access',namespaces:['team-a','team-b'],workloads:url.searchParams.has('namespace')?[{name:'gateway',kind:'DEPLOYMENT',deployable:true},{name:'worker',kind:'STATEFUL_SET',deployable:true},{name:'legacy',kind:'DEPLOYMENT',deployable:false}]:[]});
      if(path==='/api/deployment-tasks'&&method==='POST'){Object.assign(deployment,body);deployment.services=Object.fromEntries(body.services.map(name=>[name,null]));return reply(deployment)}
      if(path==='/api/deployment-tasks')return reply([{...deployment,status:'FAILED',mode:'REVIEW',serviceCount:1,canDelete:true}]);
      if(path==='/api/deployment-tasks/'+deployId)return reply(deployment);
      if(path==='/api/deployment-tasks/'+deployId+'/services/gateway/values'){deployment.services.gateway.values=body.values;deployment.revision++;return reply(deployment)}
      if(path==='/api/deployment-tasks/'+deployId+'/execution')return reply({message:'部署未执行，请人工检查'},503);
      if(path==='/api/container-resource-namespaces')return reply({namespaces:['team-a','team-b']});
      if(path==='/api/container-resource-services')return reply({services:[{key:'helm:gateway',name:'gateway',source:'HELM',resourceCount:1}],groups:[{type:'SHARED',name:'共享资源',resourceCount:0}]});
      if(path==='/api/container-service-resources')return reply({resources:url.searchParams.get('serviceKey')==='helm:gateway'?[resource]:[]});
      if(path==='/api/container-resource-types')return reply(types);
      if(path==='/api/container-resources'&&method==='GET')return reply(editable);
      if(path==='/api/container-resource-changes/preview')return reply({diff:'- replicas: 2\n+ replicas: 3',warnings:['Helm 管理资源']});
      if(path==='/api/container-resource-changes/apply')return reply({message:'resourceVersion 冲突，请重新读取'},409);
      if(path==='/api/container-resources/preview')return reply({diff:'+ kind: ConfigMap',warnings:[]});
      if(path==='/api/container-resources'&&method==='POST')return reply({created:true});
      return fallback(input,options);
    };
  }});
  const {d,w,wait}=app;
  const find=selector=>{const node=d.querySelector(selector);assert.ok(node,selector);return node};
  const click=async selector=>{find(selector).click();await wait(60)};
  const input=async(selector,value,type='input')=>{const node=find(selector);node.value=value;node.dispatchEvent(new w.Event(type,{bubbles:true}));await wait(60)};
  const repaint=async()=>{const marker=d.createElement('span');find('#ux-main').append(marker);await wait(30);marker.remove();await wait(30)};
  return {...app,calls,streams,task,deployment,find,click,input,repaint};
}

const count=(app,path,method)=>app.calls.filter(call=>call.path===path&&(!method||call.method===method));

test('正式构建布局保留表单、业务仓与 SSE，视觉刷新不重试读取或重放创建',async()=>{
 const app=await scene('container/build',{storageFailure:true});
 try{
  const {find,d,input,click,repaint,wait,calls,streams}=app;
  assert.equal(d.querySelectorAll('#single-build-form .cx-repository-pair').length,2);
  const form=find('#single-build-form'),branch=find('[name=cbbWebDevBranch]');
  await input('[name=cbbWebDevBranch]','feature/kept');await repaint();
  assert.equal(find('#single-build-form'),form);assert.equal(find('[name=cbbWebDevBranch]'),branch);
  assert.equal(branch.value,'feature/kept');assert.equal(count(app,'/api/build-environments/1/storage').length,1,'失败的只读请求不由增强层自动重试');
  await click('[data-business-add]');await input('[data-business-field=repository]','https://example.test/Business.git');await input('[data-business-field=branch]','release/v2');
  await click('[data-create-build-task=single]');
  const writes=count(app,'/api/build-tasks','POST');assert.equal(writes.length,1);assert.deepEqual(writes[0].body,{mode:'SINGLE',environmentId:1,module:'mae-access',baseline:{cbbWebDevBranch:'feature/kept',archDesignBranch:'main',businessRepositories:[{repository:'https://example.test/Business.git',branch:'release/v2'}]},candidate:null});
  const stream=streams.find(item=>item.url==='/api/build-tasks/'+buildId+'/events');assert.ok(stream);
  const log={sequence:1,type:'LOG',message:'实际构建输出',occurredAt:now,progress:30,taskStatus:'RUNNING'};stream.emit(log);stream.emit(log);await wait(180);
  assert.equal(find('#build-log-terminal').textContent.match(/实际构建输出/g)?.length,1,'SSE sequence 去重保持');
  await repaint();assert.equal(count(app,'/api/build-tasks','POST').length,1);assert.ok(calls.every(call=>call.path.startsWith('/api/')));
  await click('[data-build-tab=compare]');assert.equal(d.querySelectorAll('#compare-build-form .cx-repository-pair').length,4);
  await click('[data-build-tab=history]');assert.ok(find('[data-view-build-task]'));assert.ok(find('[data-delete-build-task]'));assert.ok(find('[data-clean-build-task]'));
  assert.deepEqual(app.errors,[]);
 }finally{app.close()}
});

test('正式部署保留服务选择、Values 与审阅确认；错误和 SSE 重绘不重放部署',async()=>{
 const app=await scene('container/deploy');
 try{
  const {find,d,w,click,input,wait,repaint,deployment,streams}=app;
  assert.equal(find('.cx-deploy-help').open,false);assert.equal(find('#deployment-namespace').disabled,true);
  await click('[data-deployment-candidates]');await input('#deployment-namespace','team-a','change');
  assert.equal(d.querySelectorAll('.deployment-service-option').length,3);assert.equal(find('[name=deploymentService][value=legacy]').disabled,true);
  find('[name=deploymentService][value=gateway]').checked=true;find('[name=deploymentService][value=gateway]').dispatchEvent(new w.Event('change',{bubbles:true}));await wait(30);
  await click('[data-create-deploy-task=REVIEW]');assert.equal(count(app,'/api/deployment-tasks','POST').length,1);assert.deepEqual(count(app,'/api/deployment-tasks','POST')[0].body,{mode:'REVIEW',artifactId:7,environmentId:2,namespace:'team-a',services:['gateway']});
  deployment.status='AWAITING_REVIEW';deployment.services.gateway={service:'gateway',stage:'ANALYZED',values:'replicas: 2\n',replaceItems:[],unresolvedImages:[],errors:[]};
  const stream=streams.find(item=>item.url==='/api/deployment-tasks/'+deployId+'/events?afterSequence=0');assert.ok(stream);
  stream.emit({stage:'ANALYZE',service:'gateway',message:'分析已完成',occurredAt:now},'7');await wait(210);
  assert.ok(find('#deployment-values'));assert.equal(w.localStorage.getItem('container-ops-kit.deployment-event-sequence.'+deployId),'7');
  await input('#deployment-values','replicas: 4\n');await repaint();assert.equal(find('#deployment-values').value,'replicas: 4\n');
  await click('[data-deployment-save-values]');assert.deepEqual(count(app,'/api/deployment-tasks/'+deployId+'/services/gateway/values','PUT')[0].body,{values:'replicas: 4\n'});
  await click('[data-deployment-action]');assert.equal(count(app,'/api/deployment-tasks/'+deployId+'/execution','POST').length,0);await click('[data-studio-cancel]');
  await click('[data-deployment-action]');await click('[data-studio-confirm]');await repaint();
  const writes=count(app,'/api/deployment-tasks/'+deployId+'/execution','POST');assert.equal(writes.length,1);assert.deepEqual(writes[0].body,{expectedRevision:2,services:['gateway']});assert.match(d.body.textContent,/部署未执行/);
  await click('[data-dh-tab=history]');assert.ok(find('[data-dh-view]'));assert.ok(find('[data-dh-delete]'));assert.equal(count(app,'/api/deployment-tasks','POST').length,1);
  assert.deepEqual(app.errors,[]);
 }finally{app.close()}
});

test('服务资源保留真实坐标、版本校验、草稿和创建流程，弹层关闭恢复焦点',async()=>{
 const app=await scene('container/operations');
 try{
  const {find,d,w,click,input,repaint,wait}=app;
  await click('[data-connect-resource-environment]');await input('#resource-namespace','team-a','change');await click('[data-load-resource-workspace]');
  const editor=find('#resource-yaml-editor');assert.equal(editor.value,originalYaml);assert.ok(editor.closest('.cx-code-surface'));
  await input('#resource-yaml-editor',originalYaml.replace('replicas: 2','replicas: 3'));await repaint();assert.equal(find('#resource-yaml-editor'),editor);assert.equal(find('.cx-code-lines').textContent.split('\n').length,editor.value.split('\n').length);
  await click('[data-cx-tree]');assert.equal(find('.cr-workbench').classList.contains('cx-tree-hidden'),true);assert.equal(find('#resource-yaml-editor'),editor);
  await click('[data-preview-resource]');assert.deepEqual(count(app,'/api/container-resource-changes/preview','POST')[0].body,{environmentId:2,coordinates,yaml:originalYaml.replace('replicas: 2','replicas: 3'),expectedResourceVersion:'42'});
  await click('[data-apply-resource]');assert.equal(count(app,'/api/container-resource-changes/apply','POST').length,0);await click('[data-studio-cancel]');
  await click('[data-apply-resource]');await click('[data-studio-confirm]');await repaint();assert.equal(count(app,'/api/container-resource-changes/apply','POST').length,1);assert.match(d.body.textContent,/resourceVersion 冲突/);
  await click('[data-resource-tab=yaml]');assert.match(find('#resource-yaml-editor').value,/replicas: 3/);
  await click('[data-cx-tree]');await click('[data-open-resource-create]');assert.equal(find('.cr-dialog').getAttribute('role'),'dialog');assert.ok(find('.cx-create-body #create-resource-yaml'));assert.equal(find('.studio-topbar').inert,true);
  await input('#create-resource-yaml','apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: gateway-extra\ndata:\n  key: value\n');await click('[data-preview-resource-create]');assert.match(find('#create-resource-yaml').value,/key: value/);assert.equal(count(app,'/api/container-resources/preview','POST')[0].body.serviceKey,'helm:gateway');
  await click('[data-create-resource]');await repaint();assert.equal(count(app,'/api/container-resources','POST').length,1);assert.equal(d.querySelector('.cr-dialog'),null);assert.equal(!!find('.studio-topbar').inert,false);
  await click('[data-open-resource-create]');find('#create-resource-yaml').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await wait(60);assert.equal(d.querySelector('.cr-dialog'),null);assert.ok(d.activeElement.hasAttribute('data-open-resource-create'));
  await click('[data-resource-service="group:shared"]');assert.equal(find('[data-open-resource-create]').disabled,true);assert.equal(find('.cr-workbench').dataset.cxPane,'resources');
  assert.deepEqual(app.errors,[]);
 }finally{app.close()}
});

test('环境管理保留账号测试、详情和删除确认，失败不自动重试',async()=>{
 const app=await scene('container/resources');
 try{
  const {find,d,click,input,repaint}=app;
  await click('[data-resource-type=container]');assert.match(find('.environment-kind-icon').textContent,/容/);
  await input('[data-test-user="db-2"]','ROOT','change');await click('[data-test-environment="db-2"]');assert.deepEqual(count(app,'/api/environments/2/connection-test','POST')[0].body,{user:'ROOT'});
  await click('[data-toggle-container-details="db-2"]');assert.ok(find('.container-detail-grid'));
  await input('[data-more-environment="db-2"]','delete','change');assert.equal(count(app,'/api/environments/2','DELETE').length,0);await click('[data-studio-cancel]');
  await input('[data-more-environment="db-2"]','delete','change');await click('[data-studio-confirm]');await repaint();assert.equal(count(app,'/api/environments/2','DELETE').length,1);assert.match(d.body.textContent,/模拟删除失败/);assert.ok(find('[data-edit-environment="db-2"]'));
  assert.deepEqual(app.errors,[]);
 }finally{app.close()}
});

test('构建历史删除及清理目录保持独立确认与原始 deleteWorkspace 参数',async()=>{
 const app=await scene('container/build');
 try{
  const {click,repaint}=app;await click('[data-build-tab=history]');
  await click('[data-delete-build-task]');assert.equal(count(app,'/api/build-tasks/'+buildId,'DELETE').length,0);await click('[data-studio-cancel]');
  await click('[data-clean-build-task]');await click('[data-studio-confirm]');await repaint();
  const writes=count(app,'/api/build-tasks/'+buildId,'DELETE');assert.equal(writes.length,1);assert.equal(writes[0].search,'?deleteWorkspace=true');
  assert.deepEqual(app.errors,[]);
 }finally{app.close()}
});
