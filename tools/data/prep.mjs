#!/usr/bin/env node
/* ===========================================================
   情心 · 数据准备脚本（一次性本地运行）
   读取 chinese-poetry 源仓库，产出静态可 fetch 的 data/**

   用法：
     cd tools && npm install
     node data/prep.mjs --src ../../chinese-poetry-src

   产出（相对仓库根 QingXin/）：
     data/manifest.json          总数 / 分页信息 / 朝代分面
     data/index/page-XXXX.json   浏览索引（500 条/页）
     data/poems/XXXX-S.json      原文详情子块（100 首/文件，只读；每 1000 首 id 块拆 10 个子文件）
     data/authors/<slug>.json    作者简介（一人一文件）
     data/featured.json          首页精选（保留原站 5 首）
     data/annotations/<id>.json  注释叠加层（含《水调歌头》种子）
   =========================================================== */

import {
  readFileSync, writeFileSync, readdirSync,
  mkdirSync, rmSync, existsSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import * as OpenCC from 'opencc-js';

// ---------- 路径与参数 ----------
const __dirname = dirname(fileURLToPath(import.meta.url)); // .../QingXin/tools/data
const REPO = resolve(__dirname, '..', '..');               // .../QingXin
const args = process.argv.slice(2);
const argVal = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : d;
};
// 默认源：仓库同级目录 ../chinese-poetry-src（相对 QingXin 即 ../..）
const SRC = resolve(argVal('--src', resolve(REPO, '..', 'chinese-poetry-src')));
const OUT = resolve(REPO, 'data');
const INCLUDE_SONG_SHI = args.includes('--include-song-shi'); // 宋诗 25 万，暂不启用

const PAGE_SIZE = 500;   // 索引分页
const CHUNK_SIZE = 1000; // id 分块（id 仍为 t<块>-<0..999>，保持稳定，勿改）
const SUBCHUNK_SIZE = 100; // 落盘子文件粒度：每块拆为 poems/<块>-<0..9>.json，按需只取 100 首
                           // 前端 loadPoem 用相同的 100 反解，改此值须同步 assets/js 里的除数

if (!existsSync(SRC)) {
  console.error(`✗ 源目录不存在：${SRC}\n  请先：git clone --depth 1 https://github.com/chinese-poetry/chinese-poetry ${SRC}`);
  process.exit(1);
}

// ---------- 繁 → 简 ----------
const t2s = OpenCC.Converter({ from: 't', to: 'cn' });
// 剔除源数据中偶发的“孤立代理项”（不成对的 UTF-16 surrogate，chinese-poetry 已知瑕疵）
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const clean = (s) => (typeof s === 'string' ? s.replace(LONE_SURROGATE, '') : s);
const conv = (s) => (typeof s === 'string' ? clean(t2s(s)) : s);

// ---------- 工具函数 ----------
const loadJSON = (p) => JSON.parse(readFileSync(p, 'utf8'));
const numOf = (f) => { const m = f.match(/(\d+)/); return m ? parseInt(m[1], 10) : 0; };
const pad4 = (n) => String(n).padStart(4, '0');

