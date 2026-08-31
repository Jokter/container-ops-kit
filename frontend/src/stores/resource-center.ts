import {computed,ref} from 'vue'
import {defineStore} from 'pinia'
import {environmentApi} from '../api/environment-api'
import type {ConnectionStatus,Environment,EnvironmentRequest,EnvironmentType,ReleaseVersion} from '../types/environment'
export const useResourceCenterStore=defineStore('resource-center',()=>{
 const versions=ref<ReleaseVersion[]>([]); const environments=ref<Environment[]>([]); const loading=ref(false); const error=ref('')
 const load=async()=>{loading.value=true;error.value='';try{[versions.value,environments.value]=await Promise.all([environmentApi.versions(),environmentApi.list()])}catch(e){error.value=e instanceof Error?e.message:'加载失败'}finally{loading.value=false}}
 const save=async(id:number|undefined,body:EnvironmentRequest)=>{if(id===undefined)await environmentApi.create(body);else await environmentApi.update(id,body);await load()}
 const remove=async(id:number)=>{await environmentApi.remove(id);await load()}
 const test=async(id:number)=>{const result=await environmentApi.test(id);await load();return result}
 const testAll=async()=>{const result=await environmentApi.testAll();await load();return result}
 const byType=computed(()=> (type:EnvironmentType)=>environments.value.filter(e=>e.type===type))
 const byStatus=computed(()=> (status:ConnectionStatus)=>environments.value.filter(e=>e.connectionStatus===status))
 return {versions,environments,loading,error,load,save,remove,test,testAll,byType,byStatus}
})