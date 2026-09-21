import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,basename} from 'node:path';
import {spawnSync} from 'node:child_process';

const project=resolve(process.argv[2]??'.');
const packagePath=join(project,'package.json'),lockPath=join(project,'package-lock.json'),nodeModules=join(project,'node_modules'),markerPath=join(nodeModules,'.container-ops-kit-lock');
const [packageText,lockText]=await Promise.all([readFile(packagePath,'utf8'),readFile(lockPath,'utf8')]);
const packageJson=JSON.parse(packageText),lockJson=JSON.parse(lockText);
const fingerprint=createHash('sha256').update([packageText,lockText,process.platform,process.arch,process.versions.modules??''].join('\0')).digest('hex');
const npm=process.platform==='win32'?'npm.cmd':'npm';
function runNpm(args,stdio){return spawnSync(npm,args,{cwd:project,stdio,shell:process.platform==='win32'});}
function npmCheck(){return runNpm(['ls','--all','--silent'],'ignore').status===0;}
async function directVersionsMatch(){const declared={...packageJson.dependencies,...packageJson.devDependencies,...packageJson.optionalDependencies};for(const name of Object.keys(declared)){const expected=lockJson.packages?.[`node_modules/${name}`]?.version;if(!expected)return false;try{const actual=JSON.parse(await readFile(join(nodeModules,name,'package.json'),'utf8')).version;if(actual!==expected)return false;}catch{return false;}}return true;}
async function markerMatches(){try{return(await readFile(markerPath,'utf8')).trim()===fingerprint;}catch{return false;}}
async function markerExists(){try{await readFile(markerPath);return true;}catch{return false;}}
async function saveMarker(){await mkdir(nodeModules,{recursive:true});await writeFile(markerPath,fingerprint+'\n','utf8');}

const marked=await markerMatches(),hasMarker=await markerExists();
if((marked||!hasMarker)&&await directVersionsMatch()&&npmCheck()){
 await saveMarker();console.log(`Locked dependencies for ${basename(project)} are already installed; installation skipped.`);process.exit(0);
}
console.log(`Restoring locked dependencies for ${basename(project)} without deleting node_modules...`);
const installed=runNpm(['install','--prefer-offline','--no-audit','--no-fund'],'inherit');
if(await readFile(lockPath,'utf8')!==lockText){await writeFile(lockPath,lockText,'utf8');console.error('npm attempted to change package-lock.json; the committed lock file was restored.');}
if(installed.status!==0||!await directVersionsMatch()||!npmCheck()){
 console.error(`Unable to restore ${basename(project)} dependencies. Close Node/Vite processes, editors or antivirus scans using this project's node_modules, then retry.`);process.exit(installed.status||1);
}
await saveMarker();console.log(`Locked dependencies for ${basename(project)} are ready.`);