function safeSlug(name) {
  return String(name || '佚名').replace(/[\/\\?%*:|"<>\s]/g, '_').trim() || '佚名';
}

// 首句摘要（去尾句末标点，截断 ~18 字）
function excerptOf(paras) {
  let s = (paras && paras[0]) || '';
  s = s.replace(/[。！？.!?]+\s*$/, '');
  return s.length > 18 ? s.slice(0, 18) : s;
}

// 词无 title → 词牌·首句前若干字
function synthTitle(rhythmic, paras) {
  const head = ((paras && paras[0]) || '')
    .replace(/[，。！？、；：,.!?;:].*$/, '')
    .slice(0, 7);
  if (rhythmic && head) return `${rhythmic}·${head}`;
  return rhythmic || head || '无题';
}

// 原文按空串分节；无空串则整首一节
function groupStanzas(paras) {
  const stanzas = [];
  let cur = [];
  for (const line of paras || []) {
    if (String(line).trim() === '') { if (cur.length) { stanzas.push(cur); cur = []; } }
    else cur.push(line);
  }
  if (cur.length) stanzas.push(cur);
  return stanzas.length ? stanzas : [paras || []];
}

// ---------- 输出目录重置 ----------
// 仅清理“可再生”产物，保留 annotations/（用户手写的注释叠加层不能丢）
for (const d of ['index', 'poems', 'authors']) rmSync(join(OUT, d), { recursive: true, force: true });
for (const f of ['manifest.json', 'featured.json', 'search.json', 'authors-index.json']) rmSync(join(OUT, f), { force: true });
for (const d of ['index', 'poems', 'authors', 'annotations']) mkdirSync(join(OUT, d), { recursive: true });

// ---------- 累加器 ----------
let chunkBuf = [];    // 当前原文块缓冲
let chunkNum = 0;     // 当前块号（= 输出文件号）
const indexAll = [];  // 全部索引条目
const authors = new Map(); // slug -> { slug, name, dynasty, count, works:[] }
let total = 0;
const dynasties = { 唐: 0, 宋: 0 };

// 《水调歌头》种子识别：仅用于定位其 id，写种子注释 c59-66.json
const SEED = { kind: 'ci', author: '苏轼', rhythmic: '水调歌头', head: '明月几时有' };
let seedHit = null;

function flushChunk() {
  if (!chunkBuf.length) return;
  // 每个 id 块（1000 首）拆成若干 100 首的子文件：poems/<块>-<子>.json。
  // id 不变（仍 t<块>-<0..999>）；loadPoem 以 floor(i/100) 定位子文件、i%100 取项。
  for (let s = 0; s * SUBCHUNK_SIZE < chunkBuf.length; s++) {
    const slice = chunkBuf.slice(s * SUBCHUNK_SIZE, (s + 1) * SUBCHUNK_SIZE);
    writeFileSync(join(OUT, 'poems', `${pad4(chunkNum)}-${s}.json`), JSON.stringify(slice));
  }
  chunkBuf = [];
  chunkNum += 1;
}

// rec: { title, rhythmic, author, paragraphs }
function addPoem(rec, kind) {
  const i = chunkBuf.length;
  const id = `${kind === 'shi' ? 't' : 'c'}${chunkNum}-${i}`;
  const dynasty = kind === 'shi' ? '唐' : '宋';
  const slug = safeSlug(rec.author);

  const detail = {
    id,
    title: rec.title,
    rhythmic: rec.rhythmic || null,
    author: rec.author,
    authorSlug: slug,
    dynasty,
    kind,
    paragraphs: rec.paragraphs,
  };
  chunkBuf.push(detail);
  if (chunkBuf.length >= CHUNK_SIZE) flushChunk();

  const excerpt = excerptOf(rec.paragraphs);
  indexAll.push({
    id,
    title: rec.title,
    rhythmic: rec.rhythmic || null,
    author: rec.author,
    authorSlug: slug,
    dynasty,
    kind,
    excerpt,
  });

  // 作者作品归并：count 为真实作品数（不截断），works 仅存代表作前 50
  let a = authors.get(slug);
  if (!a) { a = { slug, name: rec.author, dynasty, count: 0, works: [] }; authors.set(slug, a); }
  a.count += 1;
  if (a.works.length < 50) {
    a.works.push({ id, title: rec.title, kind: kind === 'ci' ? '词' : '诗' });
  }

  // 种子（水调歌头）识别
  if (!seedHit && kind === SEED.kind && rec.author === SEED.author
      && rec.rhythmic === SEED.rhythmic
      && String(rec.paragraphs[0] || '').startsWith(SEED.head)) {
    seedHit = { id, title: rec.title, author: rec.author, dynasty, excerpt };
  }

  total += 1;
  dynasties[dynasty] += 1;
}

// ---------- 处理全唐诗（繁 → 简） ----------
console.log('▸ 处理 全唐诗 …');
const tangDir = join(SRC, '全唐诗');
const tangFiles = readdirSync(tangDir)
  .filter((f) => /^poet\.tang\.\d+\.json$/.test(f))
  .sort((a, b) => numOf(a) - numOf(b));
for (const f of tangFiles) {
  for (const r of loadJSON(join(tangDir, f))) {
    addPoem({
      title: conv(r.title) || '无题',
      rhythmic: null,
      author: conv(r.author) || '佚名',
      paragraphs: (r.paragraphs || []).map(conv),
    }, 'shi');
  }
}
console.log(`  唐诗 ${dynasties.唐} 首`);

// ---------- 处理宋词（已是简体） ----------
console.log('▸ 处理 宋词 …');
const ciDir = join(SRC, '宋词');
const ciFiles = readdirSync(ciDir)
  .filter((f) => /^ci\.song\..*\.json$/.test(f))
  .sort((a, b) => numOf(a) - numOf(b));
for (const f of ciFiles) {
  for (const r of loadJSON(join(ciDir, f))) {
    const rhythmic = clean(r.rhythmic || '');
    const paragraphs = (r.paragraphs || []).map(clean);
    addPoem({
      title: synthTitle(rhythmic, paragraphs),
      rhythmic,
      author: clean(r.author || '佚名'),
      paragraphs,
    }, 'ci');
  }
}
flushChunk();
console.log(`  宋词 ${dynasties.宋} 首`);

// ---------- 索引分页 ----------
console.log('▸ 写索引分页 …');
const pages = Math.ceil(indexAll.length / PAGE_SIZE);
for (let p = 0; p < pages; p++) {
  writeFileSync(
    join(OUT, 'index', `page-${pad4(p)}.json`),
    JSON.stringify(indexAll.slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE)),
  );
}

// ---------- 全局搜索索引（紧凑：[id,title,author]）----------
console.log('▸ 写全局搜索索引 …');
writeFileSync(
  join(OUT, 'search.json'),
  JSON.stringify(indexAll.map((e) => [e.id, e.title, e.author])),
);

// ---------- manifest ----------
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({
  total,
  pageSize: PAGE_SIZE,
  pages,
  chunkSize: CHUNK_SIZE,
  subChunkSize: SUBCHUNK_SIZE,
  chunks: chunkNum,
  dynasties,
  generatedAt: new Date().toISOString(),
}, null, 2));

