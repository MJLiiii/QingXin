/* 从 chinese-gushiwen 数据集导入 译文/注释/赏析 → data/annotations/<id>.json
   （创作背景数据集里没有，保持空数组=前端占位；不做任何 AI 生成。）

   用法（在 tools/ 下）：
     node annotations/annotate-import.mjs                    # 下载全部 10 个分块并导入
     node annotations/annotate-import.mjs --dry-run          # 只匹配统计，不写文件
     node annotations/annotate-import.mjs --src <文件|目录>… # 用本地 JSONL 文件替代下载
     node annotations/annotate-import.mjs --force            # 允许覆盖 source==="gushiwen" 的旧导入
     node annotations/annotate-import.mjs --limit 100        # 只处理前 N 条（调试用）

   安全约定：
   - 已存在的注释文件默认跳过；--force 也只覆盖 JSON 里带 "source":"gushiwen"
     的文件——手写注释（如 c59-66《水调歌头》）永远不会被覆盖。
   - 只写 data/annotations/，绝不改动 data/poems/** 原文。 */
import { mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normText, normAuthor, normTitle, dice, loadQingxinIndex,
} from './annotate-lib.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const TOOLS = resolve(SCRIPT_DIR, '..');
const ROOT = resolve(SCRIPT_DIR, '..', '..');
const DATA = join(ROOT, 'data');
const ANN_DIR = join(DATA, 'annotations');
const CACHE = join(TOOLS, '.cache');
const GUWEN_CACHE = join(CACHE, 'gushiwen');
const BASE_URL = 'https://raw.githubusercontent.com/aopao/chinese-gushiwen/master/guwen/';

/* ---------- 参数 ---------- */

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const FORCE = argv.includes('--force');
const LIMIT = (() => {
  const i = argv.indexOf('--limit');
  return i >= 0 ? parseInt(argv[i + 1], 10) || Infinity : Infinity;
})();
const SRC = (() => {
  const i = argv.indexOf('--src');
  if (i < 0) return null;
  const out = [];
  for (let k = i + 1; k < argv.length && !argv[k].startsWith('--'); k++) out.push(argv[k]);
  return out.length ? out : null;
})();

/* ---------- guwen 数据获取（JSONL，10 分块） ---------- */

function chunkNames() {
  const names = ['guwen0-1000.json'];
  for (let k = 1; k < 10; k++) names.push(`guwen${k * 1000 + 1}-${(k + 1) * 1000}.json`);
  return names;
}

async function loadJsonl(fp) {
  const text = await readFile(fp, 'utf8');
  const recs = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { recs.push(JSON.parse(t)); } catch { /* 跳过坏行 */ }
  }
  return recs;
}

async function collectRecords() {
  const files = [];
  if (SRC) {
    for (const p of SRC) {
      const s = await stat(p);
      if (s.isDirectory()) {
        for (const f of (await readdir(p)).sort()) {
          if (f.endsWith('.json')) files.push(join(p, f));
        }
      } else files.push(resolve(p));
    }
  } else {
    await mkdir(GUWEN_CACHE, { recursive: true });
    for (const name of chunkNames()) {
      const fp = join(GUWEN_CACHE, name);
      const cached = await stat(fp).catch(() => null);
      if (!cached || cached.size === 0) {
        process.stdout.write(`下载 ${name} … `);
        const res = await fetch(BASE_URL + name);
        if (!res.ok) throw new Error(`下载失败 ${name}: HTTP ${res.status}`);
        await writeFile(fp, Buffer.from(await res.arrayBuffer()));
        console.log('完成');
      }
      files.push(fp);
    }
  }
  const records = [];
  for (const fp of files) records.push(...await loadJsonl(fp));
  return records;
}

/* ---------- 匹配 ---------- */

