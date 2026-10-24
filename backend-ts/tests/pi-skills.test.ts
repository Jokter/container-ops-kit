import test from 'node:test';
import assert from 'node:assert/strict';
import {chmod,mkdir,mkdtemp,readFile,realpath,rm,writeFile} from 'node:fs/promises';
import {homedir,tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {personalSkillsDirectory,projectSkillPackage,withPiSkills} from '../src/infrastructure/pi-skills.js';
import {runProcess} from '../src/infrastructure/process.js';

test('个人 Skill 使用当前用户主目录；不存在时不传入无效目录',async t=>{
 assert.equal(personalSkillsDirectory(),join(homedir(),'.agents','skills'));
 const home=await mkdtemp(join(tmpdir(),'pi user 空格 '));t.after(()=>rm(home,{recursive:true,force:true}));
 const command=['pi','--mode','rpc','--session','session with spaces.jsonl'];
 const before=await withPiSkills(command,{homeDirectory:home});
 assert.ok(before.includes('--extension'));assert.ok(!before.includes('--skill'));
 const personal=personalSkillsDirectory(home);await mkdir(personal,{recursive:true});
 const after=await withPiSkills(command,{homeDirectory:home});
 assert.equal(after[after.indexOf('--skill')+1],personal);
 assert.deepEqual(after.slice(-command.length+1),command.slice(1));
 assert.deepEqual(command,['pi','--mode','rpc','--session','session with spaces.jsonl']);
 assert.deepEqual(await withPiSkills(after,{homeDirectory:home}),after);
});

test('非 Pi、明确禁用 Skill 和维护命令不读取项目或个人目录',async()=>{
 const options={moduleUrl:'not-a-file-url',homeDirectory:'not-a-directory'};
 for(const command of [
  ['git','status'],['node','script.js'],['pi','--help'],['pi','--version'],['pi','--list-models'],
  ['pi','install','some-package'],['pi','auth','check'],
  ['pi','--print','--no-skills','--no-tools'],['pi','-ns','--mode','rpc'],
 ])assert.equal(await withPiSkills(command,options),command);
});

test('Pi RPC、print 与 Windows 启动形式共用注入，不将 -- 后的正文视为选项',async()=>{
 const bundle=await projectSkillPackage();
 for(const binary of ['pi','pi.cmd','PI.EXE','pi.bat','C:\\Program Files\\Agent\\pi.cmd']){
  for(const args of [['--mode','rpc'],['--print'],['--print','--','--no-skills']]){
   const command=await withPiSkills([binary,...args]);
   assert.deepEqual(command.slice(0,3),[binary,'--extension',bundle]);
   assert.deepEqual(command.slice(-args.length),args);
  }
 }
});

test('从模块位置寻找包根目录，源码与编译产物均不依赖任务 cwd',async t=>{
 const root=await mkdtemp(join(tmpdir(),'ops project 空格 '));t.after(()=>rm(root,{recursive:true,force:true}));
 await writeFile(join(root,'package.json'),'{}');
 await mkdir(join(root,'skills','code-review-skill'),{recursive:true});
 await writeFile(join(root,'skills','package.json'),'{}');
 await writeFile(join(root,'skills','code-review-skill','SKILL.md'),'review');
 for(const relative of ['backend-ts/src/infrastructure/pi-skills.ts','dist/backend-ts/src/infrastructure/pi-skills.js']){
  assert.equal(await projectSkillPackage(pathToFileURL(join(root,relative)).href),join(root,'skills'));
 }
 await rm(join(root,'skills','code-review-skill','SKILL.md'));
 await assert.rejects(projectSkillPackage(pathToFileURL(join(root,'dist/backend-ts/src/infrastructure/pi-skills.js')).href),/内置 Skill 缺失/);
});

test('内置包只声明 Skill，不隐式加载扩展、提示词或主题',async()=>{
 const bundle=await projectSkillPackage();
 const manifest=JSON.parse(await readFile(join(bundle,'package.json'),'utf8'));
 assert.deepEqual(manifest.pi,{skills:['./*/SKILL.md'],extensions:[],prompts:[],themes:[]});
 const skill=await readFile(join(bundle,'code-review-skill','SKILL.md'),'utf8');
 assert.match(skill,/name: code-review-skill/);
 for(const path of ['reference/performance-review-guide.md','reference/architecture-review-guide.md','assets/pr-review-template.md','scripts/pr-analyzer.py']){
  assert.ok((await readFile(join(bundle,'code-review-skill',path),'utf8')).length>0);
 }
});

test('实际进程启动注入项目包，保留工作目录及参数；禁用时不注入',async t=>{
 const root=await mkdtemp(join(tmpdir(),'pi launch 空格 '));t.after(()=>rm(root,{recursive:true,force:true}));
 const helper=join(root,'argv.cjs');await writeFile(helper,'console.log(JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2)}))');
 const binary=join(root,process.platform==='win32'?'pi.cmd':'pi');
 if(process.platform==='win32')await writeFile(binary,'@echo off\r\n"'+process.execPath+'" "'+helper+'" %*\r\n');
 else{await writeFile(binary,'#!'+process.execPath+'\nconsole.log(JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2)}))\n');await chmod(binary,0o755);}
 const args=['--mode','rpc','--session',join(root,'会话 with spaces.jsonl')];
 const result=await runProcess([binary,...args],root,5000);assert.equal(result.exitCode,0);
 const output=JSON.parse(result.output);assert.equal(output.cwd,await realpath(root));
 assert.deepEqual(output.args.slice(0,2),['--extension',await projectSkillPackage()]);
 assert.deepEqual(output.args.slice(-args.length),args);
 const disabled=await runProcess([binary,'--print','--no-skills','--no-tools'],root,5000);
 assert.equal(disabled.exitCode,0);assert.deepEqual(JSON.parse(disabled.output).args,['--print','--no-skills','--no-tools']);
});
