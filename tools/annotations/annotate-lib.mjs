/* 注释工具共享库：文本归一化、相似度、情心诗库索引、语料匹配、字段转换。
   供 annotate-import.mjs / annotate-scrape.mjs 使用；不依赖任何第三方包。 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/* 异文/通假括注，如 (何似 一作：何时)、（尊 通：樽）——比对前先剥离 */
export const VARIANT_RE = /[(（][^()（）]*(?:一作|一本作|通)[：:][^()（）]*[)）]/g;

/* 全部中英标点、空白、爬虫残留（▲）、全角空格 */
export const PUNCT_RE =
  /[，。、；：？！“”‘’「」『』《》〈〉（）()·．…—－\-,.;:?!'"<>\[\]\s▲　]/g;

/* 正文归一化：剥异文括注 → 剥标点空白 */
export function normText(s) {
  return String(s || '').replace(VARIANT_RE, '').replace(PUNCT_RE, '');
}

/* 作者归一化：去首尾空白、去尾部编号（吴氏3→吴氏）、佚名系归并 */
export function normAuthor(s) {
  let a = String(s || '').trim().replace(/[0-9０-９]+$/, '');
  if (a === '佚名' || a === '无名' || a === '' ) a = '无名氏';
  return a;
}

/* 标题归一化：按 " / " 拆备选（琵琶行 / 琵琶引）、去括注、去尾部 ·其N，
   返回归一化后的备选数组 */
export function normTitle(s) {
  return String(s || '')
    .split(/\s*\/\s*/)
    .map((t) =>
      normText(
        t
          .replace(/[（(][^()（）]*[)）]/g, '')
          .replace(/·其[一二三四五六七八九十百\d]+$/, ''),
      ),
    )
    .filter(Boolean);
}

/* 字符 bigram Dice 相似度（对短诗也稳定；相同串=1，无重合=0） */
export function dice(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const grams = new Map();
  for (let i = 0; i < a.length - 1; i++) {
    const g = a.slice(i, i + 2);
    grams.set(g, (grams.get(g) || 0) + 1);
  }
  let hit = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const g = b.slice(i, i + 2);
    const n = grams.get(g) || 0;
    if (n > 0) {
      hit++;
      grams.set(g, n - 1);
    }
  }
  return (2 * hit) / (a.length - 1 + (b.length - 1));
}

/* 载入情心诗库并建索引。
   重要：chunk 文件名按 manifest 计算（0000.json…），绝不 readdir——
   目录里可能有 iCloud 冲突副本（如 "0057 3.json"）。
   返回 { byKey, byAuthor, byId, total }：
   - byKey:    "作者|正文归一化前12字" -> entry[]（全唐诗重出诗会有多条）
   - byAuthor: 作者 -> entry[]
   - byId:     id -> entry
   entry = { id, title, titleNorms, author, rawAuthor, kind, paras, normFull } */
export async function loadQingxinIndex(dataDir) {
  const manifest = JSON.parse(
    await readFile(join(dataDir, 'manifest.json'), 'utf8'),
  );
  const chunks = manifest.chunks;
  const byKey = new Map();
  const byAuthor = new Map();
  const byId = new Map();
  let total = 0;
  for (let c = 0; c < chunks; c++) {
    const name = String(c).padStart(4, '0') + '.json';
    const poems = JSON.parse(
      await readFile(join(dataDir, 'poems', name), 'utf8'),
    );
    for (const p of poems) {
      const paras = p.paragraphs || [];
      const normFull = normText(paras.join(''));
      if (!normFull) continue;
      const entry = {
        id: p.id,
        title: p.title || '',
        titleNorms: normTitle(p.title || ''),
        author: normAuthor(p.author),
        rawAuthor: p.author || '',
        kind: p.kind,
        paras,
        normFull,
      };
      const key = entry.author + '|' + normFull.slice(0, 12);
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(entry);
      if (!byAuthor.has(entry.author)) byAuthor.set(entry.author, []);
      byAuthor.get(entry.author).push(entry);
      byId.set(entry.id, entry);
      total++;
    }
  }
  return { byKey, byAuthor, byId, total };
}

/* ---------- 语料匹配（自 annotate-import.mjs 平移，阈值原样保留） ---------- */

/* 候选正文：全文，以及（可能去掉序的）后续块 */
export function candidateBodies(blocks) {
  const bodies = [{ text: blocks.join('\n'), preface: null }];
  if (blocks.length > 1) {
    bodies.push({ text: blocks.slice(1).join('\n'), preface: blocks[0] });
  }
  return bodies;
}

/* record = {title, author, blocks}（blocks 为正文分块，首块可能是序）。
   返回 {matches:[{entry,score,preface,tier}]} 或 {ambiguous:{…}} 或 {matches:[]}。
   - Tier A：作者 + 正文前12字精确键，Dice ≥ 0.75（佚名 0.90）、长度比 0.6–1.5；
   - Tier B：同作者全集模糊扫描，长度比 0.5–2，≥0.85 或 ≥0.70+标题命中；
   - 歧义：亚军差距 ≤0.05 且两正文 Dice < 0.80（非重出异文）时整条放弃。 */
export function matchToCorpus(record, idx) {
  const author = normAuthor(record.author);
  const blocks = record.blocks;
  if (!blocks.length) return { matches: [] };
  const bodies = candidateBodies(blocks);
  const titleNorms = normTitle(record.title);
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
          title: record.title, writer: record.author,
          best: { id: best.entry.id, title: best.entry.title, score: +best.score.toFixed(3) },
          runner: { id: r.entry.id, title: r.entry.title, score: +r.score.toFixed(3) },
        },
      };
    }
  }
  return { matches: accepted };
}

/* ---------- 字段转换（自 annotate-import.mjs 平移，行为不变） ---------- */

export function cleanLine(s) {
  return s
    .replace(/▲/g, '')
    /* 爬虫黏连的标题头，如 "《核舟记》 　　苏东坡的词…"——
       书名号短标题后紧跟全角缩进才剥（正常行文不会这样开头） */
    .replace(/^《[^《》]{1,12}》\s*　+/, '')
    .replace(/^[　\s]+|[　\s]+$/g, '');
}

export function splitParas(s) {
  return String(s || '').split(/\n+/).map(cleanLine).filter(Boolean);
}

/* 注释原文 → notes[{term,def}]：全/半角冒号在第1~30字符处开新词条，
   无冒号行是上一条释义的续行 */
export function parseNotes(remark) {
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
export function parseTranslation(s, hasPreface) {
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
