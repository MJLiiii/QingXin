/* 从古诗文网（gushiwen.cn）抓取 注释/译文/赏析/创作背景 → data/annotations/<id>.json。
   写出文件统一标 "source":"gushiwen-web"（比数据集版更全，含创作背景）。

   用法（在 tools/ 下）：
     node annotations/annotate-scrape.mjs backfill [--limit N] [--dry-run] [--delay 2500] [--verbose]
     node annotations/annotate-scrape.mjs expand   [--dynasty 唐|宋|all] [--crawl-only] [--limit N] [--force] [--dry-run]
     node annotations/annotate-scrape.mjs id <poemId> [--force] [--dry-run] [--verbose]
     node annotations/annotate-scrape.mjs authors [作者名…] [--top N] [--pages N] [--limit N] [--force] [--dry-run]

   模式：
   - backfill：把现有 source 以 "gushiwen" 开头的注释文件（数据集导入的 ~1045 首）
     用网站版逐节替换刷新（爬到的非空则替换、爬空则保留）。
   - expand：爬唐/宋目录列表页 → 匹配语料 → 为尚无注释文件的 id 新建。
     --force 额外允许逐节替换 source 以 "gushiwen" 开头的文件。
   - id：单首。有 gushiwen* 文件走 backfill 语义，无文件走 expand 语义。
   - authors：按作者抓 astr 列表页 → 匹配语料 → 为该作者尚无注释的 id 新建（与 expand 同写策略，
     用于扩展精选目录之外的长尾覆盖）。作者名可显式传入，也可用 --top N 自动取产量最高的前 N 位。
     注意：高产作者（如白居易 3009 首）古诗文网多数无注释，每首命中语料的诗仍需一次详情请求
     才能确认「转换后为空」，成本随之上升——用 --limit / --pages 控制单轮规模。勿传无名氏/佚名/不详。

   安全约定：无 source 字段的手写文件（如 c59-66《水调歌头》）任何模式、任何路径永不触碰。
   只写 data/annotations/，绝不改动 data/poems/** 原文。 */
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normText, normAuthor, dice, loadQingxinIndex,
  matchToCorpus, candidateBodies, parseNotes, parseTranslation,
} from './annotate-lib.mjs';
import { createClient, BlockedError } from './gushiwen-client.mjs';
import {
  parseListItems, parseCatalogPage, parseDetailPage,
  splitFanyiParas, parseShangxiFragment,
  stripFooterLines, htmlToParas, contentPoisoned,
  validateScrapedAnnotation,
} from './gushiwen-parse.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const TOOLS = resolve(SCRIPT_DIR, '..');
const ROOT = resolve(SCRIPT_DIR, '..', '..');
const DATA = join(ROOT, 'data');
const ANN_DIR = join(DATA, 'annotations');
const CACHE = join(TOOLS, '.cache');
const WEB_CACHE = join(CACHE, 'gushiwen-web');
const PAGE_CACHE = join(WEB_CACHE, 'pages');
const RESOLVED_PATH = join(WEB_CACHE, 'resolved.json');
const REPORT_PATH = join(CACHE, 'annotate', 'scrape-report.json');

const BASE = 'https://www.gushiwen.cn';
const detailUrl = (hexid) => `${BASE}/shiwenv_${hexid}.aspx`;
const searchUrl = (q) => `${BASE}/search.aspx?value=${encodeURIComponent(q)}`;
const ajaxUrl = (kind, n, idjm, hexid) =>
  `${BASE}/nocdn/ajax${kind}.aspx?id=${n}&idjm=${idjm}&idStr=${hexid}`;
const shiwensUrl = ({ tstr = '', astr = '', cstr = '', xstr = '', page = 1 }) =>
  `${BASE}/shiwens/default.aspx?page=${page}&tstr=${encodeURIComponent(tstr)}` +
  `&astr=${encodeURIComponent(astr)}&cstr=${encodeURIComponent(cstr)}&xstr=${encodeURIComponent(xstr)}`;
