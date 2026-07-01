/* 注释导入共享库：文本归一化、相似度、情心诗库索引。
   供 annotate-import.mjs 使用；不依赖任何第三方包。 */
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
   返回 { byKey, byAuthor, total }：
   - byKey:    "作者|正文归一化前12字" -> entry[]（全唐诗重出诗会有多条）
   - byAuthor: 作者 -> entry[]
   entry = { id, title, titleNorms, author, kind, normFull } */
export async function loadQingxinIndex(dataDir) {
  const manifest = JSON.parse(
    await readFile(join(dataDir, 'manifest.json'), 'utf8'),
  );
  const chunks = manifest.chunks;
  const byKey = new Map();
  const byAuthor = new Map();
  let total = 0;
  for (let c = 0; c < chunks; c++) {
    const name = String(c).padStart(4, '0') + '.json';
    const poems = JSON.parse(
      await readFile(join(dataDir, 'poems', name), 'utf8'),
    );
    for (const p of poems) {
      const normFull = normText((p.paragraphs || []).join(''));
      if (!normFull) continue;
      const entry = {
        id: p.id,
        title: p.title || '',
        titleNorms: normTitle(p.title || ''),
        author: normAuthor(p.author),
        kind: p.kind,
        normFull,
      };
      const key = entry.author + '|' + normFull.slice(0, 12);
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(entry);
      if (!byAuthor.has(entry.author)) byAuthor.set(entry.author, []);
      byAuthor.get(entry.author).push(entry);
      total++;
    }
  }
  return { byKey, byAuthor, total };
}
