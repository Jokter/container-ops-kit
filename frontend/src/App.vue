<script setup lang="ts">
import {computed,onMounted,reactive,ref} from 'vue'
import {ElMessage,ElMessageBox} from 'element-plus'
import {useResourceCenterStore} from './stores/resource-center'
import type {ConnectionStatus,Environment,EnvironmentRequest,EnvironmentType} from './types/environment'

const store=useResourceCenterStore()
const type=ref<EnvironmentType>('BUILD')
const selectedVersionId=ref<number>()
const query=ref('')
const status=ref<'ALL'|ConnectionStatus>('ALL')
const drawer=ref(false)
const editing=ref<Environment>()
const testing=ref<number>()
const previewing=ref(false)
const saving=ref(false)
const form=reactive<EnvironmentRequest>({
 releaseVersionId:0,type:'BUILD',name:'',host:'',sshPort:22,password:'',
 workDirectory:'',architecture:'X86_64',mae:'',maeUser:'',maePassword:'',
 osmu:'',osmuUser:'',osmuPassword:''
})

const versionEnvironments=computed(()=>store.environments.filter(environment=>environment.releaseVersion.id===selectedVersionId.value))
const buildCount=computed(()=>versionEnvironments.value.filter(environment=>environment.type==='BUILD').length)
const containerCount=computed(()=>versionEnvironments.value.filter(environment=>environment.type==='CONTAINER').length)
const reachableCount=computed(()=>versionEnvironments.value.filter(environment=>environment.connectionStatus==='REACHABLE').length)
const filtered=computed(()=>versionEnvironments.value.filter(environment=>
 environment.type===type.value &&
 (status.value==='ALL'||environment.connectionStatus===status.value) &&
 (!query.value||[environment.name,environment.host,environment.workDirectory].some(value=>(value||'').toLowerCase().includes(query.value.toLowerCase())))
))

const statusLabel=(value:ConnectionStatus)=>({UNTESTED:'未测试',REACHABLE:'可连接',FAILED:'连接失败'}[value])
const statusClass=(value:ConnectionStatus)=>({UNTESTED:'untested',REACHABLE:'reachable',FAILED:'failed'}[value])
const userFor=(value:EnvironmentType)=>value==='BUILD'?'huawei':'sopuser'
const resetFilters=()=>{query.value='';status.value='ALL'}
const selectType=(value:EnvironmentType)=>{type.value=value;resetFilters()}

const openDrawer=(environment?:Environment)=>{
 editing.value=environment
 form.releaseVersionId=environment?.releaseVersion.id||selectedVersionId.value||store.versions[0]?.id||0
 form.type=environment?.type||type.value
 form.name=environment?.name||''
 form.host=environment?.host||''
 form.sshPort=environment?.sshPort||22
 form.password=environment?.password||''
 form.workDirectory=environment?.workDirectory||''
 form.architecture=environment?.architecture||'X86_64'
 form.mae=environment?.mae||''
 form.maeUser=environment?.maeUser||''
 form.maePassword=environment?.maePassword||''
 form.osmu=environment?.osmu||''
 form.osmuUser=environment?.osmuUser||''
 form.osmuPassword=environment?.osmuPassword||''
 drawer.value=true
}

const validateConnection=()=>{
 if(!form.host.trim()){ElMessage.warning('请输入 SSH 地址');return false}
 if(!form.password){ElMessage.warning('请输入 SSH 密码');return false}
 return true
}

const preview=async()=>{
 if(!validateConnection())return
 previewing.value=true
 try{
  const result=await store.preview({...form})
  ElMessage[result.status==='REACHABLE'?'success':'error'](result.status==='REACHABLE'?'SSH 连接成功':result.error||'SSH 连接失败')
 }catch(error){ElMessage.error(error instanceof Error?error.message:'测试失败')}
 finally{previewing.value=false}
}