const catalogUrl = (cstr, xstr, page) => shiwensUrl({ cstr, xstr, page });
const authorUrl = (astr, page) => shiwensUrl({ astr, page });

const ANN_FILE_RE = /^[tc]\d+-\d+\.json$/; // 排除 README 与 iCloud 冲突副本

/* ---------- 参数 ---------- */

const argv = process.argv.slice(2);
const MODE = argv[0];
const flag = (name) => argv.includes(name);
const opt = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};
const DRY = flag('--dry-run');
const FORCE = flag('--force');
const VERBOSE = flag('--verbose');
const CRAWL_ONLY = flag('--crawl-only');
const LIMIT = parseInt(opt('--limit', ''), 10) || Infinity;
const PAGES = parseInt(opt('--pages', ''), 10) || Infinity;
const DELAY = parseInt(opt('--delay', ''), 10) || 2500;
const DYNASTY = opt('--dynasty', 'all');
const TOP = parseInt(opt('--top', ''), 10) || 0;

/* 取值型开关（其后紧跟的非 -- token 是它的值，不是位置参数）。 */
const VALUE_FLAGS = new Set(['--limit', '--pages', '--delay', '--dynasty', '--top']);
/* 位置参数（authors 模式的作者名）：跳过 MODE、所有 --flag 及取值型开关吞掉的值。 */
function positionals() {
  const out = [];
  for (let i = 1; i < argv.length; i++) {
    const tok = argv[i];
    if (tok.startsWith('--')) {
      if (VALUE_FLAGS.has(tok) && argv[i + 1] && !argv[i + 1].startsWith('--')) i++;
      continue;
    }
    out.push(tok);
  }
  return out;
}

/* ---------- 断点资产 ---------- */

async function readJson(fp, dflt) {
  try { return JSON.parse(await readFile(fp, 'utf8')); } catch { return dflt; }
}

let resolved = {};      // poemId -> {hexid, score, method, at}
async function saveResolved() {
  if (DRY) return;
  await mkdir(WEB_CACHE, { recursive: true });
  await writeFile(RESOLVED_PATH, JSON.stringify(resolved, null, 0) + '\n', 'utf8');
}

/* ---------- 报表 ---------- */

const report = {
  generatedAt: null, mode: MODE, dryRun: DRY,
  totals: {
    targets: 0, resolvedFromCache: 0, resolvedBySearch: 0, matchedFromCatalog: 0,
    verified: 0, written: 0, skippedExisting: 0, skippedHandwritten: 0,
    unresolved: 0, bodyMismatch: 0, notOnGushiwen: 0, noBackgroundOnPage: 0,
    ambiguous: 0, emptyAfterTransform: 0, validationWarnings: 0, poisonedDropped: 0,
    networkRequests: 0, cacheHits: 0, retries: 0, errors: 0,
  },
  writtenIds: [],
  unresolvedIds: [], bodyMismatchIds: [], ambiguousList: [], validationWarnList: [],
};
const T = report.totals;

