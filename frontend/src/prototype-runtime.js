(function(){
 const statusMap={UNTESTED:'untested',REACHABLE:'online',FAILED:'error'}
 const typeMap={BUILD:'build',CONTAINER:'container'}

 async function request(url,options){
  const response=await fetch(url,Object.assign({headers:{'Content-Type':'application/json'}},options||{}))
  if(!response.ok){const body=await response.json().catch(()=>({message:'请求失败'}));throw new Error(body.message||'请求失败')}
  return response.status===204?null:response.json()
 }

 function mapEnvironment(item){
  return {
   id:'db-'+item.id,_apiId:item.id,_version:item.version,type:typeMap[item.type],version:'dbv-'+item.releaseVersion.id,
   name:item.name,ip:item.host,port:String(item.sshPort),user:item.type==='BUILD'?'huawei':'sopuser',password:item.password,
   workdir:item.workDirectory||'',architecture:(item.architecture||'').toLowerCase(),mae:item.mae||'',maeUser:item.maeUser||'',maePassword:item.maePassword||'',
   osmu:item.osmu||'',osmuUser:item.osmuUser||'',osmuPassword:item.osmuPassword||'',sshPasswordConfigured:Boolean(item.password),
   maePasswordConfigured:Boolean(item.maePassword),osmuPasswordConfigured:Boolean(item.osmuPassword),status:statusMap[item.connectionStatus],
   lastTest:item.lastTestedAt?new Date(item.lastTestedAt).toLocaleString('zh-CN'):'尚未测试',
   latency:item.lastTestLatencyMs!=null?item.lastTestLatencyMs+' ms':item.lastTestError||'—',outcome:statusMap[item.connectionStatus],history:[]
  }
 }

 async function loadResources(){
  try{
   const result=await Promise.all([request('/api/release-versions'),request('/api/environments')])
   releaseVersions.splice(0,releaseVersions.length,...result[0].map(item=>({id:'dbv-'+item.id,_apiId:item.id,code:item.code,name:item.name,locked:false})))
   environments.splice(0,environments.length,...result[1].map(mapEnvironment))
   if(releaseVersions.length&&!releaseVersions.some(item=>item.id===state.resourceVersion))state.resourceVersion=releaseVersions[0].id
   render(false)
  }catch(error){
   releaseVersions.splice(0,releaseVersions.length)
   environments.splice(0,environments.length)
   state.resourceVersion=''
   render(false)
   showToast((error.message||'资源中心加载失败')+'，请确认后端已启动')
  }
 }

 testEnvironment=async function(id){
  const environment=environments.find(item=>item.id===id)
  if(!environment||environment._apiId==null||testTokens.has(id)){showToast('环境数据尚未从后端加载');return}
  const token=Symbol(id);testTokens.set(id,token);render(false)
  try{
   const result=await request('/api/environments/'+environment._apiId+'/connection-test',{method:'POST'})
   environment.status=statusMap[result.status];environment.lastTest='刚刚';environment.latency=result.latencyMs!=null?result.latencyMs+' ms':result.error||'—'
   showToast(result.status==='REACHABLE'?environment.name+' 可以连接':result.error||environment.name+' 连接失败')
  }catch(error){showToast(error.message||'连接测试失败')}
  finally{testTokens.delete(id);render(false)}
 }

 testAllEnvironments=async function(){
  const targets=versionEnvironments(state.resourceType).filter(item=>item._apiId!=null)
  if(!targets.length){showToast('当前范围没有可测试的环境');return}
  targets.forEach(item=>testTokens.set(item.id,Symbol(item.id)));render(false)
  const results=await Promise.all(targets.map(async environment=>{
   try{
    const result=await request('/api/environments/'+environment._apiId+'/connection-test',{method:'POST'})
    environment.status=statusMap[result.status];environment.lastTest='刚刚';environment.latency=result.latencyMs!=null?result.latencyMs+' ms':result.error||'—'
    return result.status==='REACHABLE'
   }catch(error){environment.status='error';environment.latency=error.message||'连接失败';return false}
   finally{testTokens.delete(environment.id)}
  }))
  render(false);showToast('测试完成：'+results.filter(Boolean).length+' 个成功，'+results.filter(item=>!item).length+' 个失败')
 }

 saveEnvironment=async function(){
  const form=document.querySelector('#environment-form')
  if(!form||!form.reportValidity())return
  const values=Object.fromEntries(new FormData(form))
  const existing=environments.find(item=>item.id===form.dataset.environmentId)
  const selectedVersion=releaseVersions.find(item=>item.id===values.version)
  const type=form.dataset.environmentType
  if(!selectedVersion||selectedVersion._apiId==null){showToast('发布版本数据尚未从后端加载');return}
  const password=values.password||existing?.password||''
  const body={
   releaseVersionId:selectedVersion._apiId,type:type==='build'?'BUILD':'CONTAINER',name:values.name,host:values.ip,sshPort:Number(values.port),
   password,workDirectory:values.workdir||'',architecture:(values.architecture||'').toUpperCase(),mae:values.mae||'',maeUser:values.maeUser||'',
   maePassword:values.maePassword||existing?.maePassword||'',osmu:values.osmu||'',osmuUser:values.osmuUser||'',osmuPassword:values.osmuPassword||existing?.osmuPassword||'',
   version:existing?existing._version:null
  }
  try{
   await request(existing?'/api/environments/'+existing._apiId:'/api/environments',{method:existing?'PUT':'POST',body:JSON.stringify(body)})
   state.resourceDrawer=null;await loadResources();showToast(existing?'环境配置已保存':'环境已新增')
  }catch(error){showToast(error.message||'保存失败')}
 }

 deleteEnvironment=async function(environment){
  if(!environment||environment._apiId==null){showToast('环境数据尚未从后端加载');return}
  if(!confirm('确定删除“'+environment.name+'”吗？删除后无法恢复。'))return
  try{await request('/api/environments/'+environment._apiId,{method:'DELETE'});await loadResources();showToast('环境已删除')}
  catch(error){showToast(error.message||'删除失败')}
 }

 async function previewConnection(){
  const form=document.querySelector('#environment-form')
  if(!form)return
  const values=Object.fromEntries(new FormData(form))
  const existing=environments.find(item=>item.id===form.dataset.environmentId)
  const result=document.querySelector('#drawer-test-result')
  const button=document.querySelector('[data-drawer-test]')
  const body={type:form.dataset.environmentType==='build'?'BUILD':'CONTAINER',host:values.ip,sshPort:Number(values.port),password:values.password||existing?.password||''}
  if(!body.host||!body.password){form.reportValidity();return}
  result.className='drawer-test-result visible testing';result.textContent='正在检查真实 SSH 连接…';button.disabled=true
  try{
   const response=await request('/api/connection-tests/preview',{method:'POST',body:JSON.stringify(body)})
   result.className='drawer-test-result visible '+(response.status==='REACHABLE'?'success':'error')
   result.textContent=response.status==='REACHABLE'?'SSH 连接成功，可以保存当前配置。':response.error||'SSH 连接失败'
  }catch(error){result.className='drawer-test-result visible error';result.textContent=error.message||'SSH 连接失败'}
  finally{button.disabled=false}
 }

 document.addEventListener('click',function(event){
  const button=event.target.closest&&event.target.closest('[data-drawer-test]')
  if(!button)return
  event.preventDefault();event.stopImmediatePropagation();previewConnection()
 },true)

 new MutationObserver(function(){
  const form=document.querySelector('#environment-form')
  if(!form)return
  const existing=environments.find(item=>item.id===form.dataset.environmentId)
  for(const name of ['password','maePassword','osmuPassword']){
   const input=form.elements[name]
   if(input){input.type='text';if(existing&&!input.value)input.value=existing[name]||''}
  }
 }).observe(document.querySelector('#app'),{childList:true,subtree:true})

 loadResources()
})()