// ---------- 作者简介 ----------
console.log('▸ 合并作者简介 …');

function toParagraphs(text, per = 3) {
  const sents = String(text).split(/(?<=。)/).map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (let i = 0; i < sents.length; i += per) out.push(sents.slice(i, i + per).join(''));
  return out.length ? out : [String(text).trim()].filter(Boolean);
}

function parseMeta(text) {
  const meta = { style: '', life: '', origin: '' };
  const life = text.match(/(\d{3,4})\s*[—\-―~]\s*(\d{3,4})/);
  if (life) meta.life = `${life[1]} — ${life[2]}`;
  const zi = text.match(/字([^\s，,。、；;）)]+)/);
  const hao = text.match(/号([^\s，,。、；;）)]+)/);
  const parts = [];
  if (zi) parts.push(`字${zi[1]}`);
  if (hao) parts.push(`号${hao[1]}`);
  meta.style = parts.join(' · ');
  // 籍贯：兼容全/半角括号与空格，如「眉州眉山（今四川眉山）人」「眉州眉山 (今属四川) 人」
  const origin = text.match(/([一-鿿]{2,8})\s*[（(]今[^）)]*[）)]\s*人/) ||
                 text.match(/[。\s]([一-鿿]{2,6})人[，。]/);
  if (origin) meta.origin = origin[1] + (origin[0].includes('今') ? origin[0].match(/[（(]今[^）)]*[）)]/)[0].replace(/[（(]/, '（').replace(/[）)]/, '）') : '');
  return meta;
}

// 宋词作者（简体，优先）
const bioBySlug = new Map();
for (const a of loadJSON(join(ciDir, 'author.song.json'))) {
  let text = (a.short_description || a.description || '').trim();
  text = text.replace(/主要作品有[：:][\s\S]*$/, '').replace(/存世书迹[\s\S]*$/, '').trim();
  bioBySlug.set(safeSlug(a.name), { bio: toParagraphs(text), ...parseMeta(text) });
}
// 唐诗作者（繁 → 简，文言 desc）
for (const a of loadJSON(join(tangDir, 'authors.tang.json'))) {
  const slug = safeSlug(conv(a.name));
  if (bioBySlug.has(slug)) continue;
  const text = conv((a.desc || '').trim());
  bioBySlug.set(slug, { bio: toParagraphs(text), ...parseMeta(text) });
}

// 作者按 256 桶打包为 authors/bucket-<000..255>.json（对象 {slug: 记录}），削减小文件数。
// authorBucket 须与 app.js loadAuthor / bundle-authors.mjs 完全一致（改动三处需同步）。
const AUTHOR_BUCKETS = 256;
const authorBucket = (slug) => {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return h % AUTHOR_BUCKETS;
};
const pad3 = (n) => ('00' + n).slice(-3);

const authorsIndex = [];
const authorBucketsOut = new Map(); // bucket -> {slug: 记录}
for (const [slug, info] of authors) {
  const b = bioBySlug.get(slug) || { bio: [], style: '', life: '', origin: '' };
  const rec = {
    slug,
    name: info.name,
    dynasty: info.dynasty,
    style: b.style || '',
    life: b.life || '',
    origin: b.origin || '',
    seal: (info.name || '')[0] || '',
    bio: b.bio || [],
    works: info.works,
  };
  const bk = authorBucket(slug);
  if (!authorBucketsOut.has(bk)) authorBucketsOut.set(bk, {});
  authorBucketsOut.get(bk)[slug] = rec;
  authorsIndex.push({ slug, name: info.name, dynasty: info.dynasty, count: info.count });
}
for (const [bk, obj] of authorBucketsOut) {
  writeFileSync(join(OUT, 'authors', `bucket-${pad3(bk)}.json`), JSON.stringify(obj));
}

// ---------- 作者总索引（按作品数降序，供“诗人”页浏览/搜索） ----------
authorsIndex.sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name, 'zh'));
writeFileSync(join(OUT, 'authors-index.json'), JSON.stringify(authorsIndex));
console.log(`  作者索引 ${authorsIndex.length} 位`);

