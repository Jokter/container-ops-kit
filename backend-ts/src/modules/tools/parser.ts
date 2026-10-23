import {z} from 'zod';

export function bad(message:string):never {throw Object.assign(new Error(message),{statusCode:400});}
const name=z.string().min(1).max(100).regex(/^@?[A-Za-z_][A-Za-z0-9_]*$/).refine(v=>!['__proto__','constructor','prototype'].includes(v));
export interface Field {
 name:string;type:'int'|'long'|'hex'|'ascii'|'nest'|'array';offset?:number|undefined;
 tag?:string|undefined;childrenLengthOffset?:number|undefined;children?:Field[]|undefined;lengthKey?:string|undefined;skip?:boolean|undefined;supportArray?:boolean|undefined;
 label?:string|undefined;desc?:string|undefined;unit?:string|undefined;enum?:Record<string,string>|undefined;invalidValue?:number|string|undefined;min?:number|undefined;max?:number|undefined;
}
const fieldSchema:z.ZodType<Field>=z.lazy(()=>z.object({
 name,type:z.enum(['int','long','hex','ascii','nest','array']),offset:z.number().int().min(0).max(131072).optional(),
 tag:z.string().regex(/^[a-fA-F0-9]*$/).max(16).optional(),childrenLengthOffset:z.number().int().min(2).max(8).multipleOf(2).optional(),
 children:z.array(fieldSchema).max(1024).optional(),lengthKey:z.string().max(512).optional(),skip:z.boolean().optional(),supportArray:z.boolean().optional(),
 label:z.string().max(200).optional(),desc:z.string().max(2000).optional(),unit:z.string().max(100).optional(),
 enum:z.record(z.string().max(100),z.string().max(500)).optional(),invalidValue:z.union([z.number().finite(),z.string().max(100)]).optional(),
 min:z.number().int().safe().optional(),max:z.number().int().safe().optional(),
}).strict());
export function validateFields(input:unknown,code:string):Field[]{
 // Bound recursion before applying the recursive schema, including malicious JSON.
 let nodes=0;
 function bound(value:unknown,depth:number):void{
  if(depth>24||++nodes>20000)bad('配置过大或嵌套过深');
  if(value&&typeof value==='object')for(const v of Object.values(value))bound(v,depth+1);
 }
 bound(input,0);
 const fields=z.array(fieldSchema).min(2).max(1024).parse(input);
 const available=new Set<string>();let count=0;
 function visit(list:Field[],prefix='',depth=0):void{
  if(depth>10)bad('字段嵌套不能超过 10 层');const names=new Set<string>();
  for(const f of list){
   if(++count>2048)bad('配置字段不能超过 2048 个');
   if(names.has(f.name))bad('字段名称重复：'+f.name);names.add(f.name);
   const path=prefix?prefix+'.'+f.name:f.name;
   if(f.min!==undefined||f.max!==undefined){if(!['int','long'].includes(f.type))bad('min/max 仅支持整数字段：'+path);if(f.min!==undefined&&f.max!==undefined&&f.min>f.max)bad('min 不能大于 max：'+path);}
   if(f.type==='array'){
    const key=f.lengthKey?.includes('.')?f.lengthKey:prefix+'.'+f.lengthKey;
    const resolved=prefix?key:f.lengthKey;
    if(!resolved||!available.has(resolved))bad('数组 lengthKey 必须引用之前的 @ 整数字段：'+path);
    if(!f.children?.length)bad('数组必须包含子字段');
   }else if(!f.offset||f.offset%2)bad('offset 必须是正偶数（HEX 字符数）：'+path);
   if(['int','long'].includes(f.type)&&(f.offset??0)>16)bad('整数字段最多 16 个 HEX 字符');
   if(f.type==='nest'){
    if(f.tag&&f.tag.length!==f.offset)bad('tag 长度必须与 offset 一致：'+path);
    if(!f.skip&&!f.children?.length)bad('嵌套必须包含 children 或设置 skip');
   }
   if(f.name.startsWith('@')&&['int','long'].includes(f.type))available.add(path);
   if(f.children){if(!['nest','array'].includes(f.type))bad('只有 nest/array 支持 children');visit(f.children,path,depth+1);}
  }
 }
 visit(fields);
 if(fields[0]?.name!=='cmdCode'||fields[0].type!=='hex'||fields[0].offset!==4||!fields.some(f=>f.name==='Handle'&&f.type==='hex'))bad('配置需要首字段 cmdCode（hex / 4）和 Handle（hex）');
 const tags=fields.filter(f=>f.type==='nest');
 if(code==='2d63'){
  if(tags.length!==2||tags[0]?.name!=='NodeInfo'||tags[1]?.name!=='LineInfo'||!fields.some(f=>f.name==='NodeInfoNumber')||!fields.some(f=>f.name==='LineInfoNumber'))bad('2d63 需要节点与链路计数及 NodeInfo / LineInfo');
 }else{
  const seen=new Set<string>();for(const f of tags){if(!f.tag||f.offset!==4||(f.childrenLengthOffset??4)!==4)bad('根 TLV 需要 4 字符 tag 和 4 字符长度');const tag=f.tag.toLowerCase();if(seen.has(tag))bad('根 tag 重复');seen.add(tag);}
 }
 return fields;
}
export interface ParsedField {path:string;group:string;tag:string;value:number|string;label:string;unit:string;description:string;meaning:string;invalid:boolean;issues:Array<{kind:"invalid"|"enum"|"range";message:string}>;}
export interface ParseResult {code:string;matched:boolean;feature:number|string|null;expected:number|null;bytes:number;fields:ParsedField[];warnings:string[];}
class Reader {
 pos=0;
 constructor(readonly hex:string,readonly base=0){}
 take(n:number,label:string):string{if(!Number.isSafeInteger(n)||n<0||this.pos+n>this.hex.length)bad(`${label} 在字节 ${(this.base+this.pos)/2} 数据不足，需要 ${n/2} 字节`);const s=this.hex.slice(this.pos,this.pos+n);this.pos+=n;return s;}
 get remaining(){return this.hex.length-this.pos;}
}
export function parseFrame(code:string,fields:Field[],input:string,expected:number|null=null):ParseResult{
 const hex=input.replace(/\s/g,'').toLowerCase();
 if(!hex||hex.length%2||!/^[0-9a-f]+$/.test(hex))bad('报文必须是完整的偶数位 HEX，可包含空白');
 if(hex.length>262144)bad('单条报文不能超过 128 KiB');
 if(hex.slice(0,4)!==code)bad('报文命令码与所选命令不一致');
 const out:ParseResult={code,matched:true,feature:null,expected,bytes:hex.length/2,fields:[],warnings:[]};
 const context=new Map<string,number|string>(),header=new Map<string,number|string>();let steps=0;
 function warn(s:string){if(out.warnings.length<100)out.warnings.push(s);}
 function read(f:Field,r:Reader,prefix:string,group:string,tag:string):void{
  if(++steps>20000)bad('报文字段数量超过 20000');const path=prefix?prefix+'.'+f.name:f.name;
  if(f.type==='nest'){
   const actual=r.take(f.offset??0,path+' tag');if(f.tag&&actual!==f.tag.toLowerCase())bad(path+' tag 不匹配');
   const size=parseInt(r.take(f.childrenLengthOffset??4,path+' length'),16)*2,base=r.base+r.pos;
   const child=new Reader(r.take(size,path),base);if(f.skip)return;
   for(const sub of f.children??[])read(sub,child,path,group,actual);
   if(child.remaining)warn(path+' 有 '+child.remaining/2+' 个未配置字节');return;
  }
  if(f.type==='array'){
   const key=f.lengthKey?.includes('.')?f.lengthKey:prefix?prefix+'.'+f.lengthKey:f.lengthKey??'';
   const n=context.get(key);if(typeof n!=='number'||!Number.isSafeInteger(n)||n<0||n>4096)bad(path+' 数组计数无效或超过 4096');
   for(let i=0;i<n;i++){for(const sub of f.children??[])read(sub,r,path+'['+i+']',group,tag);}
   context.delete(key);return;
  }
  const raw=r.take(f.offset??0,path);let value:number|string=raw;
  if(f.type==='int'||f.type==='long'){const n=BigInt('0x'+raw);value=n<=BigInt(Number.MAX_SAFE_INTEGER)?Number(n):n.toString();}
  if(f.type==='ascii')value=Buffer.from(raw,'hex').toString('latin1').split('\0')[0]??'';
  // Array indices belong to display paths, not protocol references.
  const schemaPath=path.replace(/\[\d+\]/g,'');if(f.name.startsWith('@'))context.set(schemaPath,value);
  if(!prefix)header.set(f.name,value);if(schemaPath==='featureCause.feature')out.feature=value;
  const invalid=f.invalidValue!==undefined&&String(f.invalidValue)===String(value);
  const issues:ParsedField['issues']=[];
  if(invalid)issues.push({kind:'invalid',message:'命中配置中的无效值：'+f.invalidValue});
  else{
   if(f.enum&&Object.keys(f.enum).length&&!Object.hasOwn(f.enum,String(value)))issues.push({kind:'enum',message:'未匹配已配置枚举；配置值：'+Object.entries(f.enum).map(([key,label])=>key+' '+label).join('、')});
   if((f.type==='int'||f.type==='long')&&(f.min!==undefined||f.max!==undefined)){
    const actual=BigInt(value);
    if(f.min!==undefined&&actual<BigInt(f.min)||f.max!==undefined&&actual>BigInt(f.max))issues.push({kind:'range',message:'超出配置范围：'+(f.min??'不限')+'–'+(f.max??'不限')+(f.unit?' '+f.unit:'')+'；实际：'+value});
   }
  }
  out.fields.push({path,group,tag,value,issues,label:f.label??f.name,unit:f.unit??'',description:f.desc??'',meaning:invalid?'无效值':f.enum?.[String(value)]??'',invalid});
 }
 const r=new Reader(hex),tags=fields.filter(f=>f.type==='nest');
 for(const f of fields.filter(f=>f.type!=='nest'))read(f,r,'','报文头','');
 if(code==='2d63'){
  for(const [i,key] of ['NodeInfoNumber','LineInfoNumber'].entries()){
   const n=header.get(key),f=tags[i];if(typeof n!=='number'||n<0||n>4096||!f)bad('拓扑计数无效');
   for(let j=0;j<n;j++)read({...f,name:f.name+'['+j+']'},r,'',f.label??f.name,f.tag??'');
  }
 }else if(tags.length){
  const occurrences=new Map<string,number>();while(r.remaining){
   const tag=r.hex.slice(r.pos,r.pos+4),f=tags.find(t=>t.tag?.toLowerCase()===tag);
   if(f){const n=occurrences.get(f.name)??0;occurrences.set(f.name,n+1);if(n&&!f.supportArray)bad('重复 tag '+tag+'，配置未启用 supportArray');read(f.supportArray?{...f,name:f.name+'['+n+']'}:f,r,'',f.label??f.name,tag);}
   else{r.take(4,'未知 tag');const n=parseInt(r.take(4,'未知 tag length'),16);r.take(n*2,'未知 tag '+tag);warn('跳过未知 tag '+tag+'（'+n+' 字节）');}
  }
 }
 if(r.remaining)bad('报文尾部存在 '+r.remaining/2+' 个多余字节');
 out.matched=expected===null||out.feature===null||out.feature===expected;
 return out;
}
