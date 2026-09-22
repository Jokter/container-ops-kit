import type {UtEvidence} from './governance.js';
import {utRegressionPassed} from './governance.js';

export function testClass(id:string):string {
 return id.slice(id.includes('::')?id.lastIndexOf('::')+2:0).split('#')[0]??'';
}
export function targetedTestCommand(command:readonly string[],classes:readonly string[]):string[] {
 const selected=[...new Set(classes)];
 if(!selected.length||selected.some(name=>!/^[$A-Za-z_][$\w]*(?:\.[$A-Za-z_][$\w]*)*$/.test(name)))throw new Error('无法确定需要验证的测试类。');
 return [...command.filter(arg=>arg!=='clean'&&!/^-D(?:test|surefire.failIfNoSpecifiedTests)=/.test(arg)),`-Dtest=${selected.join(',')}`,'-Dsurefire.failIfNoSpecifiedTests=false'];
}
function subset(evidence:UtEvidence,include:(id:string)=>boolean):UtEvidence {
 const caseIds=evidence.caseIds.filter(include),passedIds=evidence.passedIds.filter(include),failedIds=evidence.failedIds.filter(include);
 return {...evidence,caseIds,passedIds,failedIds,tests:caseIds.length,failures:failedIds.length,errors:0,skipped:caseIds.length-passedIds.length-failedIds.length};
}
// Partial reports may update the selected classes only; final publication still requires a full regression.
export function mergeTargetedEvidence(before:UtEvidence,current:UtEvidence,classes:readonly string[],exitCode:number):UtEvidence {
 const matches=(id:string)=>classes.some(name=>testClass(id)===name||testClass(id).startsWith(name+'$'));
 const observed=new Set(current.caseIds.map(testClass));
 current=subset(current,matches);
 if(classes.some(name=>![...observed].some(actual=>actual===name||actual.startsWith(name+'$')))||!utRegressionPassed(subset(before,matches),current,exitCode))throw new Error('相关测试类验证未通过，或原有用例被删除、改名、跳过。');
 const untouched=subset(before,id=>!matches(id));
 return {tests:untouched.tests+current.tests,failures:untouched.failures+current.failures,errors:untouched.errors+current.errors,skipped:untouched.skipped+current.skipped,caseIds:[...new Set([...untouched.caseIds,...current.caseIds])],passedIds:[...new Set([...untouched.passedIds,...current.passedIds])],failedIds:[...new Set([...untouched.failedIds,...current.failedIds])],details:current.details};
}