async function flushReport(client) {
  T.networkRequests = client.stats.networkRequests;
  T.cacheHits = client.stats.cacheHits;
  T.retries = client.stats.retries;
  T.errors = client.stats.errors;
  report.generatedAt = new Date().toISOString();
  await mkdir(dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
}

/* ---------- 搜索定位（poemId → hexid） ---------- */

/* 候选正文校验：gushiwen 候选 blocks 是否与语料 entry 同一首诗。
   返回 {ok, score, preface}；preface = 命中变体丢弃的首块（序） */
function verifyBody(blocks, entry) {
  const anon = entry.author === '无名氏';
  const minDice = anon ? 0.90 : 0.75;
  let best = { ok: false, score: 0, preface: null };
  for (const b of candidateBodies(blocks)) {
    const norm = normText(b.text);
    if (norm.length < 4) continue;
    const ratio = norm.length / entry.normFull.length;
    if (ratio < 0.6 || ratio > 1.5) continue;
    const s = dice(norm, entry.normFull);
    if (s > best.score) best = { ok: s >= minDice, score: s, preface: b.preface };
  }
  return best;
}

/* 词作标题是合成的「词牌·首句」，搜词牌更稳；诗用全标题 */
function primaryQuery(entry) {
  const pai = entry.kind === 'ci' ? entry.title.split(/[·・]/)[0] : entry.title;
  return `${pai} ${entry.rawAuthor}`.trim();
}

/* 从一页候选里挑与 entry 同作者、正文 dice 最高且达标者 */
function pickCandidate(items, entry) {
  let best = null;
  for (const it of items) {
    if (normAuthor(it.author) !== entry.author) continue;
    const v = verifyBody(it.blocks, entry);
    if (v.ok && (!best || v.score > best.score)) {
      best = { hexid: it.hexid, score: v.score, preface: v.preface };
    }
  }
  return best;
}

/* 搜索阶梯：① 词牌/标题 + 作者 → ② 首段原文全文。返回 {hexid,score,method} 或 null */
async function resolveViaSearch(client, entry) {
  const queries = [
    { q: primaryQuery(entry), method: 'title' },
    { q: (entry.paras[0] || '').slice(0, 20), method: 'firstline' },
  ];
  for (const { q, method } of queries) {
    if (!q || q.length < 2) continue;
    const url = searchUrl(q);
    let res;
    try { res = await client.fetchHtml(url); } catch (e) {
      if (e instanceof BlockedError) throw e;
      continue;
    }
    if (res.status === 404 || !res.html) continue;
    const items = parseListItems(res.html);
    const hit = pickCandidate(items, entry);
    if (hit) return { ...hit, method };
  }
  return null;
}

/* ---------- 抓取详情 + 片段 → 结构化 ---------- */

/* 返回 {ann, meta}；ann 为待合并注释（可能各节为空），meta 记录诊断 */
async function scrapeContent(client, hexid, entry) {
  const referer = detailUrl(hexid);
  const res = await client.fetchHtml(referer);
  if (res.status === 404 || !res.html) return { ann: null, meta: { reason: 'notOnGushiwen' } };
  const detail = parseDetailPage(res.html, hexid);

  const v = verifyBody(detail.blocks, entry);
  if (!v.ok && !detail.truncated) return { ann: null, meta: { reason: 'bodyMismatch', score: v.score } };
  const preface = v.preface;

  let translationText = '';
  let notesText = '';
  const appreciation = [];
  let background = null; // null=页面无此节；[]=有节但空
  let poisonedSections = 0;

  for (const sec of detail.sections) {
    /* 选定该节段落。n 为空：内联即全文，直接用。n 非空（被折叠）：抓 AJAX 全文，
       与内联预览逐字比对，未投毒→用全文；投毒→整节丢弃（连预览也不用，因预览带有
       一层轻度投毒残留，如 情→隋，无法保证干净——宁缺毋滥）。fanyi 按正文串比对，
       避开预览无「译文及注释」标题行造成的结构差异误判。取全文失败也整节丢弃。 */
    let paras = sec.paras;
    if (sec.n != null) {
      const url = ajaxUrl(sec.ajaxKind, sec.n, sec.idjm, hexid);
      let frag = null;
      try { frag = await client.fetchHtml(url, { referer }); } catch (e) {
        if (e instanceof BlockedError) throw e;
      }
      if (frag && frag.status !== 404 && frag.html) {
        const fullParas = sec.channel === 'fanyi'
          ? stripFooterLines(htmlToParas(frag.html))
          : parseShangxiFragment(frag.html);
        const cleanStr = sec.channel === 'fanyi'
          ? splitFanyiParas(sec.paras).translationText : sec.paras.join('');
        const fullStr = sec.channel === 'fanyi'
          ? splitFanyiParas(fullParas).translationText : fullParas.join('');
        if (contentPoisoned(cleanStr, fullStr)) { paras = []; poisonedSections++; }
        else paras = fullParas;
      } else {
        paras = []; // 取全文失败，整节丢弃（不写截断预览）
      }
    }
    if (sec.channel === 'fanyi') {
      const r = splitFanyiParas(paras);
      translationText = r.translationText;
      notesText = r.notesText;
    } else if (sec.channel === 'background') background = (background || []).concat(paras);
    else if (sec.channel === 'shangxi') appreciation.push(...paras);
  }

  const notes = parseNotes(notesText);
  const { prefaceTranslation, translation } =
    parseTranslation(translationText, !!preface);

  const ann = {
    id: entry.id,
    preface: preface || '',
    notes,
    prefaceTranslation: prefaceTranslation || '',
    translation,
    appreciation,
    background: background || [],
  };
  return {
    ann,
    meta: {
      hasBackground: background != null && background.length > 0,
      bodyScore: v.score, poisonedSections,
    },
  };
}

/* ---------- 合并与写文件 ---------- */

const FIELD_ORDER = ['preface', 'notes', 'prefaceTranslation', 'translation', 'appreciation', 'background'];
const isEmpty = (v) => v == null || (Array.isArray(v) ? v.length === 0 : String(v).trim() === '');

/* 逐节替换：爬到的非空则用之，否则保留 existing */
function mergeAnnotation(existing, scraped) {
  const out = { id: scraped.id };
  const base = existing || {};
  for (const f of FIELD_ORDER) {
    const val = isEmpty(scraped[f]) ? base[f] : scraped[f];
    if (isEmpty(val)) {
      if (f === 'notes' || f === 'translation' || f === 'appreciation' || f === 'background') out[f] = [];
      // 空的 preface/prefaceTranslation 省略
    } else {
      out[f] = val;
    }
  }
  out.source = 'gushiwen-web';
  return orderAnnotation(out);
}

function orderAnnotation(a) {
  const out = { id: a.id };
  if (!isEmpty(a.preface)) out.preface = a.preface;
  out.notes = a.notes || [];
  if (!isEmpty(a.prefaceTranslation)) out.prefaceTranslation = a.prefaceTranslation;
  out.translation = a.translation || [];
  out.appreciation = a.appreciation || [];
  out.background = a.background || [];
  out.source = a.source;
  return out;
}

/* 写策略。mode: 'backfill'|'expand'。返回 'written'|'skippedExisting'|'skippedHandwritten'|'emptyAfterTransform' */
async function commit(id, scraped, mode) {
  const { ann: clean, warnings } = validateScrapedAnnotation(scraped);
  if (warnings.length) {
    T.validationWarnings += warnings.length;
    report.validationWarnList.push({ id, warnings });
  }
  const nonEmpty = !isEmpty(clean.notes) || !isEmpty(clean.translation) ||
    !isEmpty(clean.appreciation) || !isEmpty(clean.background);

  const fp = join(ANN_DIR, id + '.json');
  const existingRaw = await readFile(fp, 'utf8').catch(() => null);
  let existing = null;
  if (existingRaw != null) {
    try { existing = JSON.parse(existingRaw); } catch { existing = null; }
    const src = existing && existing.source;
    const isGushiwen = typeof src === 'string' && src.startsWith('gushiwen');
    if (!isGushiwen) return 'skippedHandwritten'; // 手写文件永不触碰
    if (mode === 'expand' && !FORCE) return 'skippedExisting';
  }

  const merged = mode === 'backfill' || existing
    ? mergeAnnotation(existing, clean)
    : orderAnnotation({ ...clean, source: 'gushiwen-web' });

  const finalNonEmpty = !isEmpty(merged.notes) || !isEmpty(merged.translation) ||
    !isEmpty(merged.appreciation) || !isEmpty(merged.background);
  if (!finalNonEmpty && !nonEmpty) return 'emptyAfterTransform';

  if (!DRY) {
    await mkdir(ANN_DIR, { recursive: true });
    await writeFile(fp, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  }
  return 'written';
}

/* ---------- backfill ---------- */

async function backfillTargets() {
  const files = (await readdir(ANN_DIR)).filter((f) => ANN_FILE_RE.test(f));
  const ids = [];
  for (const f of files) {
    const j = await readJson(join(ANN_DIR, f), null);
    if (j && typeof j.source === 'string' && j.source.startsWith('gushiwen')) {
      ids.push(f.replace(/\.json$/, ''));
    }
  }
  return ids.sort();
}

async function runBackfill(client, idx) {
  const ids = (await backfillTargets()).slice(0, LIMIT);
  T.targets = ids.length;
  console.log(`backfill 目标：${ids.length} 首（source 以 gushiwen 开头的注释文件）`);
  await processIds(client, idx, ids, 'backfill');
}

/* ---------- expand ---------- */

const DYN_QUERIES = { 唐: ['唐代', '诗'], 宋: ['宋代', '词'] };

/* 逐页爬某朝代目录（按热度排序），产出未见过的条目。断点：progress 文件存
   {seen, lastPage, done, count}，每页落盘；--pages 限制本次翻页数。
   目录条目量级巨大（数千页），故以生成器流式产出，由调用方决定处理多少。 */
async function* crawlPages(client, dyn) {
  const [cstr, xstr] = DYN_QUERIES[dyn];
  const progressPath = join(WEB_CACHE, `catalog-${dyn}.json`);
  const prog = await readJson(progressPath, { seen: [], lastPage: 0, done: false, count: 0 });
  const seen = new Set(prog.seen);
  let page = prog.lastPage + 1;
  let pagesThisRun = 0;
  console.log(`爬 ${dyn} 目录（cstr=${cstr} xstr=${xstr}），从第 ${page} 页起，已知 ${prog.count} 条${prog.done ? '（上次已抓完）' : ''}`);
  while (!prog.done && pagesThisRun < PAGES) {
    const url = catalogUrl(cstr, xstr, page);
    const res = await client.fetchHtml(url);
    if (res.status === 404 || !res.html) { prog.done = true; break; }
    const { items, nextPage } = parseCatalogPage(res.html);
    pagesThisRun++;
    const fresh = [];
    for (const it of items) {
      if (seen.has(it.hexid)) continue;
      seen.add(it.hexid);
      fresh.push({ ...it, dynasty: dyn });
    }
    prog.seen = [...seen];
    prog.lastPage = page;
    prog.count = seen.size;
    if (!nextPage || nextPage <= page || !items.length) prog.done = true;
    if (!DRY) { await mkdir(WEB_CACHE, { recursive: true }); await writeFile(progressPath, JSON.stringify(prog), 'utf8'); }
    if (VERBOSE || page % 25 === 0) console.log(`  第 ${page} 页：+${fresh.length} 新（累计 ${seen.size}）`);
    for (const it of fresh) yield it;
    page = nextPage;
  }
}

/* ---------- authors ---------- */

/* 作者名 → 断点文件名：归一化（去尾数字、佚名/无名折叠）后剔除文件系统敏感字符，
   使显式传入的「李白」与 --top 取到的「李白」共用同一进度文件。 */
const cacheKeyForAuthor = (name) =>
  (normAuthor(name).replace(/[\/\\?%*:|"<>\s、，,\[\]（）()□]/g, '_') || 'author');

/* 逐页爬某作者的 astr 列表页（与 crawlPages 同构，但按作者而非朝代分页/断点）。
   列表页与目录页结构一致，故复用 parseCatalogPage；--pages 限制本次单作者翻页数。 */
async function* crawlAuthorPages(client, name) {
  const progressPath = join(WEB_CACHE, `catalog-author-${cacheKeyForAuthor(name)}.json`);
  const prog = await readJson(progressPath, { seen: [], lastPage: 0, done: false, count: 0 });
  const seen = new Set(prog.seen);
  let page = prog.lastPage + 1;
  let pagesThisRun = 0;
  console.log(`爬 ${name} 作者页（astr=${name}），从第 ${page} 页起，已知 ${prog.count} 条${prog.done ? '（上次已抓完）' : ''}`);
  while (!prog.done && pagesThisRun < PAGES) {
    const res = await client.fetchHtml(authorUrl(name, page));
    if (res.status === 404 || !res.html) { prog.done = true; break; }
    const { items, nextPage } = parseCatalogPage(res.html);
    pagesThisRun++;
    const fresh = [];
    for (const it of items) {
      if (seen.has(it.hexid)) continue;
      seen.add(it.hexid);
      fresh.push(it); // 列表条目自带 dynasty
    }
    prog.seen = [...seen];
    prog.lastPage = page;
    prog.count = seen.size;
    if (!nextPage || nextPage <= page || !items.length) prog.done = true;
    if (!DRY) { await mkdir(WEB_CACHE, { recursive: true }); await writeFile(progressPath, JSON.stringify(prog), 'utf8'); }
    if (VERBOSE || page % 25 === 0) console.log(`  ${name} 第 ${page} 页：+${fresh.length} 新（累计 ${seen.size}）`);
    for (const it of fresh) yield it;
    page = nextPage;
  }
}

/* 处理一个目录条目：先用**列表页已带的正文**（it.blocks）做语料匹配（省请求关键——
   列表页 .contson 是全文，无需先抓详情），匹配通过才抓详情页 + 片段并写全部 fanout 兄弟 id。
   非命中条目零额外请求（正文随目录页免费到手）。 */
async function processCatalogItem(client, idx, it) {
  try {
    const matchRes = matchToCorpus({ title: it.title, author: it.author, blocks: it.blocks }, idx);
    if (matchRes.ambiguous) {
      T.ambiguous++; report.ambiguousList.push({ hexid: it.hexid, ...matchRes.ambiguous }); return;
    }
    if (!matchRes.matches.length) { T.notOnGushiwen++; return; }
    T.matchedFromCatalog++;
    const first = matchRes.matches[0].entry;
    const { ann, meta } = await scrapeContent(client, it.hexid, first);
    if (!ann) {
      if (meta.reason === 'bodyMismatch') T.bodyMismatch++; else T.notOnGushiwen++;
      return;
    }
    T.verified++;
    if (!meta.hasBackground) T.noBackgroundOnPage++;
    if (meta.poisonedSections) T.poisonedDropped++;
    for (const m of matchRes.matches) { // 一次抓取写全部 fanout 兄弟 id
      resolved[m.entry.id] = { hexid: it.hexid, score: +m.score.toFixed(3), method: 'catalog', at: new Date().toISOString() };
      recordOutcome(await commit(m.entry.id, { ...ann, id: m.entry.id }, 'expand'), m.entry.id);
    }
  } catch (e) {
    if (e instanceof BlockedError) throw e;
    report.validationWarnList.push({ hexid: it.hexid, error: String(e.message || e) });
    T.errors++;
  }
}

async function runExpand(client, idx) {
  const dyns = DYNASTY === 'all' ? ['唐', '宋'] : [DYNASTY];
  const resolvedHexids = new Set(Object.values(resolved).map((r) => r.hexid));

  if (CRAWL_ONLY) {
    let total = 0;
    for (const dyn of dyns) for await (const _it of crawlPages(client, dyn)) total++; // eslint-disable-line no-unused-vars
    await flushReport(client);
    console.log(`crawl-only：本次新增目录条目 ${total}（累计见 catalog-*.json），未抓详情`);
    return;
  }

  /* 流式：逐页爬目录，只处理未 resolved 的新条目，处理满 --limit 即止
     （目录按热度排序，前 ~1045 与 backfill 重叠会被 resolved 跳过、零成本）。 */
  let processed = 0;
  outer: for (const dyn of dyns) {
    for await (const it of crawlPages(client, dyn)) {
      if (resolvedHexids.has(it.hexid)) continue;
      resolvedHexids.add(it.hexid); // 防同名重出诗在本轮重复处理
      await processCatalogItem(client, idx, it);
      processed++;
      if (processed % 50 === 0) {
        await saveResolved(); await flushReport(client);
        console.log(`  已处理新条目 ${processed}，写入 ${T.written}`);
      }
      if (processed >= LIMIT) break outer;
    }
  }
  T.targets = processed;
}

/* ---------- authors 驱动 ---------- */

/* 目标作者名单：位置参数在前，再补 --top N 位（authors-index.json 已按产量降序）。
   按 normAuthor 去重；--top 跳过无名氏/不详及含数字/顿号/括号等杂名。 */
async function authorTargets() {
  const map = new Map(); // normAuthor -> 展示名，保序去重
  for (const n of positionals()) {
    const na = normAuthor(n);
    if (!map.has(na)) map.set(na, n);
  }
  if (TOP > 0) {
    const idxAuthors = await readJson(join(DATA, 'authors-index.json'), []);
    let added = 0;
    for (const a of idxAuthors) {
      if (added >= TOP) break;
      const na = normAuthor(a.name);
      if (na === '无名氏' || na === '不详') continue;        // 匿名桶：量大值低，不占排名位
      if (/[、，,\[\]（）()□\s0-9]/.test(a.name)) continue;   // 多作者/编号/杂名：astr 查询与文件名都不友好，不占排名位
      added++;                                               // 计入排名位（不论是否已在名单，故与位置参数重叠时自然并合）
      if (!map.has(na)) map.set(na, a.name);
    }
  }
  return [...map.values()];
}

async function runAuthors(client, idx) {
  const targets = await authorTargets();
  if (!targets.length) { console.error('authors 模式需提供作者名或 --top N'); return; }
  console.log(`authors 目标作者：${targets.join('、')}`);
  const resolvedHexids = new Set(Object.values(resolved).map((r) => r.hexid));
  let processed = 0;
  outer: for (const name of targets) {
    if (!(idx.byAuthor.get(normAuthor(name)) || []).length) {
      console.warn(`  跳过：语料中无「${name}」的诗，astr 抓取将全部落空`);
      continue;
    }
    const b = { matched: T.matchedFromCatalog, written: T.written, empty: T.emptyAfterTransform };
    for await (const it of crawlAuthorPages(client, name)) {
      if (resolvedHexids.has(it.hexid)) continue;
      resolvedHexids.add(it.hexid); // 防同名重出诗在本轮重复处理
      await processCatalogItem(client, idx, it);
      processed++;
      if (processed % 50 === 0) {
        await saveResolved(); await flushReport(client);
        console.log(`  已处理新条目 ${processed}，写入 ${T.written}`);
      }
      if (processed >= LIMIT) break outer;
    }
    console.log(`  [${name}] 匹配 ${T.matchedFromCatalog - b.matched}，${DRY ? '将写入' : '写入'} ${T.written - b.written}，转换后为空 ${T.emptyAfterTransform - b.empty}`);
  }
  T.targets = processed;
}

/* ---------- id 单首 ---------- */

async function runSingle(client, idx, id) {
  const entry = idx.byId.get(id);
  if (!entry) { console.error(`语料中无此 id：${id}`); return; }
  T.targets = 1;
  await processIds(client, idx, [id], 'id', true);
  console.log(`\n验收：http://localhost:8080/#/poem/${id}`);
}

/* ---------- 逐 id 处理（backfill / id 共用） ---------- */

function recordOutcome(outcome, id) {
  if (outcome === 'written') { T.written++; report.writtenIds.push(id); }
  else if (outcome === 'skippedExisting') T.skippedExisting++;
  else if (outcome === 'skippedHandwritten') T.skippedHandwritten++;
  else if (outcome === 'emptyAfterTransform') T.emptyAfterTransform++;
}

async function processIds(client, idx, ids, mode, verbose = VERBOSE) {
  let n = 0;
  for (const id of ids) {
    n++;
    const entry = idx.byId.get(id);
    if (!entry) { T.unresolved++; report.unresolvedIds.push({ id, reason: 'notInCorpus' }); continue; }

    /* 定位 hexid */
    let loc = resolved[id];
    if (loc) T.resolvedFromCache++;
    else {
      loc = await resolveViaSearch(client, entry);
      if (loc) {
        T.resolvedBySearch++;
        resolved[id] = { ...loc, at: new Date().toISOString() };
      } else {
        T.unresolved++;
        report.unresolvedIds.push({ id, title: entry.title, author: entry.rawAuthor, reason: 'notFoundBySearch' });
        if (verbose) console.log(`  [${id}] 未找到：${entry.title} / ${entry.rawAuthor}`);
        continue;
      }
    }

    /* 抓内容 */
    let ann, meta;
    try {
      ({ ann, meta } = await scrapeContent(client, loc.hexid, entry));
    } catch (e) {
      if (e instanceof BlockedError) throw e;
      T.errors++; report.validationWarnList.push({ id, error: String(e.message || e) }); continue;
    }
    if (!ann) {
      if (meta.reason === 'bodyMismatch') { T.bodyMismatch++; report.bodyMismatchIds.push({ id, hexid: loc.hexid, score: meta.score }); }
      else { T.notOnGushiwen++; }
      if (verbose) console.log(`  [${id}] ${meta.reason}（hexid ${loc.hexid}）`);
      continue;
    }
    T.verified++;
    if (!meta.hasBackground) T.noBackgroundOnPage++;
    if (meta.poisonedSections) T.poisonedDropped++;
    const outcome = await commit(id, ann, mode);
    recordOutcome(outcome, id);
    if (verbose) {
      console.log(`  [${id}] ${outcome}（hexid ${loc.hexid}, dice ${meta.bodyScore.toFixed(3)}）` +
        ` notes=${ann.notes.length} 译=${ann.translation.length} 赏=${ann.appreciation.length} 背=${ann.background.length}`);
    }
    if (n % 50 === 0) { await saveResolved(); await flushReport(client); console.log(`  ${n}/${ids.length}，写入 ${T.written}`); }
  }
}

/* ---------- 主流程 ---------- */

async function main() {
  if (!['backfill', 'expand', 'id', 'authors'].includes(MODE)) {
    console.error('用法：annotate-scrape.mjs <backfill|expand|id|authors> [选项]（详见文件头注释）');
    process.exit(1);
  }
  console.log('载入情心诗库索引 …');
  const idx = await loadQingxinIndex(DATA);
  console.log(`  共 ${idx.total} 首`);
  resolved = await readJson(RESOLVED_PATH, {});

  const client = createClient({ cacheDir: PAGE_CACHE, delayMs: DELAY, verbose: VERBOSE });

  let blocked = false;
  try {
    if (MODE === 'backfill') await runBackfill(client, idx);
    else if (MODE === 'expand') await runExpand(client, idx);
    else if (MODE === 'authors') await runAuthors(client, idx);
    else if (MODE === 'id') {
      const id = argv[1];
      if (!id || id.startsWith('--')) { console.error('id 模式需提供 poemId'); process.exit(1); }
      await runSingle(client, idx, id);
    }
  } catch (e) {
    if (e instanceof BlockedError) {
      blocked = true;
      console.error(`\n⚠ ${e.message}`);
      console.error('已中止。缓存保证续跑零重复请求，请稍后重新运行相同命令继续。');
    } else throw e;
  }

  await saveResolved();
  await flushReport(client);

  const t = T;
  console.log('\n==== 汇总 ====');
  console.log(`目标 ${t.targets}；命中缓存 ${t.resolvedFromCache}，搜索定位 ${t.resolvedBySearch}，目录匹配 ${t.matchedFromCatalog}`);
  console.log(`正文校验通过 ${t.verified}；${DRY ? '[dry-run] 将写入' : '写入'} ${t.written}`);
  console.log(`跳过已存在 ${t.skippedExisting}，跳过手写 ${t.skippedHandwritten}，转换后为空 ${t.emptyAfterTransform}`);
  console.log(`未定位 ${t.unresolved}，正文不符 ${t.bodyMismatch}，站上无 ${t.notOnGushiwen}，无创作背景 ${t.noBackgroundOnPage}，歧义 ${t.ambiguous}，投毒丢弃 ${t.poisonedDropped}`);
  console.log(`校验警告 ${t.validationWarnings}；网络请求 ${t.networkRequests}，缓存命中 ${t.cacheHits}，重试 ${t.retries}，错误 ${t.errors}`);
  console.log(`报表：${REPORT_PATH}`);
  if (blocked) process.exit(2);
}

main().catch((e) => { console.error(e); process.exit(1); });
