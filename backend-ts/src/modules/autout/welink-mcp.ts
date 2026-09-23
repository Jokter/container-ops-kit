import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {z} from 'zod';

export function welinkMcpArgs(env:NodeJS.ProcessEnv=process.env):string[]{
 const source=env.WELINK_MCP_PACKAGE?.trim();
 if(!source)throw Error('请设置 WELINK_MCP_PACKAGE 为 welink-msg 配置中的 --from 地址');
 const address=(value:string)=>{const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('WeLink MCP 制品或镜像地址无效');return value;};
 const args:string[]=[];
 if(env.WELINK_MCP_INDEX_URL?.trim())args.push('--index-url',address(env.WELINK_MCP_INDEX_URL.trim()));
 for(const host of (env.WELINK_MCP_INSECURE_HOSTS||'').split(',').map(v=>v.trim()).filter(Boolean)){if(!/^[a-z0-9.-]+(?::[0-9]+)?$/i.test(host))throw Error('WeLink MCP 内网主机配置无效');args.push('--allow-insecure-host',host);}
 return [...args,'--from',address(source),'welink-msg','stdio'];
}
const object=z.record(z.string(),z.unknown());
export function confirmedWelinkResult(value:unknown):boolean{
 const parsed=object.safeParse(value);if(!parsed.success||parsed.data.isError===true)return false;
 const result=parsed.data;
 const success=(data:unknown)=>{const p=object.safeParse(data);if(!p.success)return false;const r=p.data;return !r.error&&r.success!==false&&(r.resultCode===0||r.resultCode==='0'||r.success===true||r.status==='success');};
 if(success(result.structuredContent))return true;
 const content=z.array(z.object({type:z.string(),text:z.string().optional()})).safeParse(result.content);if(!content.success)return false;
 return content.data.some(c=>{if(c.type!=='text'||!c.text)return false;try{return success(JSON.parse(c.text));}catch{return /^(?:消息发送成功[！!。.]?|发送成功[！!。.]?|message sent successfully[!.]?)$/i.test(c.text.trim());}});
}
export class WelinkMcp {
 constructor(private readonly launch:(token:string)=>ChildProcessWithoutNullStreams=token=>spawn(process.platform==='win32'?'uvx.exe':'uvx',welinkMcpArgs(),{windowsHide:true,detached:process.platform!=='win32',stdio:['pipe','pipe','pipe'],env:{...process.env,WELINK_TOKEN:token}}),private readonly timeoutMs=120000){}
 async send(receiver:string,content:string,token:string,signal?:AbortSignal){
  if(!/^[a-z][a-z0-9._-]{1,79}$/.test(receiver))throw Error('WeLink MCP 接收者工号格式不正确');
  signal?.throwIfAborted();const child=this.launch(token);let sequence=0,buffer='',failure:Error|undefined;
  const pending=new Map<number,{resolve:(v:unknown)=>void;reject:(e:Error)=>void}>();
  const fail=(message:string)=>{failure??=Error(message);for(const p of pending.values())p.reject(failure);pending.clear();};
  const abort=()=>fail('WeLink MCP 通知已中断，发送结果待确认');
  const timer=setTimeout(()=>fail('WeLink MCP 超时，发送结果待确认，请核对后再手动重发'),this.timeoutMs);
  child.stderr.resume(); // Never persist server output: it may contain credentials or message bodies.
  child.on('error',()=>fail('WeLink MCP 无法启动，请确认 uvx 已安装且内网可达'));
  child.on('exit',()=>fail('WeLink MCP 提前退出，发送结果待确认'));
  child.stdin.on('error',()=>fail('WeLink MCP 输入中断，发送结果待确认'));
  child.stdout.setEncoding('utf8');child.stdout.on('data',(chunk:string)=>{
   buffer+=chunk;if(buffer.length>1048576){fail('WeLink MCP 返回过大，发送结果待确认');return;}
   let boundary:number;while((boundary=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,boundary).trim();buffer=buffer.slice(boundary+1);if(!line)continue;
    let value:unknown;try{value=JSON.parse(line);}catch{fail('WeLink MCP 返回格式错误，发送结果待确认');return;}
    const parsed=object.safeParse(value);if(!parsed.success)continue;const message=parsed.data;
    if(typeof message.id!=='number')continue;const p=pending.get(message.id);if(!p)continue;pending.delete(message.id);
    if(message.error)p.reject(Error('WeLink MCP 调用失败，发送结果待确认'));else p.resolve(message.result);
   }
  });
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  const write=(message:unknown)=>child.stdin.write(JSON.stringify(message)+'\n');
  const call=(method:string,params:Record<string,unknown>)=>new Promise<unknown>((resolve,reject)=>{if(failure){reject(failure);return;}const id=++sequence;pending.set(id,{resolve,reject});write({jsonrpc:'2.0',id,method,params});});
  try{
   const initialized=object.parse(await call('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'ops-studio',version:'1.0'}}));
   if(typeof initialized.protocolVersion!=='string')throw Error('WeLink MCP 初始化失败');
   write({jsonrpc:'2.0',method:'notifications/initialized'});
   const listed=z.object({tools:z.array(z.object({name:z.string()}))}).parse(await call('tools/list',{}));
   const name=listed.tools.find(t=>t.name==='send_welink_message'||t.name==='mcp__welink-msg__send_welink_message')?.name;
   if(!name)throw Error('WeLink MCP 未提供 send_welink_message 工具');
   const result=await call('tools/call',{name,arguments:{content,receiver,token:''}});
   if(!confirmedWelinkResult(result))throw Error('WeLink MCP 未返回明确的发送成功结果，请核对消息后手动处理');
  }finally{
   clearTimeout(timer);signal?.removeEventListener('abort',abort);child.stdin.destroy();
   if(child.pid){if(process.platform==='win32'){await new Promise<void>(resolve=>{const killer=spawn('taskkill',['/pid',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.once('error',()=>resolve());killer.once('close',()=>resolve());});}else{try{process.kill(-child.pid,'SIGKILL');}catch{child.kill('SIGKILL');}}}
  }
 }
}
