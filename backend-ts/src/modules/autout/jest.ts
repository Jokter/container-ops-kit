import {isAbsolute,relative,win32} from 'node:path';
import {z} from 'zod';
import type {UtEvidence} from './governance.js';
const assertion=z.object({title:z.string(),fullName:z.string().optional(),ancestorTitles:z.array(z.string()).optional(),status:z.enum(['passed','failed','pending','todo','disabled','skipped']),failureMessages:z.array(z.string()).default([])});
const report=z.object({numTotalTests:z.number().int().nonnegative(),numRuntimeErrorTestSuites:z.number().int().nonnegative().optional(),testResults:z.array(z.object({name:z.string().min(1),status:z.string(),message:z.string().optional(),assertionResults:z.array(assertion)}))});
export function jestCommand(outputFile:string){return ['npm','run','test','--','--watch=false','--watchAll=false','--ci','--runInBand','--json','--outputFile='+outputFile];}
export function usesJest(scripts:Record<string,string>,name='test',seen=new Set<string>()):boolean{
 if(seen.has(name))return false;seen.add(name);const script=scripts[name]??'';
 // Detect the invoked runner, not a package name or the presence of a Jest
 // dependency. Keep npm's own test script as the execution entry point.
 if(/(?:^|[\s/\\])jest(?:\.js)?(?:[\s"']|$)/.test(script)||/\breact-(?:scripts|app-rewired)\b[^;&|]*\btest\b/.test(script))return true;
 const alias=script.match(/^\s*npm\s+run(?:-script)?\s+([\w:.-]+)\s+--\s*$/)?.[1];
 return !!alias&&usesJest(scripts,alias,seen);
}
export function readJestReport(content:string,website:string):UtEvidence{
 let parsed:z.infer<typeof report>;
 try{parsed=report.parse(JSON.parse(content));}catch{throw Error('核验受阻：Jest JSON 报告无效，请检查 npm run test 日志。');}
 if(parsed.numRuntimeErrorTestSuites)throw Error('核验受阻：Jest 测试套件加载失败，请检查依赖、Babel 和运行环境。');
 const result:UtEvidence={tests:0,failures:0,errors:0,skipped:0,passedIds:[],failedIds:[],caseIds:[],details:''};
 const occurrences=new Map<string,number>(),details:string[]=[];
 for(const suite of parsed.testResults){
  if(suite.status==='failed'&&!suite.assertionResults.length)throw Error('核验受阻：Jest 测试套件未能执行：'+(suite.message??suite.name).slice(0,2000));
  const windows=/^[A-Za-z]:[\\/]/.test(website),path=(windows?win32.relative(website,suite.name):isAbsolute(suite.name)?relative(website,suite.name):suite.name).replaceAll('\\','/');
  if(path==='..'||path.startsWith('../')||isAbsolute(path)||/^[A-Za-z]:/.test(path))throw Error('核验受阻：Jest 报告包含 website 目录之外的测试。');
  for(const entry of suite.assertionResults){
   const key=JSON.stringify([path,entry.ancestorTitles??[],entry.title]),occurrence=(occurrences.get(key)??0)+1;occurrences.set(key,occurrence);
   const id='jest:'+key+':'+occurrence;result.tests++;result.caseIds.push(id);
   if(entry.status==='passed')result.passedIds.push(id);
   else if(entry.status==='failed'){result.failures++;result.failedIds.push(id);details.push(path+' :: '+(entry.fullName??entry.title)+'\n'+entry.failureMessages.join('\n'));}
   else result.skipped++;
  }
 }
 if(!result.tests||result.tests!==parsed.numTotalTests||result.tests===result.skipped)throw Error('核验受阻：Jest 未执行有效 UT 或报告用例不完整。');
 result.details=details.join('\n\n').slice(0,40000);return result;
}
export function jsTestViolations(original:string,content:string,added:string):string[]{
 const errors:string[]=[];
 if(/\b(?:it|test|describe)\s*\.\s*(?:skip|only|todo)\b|\b(?:xit|xtest|xdescribe|fit|fdescribe)\s*\(/.test(added))errors.push('禁止新增跳过、独占或待实现测试');
 if(/expect\s*\(\s*(?:true|false|\d+|['"][^'"]*['"])\s*\)\s*\.\s*(?:toBe|toEqual|toBeTruthy|toBeFalsy)\b/.test(added))errors.push('禁止新增恒真或无效断言');
 if((content.match(/\bexpect\s*\(/g)??[]).length<(original.match(/\bexpect\s*\(/g)??[]).length)errors.push('断言数量减少');
 if((content.match(/\b(?:it|test)\s*(?:\.[\w]+\s*)?\(/g)??[]).length<(original.match(/\b(?:it|test)\s*(?:\.[\w]+\s*)?\(/g)??[]).length)errors.push('测试数量减少');
 return errors;
}
