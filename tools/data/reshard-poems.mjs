/* 一次性迁移：把 data/poems/<块>.json（每文件 1000 首）拆成 <块>-<子>.json（每文件 100 首）。
   诗 id 不变（仍 t<块>-<0..999> / c<块>-<0..999>）——仅改变落盘粒度，使单首详情按需只取 100 首。
   与 prep.mjs 的 flushChunk 落盘布局保持一致；幂等：仅处理 ^\d{4}\.json$，重跑无副作用。

   用法（在 tools/ 下）： node data/reshard-poems.mjs [--dry-run]
*/
import { readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const POEMS = join(REPO, 'data', 'poems');
const SUBCHUNK_SIZE = 100; // 须与 prep.mjs 的 SUBCHUNK_SIZE 及前端 loadPoem 除数一致
const DRY = process.argv.includes('--dry-run');
const pad4 = (n) => String(n).padStart(4, '0');

const whole = readdirSync(POEMS).filter((f) => /^\d{4}\.json$/.test(f)).sort();
if (!whole.length) {
  console.log('没有 <块>.json 整块文件可迁移（可能已迁移过）。');
  process.exit(0);
}

let totalPoems = 0, subFiles = 0;
for (const f of whole) {
  const chunkNum = parseInt(f.slice(0, 4), 10);
  const arr = JSON.parse(readFileSync(join(POEMS, f), 'utf8'));
  totalPoems += arr.length;
  for (let s = 0; s * SUBCHUNK_SIZE < arr.length; s++) {
    const slice = arr.slice(s * SUBCHUNK_SIZE, (s + 1) * SUBCHUNK_SIZE);
    const out = `${pad4(chunkNum)}-${s}.json`;
    if (!DRY) writeFileSync(join(POEMS, out), JSON.stringify(slice));
    subFiles++;
  }
  if (!DRY) rmSync(join(POEMS, f));
}

console.log(`${DRY ? '[dry-run] ' : ''}整块文件 ${whole.length} → 子文件 ${subFiles}（每 ${SUBCHUNK_SIZE} 首），覆盖 ${totalPoems} 首。`);

// 校验：迁移后每个 id 都能通过新路径公式解析回其原文。
if (!DRY) {
  const search = JSON.parse(readFileSync(join(REPO, 'data', 'search.json'), 'utf8'));
  let checked = 0, bad = 0;
  const cache = new Map();
  const load = (file) => {
    if (!cache.has(file)) cache.set(file, JSON.parse(readFileSync(join(POEMS, file), 'utf8')));
    return cache.get(file);
  };
  for (const [id] of search) {
    const m = /^[tc](\d+)-(\d+)$/.exec(id);
    const chunk = +m[1], i = +m[2];
    const sub = Math.floor(i / SUBCHUNK_SIZE);
    const poem = load(`${pad4(chunk)}-${sub}.json`)[i % SUBCHUNK_SIZE];
    checked++;
    if (!poem || poem.id !== id) { bad++; if (bad <= 5) console.error(`  校验失败：${id} → ${poem && poem.id}`); }
  }
  console.log(`校验：${checked} 个 id 全部解析，${bad} 个失配。`);
  if (bad) process.exit(1);
}
