import {stat} from 'node:fs/promises';
import {homedir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

async function exists(path:string,kind:'file'|'directory'):Promise<boolean>{
 try{const info=await stat(path);return kind==='file'?info.isFile():info.isDirectory();}
 catch(error){if(error instanceof Error&&'code' in error&&(error.code==='ENOENT'||error.code==='ENOTDIR'))return false;throw error;}
}

// Resolve from this module, not the task cwd (UT runs inside a different Git checkout).
// Walking to package.json works both in backend-ts/src and dist/backend-ts/src.
export async function projectSkillPackage(moduleUrl:string=import.meta.url):Promise<string>{
 let directory=dirname(fileURLToPath(moduleUrl));
 for(;;){
  if(await exists(join(directory,'package.json'),'file')){
   const skills=join(directory,'skills');
   if(!await exists(join(skills,'package.json'),'file')||!await exists(join(skills,'code-review-skill','SKILL.md'),'file')){
    throw Error('项目内置 Skill 缺失，请完整更新项目 skills 目录后重试');
   }
   return skills;
  }
  const parent=dirname(directory);if(parent===directory)throw Error('无法定位 Ops Studio 项目 Skill 目录');directory=parent;
 }
}

export function personalSkillsDirectory(homeDirectory:string=homedir()):string{
 // os.homedir() uses USERPROFILE on Windows; never persist another user's absolute path.
 return join(homeDirectory,'.agents','skills');
}

export async function withPiSkills(command:readonly string[],options:{moduleUrl?:string;homeDirectory?:string}={}):Promise<readonly string[]>{
 const name=command[0]?.replaceAll('\\','/').split('/').at(-1)??'';
 if(!/^pi(?:\.(?:cmd|bat|exe))?$/i.test(name))return command;
 const end=command.indexOf('--');const flags=command.slice(1,end<0?undefined:end);
 // Explicit opt-out and CLI maintenance/probes must not acquire resources.
 if(flags.some(arg=>['--no-skills','-ns','--help','-h','--version','-v','--list-models','--export'].includes(arg))||
    ['install','remove','uninstall','update','list','config','auth','mcp'].includes(flags[0]??''))return command;
 const skills=await projectSkillPackage(options.moduleUrl);
 const personal=personalSkillsDirectory(options.homeDirectory);
 const extra:string[]=[];
 // A CLI Pi package is resolved before discovered/configured skills. A plain --skill
 // is additive after them and would let an old personal skill win a name collision.
 // The manifest declares skills only: no executable extensions, prompts or themes.
 if(!flags.some((arg,i)=>(arg==='--extension'||arg==='-e')&&flags[i+1]===skills))extra.push('--extension',skills);
 if(await exists(personal,'directory')&&!flags.some((arg,i)=>arg==='--skill'&&flags[i+1]===personal))extra.push('--skill',personal);
 return extra.length?[command[0]!,...extra,...command.slice(1)]:command;
}
