import {z} from 'zod';
import {WelinkMcp,welinkMcpArgs} from './welink-mcp.js';

const mcpSchema=z.object({packageUrl:z.string().trim().min(1).max(8192),indexUrl:z.string().trim().min(1).max(8192),insecureHosts:z.string().trim().max(2048)}).strict();
type McpConfig=z.infer<typeof mcpSchema>;
function configArgs(config:McpConfig){return welinkMcpArgs({WELINK_MCP_PACKAGE:config.packageUrl,WELINK_MCP_INDEX_URL:config.indexUrl,WELINK_MCP_INSECURE_HOSTS:config.insecureHosts});}
function argsConfig(args:string[]):McpConfig{
 const last=(flag:string)=>{const index=args.lastIndexOf(flag);return index<0?'':args[index+1]??'';};
 return {packageUrl:last('--from'),indexUrl:last('--index-url'),insecureHosts:args.flatMap((v,i)=>v==='--allow-insecure-host'?[args[i+1]??'']:[]).join(',')};
}
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {homedir} from 'node:os';
import type {TaskStore} from '../../platform/store.js';

interface Secret {iv:string;tag:string;encrypted:string}
export class WelinkSettings {
 constructor(private readonly store:TaskStore,private readonly keyPath=join(homedir(),'.container-ops-kit','welink.key')){}
 mcpArgs(){const saved=this.store.getRecord<McpConfig>('welink-settings','mcp');return saved?configArgs(mcpSchema.parse(saved)):welinkMcpArgs();}
 mcpStatus(){return {config:argsConfig(this.mcpArgs()),defaults:argsConfig(welinkMcpArgs({})),source:this.store.getRecord('welink-settings','mcp')?'saved':'runtime'};}
 saveMcp(value:unknown){const config=mcpSchema.parse(value);try{configArgs(config);}catch{throw Object.assign(Error('WeLink MCP 配置无效：地址须为 HTTP(S)，不能包含账号密码；主机用逗号分隔。'),{statusCode:400});}this.store.putRecord('welink-settings','mcp',config);return this.mcpStatus();}
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

export function welinkSettingsRoutes(app:import('fastify').FastifyInstance,store:TaskStore,sender?:Pick<WelinkMcp,'send'>){
 const settings=new WelinkSettings(store),client=sender??new WelinkMcp(undefined,undefined,()=>settings.mcpArgs());
 let testing=false;
 app.post('/api/auto-ut/welink-mcp-settings/test',async(request,reply)=>{
  const parsed=z.object({receiver:z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9._-]{1,79}$/)}).strict().safeParse(request.body);
  if(!parsed.success)return reply.code(400).send({message:'请填写有效的接收人工号（保留字母前缀）。'});
  if(testing)return reply.code(409).send({message:'测试消息正在发送，请等待结果，勿重复发送。'});
  let token:string;try{token=settings.token();settings.mcpArgs();}catch(error){return reply.code(400).send({message:error instanceof Error?error.message:'请检查 WeLink 配置。'});}
  testing=true;
  try{await client.send(parsed.data.receiver,'Ops Studio：这是一条 WeLink MCP 连接测试消息，收到即表示消息链路正常。',token);return{message:'MCP 已确认发送成功，请在 WeLink 中查收测试消息。'};}
  catch{return reply.code(502).send({message:'测试消息发送未确认。请先核对 WeLink 是否收到，避免重复发送；检查 Token、uvx、内网连接及 MCP 配置。'});}
  finally{testing=false;}
 });
 app.get('/api/auto-ut/welink-mcp-settings',async()=>settings.mcpStatus());
 app.put('/api/auto-ut/welink-mcp-settings',async request=>settings.saveMcp(request.body));
 app.get('/api/auto-ut/welink-settings',async()=>settings.status());
 app.put('/api/auto-ut/welink-settings',async request=>{const {token}=z.object({token:z.string().trim().min(1).max(16384).regex(/^[^\r\n]+$/)}).parse(request.body);return settings.save(token);});
 app.delete('/api/auto-ut/welink-settings',async()=>settings.clear());
}
