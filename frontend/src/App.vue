<script setup lang="ts">
import {computed, onMounted, reactive, ref} from 'vue'
import {ElMessage, ElMessageBox} from 'element-plus'
import {useResourceCenterStore} from './stores/resource-center'
import type {ConnectionStatus,Environment,EnvironmentRequest,EnvironmentType} from './types/environment'

const store=useResourceCenterStore()
const type=ref<EnvironmentType>('BUILD')
const query=ref('')
const status=ref<'ALL'|ConnectionStatus>('ALL')
const drawer=ref(false)
const editing=ref<Environment>()
const testing=ref<number>()
const form=reactive<EnvironmentRequest>({releaseVersionId:0,type:'BUILD',name:'',host:'',sshPort:22,password:'',workDirectory:'',architecture:'',mae:'',maeUser:'',maePassword:'',osmu:'',osmuUser:'',osmuPassword:''})
const filtered=computed(()=>store.environments.filter(e=>e.type===type.value&&(status.value==='ALL'||e.connectionStatus===status.value)&&(!query.value||[e.name,e.host,e.workDirectory].some(v=>(v||'').toLowerCase().includes(query.value.toLowerCase())))))
const statusLabel=(s:ConnectionStatus)=>({UNTESTED:'未测试',REACHABLE:'可连接',FAILED:'连接失败'}[s])
const statusType=(s:ConnectionStatus)=>({UNTESTED:'info',REACHABLE:'success',FAILED:'danger'}[s] as any)
const resetForm=(e?:Environment)=>{editing.value=e;form.releaseVersionId=e?.releaseVersion.id||store.versions[0]?.id||0;form.type=e?.type||type.value;form.name=e?.name||'';form.host=e?.host||'';form.sshPort=e?.sshPort||22;form.password=e?.password||'';form.workDirectory=e?.workDirectory||'';form.architecture=e?.architecture||'';form.mae=e?.mae||'';form.maeUser=e?.maeUser||'';form.maePassword=e?.maePassword||'';form.osmu=e?.osmu||'';form.osmuUser=e?.osmuUser||'';form.osmuPassword=e?.osmuPassword||'';drawer.value=true}
const save=async()=>{try{await store.save(editing.value?.id,{...form,version:editing.value?.version});drawer.value=false;ElMessage.success('环境已保存')}catch(e){ElMessage.error(e instanceof Error?e.message:'保存失败')}}
const remove=async(e:Environment)=>{await ElMessageBox.confirm('确定删除环境「'+e.name+'」吗？','删除确认',{type:'warning'});try{await store.remove(e.id);ElMessage.success('环境已删除')}catch(err){ElMessage.error(err instanceof Error?err.message:'删除失败')}}
const test=async(e:Environment)=>{testing.value=e.id;try{const r=await store.test(e.id);ElMessage[r.status==='REACHABLE'?'success':'error'](r.status==='REACHABLE'?'连接成功':r.error||'连接失败')}finally{testing.value=undefined}}
const testAll=async()=>{testing.value=-1;try{const result=await store.testAll();ElMessage.info('测试完成：'+result.filter(r=>r.status==='REACHABLE').length+' 个可连接')}finally{testing.value=undefined}}
onMounted(store.load)
</script>

