export function buildFailure(values:unknown[]):boolean {
 const text=JSON.stringify(values);
 // Specific test and authorization evidence take precedence over a build summary.
 if(/unauthorized|permission denied|无权限|forbidden|AssertionError|surefire|src[\\/]test[\\/]|失败用例|测试失败/i.test(text))return false;
 const visit=(value:unknown):boolean=>{
  if(Array.isArray(value))return value.some(visit);
  if(!value||typeof value!=='object')return false;
  const row=value as Record<string,unknown>;
  const marker=Object.values(row).some(v=>typeof v==='string'&&/(?:indicatorType=|^|[?&])build2\.0_build(?:&|$)/i.test(v));
  if(marker&&(row.exceeded===true||Number(row.value)>0))return true;
  return Object.values(row).some(visit);
 };
 return values.some(visit);
}
export interface PipelineRebuild {sha:string;attempts:number;manualOnly?:boolean;pending?:{pipelineId:string;knownIds:string[];requestedAt:number;observed:boolean}}