// ---------- 《水调歌头》种子注释 ----------
const sd = seedHit;
if (sd) {
  writeFileSync(join(OUT, 'annotations', `${sd.id}.json`), JSON.stringify({
    id: sd.id,
    preface: '丙辰中秋，欢饮达旦，大醉，作此篇，兼怀子由。',
    notes: [
      { term: '丙辰', def: '指宋神宗熙宁九年（1076 年）。' },
      { term: '达旦', def: '到天亮。' },
      { term: '子由', def: '苏轼的弟弟苏辙，字子由。' },
      { term: '宫阙', def: '天上的宫殿。阙，古代宫门前两旁的楼台。' },
      { term: '琼楼玉宇', def: '美玉砌成的楼宇，指想象中月宫的仙阙。' },
      { term: '不胜寒', def: '经受不住寒冷。胜，承受、经得起。' },
      { term: '弄清影', def: '意谓月光下起舞，影子也随之舞动。' },
      { term: '绮户', def: '雕饰华美的门窗。' },
      { term: '婵娟', def: '本指美好的姿容，这里借指明月。' },
    ],
    prefaceTranslation: '丙辰年的中秋节，我通宵畅饮直到天明，大醉之后写下这篇词，同时也思念着弟弟子由。',
    translation: [
      '明月是从什么时候开始有的呢？我举起酒杯，遥问那浩渺的青天。不知道天上的宫阙，今晚又是何年何月。我想乘着清风回到天上去，却又怕那美玉砌成的楼宇太高，经不住九天之上的清寒。倒不如在月下翩然起舞，与清影为伴——这人间的乐趣，又哪里是天上比得了的。',
      '月光转过朱红的楼阁，低低地照进雕花的窗户，映着这无眠的人。明月本不该对人有什么怨恨，可为什么偏偏在人们离别时才这般圆满？人有悲欢离合，月有阴晴圆缺，这样的憾事自古以来便难以周全。只愿彼此都能长久安康，纵使相隔千里，也能共赏这同一轮明月。',
    ],
    appreciation: [
      '这首中秋词以“月”为线索，由问天而及人间，把对宇宙、人生的哲思与手足之情融于一炉。上片写把酒问月、欲归又恐的矛盾——既有超脱尘世的向往，又有对人间温情的眷恋；一句“起舞弄清影，何似在人间”，让飘渺的遐想重新落回坚实的人世。',
      '下片由月的圆缺，写到人的离合，将个人的遗憾升华为对人间普遍境遇的体察。“人有悲欢离合，月有阴晴圆缺”道尽世事难全的无奈，而“但愿人长久，千里共婵娟”则以旷达之语作结——纵使离别，也愿共此明月、彼此珍重。全词情理交融，境界开阔，是苏轼豪放中见温厚的代表之作。',
    ],
    background: [
      '此词作于宋神宗熙宁九年（1076 年）中秋，时苏轼在密州（今山东诸城）任知州。他因与主持变法的王安石等人政见不合，自请外放，辗转各地为官。当时苏轼与弟弟苏辙已分别七年未能团聚，中秋对月，思念尤深，遂乘醉写下此篇——既是抒怀，亦是寄弟。',
    ],
  }, null, 2));
  console.log(`  种子注释 → annotations/${sd.id}.json（《水调歌头》id = ${sd.id}）`);
}

// ---------- 注释目录说明（幂等重写；不影响用户已建的 <id>.json） ----------
writeFileSync(join(OUT, 'annotations', 'README.md'), `# 注释叠加层（手工补内容）

想给某首诗补 **注释 / 译文 / 赏析 / 创作背景**，只需在本目录新建一个
\`<诗的id>.json\`。id 见该诗详情页地址栏 \`#/poem/<id>\`（如 \`c59-66\`）。

文件结构（留空的字段前端会显示“尚未收录”占位，不影响版式）：

\`\`\`json
{
  "id": "<诗的id>",
  "preface": "",                       // 词序/小序原文，可选
  "notes": [ { "term": "词语", "def": "释义" } ],
  "prefaceTranslation": "",            // 词序的白话，作译文首段淡墨显示，可选
  "translation": [ "译文第一段", "第二段" ],
  "appreciation": [ "赏析第一段" ],
  "background": [ "创作背景" ]
}
\`\`\`

保存后刷新页面即生效，**无需重跑脚本、也不改动任何大文件**。

> 说明：重跑 \`prep.mjs\` 会保留本目录（你的注释不会丢），但会**重写**
> 随仓库自带的种子文件 \`${sd ? sd.id : 'c59-66'}.json\`（《水调歌头》）。
`);

console.log(`\n✓ 完成：${total} 首 · ${chunkNum} 原文块 · ${pages} 索引页 · ${authors.size} 作者`);
console.log(`  输出目录：${OUT}`);
