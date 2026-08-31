import type {ConnectionTestResult,Environment,EnvironmentRequest,ReleaseVersion} from '../types/environment'
const request=async <T>(url:string,options?:RequestInit):Promise<T>=>{const response=await fetch(url,{headers:{'Content-Type':'application/json'},...options});if(!response.ok)throw new Error(await response.text()||'请求失败');return response.status===204?undefined as T:response.json()}
export const environmentApi={
 versions:()=>request<ReleaseVersion[]>('/api/release-versions'),
 list:()=>request<Environment[]>('/api/environments'),
 create:(body:EnvironmentRequest)=>request<Environment>('/api/environments',{method:'POST',body:JSON.stringify(body)}),
 update:(id:number,body:EnvironmentRequest)=>request<Environment>('/api/environments/'+id,{method:'PUT',body:JSON.stringify(body)}),
 remove:(id:number)=>request<void>('/api/environments/'+id,{method:'DELETE'}),
 test:(id:number)=>request<ConnectionTestResult>('/api/environments/'+id+'/connection-test',{method:'POST'}),
 testAll:()=>request<ConnectionTestResult[]>('/api/environments/connection-tests/batch',{method:'POST'})
}