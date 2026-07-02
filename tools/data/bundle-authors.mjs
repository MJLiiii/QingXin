/* 一次性迁移：把 data/authors/<slug>.json（5119 个小文件）打包成 256 个
   data/authors/bucket-<000..255>.json（对象 { slug: 作者记录 }）。
   目的：削减小文件数量（git 对象数 / 本地 iCloud 同步量）。作者记录形状不变。
   顺带把无意义的占位 bio（["--"] / [""]）归一化为 []。

   分桶哈希 authorBucket 必须与 prep.mjs 及 assets/js/app.js 的 loadAuthor 完全一致——
   改动三处需同步（如同 SUBCHUNK_SIZE 除数约定）。

   用法（在 tools/ 下）： node data/bundle-authors.mjs [--dry-run]
*/
import { readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const AUTHORS = join(REPO, 'data', 'authors');
const BUCKETS = 256;
const DRY = process.argv.includes('--dry-run');
const pad3 = (n) => ('00' + n).slice(-3);

// 与 prep.mjs / app.js 一致的分桶哈希（UTF-16 码元逐字，结果 0..255）
export function authorBucket(slug) {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return h % BUCKETS;
}

const isStub = (bio) => !bio || !bio.length || bio.every((p) => !String(p).replace(/[-—\s]/g, ''));

const files = readdirSync(AUTHORS).filter((f) => /\.json$/.test(f) && !/^bucket-/.test(f));
if (!files.length) {
  console.log('没有 <slug>.json 单文件可打包（可能已打包过）。');
  process.exit(0);
}

const bucketMap = new Map(); // bucket -> { slug: record }
for (const f of files) {
  const rec = JSON.parse(readFileSync(join(AUTHORS, f), 'utf8'));
  if (isStub(rec.bio)) rec.bio = []; // 丢弃 "--" 占位
  const b = authorBucket(rec.slug);
  if (!bucketMap.has(b)) bucketMap.set(b, {});
  bucketMap.get(b)[rec.slug] = rec;
}

let written = 0, records = 0;
for (const [b, obj] of bucketMap) {
  records += Object.keys(obj).length;
  if (!DRY) writeFileSync(join(AUTHORS, `bucket-${pad3(b)}.json`), JSON.stringify(obj));
  written++;
}
if (!DRY) for (const f of files) rmSync(join(AUTHORS, f));

console.log(`${DRY ? '[dry-run] ' : ''}单文件 ${files.length} → 桶文件 ${written}（共 ${records} 位作者，${BUCKETS} 桶）。`);

// 校验：每位作者都能经 bucket 哈希在对应桶里按 slug 取回。
if (!DRY) {
  let checked = 0, bad = 0;
  const cache = new Map();
  const load = (b) => {
    const k = pad3(b);
    if (!cache.has(k)) cache.set(k, JSON.parse(readFileSync(join(AUTHORS, `bucket-${k}.json`), 'utf8')));
    return cache.get(k);
  };
  const index = JSON.parse(readFileSync(join(REPO, 'data', 'authors-index.json'), 'utf8'));
  for (const a of index) {
    const rec = load(authorBucket(a.slug))[a.slug];
    checked++;
    if (!rec || rec.slug !== a.slug) { bad++; if (bad <= 5) console.error(`  校验失败：${a.slug}`); }
  }
  console.log(`校验：${checked} 位作者全部命中桶，${bad} 个失配。`);
  if (bad) process.exit(1);
}
