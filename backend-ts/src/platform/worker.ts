import {opendir, stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {taskInput} from '../../../shared/contracts.js';

process.once('disconnect', () => process.exit(1));
process.once('message', async (message: unknown) => {
  try {
    const input = taskInput.parse(message);
    const path = resolve(input.path);
    if (!(await stat(path)).isDirectory()) throw new Error('工作区不是目录');
    process.send?.({type: 'progress', message: '正在扫描工作区一级目录（不读取文件内容）'});
    let files = 0, directories = 0, links = 0;
    const handle = await opendir(path);
    for await (const child of handle) {
      if (child.isDirectory()) directories++;
      else if (child.isSymbolicLink()) links++;
      else if (child.isFile()) files++;
    }
    process.send?.({type: 'result', ok: true, message: `扫描完成：${directories} 个目录，${files} 个文件，${links} 个符号链接`}, () => process.disconnect());
  } catch {
    process.send?.({type: 'result', ok: false, message: '工作区无法读取或输入无效'}, () => process.disconnect());
  }
});
