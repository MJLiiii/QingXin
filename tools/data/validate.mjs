#!/usr/bin/env node
/* 只读数据一致性校验。
   覆盖 manifest/search/index/poems/authors/annotations 的运行时约束，
   不写入任何文件，适合放进 npm run check。 */
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, '..', '..');
const DATA = join(ROOT, 'data');
const ANN_FILE_RE = /^[tc]\d+-\d+\.json$/;
const AUTHOR_BUCKETS = 256;

const errors = [];
const warnings = [];

const pad3 = (n) => String(n).padStart(3, '0');
const pad4 = (n) => String(n).padStart(4, '0');
const addError = (msg) => errors.push(msg);
const addWarning = (msg) => warnings.push(msg);

async function readJson(fp) {
  return JSON.parse(await readFile(fp, 'utf8'));
}

function parseId(id) {
  const m = /^([tc])(\d+)-(\d+)$/.exec(id || '');
  return m ? { prefix: m[1], chunk: +m[2], i: +m[3] } : null;
}

function authorBucket(slug) {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return h % AUTHOR_BUCKETS;
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
  const sub = Math.floor(loc.i / manifest.subChunkSize);
  const file = `${pad4(loc.chunk)}-${sub}.json`;
  if (!poemCache.has(file)) {
    try {
      poemCache.set(file, await readJson(join(DATA, 'poems', file)));
    } catch (e) {
      addError(`缺失或无法解析 data/poems/${file}: ${e.message}`);
      continue;
    }
  }
  const poem = poemCache.get(file)[loc.i % manifest.subChunkSize];
  if (!poem || poem.id !== id) addError(`${id} 无法按分片公式反解到同 id 原文`);
}

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
  }
}
if (indexRows !== manifest.total) addError(`index 总行数 ${indexRows} != manifest.total ${manifest.total}`);

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
for (const f of annFiles) {
  try {
    validateAnnotationShape(f.slice(0, -5), await readJson(join(DATA, 'annotations', f)));
  } catch (e) {
    addError(`无法解析 data/annotations/${f}: ${e.message}`);
  }
}

const expectedPoemFiles = Math.ceil(manifest.total / manifest.subChunkSize);
if (poemCache.size !== expectedPoemFiles) {
  addWarning(`本次按 search 触达 ${poemCache.size} 个 poem 分片，按总量估算 ${expectedPoemFiles} 个`);
}

console.log(`validate: poems=${searchIds.size}, indexRows=${indexRows}, authors=${authorIndex.length}, annotations=${annFiles.length}`);
for (const w of warnings) console.warn(`warning: ${w}`);
if (errors.length) {
  for (const e of errors.slice(0, 50)) console.error(`error: ${e}`);
  if (errors.length > 50) console.error(`error: 还有 ${errors.length - 50} 个错误未显示`);
  process.exit(1);
}
console.log('validate: ok');
