export const defaultCompileCommand=['mvn','-B','-ntp','-U','-s','.ci/settings.xml','test-compile','-DskipTests','-Djacoco.skip=true'];
// A task-specific Maven template, not a shell or arbitrary command endpoint.
export function compileCommand(input:string):string[]{
 const parts=input.trim().split(/\s+/);
 if(input.length>4096||/[\r\n\0]/.test(input)||defaultCompileCommand.some((v,i)=>parts[i]!==v))throw Object.assign(Error('请保留原 Maven 编译命令，仅允许追加 -pl 模块列表及可选 -am。'),{statusCode:400});
 const extra=parts.slice(defaultCompileCommand.length);
 if(!extra.length)return [...defaultCompileCommand];
 const modules=extra[1]?.replace(/^(["'])(.*)\1$/,'$2');
 if(extra[0]!=='-pl'||!modules||!modules.split(',').every(p=>/^[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(p)&&p.split('/').every(s=>s&&s!=='.'&&s!=='..'))||extra.length>3||(extra.length===3&&extra[2]!=='-am'))throw Object.assign(Error('模块列表格式不正确，例如 -pl model,website-service；可追加 -am。'),{statusCode:400});
 return [...defaultCompileCommand,'-pl',modules,...(extra[2]?['-am']:[])];
}
export function taskMavenCommand(command:readonly string[],selection:readonly string[]=[]):string[]{
 const validated=compileCommand([...defaultCompileCommand,...selection].join(' ')).slice(defaultCompileCommand.length);
 return [...command,...validated];
}