const save=async()=>{
 if(!form.name.trim()){ElMessage.warning('请输入环境名称');return}
 if(!validateConnection())return
 saving.value=true
 try{
  await store.save(editing.value?.id,{...form,version:editing.value?.version})
  selectedVersionId.value=form.releaseVersionId
  type.value=form.type
  drawer.value=false
  ElMessage.success('环境已保存')
 }catch(error){ElMessage.error(error instanceof Error?error.message:'保存失败')}
 finally{saving.value=false}
}

const remove=async(environment:Environment)=>{
 try{
  await ElMessageBox.confirm('确定删除环境「'+environment.name+'」吗？删除后无法恢复。','删除环境',{type:'warning',confirmButtonText:'删除',cancelButtonText:'取消'})
  await store.remove(environment.id)
  ElMessage.success('环境已删除')
 }catch(error){
  if(error!=='cancel'&&error!=='close')ElMessage.error(error instanceof Error?error.message:'删除失败')
 }
}

const test=async(environment:Environment)=>{
 testing.value=environment.id
 try{
  const result=await store.test(environment.id)
  ElMessage[result.status==='REACHABLE'?'success':'error'](result.status==='REACHABLE'?environment.name+' 可以连接':result.error||'连接失败')
 }catch(error){ElMessage.error(error instanceof Error?error.message:'测试失败')}
 finally{testing.value=undefined}
}

const testAll=async()=>{
 testing.value=-1
 try{
  const result=await store.testAll()
  const passed=result.filter(item=>item.status==='REACHABLE').length
  ElMessage.info('测试完成：'+passed+' 个成功，'+(result.length-passed)+' 个失败')
 }catch(error){ElMessage.error(error instanceof Error?error.message:'测试失败')}
 finally{testing.value=undefined}
}

const copySsh=async(environment:Environment)=>{
 const command='ssh '+userFor(environment.type)+'@'+environment.host+' -p '+environment.sshPort
 await navigator.clipboard.writeText(command)
 ElMessage.success('SSH 命令已复制')
}

const handleCommand=(command:string,environment:Environment)=>{
 if(command==='copy')copySsh(environment)
 if(command==='delete')remove(environment)
}

onMounted(async()=>{
 await store.load()
 selectedVersionId.value=store.versions[0]?.id
})
</script>