<template>
<el-container class="shell">
<el-header class="header"><div><h1>Container Ops Kit</h1><span>资源中心</span></div><el-button type="primary" @click="resetForm()">新增环境</el-button></el-header>
<el-main>
<el-alert v-if="store.error" :title="store.error" type="error" show-icon/>
<el-card class="summary"><div><b>{{store.environments.length}}</b><span>环境总数</span></div><div><b>{{store.environments.filter(e=>e.connectionStatus==='REACHABLE').length}}</b><span>可连接</span></div><div><b>{{store.environments.filter(e=>e.connectionStatus==='FAILED').length}}</b><span>连接失败</span></div></el-card>
<el-card>
<el-tabs v-model="type"><el-tab-pane label="构建环境" name="BUILD"/><el-tab-pane label="容器环境" name="CONTAINER"/></el-tabs>
<div class="toolbar"><el-input v-model="query" placeholder="搜索名称、地址或工作目录" clearable/><el-select v-model="status" style="width:150px"><el-option label="全部状态" value="ALL"/><el-option label="未测试" value="UNTESTED"/><el-option label="可连接" value="REACHABLE"/><el-option label="连接失败" value="FAILED"/></el-select><el-button :loading="testing===-1" @click="testAll">测试全部</el-button></div>
<el-table :data="filtered" v-loading="store.loading" row-key="id"><el-table-column prop="name" label="环境名称" min-width="190"/><el-table-column prop="host" label="地址" min-width="160"/><el-table-column prop="sshPort" label="端口" width="80"/><el-table-column label="状态" width="120"><template #default="{row}"><el-tag :type="statusType(row.connectionStatus)">{{statusLabel(row.connectionStatus)}}</el-tag></template></el-table-column><el-table-column prop="releaseVersion.code" label="版本" width="110"/><el-table-column label="操作" width="260"><template #default="{row}"><el-button link @click="test(row)" :loading="testing===row.id">测试连接</el-button><el-button link @click="resetForm(row)">编辑</el-button><el-button link type="danger" @click="remove(row)">删除</el-button></template></el-table-column></el-table>
<el-empty v-if="!filtered.length" description="暂无环境"/>
</el-card>
</el-main>
<el-drawer v-model="drawer" :title="editing?'编辑环境':'新增环境'" size="480px"><el-form label-position="top"><el-form-item label="发布版本"><el-select v-model="form.releaseVersionId"><el-option v-for="v in store.versions" :key="v.id" :label="v.code" :value="v.id"/></el-select></el-form-item><el-form-item label="环境名称" required><el-input v-model="form.name"/></el-form-item><el-form-item label="SSH 地址" required><el-input v-model="form.host"/></el-form-item><el-form-item label="SSH 端口"><el-input-number v-model="form.sshPort" :min="1" :max="65535"/></el-form-item><el-form-item label="SSH 密码" required><el-input v-model="form.password"/></el-form-item><el-form-item v-if="form.type==='BUILD'" label="工作目录"><el-input v-model="form.workDirectory"/></el-form-item><el-form-item v-if="form.type==='BUILD'" label="架构"><el-input v-model="form.architecture" placeholder="X86_64 / AARCH64"/></el-form-item><template v-if="form.type==='CONTAINER'"><el-divider>MAE / OSMU</el-divider><el-form-item label="MAE 地址"><el-input v-model="form.mae"/></el-form-item><el-form-item label="MAE 账号"><el-input v-model="form.maeUser"/></el-form-item><el-form-item label="MAE 密码"><el-input v-model="form.maePassword"/></el-form-item><el-form-item label="OSMU 地址"><el-input v-model="form.osmu"/></el-form-item><el-form-item label="OSMU 账号"><el-input v-model="form.osmuUser"/></el-form-item><el-form-item label="OSMU 密码"><el-input v-model="form.osmuPassword"/></el-form-item></template></el-form><template #footer><el-button @click="drawer=false">取消</el-button><el-button type="primary" @click="save">保存环境</el-button></template></el-drawer>
</el-container>
</template>

<style>
:root{font-family:Inter,"Microsoft YaHei",sans-serif;color:#24313a;background:#f5f7f8}*{box-sizing:border-box}body{margin:0}.shell{min-height:100vh;background:#f5f7f8}.header{height:72px!important;padding:0 34px;display:flex;align-items:center;justify-content:space-between;background:#253744;color:#fff}.header h1{margin:0;font-size:20px}.header span{color:#b8c4cb;font-size:12px}.el-main{max-width:1440px;width:100%;margin:auto;padding:28px 34px}.summary{display:flex;gap:70px;margin-bottom:18px}.summary div{display:flex;flex-direction:column;gap:4px}.summary b{font-size:25px}.summary span{color:#71808a;font-size:12px}.toolbar{display:flex;gap:10px;margin:8px 0 16px}.toolbar .el-input{max-width:360px}.el-card{border:1px solid #e1e6e9;margin-bottom:18px}
</style>