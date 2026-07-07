/* 生成 data/featured.json —— 首页推荐池。
   口径:注释文件中 赏析非空 且 (注释或译文非空) 的非 AI 诗(保证 hero 点进去内容最全)。
   产物为这些诗的完整索引行 {id,title,author,dynasty,kind,excerpt},与 data/index/
   行结构一致,前端 poemRow/hero 零适配,按索引序排列(diff 稳定)。

   注释覆盖变化(新爬/手写新增)后重跑:
     node tools/data/build-featured.mjs
   单篇手写注释不重跑也能在详情页生效,只是暂不进入首页推荐池。 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(SCRIPT_DIR, '..', '..', 'data');
const ANN_DIR = join(DATA, 'annotations');
const OUT = join(DATA, 'featured.json');

const ANN_FILE_RE = /^[tc]\d+-\d+\.json$/; // 排除 README 与 iCloud 冲突副本
const ne = (x) => Array.isArray(x) && x.length > 0;
const pad4 = (n) => String(n).padStart(4, '0');

/* 1) 合格 id 集:非 AI 且赏析非空 且 (注释或译文非空) */
const eligible = new Set();
let scanned = 0;
let aiSkipped = 0;
for (const f of (await readdir(ANN_DIR)).filter((f) => ANN_FILE_RE.test(f))) {
  scanned++;
  const a = JSON.parse(await readFile(join(ANN_DIR, f), 'utf8'));
  if (a.source === 'ai') {
    aiSkipped++;
    continue;
  }
  if (ne(a.appreciation) && (ne(a.notes) || ne(a.translation))) eligible.add(f.slice(0, -5));
}

/* 2) 按索引序收集合格 id 的完整索引行 */
const manifest = JSON.parse(await readFile(join(DATA, 'manifest.json'), 'utf8'));
const rows = [];
for (let p = 0; p < manifest.pages; p++) {
  const page = JSON.parse(await readFile(join(DATA, 'index', `page-${pad4(p)}.json`), 'utf8'));
  for (const row of page) if (eligible.has(row.id)) rows.push(row);
}

await writeFile(OUT, JSON.stringify(rows) + '\n', 'utf8');
const shi = rows.filter((r) => r.id[0] === 't').length;
console.log(`featured.json:池 ${rows.length} 首(唐诗 ${shi} + 宋词 ${rows.length - shi}),` +
  `扫描注释 ${scanned},跳过 AI ${aiSkipped},合格 ${eligible.size}` +
  `${eligible.size === rows.length ? '' : `(${eligible.size - rows.length} 个 id 不在索引中!)`}`);
