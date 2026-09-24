import {jsonValues} from '../autout/mr-codehub.js';

// Preserve response structure, not message bodies, diffs or credentials.
export function responseDiagnostic(output:string){
 const values=jsonValues(output);
 const shape=(value:unknown,depth=0):unknown=>{
  if(value===null)return null;
  if(depth>=5)return Array.isArray(value)?{type:'array',length:value.length}:typeof value;
  if(Array.isArray(value))return {type:'array',length:value.length,items:value.slice(0,2).map(v=>shape(v,depth+1))};
  if(typeof value==='object')return Object.fromEntries(Object.entries(value).slice(0,40).map(([key,v])=>[
   /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key)?key:'[non-field-key]',
   /token|secret|password|authorization|cookie|credential|private.?key/i.test(key)?'[REDACTED]':
   ['status','state'].includes(key)&&typeof v==='string'&&['success','failed','running','pending','opened','closed','merged','error'].includes(v)?v:
   ['code','statusCode','resultCode'].includes(key)&&(typeof v==='number'||typeof v==='string'&&/^\d{1,6}$/.test(v))?v:shape(v,depth+1)
  ]));
  return typeof value;
 };
 return {bytes:Buffer.byteLength(output),format:values.length?'json':!output.trim()?'empty':/<(?:!doctype|html)\b/i.test(output)?'html':'text',values:values.slice(0,3).map(v=>shape(v))};
}
