import {z} from 'zod';
export const dtsVersion=z.string().trim().toUpperCase().regex(/^R\d{2}C(?:00|10)$/);
const productId=z.string().trim().regex(/^\d+$/);
export const dtsProduct=z.object({rNo:productId,cNo:productId,bNo:productId});
export type DtsProduct=z.infer<typeof dtsProduct>;
export function dtsProductNames(version:string){const v=dtsVersion.parse(version);const r=`MAE-NEM V100R0${v.slice(1,3)}`,c=r+v.slice(3);return {r,c,b:c+'B001'};}
const pbi=z.object({pbiName:z.string(),pbiId:z.union([productId,z.number().int().nonnegative()]).transform(String),parentId:z.union([productId,z.number().int().nonnegative()]).transform(String)});
export async function resolveDtsProduct(version:string,query:(name:string)=>Promise<unknown>):Promise<DtsProduct>{
 const names=dtsProductNames(version);
 async function exact(name:string){
  const response=await query(name);
  const container=z.object({datas:z.array(z.unknown())}).safeParse(response);
  const rows=Array.isArray(response)?response:container.success?container.data.datas:[];
  const matches=rows.flatMap(row=>{const parsed=pbi.safeParse(row);return parsed.success&&parsed.data.pbiName===name?[parsed.data]:[];});
  if(matches.length!==1)throw Error('DTS 未返回唯一且完整的产品版本：'+name+'，未提交建单。');
  return matches[0]!;
 }
 const b=await exact(names.b),c=await exact(names.c),r=await exact(names.r);
 if(b.parentId!==c.pbiId||c.parentId!==r.pbiId)throw Error('DTS 产品版本父子关系不匹配，未提交建单。');
 return {rNo:r.pbiId,cNo:c.pbiId,bNo:b.pbiId};
}