<template>
<div class="app-shell">
 <aside class="sidebar">
  <div class="brand">
   <div class="brand-mark">◐</div>
   <div><strong>Container Ops Kit</strong><span>容器运维工作台</span></div>
  </div>
  <nav>
   <button>工作台</button>
   <div class="nav-section">工作区</div>
   <button>构建</button>
   <button>部署</button>
   <button>容器运维</button>
   <div class="nav-section">基础能力</div>
   <button class="active">资源中心</button>
  </nav>
  <div class="user">林工 · 本地环境</div>
 </aside>

 <main class="main">
  <header class="page-head">
   <div><h1>资源中心</h1><p>按发布版本维护构建环境和容器环境，并验证 SSH 连通性。</p></div>
  </header>

  <el-alert v-if="store.error" :title="store.error" type="error" show-icon class="error-alert"/>

  <section class="panel version-overview">
   <div class="version-selector">
    <label>发布版本</label>
    <el-select v-model="selectedVersionId" @change="resetFilters">
     <el-option v-for="version in store.versions" :key="version.id" :label="version.code" :value="version.id"/>
    </el-select>
   </div>
   <div class="version-stat"><span>构建环境</span><strong>{{buildCount}}</strong></div>
   <div class="version-stat"><span>容器环境</span><strong>{{containerCount}}</strong></div>
   <div class="version-stat"><span>可连接</span><strong>{{reachableCount}}</strong></div>
  </section>

  <section class="panel resource-panel">
   <div class="resource-tabs">
    <button :class="{active:type==='BUILD'}" @click="selectType('BUILD')">构建环境<span>{{buildCount}}</span></button>
    <button :class="{active:type==='CONTAINER'}" @click="selectType('CONTAINER')">容器环境<span>{{containerCount}}</span></button>
   </div>
   <div class="toolbar">
    <el-input v-model="query" placeholder="搜索名称、IP 或工作目录" clearable/>
    <el-select v-model="status">
     <el-option label="全部状态" value="ALL"/>
     <el-option label="可连接" value="REACHABLE"/>
     <el-option label="连接失败" value="FAILED"/>
     <el-option label="未测试" value="UNTESTED"/>
    </el-select>
    <div class="toolbar-spacer"/>
    <el-button :loading="testing===-1" @click="testAll">测试全部</el-button>
    <el-button type="primary" @click="openDrawer()">新增{{type==='BUILD'?'构建环境':'容器环境'}}</el-button>
   </div>

   <div class="environment-table" v-loading="store.loading">
    <div class="environment-row head">
     <span>环境</span><span>SSH 地址</span><span>端口</span><span>连接状态</span>
     <span>{{type==='BUILD'?'工作目录 / 架构':'MAE / OSMU'}}</span><span>操作</span>
    </div>
    <div v-for="environment in filtered" :key="environment.id" class="environment-row">
     <div class="environment-name"><span class="kind">{{type==='BUILD'?'B':'C'}}</span><div><strong>{{environment.name}}</strong><small>{{userFor(environment.type)}}</small></div></div>
     <div><strong class="mono">{{environment.host}}</strong><small>{{environment.releaseVersion.code}}</small></div>
     <span class="mono">{{environment.sshPort}}</span>
     <div><span class="connection-status" :class="statusClass(environment.connectionStatus)">{{statusLabel(environment.connectionStatus)}}</span><small v-if="environment.lastTestLatencyMs">{{environment.lastTestLatencyMs}} ms</small><small v-else-if="environment.lastTestError">{{environment.lastTestError}}</small></div>
     <div v-if="type==='BUILD'"><strong class="ellipsis">{{environment.workDirectory||'—'}}</strong><small>{{environment.architecture||'—'}}</small></div>
     <div v-else><strong>{{environment.mae||'—'}}</strong><small>{{environment.osmu||'—'}}</small></div>
     <div class="actions">
      <el-button size="small" :loading="testing===environment.id" @click="test(environment)">测试连接</el-button>
      <el-button size="small" @click="openDrawer(environment)">编辑</el-button>
      <el-dropdown trigger="click" @command="handleCommand($event,environment)">
       <el-button size="small">更多⌄</el-button>
       <template #dropdown><el-dropdown-menu><el-dropdown-item command="copy">复制 SSH 命令</el-dropdown-item><el-dropdown-item command="delete" divided>删除环境</el-dropdown-item></el-dropdown-menu></template>
      </el-dropdown>
     </div>
    </div>
    <div v-if="!store.loading&&!filtered.length" class="empty">当前范围没有环境</div>
   </div>
  </section>
 </main>

 <el-drawer v-model="drawer" :with-header="false" size="520px" class="environment-drawer">
  <div class="drawer-head"><div><h2>{{editing?'编辑环境':'新增环境'}}</h2><p>密码将以明文保存并直接显示。</p></div><button @click="drawer=false">×</button></div>
  <el-form label-position="top" class="drawer-form">
   <section>
    <h3>基本信息</h3>
    <div class="form-grid">
     <el-form-item label="发布版本"><el-select v-model="form.releaseVersionId"><el-option v-for="version in store.versions" :key="version.id" :label="version.code" :value="version.id"/></el-select></el-form-item>
     <el-form-item label="环境类型"><el-select v-model="form.type"><el-option label="构建环境" value="BUILD"/><el-option label="容器环境" value="CONTAINER"/></el-select></el-form-item>
     <el-form-item label="环境名称" required class="wide"><el-input v-model="form.name"/></el-form-item>
    </div>
   </section>
   <section>
    <h3>SSH 连接</h3>
    <div class="form-grid">
     <el-form-item label="SSH 地址" required><el-input v-model="form.host"/></el-form-item>
     <el-form-item label="端口"><el-input-number v-model="form.sshPort" :min="1" :max="65535" controls-position="right"/></el-form-item>
     <el-form-item label="固定账号"><el-input :model-value="userFor(form.type)" disabled/></el-form-item>
     <el-form-item label="密码" required><el-input v-model="form.password"/></el-form-item>
    </div>
   </section>
   <section v-if="form.type==='BUILD'">
    <h3>构建配置</h3>
    <div class="form-grid">
     <el-form-item label="工作目录" class="wide"><el-input v-model="form.workDirectory"/></el-form-item>
     <el-form-item label="架构"><el-select v-model="form.architecture"><el-option label="x86_64" value="X86_64"/><el-option label="aarch64" value="AARCH64"/></el-select></el-form-item>
    </div>
   </section>
   <section v-else>
    <h3>容器平台连接</h3>
    <div class="form-grid">
     <el-form-item label="MAE 地址"><el-input v-model="form.mae"/></el-form-item>
     <el-form-item label="MAE 账号"><el-input v-model="form.maeUser"/></el-form-item>
     <el-form-item label="MAE 密码" class="wide"><el-input v-model="form.maePassword"/></el-form-item>
     <el-form-item label="OSMU 地址"><el-input v-model="form.osmu"/></el-form-item>
     <el-form-item label="OSMU 账号"><el-input v-model="form.osmuUser"/></el-form-item>
     <el-form-item label="OSMU 密码" class="wide"><el-input v-model="form.osmuPassword"/></el-form-item>
    </div>
   </section>
  </el-form>
  <div class="drawer-footer"><el-button @click="drawer=false">取消</el-button><el-button :loading="previewing" @click="preview">测试连接</el-button><el-button type="primary" :loading="saving" @click="save">保存环境</el-button></div>
 </el-drawer>
