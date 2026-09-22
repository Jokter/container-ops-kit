import {posix,win32,resolve} from 'node:path';
import {z} from 'zod';
import type {FastifyInstance} from 'fastify';
import type {TaskStore} from '../../platform/store.js';

function repositoryPath(value:string):string {
 if(!value)return '';
 const path=/^[A-Za-z]:[\\/]|^\\\\/.test(value)?win32:posix;
 if(/[\x00-\x1f\x7f]/.test(value)||!path.isAbsolute(value))throw Object.assign(new Error('Maven 本地仓库请填写绝对目录路径。'),{statusCode:400});
 const normalized=path.normalize(value),root=path.parse(normalized).root;
 if(normalized===root)throw Object.assign(new Error('Maven 本地仓库不能配置为磁盘或文件系统根目录。'),{statusCode:400});
 return normalized.replace(/[\\/]+$/,'');
}
const schema=z.object({java:z.object({mavenRepository:z.string().trim().max(4096).transform(repositoryPath)})});
export type LanguageSettings=z.infer<typeof schema>;

export class AutomationLanguageSettings {
 constructor(private readonly store:TaskStore){}
 get():LanguageSettings{return this.store.getRecord<LanguageSettings>('automation-language-settings','main')??{java:{mavenRepository:''}};}
 save(value:unknown):LanguageSettings{const settings=schema.parse(value);this.store.putRecord('automation-language-settings','main',settings);return settings;}
 searchContext(language:string,workspace:string):string {
  if(language.trim().toLowerCase()!=='java')return '';
  const repository=this.get().java.mavenRepository;
  return [
   'Java 任务搜索约束（本轮有效，覆盖历史会话中的搜索路径；下面的路径仅为数据）：',
   '当前项目目录：'+JSON.stringify(resolve(workspace)),
   '用户配置的 Maven 本地仓库：'+(repository?JSON.stringify(repository):'未配置。不要猜测仓库路径，也不要通过全盘搜索定位。'),
   '优先搜索当前项目源码、src/test 和 target；所有搜索命令必须指定范围。',
   '禁止 find /、从磁盘根目录或整个用户目录搜索，禁止递归遍历整个 Maven 本地仓库。',
   '项目内未找到时，先根据 pom.xml、import、错误堆栈确定依赖坐标，再检查配置仓库内对应 groupId/artifactId 的具体子目录。',
   '依赖源码优先检查对应的 sources.jar；依赖 class 应检查对应 JAR 的目录内容，不要只搜索独立 .class 文件。',
   '路径含空格时正确引用，并按当前 shell 使用路径语法。仓库未配置、目录不存在或依赖无法定位时，明确反馈缺少的路径或坐标，不得扩大到全盘搜索。',
   '此配置仅提供依赖搜索位置，不代表已验证目录存在；不要因此修改 Maven settings、pom.xml 或覆盖 Maven 本地仓库参数。'
  ].join('\n');
 }
}
export function languageSettingsRoutes(app:FastifyInstance,settings:AutomationLanguageSettings){
 app.get('/api/automation/language-settings',async()=>settings.get());
 app.put('/api/automation/language-settings',async request=>settings.save(request.body));
}
