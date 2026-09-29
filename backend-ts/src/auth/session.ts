import {readFileSync} from 'node:fs';
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';

export const accountSchema=z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_-]{1,39}$/);
const schema=z.object({defaultPassword:z.string().min(1).max(256),allowedAccounts:z.array(accountSchema).max(500).refine(v=>new Set(v).size===v.length,'白名单账号不能重复')}).strict();
export function readAuthConfig(path:string){try{return schema.parse(JSON.parse(readFileSync(path,'utf8')));}catch{throw Object.assign(Error('登录配置不可用，请管理员检查 auth-config.json'),{statusCode:503});}}
export type AuthConfig=ReturnType<typeof readAuthConfig>;
const digest=(value:string)=>createHash('sha256').update(value).digest();
export const passwordMatches=(supplied:string,expected:string)=>timingSafeEqual(digest(supplied),digest(expected));
interface Session {account:string;expires:number;passwordVersion:string}
export class Sessions {
 private readonly values=new Map<string,Session>();
 private readonly attempts=new Map<string,{count:number;until:number}>();
 constructor(private readonly lifetime=12*3600_000){}
 private version(config:AuthConfig){return digest(config.defaultPassword).toString('hex');}
 issue(account:string,config:AuthConfig){this.sweep();if(this.values.size>=10000)throw Object.assign(Error('登录会话过多，请稍后重试'),{statusCode:429});const token=randomBytes(32).toString('hex');this.values.set(digest(token).toString('hex'),{account,expires:Date.now()+this.lifetime,passwordVersion:this.version(config)});return token;}
 token(cookie:string|undefined){return cookie?.split(';').map(v=>v.trim()).find(v=>v.startsWith('ops_session='))?.slice(12)??'';}
 get(token:string,config:AuthConfig){const key=digest(token).toString('hex'),session=this.values.get(key);if(!session)return;
  if(session.expires<=Date.now()||!config.allowedAccounts.includes(session.account)||session.passwordVersion!==this.version(config)){this.values.delete(key);return;}return session;
 }
 revoke(token:string){this.values.delete(digest(token).toString('hex'));}
 allow(ip:string){this.sweep();const row=this.attempts.get(ip);if(row&&row.count>=10)return false;if(this.attempts.size>=10000&&!row)return false;this.attempts.set(ip,{count:(row?.count??0)+1,until:row?.until??Date.now()+60_000});return true;}
 sweep(){const now=Date.now();for(const [key,s]of this.values)if(s.expires<=now)this.values.delete(key);for(const [key,a]of this.attempts)if(a.until<=now)this.attempts.delete(key);}
}
