/* 工具脚本共用的路径与读文件助手。路径由本文件位置推导，不依赖 cwd。 */
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TOOLS = resolve(fileURLToPath(new URL('..', import.meta.url)));     // …/QingXin/tools
export const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));   // …/QingXin
export const DATA = join(ROOT, 'data');
export const ANN_DIR = join(DATA, 'annotations');
export const CACHE = join(TOOLS, '.cache');
export const WEB_CACHE = join(CACHE, 'gushiwen-web');

/* 读 JSON。不传默认值：读不到 / 解析失败就抛（validate.mjs 靠 e.code === 'ENOENT' 区分 warning / error）；
   传了默认值：任何失败都返回它（断点、报表等「没有就从头来」的场景）。 */
export async function readJson(fp, ...dflt) {
  try {
    return JSON.parse(await readFile(fp, 'utf8'));
  } catch (e) {
    if (!dflt.length) throw e;
    return dflt[0];
  }
}
