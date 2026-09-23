import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {z} from 'zod';

// Defaults match the supplied send_welink.py / welink-msg 1.1.0 configuration.
const defaultSource='https://cmc.centralrepo.rnd.huawei.com/artifactory/product_generic/hw-generic_computing_mcp_server/servers/welink-msg/1.1.0/welink_msg-1.1.0.tar.gz';
const defaultIndex='https://mirrors.tools.huawei.com/pypi/simple';
const defaultHosts=['mirrors.tools.huawei.com','cmc.centralrepo.rnd.huawei.com'];
export function welinkMcpArgs(env:NodeJS.ProcessEnv=process.env):string[]{
 const address=(value:string)=>{try{const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error();return value;}catch{throw Error('WeLink MCP 制品或镜像地址无效');}};
 const validate=(args:string[])=>{
  if(args.at(-2)!=='welink-msg'||args.at(-1)!=='stdio')throw Error('WeLink MCP 启动参数必须以 welink-msg stdio 结尾');
  if(args.length%2!==0)throw Error('WeLink MCP 启动参数缺少值');
  let source=false;
  for(let i=0;i<args.length-2;i+=2){const flag=args[i],value=args[i+1];if(!value)throw Error('WeLink MCP 启动参数缺少值');
   if(flag==='--from'||flag==='--index-url'){address(value);if(flag==='--from')source=true;}
   else if(flag==='--allow-insecure-host'){if(!/^[a-z0-9.-]+(?::[0-9]+)?$/i.test(value))throw Error('WeLink MCP 内网主机配置无效');}
   else throw Error('WeLink MCP 启动参数仅支持 --index-url、--allow-insecure-host 和 --from');
  }
  if(!source)throw Error('WeLink MCP 启动参数缺少 --from');return args;
 };
 if(env.WELINK_MCP_UVX_ARGS?.trim()){
  let value:unknown;try{value=JSON.parse(env.WELINK_MCP_UVX_ARGS);}catch{throw Error('WELINK_MCP_UVX_ARGS 必须是 JSON 字符串数组');}
  const parsed=z.array(z.string().min(1).max(8192)).min(3).max(32).safeParse(value);
  if(!parsed.success||!/^uvx(?:\.exe)?$/i.test(parsed.data[0]!))throw Error('WELINK_MCP_UVX_ARGS 必须是以 uvx 或 uvx.exe 开头的参数数组');
  return validate(parsed.data.slice(1));
 }
 const source=env.WELINK_MCP_PACKAGE?.trim()||defaultSource,index=env.WELINK_MCP_INDEX_URL?.trim()||defaultIndex;
 const hosts=env.WELINK_MCP_INSECURE_HOSTS===undefined?defaultHosts:env.WELINK_MCP_INSECURE_HOSTS.split(',').map(v=>v.trim()).filter(Boolean);
 return validate(['--index-url',index,...hosts.flatMap(host=>['--allow-insecure-host',host]),'--from',source,'welink-msg','stdio']);
}
const object=z.record(z.string(),z.unknown());
function acknowledgement(data:unknown):boolean|undefined{
 const p=object.safeParse(data);if(!p.success)return;const r=p.data;
 if(r.error||r.success===false||r.resultCode!==undefined&&r.resultCode!==0&&r.resultCode!=='0')return false;
 if(r.status!==undefined&&!['ok','success','succeeded'].includes(String(r.status).toLowerCase()))return false;
 if(r.resultCode===0||r.resultCode==='0'||r.success===true||['ok','success','succeeded'].includes(String(r.status).toLowerCase()))return true;
 return;
}
export function confirmedWelinkResult(value:unknown):boolean{
 const parsed=object.safeParse(value);if(!parsed.success||parsed.data.isError===true||parsed.data.error)return false;
 const result=parsed.data,structured=acknowledgement(result.structuredContent);if(structured===false)return false;
 const content=z.array(z.object({type:z.string(),text:z.string().optional()})).safeParse(result.content);let confirmed=structured===true;
 if(!content.success)return confirmed;
 for(const c of content.data){if(c.type!=='text'||!c.text)continue;
  let status:boolean|undefined;
  try{status=acknowledgement(JSON.parse(c.text));}
  catch{const text=c.text.trim().replace(/^✅\s*/u,'');if(/未成功|不成功|失败|未发送|未确认|超时|timeout|failed|failure|not sent|not successful/i.test(text))status=false;else if(/^(?:(?:消息)?(?:发送成功|已成功发送|已发送成功)|message sent successfully)(?:[！!。.,，:：\s]|$)/i.test(text))status=true;}
  if(status===false)return false;if(status===true)confirmed=true;
 }
 return confirmed;
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
    let value:unknown;try{value=JSON.parse(line);}catch{continue;} // Ignore startup banners, as in the reference client; never log them.
    const parsed=object.safeParse(value);if(!parsed.success)continue;const message=parsed.data;
    if(message.jsonrpc!=='2.0'||typeof message.id!=='number')continue;const p=pending.get(message.id);if(!p)continue;pending.delete(message.id);
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
   const result=await call('tools/call',{name,arguments:{content,receiver}});
   if(!confirmedWelinkResult(result))throw Error('WeLink MCP 未返回明确的发送成功结果，请核对消息后手动处理');
  }finally{
   clearTimeout(timer);signal?.removeEventListener('abort',abort);child.stdin.destroy();
   if(child.pid){if(process.platform==='win32'){await new Promise<void>(resolve=>{const killer=spawn('taskkill',['/pid',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.once('error',()=>resolve());killer.once('close',()=>resolve());});}else{try{process.kill(-child.pid,'SIGKILL');}catch{child.kill('SIGKILL');}}}
  }
 }
}
