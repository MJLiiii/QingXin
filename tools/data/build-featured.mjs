/* 生成 data/featured.json —— 首页推荐池。
   口径:注释文件中 赏析非空 且 (注释或译文非空) 的非 AI 诗(保证 hero 点进去内容最全)。
   产物为这些诗的完整索引行 {id,title,author,dynasty,kind,excerpt},与 data/index/
   行结构一致,前端 poemRow/hero 零适配,按索引序排列(diff 稳定)。
   同时生成 data/lines.json —— 名句检索正文 [[id, text], …](全部非 AI 注释诗,见下文 3)。

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

/* 1) 合格 id 集:非 AI 且赏析非空 且 (注释或译文非空);
      另收全部非 AI 注释 id(名句检索正文用,与推荐池口径无关) */
const eligible = new Set();
const annotated = new Set();
let scanned = 0;
let aiSkipped = 0;
for (const f of (await readdir(ANN_DIR)).filter((f) => ANN_FILE_RE.test(f))) {
  scanned++;
  const a = JSON.parse(await readFile(join(ANN_DIR, f), 'utf8'));
  if (a.source === 'ai') {
    aiSkipped++;
    continue;
  }
  annotated.add(f.slice(0, -5));
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

/* 3) data/lines.json —— 名句检索正文:行 [id, text],text = 非空 paragraphs 以 '\n' 连接。
      按语料序 (chunk, i) 排列(t/c 共用 chunk 编号);同 (作者, 正文) 只留语料序第一个 id
      (全唐诗把部分乐府诗同时收在分类卷与诗人卷下)。validate.mjs 按同一口径复核。 */
const LINES_OUT = join(DATA, 'lines.json');
const parseId = (id) => {
  const m = /^[tc](\d+)-(\d+)$/.exec(id);
  return m ? { chunk: +m[1], i: +m[2] } : null;
};
const lineIds = [...annotated].map((id) => ({ id, loc: parseId(id) }))
  .sort((a, b) => a.loc.chunk - b.loc.chunk || a.loc.i - b.loc.i);
const shards = new Map();
const seenBodies = new Set();
const lineRows = [];
let deduped = 0;
let unresolved = 0;
for (const { id, loc } of lineIds) {
  const file = `${pad4(loc.chunk)}-${Math.floor(loc.i / 100)}.json`;
  if (!shards.has(file)) {
    shards.set(file, JSON.parse(await readFile(join(DATA, 'poems', file), 'utf8').catch(() => '[]')));
  }
  const poem = shards.get(file)[loc.i % 100];
  if (!poem || poem.id !== id || !Array.isArray(poem.paragraphs)) {
    unresolved++;
    continue;
  }
  const text = poem.paragraphs.filter((p) => typeof p === 'string' && p !== '').join('\n');
  const key = `${poem.author}\u0000${text}`;
  if (seenBodies.has(key)) {
    deduped++;
    continue;
  }
  seenBodies.add(key);
  lineRows.push([id, text]);
}
const linesJson = JSON.stringify(lineRows) + '\n';
await writeFile(LINES_OUT, linesJson, 'utf8');
console.log(`lines.json:${lineRows.length} 行(非 AI 注释 ${annotated.size},同作者同正文去重 ${deduped}` +
  `${unresolved ? `,${unresolved} 个 id 不在语料中!` : ''}),${Buffer.byteLength(linesJson)} 字节`);