/* guwen content 按空行分块；序（若有）为首块 */
function contentBlocks(rec) {
  return String(rec.content || '')
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/* 候选正文：全文，以及（可能去掉序的）后续块 */
function candidateBodies(blocks) {
  const bodies = [{ text: blocks.join('\n'), preface: null }];
  if (blocks.length > 1) {
    bodies.push({ text: blocks.slice(1).join('\n'), preface: blocks[0] });
  }
  return bodies;
}

/* 返回 {matches:[{entry,score,preface,tier}]} 或 {ambiguous:{…}} 或 {matches:[]} */
function matchRecord(rec, idx) {
  const author = normAuthor(rec.writer);
  const blocks = contentBlocks(rec);
  if (!blocks.length) return { matches: [] };
  const bodies = candidateBodies(blocks);
  const titleNorms = normTitle(rec.title);
  const anon = author === '无名氏';

  /* Tier A：作者 + 正文前12字 精确键，再 Dice/长度比验证 */
  const perEntry = new Map(); // entry -> {entry,score,preface,tier}
  for (const b of bodies) {
    const norm = normText(b.text);
    if (norm.length < 4) continue;
    const minDice = anon ? 0.90 : 0.75;
    for (const e of idx.byKey.get(author + '|' + norm.slice(0, 12)) || []) {
      const ratio = norm.length / e.normFull.length;
      if (ratio < 0.6 || ratio > 1.5) continue;
      const s = dice(norm, e.normFull);
      if (s < minDice) continue;
      const prev = perEntry.get(e);
      if (!prev || s > prev.score) {
        perEntry.set(e, { entry: e, score: s, preface: b.preface, tier: 'A' });
      }
    }
  }
  if (perEntry.size) return { matches: [...perEntry.values()] };
  if (anon) return { matches: [] }; // 佚名只走 Tier A

  /* Tier B：同作者全集模糊扫描 */
  for (const b of bodies) {
    const norm = normText(b.text);
    if (norm.length < 4) continue;
    for (const e of idx.byAuthor.get(author) || []) {
      const ratio = norm.length / e.normFull.length;
      if (ratio < 0.5 || ratio > 2) continue;
      const s = dice(norm, e.normFull);
      const prev = perEntry.get(e);
      if (!prev || s > prev.score) {
        perEntry.set(e, { entry: e, score: s, preface: b.preface, tier: 'B' });
      }
    }
  }
  const ranked = [...perEntry.values()].sort((a, b) => b.score - a.score);
  if (!ranked.length) return { matches: [] };
  const best = ranked[0];
  const titleHit = titleNorms.some((t) => best.entry.titleNorms.includes(t));
  if (!(best.score >= 0.85 || (best.score >= 0.70 && titleHit))) {
    return { matches: [] };
  }
  /* 歧义检查：次优解太接近且不是重出诗则放弃。
     同作者两首正文 Dice ≥ 0.80 几乎必为重出异文（组诗兄弟篇远低于此），
     视为同一首诗的多个拷贝，全部接受 */
  const accepted = [best];
  for (let i = 1; i < ranked.length; i++) {
    const r = ranked[i];
    if (best.score - r.score > 0.05) break;
    if (dice(best.entry.normFull, r.entry.normFull) >= 0.80) accepted.push(r);
    else {
      return {
        ambiguous: {
          title: rec.title, writer: rec.writer,
          best: { id: best.entry.id, title: best.entry.title, score: +best.score.toFixed(3) },
          runner: { id: r.entry.id, title: r.entry.title, score: +r.score.toFixed(3) },
        },
      };
    }
  }
  return { matches: accepted };
}

/* ---------- 字段转换 ---------- */

function cleanLine(s) {
  return s
    .replace(/▲/g, '')
    /* 爬虫黏连的标题头，如 "《核舟记》 　　苏东坡的词…"——
       书名号短标题后紧跟全角缩进才剥（正常行文不会这样开头） */
    .replace(/^《[^《》]{1,12}》\s*　+/, '')
    .replace(/^[　\s]+|[　\s]+$/g, '');
}

function splitParas(s) {
  return String(s || '').split(/\n+/).map(cleanLine).filter(Boolean);
}

/* remark → notes[{term,def}]：全/半角冒号在第1~30字符处开新词条，
   无冒号行是上一条释义的续行 */
function parseRemark(remark) {
  const notes = [];
  for (const raw of String(remark || '').split('\n')) {
    const line = cleanLine(raw);
    if (!line) continue;
    const m = line.match(/^(.{1,30}?)[：:]\s*(.*)$/);
    if (m && m[1].trim()) notes.push({ term: m[1].trim(), def: m[2].trim() });
    else if (notes.length) notes[notes.length - 1].def += line;
  }
  return notes.filter((n) => n.def);
}

/* translation → prefaceTranslation? + translation[]。
   「韵译/意译/直译」等备选译文从标签行起丢弃 */
const LABEL_RE = /^[（(【\[]?(韵译|意译|直译|韵意译)[】\])）]?[：:]?$/;
function parseTranslation(s, hasPreface) {
  let paras = splitParas(s);
  const li = paras.findIndex((p) => LABEL_RE.test(p));
  if (li > 0) paras = paras.slice(0, li);
  else if (li === 0) {
    paras = paras.slice(1);
    const li2 = paras.findIndex((p) => LABEL_RE.test(p));
    if (li2 >= 0) paras = paras.slice(0, li2);
  }
  if (hasPreface && paras.length >= 2) {
    return { prefaceTranslation: paras[0], translation: paras.slice(1) };
  }
  return { prefaceTranslation: '', translation: paras };
}

function toAnnotation(rec, id, preface) {
  const notes = parseRemark(rec.remark);
  const { prefaceTranslation, translation } = parseTranslation(rec.translation, !!preface);
  const appreciation = splitParas(rec.shangxi);
  if (!notes.length && !translation.length && !appreciation.length) return null;
  const out = { id };
  if (preface) out.preface = preface;
  out.notes = notes;
  if (prefaceTranslation) out.prefaceTranslation = prefaceTranslation;
  out.translation = translation;
  out.appreciation = appreciation;
  out.background = [];
  out.source = 'gushiwen';
  return out;
}

/* ---------- 主流程 ---------- */

function fieldCount(rec) {
  return ['translation', 'remark', 'shangxi'].filter((k) => rec[k]).length;
}

async function main() {
  console.log('载入情心诗库索引 …');
  const idx = await loadQingxinIndex(DATA);
  console.log(`  共 ${idx.total} 首（按 manifest 枚举 chunk 文件）`);

  console.log(SRC ? `读取本地数据：${SRC.join(', ')}` : '获取 guwen 数据集 …');
  const all = await collectRecords();
  const usable = all.filter((r) => fieldCount(r) > 0).slice(0, LIMIT);
  console.log(`  guwen 记录 ${all.length} 条，其中含译注 ${usable.length} 条`);

  /* 匹配；多条 guwen 争同一 id 时取字段更全、Dice 更高者 */
  const byId = new Map(); // id -> {rec, score, preface, tier, fields}
  const ambiguous = [];
  const unmatched = [];
  const fanouts = [];
  let tierA = 0; let tierB = 0;
  for (const rec of usable) {
    const res = matchRecord(rec, idx);
    if (res.ambiguous) { ambiguous.push(res.ambiguous); continue; }
    if (!res.matches.length) {
      if (rec.dynasty === '唐代' || rec.dynasty === '宋代') {
        unmatched.push({ title: rec.title, writer: rec.writer, dynasty: rec.dynasty });
      }
      continue;
    }
    if (res.matches.length > 1) {
      fanouts.push({ title: rec.title, writer: rec.writer, ids: res.matches.map((m) => m.entry.id) });
    }
    for (const m of res.matches) {
      m.tier === 'A' ? tierA++ : tierB++;
      const cur = byId.get(m.entry.id);
      const cand = { rec, score: m.score, preface: m.preface, fields: fieldCount(rec) };
      if (!cur || cand.fields > cur.fields ||
          (cand.fields === cur.fields && cand.score > cur.score)) {
        byId.set(m.entry.id, cand);
      }
    }
  }

  /* 写文件 */
  let written = 0; let skippedExisting = 0; let emptyAfterTransform = 0;
  const writtenIds = [];
  for (const [id, { rec, preface }] of byId) {
    const ann = toAnnotation(rec, id, preface);
    if (!ann) { emptyAfterTransform++; continue; }
    const fp = join(ANN_DIR, id + '.json');
    const existing = await readFile(fp, 'utf8').catch(() => null);
    if (existing != null) {
      let overwritable = false;
      if (FORCE) {
        try { overwritable = JSON.parse(existing).source === 'gushiwen'; } catch { /* 非法 JSON 也不覆盖 */ }
      }
      if (!overwritable) { skippedExisting++; continue; }
    }
    if (!DRY) await writeFile(fp, JSON.stringify(ann, null, 2) + '\n', 'utf8');
    written++;
    writtenIds.push(id);
  }

  /* 报告 */
  await mkdir(join(CACHE, 'annotate'), { recursive: true });
  const report = {
    generatedAt: new Date().toISOString(),
    dryRun: DRY,
    totals: {
      guwenRecords: all.length,
      withAnnotations: usable.length,
      matchedIds: byId.size,
      written,
      skippedExisting,
      emptyAfterTransform,
      tierA,
      tierB,
      fanoutRecords: fanouts.length,
      ambiguous: ambiguous.length,
      unmatchedTangSong: unmatched.length,
    },
    writtenIds,
    fanouts,
    ambiguous,
    unmatchedTangSong: unmatched,
  };
  const reportPath = join(CACHE, 'annotate', 'report.json');
  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('');
  console.log(`匹配到 ${byId.size} 首（Tier A ${tierA} / Tier B ${tierB}，一对多 ${fanouts.length} 组）`);
  console.log(`${DRY ? '[dry-run] 将写入' : '已写入'} ${written} 个注释文件；跳过已存在 ${skippedExisting}；歧义放弃 ${ambiguous.length}`);
  console.log(`唐宋未匹配 ${unmatched.length} 条（候选目录见报告）`);
  console.log(`报告：${reportPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
