import {readdir,stat,rm} from 'node:fs/promises';
import {join} from 'node:path';

export async function pruneDeploymentPreparations(root:string,active:ReadonlySet<string>):Promise<string[]> {
  const entries=await readdir(root,{withFileTypes:true}).catch((error:NodeJS.ErrnoException)=>{
    if(error.code==='ENOENT')return [];
    throw error;
  });
  const directories=await Promise.all(entries.filter(entry=>entry.isDirectory()&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(entry.name)).map(async entry=>({
    name:entry.name,modified:(await stat(join(root,entry.name))).mtimeMs,
  })));
  directories.sort((a,b)=>Number(active.has(b.name))-Number(active.has(a.name))||b.modified-a.modified||a.name.localeCompare(b.name));
  const deleted:string[]=[];
  for(const entry of directories.slice(10)) {
    if(active.has(entry.name))continue;
    await rm(join(root,entry.name),{recursive:true,force:true});
    deleted.push(entry.name);
  }
  return deleted;
}