</div>
</template>

<style>
:root{font-family:"Segoe UI Variable","Segoe UI","Microsoft YaHei UI",sans-serif;color:#202b33;background:#f5f7f8;font-size:14px}*{box-sizing:border-box}body{margin:0}.app-shell{min-height:100vh}.sidebar{position:fixed;inset:0 auto 0 0;width:184px;display:flex;flex-direction:column;padding:18px 12px 14px;background:#f1f4f6;border-right:1px solid #e1e6e9}.brand{display:flex;align-items:center;gap:9px;padding:0 6px 16px}.brand-mark{width:30px;height:30px;display:grid;place-items:center;border-radius:50%;color:#fff;background:#253744;font-size:20px}.brand strong{display:block;white-space:nowrap;color:#263740;font-size:14px}.brand span{display:block;margin-top:1px;color:#7b8891;font-size:12px}.sidebar nav{display:grid;gap:2px}.sidebar nav button{width:100%;border:0;border-radius:7px;padding:8px 10px;color:#53616b;background:transparent;text-align:left;font:inherit;cursor:pointer}.sidebar nav button.active{color:#202b33;background:#fff;box-shadow:inset 2px 0 #3563e9;font-weight:600}.nav-section{margin:14px 9px 4px;color:#8e99a2;font-size:12px}.user{margin-top:auto;padding:12px 8px 0;border-top:1px solid #e1e6e9;color:#66737d;font-size:12px}.main{min-height:100vh;margin-left:184px;padding:24px}.page-head{display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:20px}.page-head h1{margin:0;font-size:26px;line-height:1.3;font-weight:600;letter-spacing:-.02em}.page-head p{margin:4px 0 0;color:#66737d}.error-alert{margin-bottom:16px}.panel{background:#fff;border:1px solid #e1e6e9;border-radius:8px;box-shadow:0 1px 2px rgba(25,39,48,.04)}.version-overview{display:grid;grid-template-columns:minmax(260px,1.4fr) repeat(3,minmax(150px,.6fr));margin-bottom:16px;overflow:hidden}.version-selector{padding:16px;border-right:1px solid #e1e6e9}.version-selector label{display:block;margin-bottom:7px;color:#66737d;font-size:12px}.version-selector .el-select{width:100%}.version-stat{display:flex;flex-direction:column;justify-content:center;padding:16px 18px;border-right:1px solid #e1e6e9}.version-stat:last-child{border-right:0}.version-stat span{color:#66737d;font-size:12px}.version-stat strong{margin-top:3px;font-size:20px}.resource-panel{overflow:hidden}.resource-tabs{display:flex;gap:2px;padding:8px 12px 0;border-bottom:1px solid #e1e6e9}.resource-tabs button{position:relative;border:0;padding:9px 12px 11px;color:#66737d;background:transparent;font:500 14px inherit;cursor:pointer}.resource-tabs button.active{color:#3563e9}.resource-tabs button.active:after{content:"";position:absolute;right:10px;bottom:-1px;left:10px;height:2px;background:#3563e9}.resource-tabs button span{margin-left:5px;color:#8e99a2;font-size:12px}.toolbar{display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid #e1e6e9}.toolbar>.el-input{width:280px}.toolbar>.el-select{width:150px}.toolbar-spacer{flex:1}.environment-row{display:grid;grid-template-columns:minmax(200px,1.15fr) minmax(135px,.8fr) 70px 120px minmax(170px,1fr) minmax(270px,1.2fr);gap:14px;align-items:center;min-height:66px;padding:10px 16px;border-bottom:1px solid #e1e6e9}.environment-row:last-child{border-bottom:0}.environment-row.head{min-height:38px;color:#8e99a2;background:#f8fafb;font-size:12px}.environment-name{display:flex;align-items:center;gap:10px;min-width:0}.kind{width:32px;height:32px;display:grid;place-items:center;flex:0 0 auto;border-radius:8px;color:#3563e9;background:#edf2ff;font-weight:600}.environment-row strong{display:block;min-width:0;font-weight:500}.environment-row small{display:block;margin-top:2px;color:#66737d;font-size:12px}.mono{font-family:"Cascadia Code",Consolas,monospace}.ellipsis{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.connection-status{display:inline-flex;align-items:center;gap:6px;font-size:12px}.connection-status:before{content:"";width:7px;height:7px;border-radius:50%;background:#8e99a2}.connection-status.reachable{color:#16836e}.connection-status.reachable:before{background:#16836e}.connection-status.failed{color:#c64c4c}.connection-status.failed:before{background:#c64c4c}.connection-status.untested{color:#a96f16}.connection-status.untested:before{background:#a96f16}.actions{display:flex;justify-content:flex-end;gap:6px}.empty{padding:54px 20px;color:#66737d;text-align:center}.drawer-head{display:flex;justify-content:space-between;gap:16px;padding:20px 24px;border-bottom:1px solid #e1e6e9}.drawer-head h2{margin:0;font-size:18px}.drawer-head p{margin:4px 0 0;color:#66737d;font-size:12px}.drawer-head button{border:0;background:transparent;color:#66737d;font-size:25px;cursor:pointer}.drawer-form{padding:0 24px 90px}.drawer-form section{padding:20px 0;border-bottom:1px solid #e1e6e9}.drawer-form h3{margin:0 0 16px;font-size:14px}.form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 14px}.form-grid .wide{grid-column:1/-1}.form-grid .el-select,.form-grid .el-input-number{width:100%}.drawer-footer{position:absolute;right:0;bottom:0;left:0;display:flex;justify-content:flex-end;gap:8px;padding:14px 24px;border-top:1px solid #e1e6e9;background:#fff}@media(max-width:900px){.sidebar{width:150px}.main{margin-left:150px;padding:18px}.version-overview{grid-template-columns:1fr 1fr}.version-selector{grid-column:1/-1}.environment-table{overflow-x:auto}.environment-row{min-width:1050px}}
</style>