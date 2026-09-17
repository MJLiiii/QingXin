#!/usr/bin/env node
/* 只读数据一致性校验。
   覆盖 manifest/search/index/poems/authors/annotations/featured/lines 的运行时约束，
   不写入任何文件，适合放进 npm run check。
   严重度按影响分级：featured.json 缺失或为空 = error（首页 renderHome 直接 fetch 它，缺了页面就报错）；
   lines.json 缺失 = warning（诗集搜索只是退化为标题/作者匹配）。二者都由 build-featured.mjs 生成。 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA } from '../lib/paths.mjs';
import { ANN_FILE_RE, authorBucket, pad3, pad4, parseId, poemShardFile } from '../lib/ids.mjs';

const errors = [];
const warnings = [];

const addError = (msg) => errors.push(msg);
const addWarning = (msg) => warnings.push(msg);

// 有意不用 tools/lib/paths.mjs 的 readJson：这里读不到就要抛，下面靠 e.code === 'ENOENT' 区分 warning / error。
async function readJson(fp) {
  return JSON.parse(await readFile(fp, 'utf8'));
}

function isArray(v) {
  return Array.isArray(v);
}

function validateAnnotationShape(id, a) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) {
    addError(`annotations/${id}.json 不是对象`);
    return;
  }
  if (a.id !== id) addError(`annotations/${id}.json id 字段不匹配: ${a.id}`);
  const allowedSources = new Set(['gushiwen', 'gushiwen-web', 'ai']);
  if (a.source != null && !allowedSources.has(a.source)) {
    addError(`annotations/${id}.json source 非法: ${a.source}`);
  }
  for (const key of ['notes', 'translation', 'appreciation', 'background']) {
    if (a[key] != null && !isArray(a[key])) addError(`annotations/${id}.json ${key} 必须是数组`);
  }
  if (a.notes) {
    a.notes.forEach((n, i) => {
      if (!n || typeof n !== 'object' || Array.isArray(n)) {
        addError(`annotations/${id}.json notes[${i}] 不是对象`);
        return;
      }
      if (n.term != null && typeof n.term !== 'string') addError(`annotations/${id}.json notes[${i}].term 必须是字符串`);
      if (n.def != null && typeof n.def !== 'string') addError(`annotations/${id}.json notes[${i}].def 必须是字符串`);
    });
  }
  if (a.source === 'ai') {
    if (a.model != null && typeof a.model !== 'string') addError(`annotations/${id}.json model 必须是字符串`);
    if (!isArray(a.background) || a.background.length !== 0) {
      addError(`annotations/${id}.json AI 注释的 background 必须是空数组`);
    }
  }
}

const manifest = await readJson(join(DATA, 'manifest.json'));
for (const key of ['total', 'pageSize', 'pages', 'chunkSize', 'subChunkSize', 'chunks']) {
  if (!Number.isInteger(manifest[key]) || manifest[key] <= 0) addError(`manifest.${key} 必须是正整数`);
}

const search = await readJson(join(DATA, 'search.json'));
if (!Array.isArray(search)) addError('search.json 必须是数组');
if (search.length !== manifest.total) {
  addError(`search.json 数量 ${search.length} != manifest.total ${manifest.total}`);
}

const searchIds = new Set();
const poemCache = new Map();
for (const row of search) {
  if (!Array.isArray(row) || row.length < 3) {
    addError('search.json 存在非 [id,title,author] 行');
    continue;
  }
  const id = row[0];
  const loc = parseId(id);
  if (!loc) {
    addError(`非法诗词 id: ${id}`);
    continue;
  }
  if (searchIds.has(id)) addError(`search.json 重复 id: ${id}`);
  searchIds.add(id);
  if (loc.chunk >= manifest.chunks) addError(`${id} chunk 超出 manifest.chunks`);
  if (loc.i >= manifest.chunkSize) addError(`${id} index 超出 manifest.chunkSize`);
  // 分片公式由 manifest.subChunkSize 驱动：这是唯一一条「manifest 与磁盘布局一致」的检查，勿硬编码 100。
  const { file, index } = poemShardFile(loc, manifest.subChunkSize);
  if (!poemCache.has(file)) {
    try {
      poemCache.set(file, await readJson(join(DATA, 'poems', file)));
    } catch (e) {
      addError(`缺失或无法解析 data/poems/${file}: ${e.message}`);
      continue;
    }
  }
  const poem = poemCache.get(file)[index];
  if (!poem || poem.id !== id) addError(`${id} 无法按分片公式反解到同 id 原文`);
}

/* data/featured.json（首页推荐池）：行结构须与 data/index 行一致（前端诗卡 / hero 零适配），
   id 必须在语料中。缺失 / 非数组 / 空数组都是 error：pickFeatured 对 [] 取不到 hero，首页一样白屏。 */
