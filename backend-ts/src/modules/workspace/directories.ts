import {access, readdir, stat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {basename, dirname, parse, resolve} from 'node:path';
import type {DirectoryEntry, DirectoryListing} from '../../../../shared/contracts.js';

async function permitted(path: string, mode: number): Promise<boolean> {
  try {await access(path, mode); return true;} catch {return false;}
}
async function entry(path: string): Promise<DirectoryEntry> {
  return {name: basename(path) || path, path, writable: await permitted(path, constants.W_OK)};
}
export async function browse(requested?: string): Promise<DirectoryListing> {
  if (!requested?.trim()) {
    const candidates = process.platform === 'win32'
      ? Array.from({length: 26}, (_, index) => `${String.fromCharCode(65 + index)}:\\`)
      : ['/'];
    const roots: DirectoryEntry[] = [];
    for (const path of candidates) {
      try {if ((await stat(path)).isDirectory()) roots.push(await entry(path));} catch { /* unavailable drive */ }
    }
    return {current: '', parent: '', writable: false, directories: roots};
  }
  const current = resolve(requested.trim());
  try {
    if (!(await stat(current)).isDirectory() || !await permitted(current, constants.R_OK)) throw new Error();
    const directories: DirectoryEntry[] = [];
    for (const child of await readdir(current, {withFileTypes: true})) {
      const path = resolve(current, child.name);
      if (child.isDirectory()) directories.push(await entry(path));
      else if (child.isSymbolicLink()) {
        try {if ((await stat(path)).isDirectory()) directories.push(await entry(path));} catch { /* broken link */ }
      }
    }
    directories.sort((a, b) => a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0);
    return {current, parent: current === parse(current).root ? '' : dirname(current),
      writable: await permitted(current, constants.W_OK), directories};
  } catch {
    throw Object.assign(new Error(`目录不存在或不可读取：${current}`), {statusCode: 400});
  }
}
