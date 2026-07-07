/* 从 chinese-gushiwen 数据集导入 译文/注释/赏析 → data/annotations/<id>.json
   （创作背景数据集里没有，保持空数组=前端占位；不做任何 AI 生成。）

   用法（在 tools/ 下）：
     node annotations/annotate-import.mjs                    # 下载全部 10 个分块并导入
     node annotations/annotate-import.mjs --dry-run          # 只匹配统计，不写文件
     node annotations/annotate-import.mjs --src <文件|目录>… # 用本地 JSONL 文件替代下载
     node annotations/annotate-import.mjs --force            # 允许覆盖 source==="gushiwen" 的旧导入
     node annotations/annotate-import.mjs --limit 100        # 只处理前 N 条（调试用）

   安全约定：
   - 已存在的注释文件默认跳过；但 source==="ai" 视为低优先级自动生成内容，
     可被本脚本的人工数据集结果替换。
   - --force 也只额外覆盖 JSON 里带 "source":"gushiwen" 的旧导入；
     source==="gushiwen-web" 与无 source 手写文件永远不会被本脚本覆盖。
   - 只写 data/annotations/，绝不改动 data/poems/** 原文。 */
import { mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadQingxinIndex, matchToCorpus, splitParas, parseNotes, parseTranslation,
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

/* ---------- 字段转换 ---------- */

function toAnnotation(rec, id, preface) {
  const notes = parseNotes(rec.remark);
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

function canOverwrite(existingRaw) {
  if (existingRaw == null) return true;
  let existing = null;
  try { existing = JSON.parse(existingRaw); } catch { return false; }
  if (existing.source === 'ai') return true;
  if (FORCE && existing.source === 'gushiwen') return true;
  return false;
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
    const res = matchToCorpus(
      { title: rec.title, author: rec.writer, blocks: contentBlocks(rec) }, idx,
    );
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
    if (!canOverwrite(existing)) {
      skippedExisting++;
      continue;
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