let featured = null;
try {
  featured = await readJson(join(DATA, 'featured.json'));
} catch (e) {
  addError(e.code === 'ENOENT'
    ? '缺少 data/featured.json（首页会报错），请运行 node tools/data/build-featured.mjs'
    : `无法解析 data/featured.json: ${e.message}`);
}
if (featured !== null && !isArray(featured)) {
  addError('data/featured.json 必须是数组');
  featured = null;
}
if (featured && featured.length === 0) {
  addError('data/featured.json 为空数组（首页取不到今日一诗），请运行 node tools/data/build-featured.mjs');
}
const featuredById = new Map();
for (const row of featured || []) {
  if (!row || typeof row !== 'object' || typeof row.id !== 'string') {
    addError('featured.json 存在非 {id,…} 行');
    continue;
  }
  if (featuredById.has(row.id)) addError(`featured.json 重复 id: ${row.id}`);
  featuredById.set(row.id, row);
  if (!searchIds.has(row.id)) addError(`featured.json ${row.id} 不在 search.json 中`);
}
const indexById = new Map(); // 只留 featured 命中的索引行，供下面逐键比对

let indexRows = 0;
for (let p = 0; p < manifest.pages; p++) {
  const file = `page-${pad4(p)}.json`;
  let rows;
  try {
    rows = await readJson(join(DATA, 'index', file));
  } catch (e) {
    addError(`缺失或无法解析 data/index/${file}: ${e.message}`);
    continue;
  }
  if (!Array.isArray(rows)) {
    addError(`data/index/${file} 必须是数组`);
    continue;
  }
  indexRows += rows.length;
  for (const row of rows) {
    if (!row || typeof row !== 'object') {
      addError(`data/index/${file} 存在非对象行`);
      continue;
    }
    if (!searchIds.has(row.id)) addError(`data/index/${file} 引用 search 中不存在的 id: ${row.id}`);
    if (featuredById.has(row.id)) indexById.set(row.id, row);
  }
}
if (indexRows !== manifest.total) addError(`index 总行数 ${indexRows} != manifest.total ${manifest.total}`);

for (const [id, row] of featuredById) {
  const idx = indexById.get(id);
  if (!idx) {
    addError(`featured.json ${id} 不在 data/index 中`);
    continue;
  }
  const keys = new Set([...Object.keys(row), ...Object.keys(idx)]);
  for (const k of keys) {
    if (row[k] !== idx[k]) {
      addError(`featured.json ${id} 的 ${k} 与 data/index 行不一致`);
      break;
    }
  }
}

const authorIndex = await readJson(join(DATA, 'authors-index.json'));
if (!Array.isArray(authorIndex)) addError('authors-index.json 必须是数组');
const authorCache = new Map();
for (const a of authorIndex) {
  if (!a || typeof a !== 'object' || !a.slug) {
    addError('authors-index.json 存在非法作者行');
    continue;
  }
  const b = authorBucket(a.slug);
  const file = `bucket-${pad3(b)}.json`;
  if (!authorCache.has(file)) {
    try {
      authorCache.set(file, await readJson(join(DATA, 'authors', file)));
    } catch (e) {
      addError(`缺失或无法解析 data/authors/${file}: ${e.message}`);
      continue;
    }
  }
  const rec = authorCache.get(file)[a.slug];
  if (!rec || rec.slug !== a.slug) addError(`作者 ${a.slug} 无法命中 ${file}`);
}

