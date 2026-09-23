import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveDtsProduct,dtsProductNames} from '../src/modules/autout/dts-product.js';
test('按完整名称查询 B001，校验 C/R 父级，忽略相似版本',async()=>{
 for(const version of ['R27C00','R27C10']){
  const names=dtsProductNames(version),bNo=version==='R27C00'?'267286537':'268147646',cNo=version==='R27C00'?'266443346':'267987198',calls:string[]=[];
  const result=await resolveDtsProduct(version,async name=>{calls.push(name);return [{pbiName:name+'extra',pbiId:'9',parentId:'8'},{pbiName:name,pbiId:name===names.b?Number(bNo):name===names.c?cNo:'266443320',parentId:name===names.b?cNo:name===names.c?'266443320':'261222267'}];});
  assert.deepEqual(result,{rNo:'266443320',cNo,bNo});assert.deepEqual(calls,[names.b,names.c,names.r]);
 }
});
test('查询为空、重名、字段缺失或父级不匹配时拒绝使用结果',async()=>{
 const name=dtsProductNames('R27C10').b,row={pbiName:name,pbiId:'1',parentId:'2'};
 for(const response of [[],[row,row],[{pbiName:name,pbiId:'1'}],[{...row,pbiName:name+'extra'}]])await assert.rejects(resolveDtsProduct('R27C10',async()=>response),/唯一且完整/);
 await assert.rejects(resolveDtsProduct('R27C10',async name=>({datas:[{pbiName:name,pbiId:'1',parentId:'2'}]})),/父子关系/);
});
