import {XMLParser} from 'fast-xml-parser';

export interface UtEvidence {tests:number;failures:number;errors:number;skipped:number;passedIds:string[];failedIds:string[];caseIds:string[];details:string;}
export interface Governance {
 mode:'REPAIR'|'SUPPLEMENT'|'NONE';coverageLow:boolean;maxClasses:number;
 baseline?:UtEvidence;verified?:UtEvidence;targets?:string[];lastFailure?:string;
 fixedIds?:string[];addedIds?:string[];completedAt?:string;startedAt?:string;
 mrState?:'PENDING'|'MERGED'|'CLOSED';reportAt?:string;
 classResults?:Array<{target:string;status:'PASSED'|'FAILED';message:string}>;
}
export interface GovernanceRecord {mrCheck?:{state:'UNKNOWN'|'OPENED'|'MISSING';checkedAt:string;error:string};mrBlockRelease?:{at:string;reason:string;source:'USER'|'REMOTE_MISSING'};id:string;repository:string;reportVersion?:string;baseBranch:string;status:string;message:string;createdAt:string;updatedAt:string;pullRequestUrl:string;governance:Governance;}
const array=(value:unknown):Record<string,unknown>[]=>value===undefined?[]:(Array.isArray(value)?value:[value]).filter((x):x is Record<string,unknown>=>!!x&&typeof x==='object');
export function readUtXml(documents:Array<{path:string;content:string}>):UtEvidence {
 const result:UtEvidence={tests:0,failures:0,errors:0,skipped:0,passedIds:[],failedIds:[],caseIds:[],details:''};
 const parser=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@_',processEntities:false});
 const seen=new Set<string>();
 for(const document of documents){const root=parser.parse(document.content) as Record<string,unknown>;
  const visit=(suite:Record<string,unknown>)=>{
   for(const entry of array(suite.testcase)){
    const id=document.path+'::'+String(entry['@_classname']??suite['@_name']??'')+'#'+String(entry['@_name']??'');
    if(seen.has(id))continue;seen.add(id);result.tests++;result.caseIds.push(id);
    if(entry.failure!==undefined){result.failures++;result.failedIds.push(id);}
    else if(entry.error!==undefined){result.errors++;result.failedIds.push(id);}
    else if(entry.skipped!==undefined)result.skipped++;
    else result.passedIds.push(id);
   }
   for(const child of array(suite.testsuite))visit(child);
  };
  for(const suite of array(root.testsuite??root.testsuites))visit(suite);
 }
 return result;
}
export function decideGovernance(evidence:UtEvidence,coverageLow:boolean):Governance['mode'] {
 if(!evidence.tests||evidence.tests===evidence.skipped)throw new Error('未执行任何 UT，不能判定通过。');
 return evidence.failures+evidence.errors>0?'REPAIR':coverageLow?'SUPPLEMENT':'NONE';
}
export function verifiedChanges(baseline:UtEvidence,current:UtEvidence){
 const passed=new Set(current.passedIds),original=new Set(baseline.caseIds);
 return{fixedIds:baseline.failedIds.filter(id=>passed.has(id)),addedIds:current.passedIds.filter(id=>!original.has(id))};
}
export function utRegressionPassed(baseline:UtEvidence,current:UtEvidence,exitCode:number){
 const currentIds=new Set(current.caseIds),passed=new Set(current.passedIds);
 return exitCode===0&&current.tests>0&&current.failures+current.errors===0&&current.skipped<=baseline.skipped&&baseline.caseIds.every(id=>currentIds.has(id))&&[...baseline.passedIds,...baseline.failedIds].every(id=>passed.has(id));
}
export function governanceMetrics(records:GovernanceRecord[],now=new Date()){
 const successful=records.filter(r=>['RESOLVED','MR_PENDING','MR_REPAIRING'].includes(r.status)&&r.governance.mrState!=='CLOSED');
 const services=(key:'fixedIds'|'addedIds')=>new Set(successful.filter(r=>r.governance[key]?.length).map(r=>r.repository.toLowerCase())).size;
 const cases=(key:'fixedIds'|'addedIds')=>new Set(successful.flatMap(r=>(r.governance[key]??[]).map(id=>[r.repository.toLowerCase(),r.reportVersion??r.baseBranch,id].join('|')))).size;
 const day=(date:Date)=>new Date(date.getTime()+8*3600000).toISOString().slice(0,10);
 const days=new Set(records.flatMap(r=>r.governance.startedAt?[day(new Date(r.governance.startedAt))]:[]));
 let cursor=new Date(now),streak=0;if(!days.has(day(cursor)))cursor=new Date(cursor.getTime()-86400000);
 while(days.has(day(cursor))){streak++;cursor=new Date(cursor.getTime()-86400000);}
 return{streak,fixedServices:services('fixedIds'),fixedCases:cases('fixedIds'),supplementedServices:services('addedIds'),addedCases:cases('addedIds')};
}