const annFiles = (await readdir(join(DATA, 'annotations'))).filter((f) => ANN_FILE_RE.test(f));
const annSources = new Map(); // id -> source(无法解析的文件记为 undefined)
for (const f of annFiles) {
  const id = f.slice(0, -5);
  annSources.set(id, undefined);
  try {
    const a = await readJson(join(DATA, 'annotations', f));
    if (a && typeof a === 'object') annSources.set(id, a.source);
    validateAnnotationShape(id, a);
  } catch (e) {
    addError(`无法解析 data/annotations/${f}: ${e.message}`);
  }
}

const expectedPoemFiles = Math.ceil(manifest.total / manifest.subChunkSize);
if (poemCache.size !== expectedPoemFiles) {
  addWarning(`本次按 search 触达 ${poemCache.size} 个 poem 分片，按总量估算 ${expectedPoemFiles} 个`);
}

/* data/lines.json(名句检索正文,build-featured.mjs 生成):行 [id, text],
   text = 原文非空 paragraphs 以 '\n' 连接;只收非 AI 注释诗,同 (作者, 正文) 只留一个 id。
   手工新增注释后未重跑生成脚本只报 warning,不让校验失败。 */
const bodyText = (poem) => poem.paragraphs.filter((p) => typeof p === 'string' && p !== '').join('\n');
const bodyKey = (poem) => `${poem.author}\u0000${bodyText(poem)}`;

function corpusPoem(id) {
  const loc = parseId(id);
  if (!loc || !searchIds.has(id)) return null;
  const { file, index } = poemShardFile(loc, manifest.subChunkSize);
  const shard = poemCache.get(file);
  const poem = shard && shard[index];
  return poem && poem.id === id && isArray(poem.paragraphs) ? poem : null;
}

let lines = null;
try {
  lines = await readJson(join(DATA, 'lines.json'));
} catch (e) {
  if (e.code === 'ENOENT') {
    addWarning('缺少 data/lines.json(诗集搜索只能匹配标题/作者),请运行 node tools/data/build-featured.mjs');
  } else {
    addError(`无法解析 data/lines.json: ${e.message}`);
  }
}
if (lines !== null && !isArray(lines)) {
  addError('data/lines.json 必须是数组');
  lines = null;
}
if (lines) {
  const lineIds = new Set();
  const lineBodies = new Set();
  for (const row of lines) {
    if (!isArray(row) || row.length !== 2 || typeof row[0] !== 'string' || typeof row[1] !== 'string') {
      addError('lines.json 存在非 [id,text] 行');
      continue;
    }
    const [id, text] = row;
    if (!parseId(id)) {
      addError(`lines.json 非法诗词 id: ${id}`);
      continue;
    }
    if (lineIds.has(id)) addError(`lines.json 重复 id: ${id}`);
    lineIds.add(id);
    if (!annSources.has(id)) addError(`lines.json ${id} 没有注释文件`);
    else if (annSources.get(id) === 'ai') addError(`lines.json ${id} 是 AI 注释诗,不应收录`);
    const poem = corpusPoem(id);
    if (!poem) {
      addError(`lines.json ${id} 不在语料中`);
      continue;
    }
    if (text !== bodyText(poem)) addError(`lines.json ${id} 正文与原文非空 paragraphs 不一致`);
    lineBodies.add(bodyKey(poem));
  }
  const missing = [];
  for (const [id, source] of annSources) {
    if (source === 'ai' || lineIds.has(id)) continue;
    const poem = corpusPoem(id);
    if (poem && lineBodies.has(bodyKey(poem))) continue; // 同作者同正文,已由另一 id 收录
    missing.push(id);
  }
  if (missing.length) {
    addWarning(`lines.json 缺少 ${missing.length} 首非 AI 注释诗(如 ${missing.slice(0, 5).join(', ')}),` +
      '请重跑 node tools/data/build-featured.mjs');
  }
}

console.log(`validate: poems=${searchIds.size}, indexRows=${indexRows}, authors=${authorIndex.length}, annotations=${annFiles.length}, featured=${featuredById.size}, lines=${lines ? lines.length : 0}`);
for (const w of warnings) console.warn(`warning: ${w}`);
if (errors.length) {
  for (const e of errors.slice(0, 50)) console.error(`error: ${e}`);
  if (errors.length > 50) console.error(`error: 还有 ${errors.length - 50} 个错误未显示`);
  process.exit(1);
}
console.log('validate: ok');
