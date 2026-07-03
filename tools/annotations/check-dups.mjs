/* 重复注释检查（只读）：按 resolved.json 的 hexid 分组已注释 id，报告语料重收
   （乐府类目卷与诗人本集卷收同一首诗）导致的「同页多 id」组，并剔除 id 字段
   比对各组文件内容是否一致。重复本身是 annotate-scrape 的 fanout 设计使然
   （一次抓取写全部兄弟 id，让每个诗页都渲染完整注释），无需消除；
   但手改某个兄弟文件会与其余分叉——手改前先用本工具查出兄弟 id 一并改。

   用法（在 tools/ 下）：
     node annotations/check-dups.mjs [--quiet]
       --quiet 只列出分叉组与汇总，不列一致组。
   退出码：0 = 无分叉；1 = 存在内容分叉的组。不写任何文件。 */
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, '..', '..');
const DATA = join(ROOT, 'data');
const ANN_DIR = join(DATA, 'annotations');
const RESOLVED_PATH = join(SCRIPT_DIR, '..', '.cache', 'gushiwen-web', 'resolved.json');

const QUIET = process.argv.includes('--quiet');
const ANN_FILE_RE = /^[tc]\d+-\d+\.json$/; // 排除 README 与 iCloud 冲突副本

async function readJson(fp, dflt) {
  try { return JSON.parse(await readFile(fp, 'utf8')); } catch { return dflt; }
}

const resolved = await readJson(RESOLVED_PATH, {});
if (!Object.keys(resolved).length) {
  console.error(`读不到 ${RESOLVED_PATH}（尚未跑过 annotate-scrape？），无从分组。`);
  process.exit(1);
}
const annotated = new Set(
  (await readdir(ANN_DIR)).filter((f) => ANN_FILE_RE.test(f)).map((f) => f.slice(0, -5)),
);
const search = await readJson(join(DATA, 'search.json'), []);
const meta = new Map(search.map((r) => [r[0], `《${r[1]}》${r[2] ? ' ' + r[2] : ''}`]));

/* hexid → 已注释的 id 列表（resolved 里未注释的 id 不算重复） */
const byHex = new Map();
for (const [id, r] of Object.entries(resolved)) {
  if (!r || !r.hexid || !annotated.has(id)) continue;
  if (!byHex.has(r.hexid)) byHex.set(r.hexid, []);
  byHex.get(r.hexid).push(id);
}

let groups = 0, extra = 0, diverged = 0;
for (const [hexid, ids] of byHex) {
  if (ids.length < 2) continue;
  groups++;
  extra += ids.length - 1;
  const bodies = await Promise.all(ids.map(async (id) => {
    const a = await readJson(join(ANN_DIR, `${id}.json`), {});
    delete a.id;
    return JSON.stringify(a);
  }));
  const same = bodies.every((b) => b === bodies[0]);
  if (!same) diverged++;
  if (!QUIET || !same) {
    console.log(`${same ? '  一致' : '⚠ 分叉'} ${hexid}  ${ids.map((id) => `${id} ${meta.get(id) || '?'}`).join('  |  ')}`);
  }
}
console.log(`\n同页多 id 组 ${groups}（冗余文件 ${extra}）；内容分叉 ${diverged}。`);
if (diverged) process.exitCode = 1;
