import {z} from 'zod';
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {homedir} from 'node:os';
import type {TaskStore} from '../../platform/store.js';

interface Secret {iv:string;tag:string;encrypted:string}
export class WelinkSettings {
 constructor(private readonly store:TaskStore,private readonly keyPath=join(homedir(),'.container-ops-kit','welink.key')){}
 status(){return{configured:!!this.store.getRecord<Secret>('welink-settings','token')||!!process.env.WELINK_TOKEN?.trim()};}
 private key(create=false){
  if(create){mkdirSync(dirname(this.keyPath),{recursive:true,mode:0o700});try{writeFileSync(this.keyPath,randomBytes(32),{flag:'wx',mode:0o600});}catch(error){if(!(error instanceof Error&&'code' in error&&error.code==='EEXIST'))throw error;}}
  const key=readFileSync(this.keyPath);if(key.length!==32)throw Error('Invalid key');return key;
 }
 save(token:string){
  try{const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key(true),iv),encrypted=Buffer.concat([cipher.update(token,'utf8'),cipher.final()]);
   this.store.putRecord('welink-settings','token',{iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),encrypted:encrypted.toString('base64')});
  }catch{throw Object.assign(Error('WeLink Token 保存失败，请检查本机密钥目录权限。'),{statusCode:400});}
  return this.status();
 }
 clear(){this.store.deleteRecord('welink-settings','token');return this.status();}
 token(){
  const secret=this.store.getRecord<Secret>('welink-settings','token');if(!secret){const token=process.env.WELINK_TOKEN?.trim();if(token)return token;throw Error('请在连接设置中配置 WeLink Token，或设置 WELINK_TOKEN。');}
  try{const decipher=createDecipheriv('aes-256-gcm',this.key(),Buffer.from(secret.iv,'base64'));decipher.setAuthTag(Buffer.from(secret.tag,'base64'));return Buffer.concat([decipher.update(Buffer.from(secret.encrypted,'base64')),decipher.final()]).toString('utf8');}
  catch{throw Error('WeLink Token 无法解密，请在连接设置中重新配置。');}
 }
}

export function welinkSettingsRoutes(app:import('fastify').FastifyInstance,store:TaskStore){
 const settings=new WelinkSettings(store);
 app.get('/api/auto-ut/welink-settings',async()=>settings.status());
 app.put('/api/auto-ut/welink-settings',async request=>{const {token}=z.object({token:z.string().trim().min(1).max(16384).regex(/^[^\r\n]+$/)}).parse(request.body);return settings.save(token);});
 app.delete('/api/auto-ut/welink-settings',async()=>settings.clear());
}
