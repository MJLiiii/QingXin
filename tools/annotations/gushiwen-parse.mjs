/* 古诗文网 HTML → 结构化数据解析（纯函数，无 I/O，可离线测试）。
   选择器均由 2026-07-02 实测钉死：
   - 列表页（目录 /shiwens/default.aspx?cstr=…&xstr=… 与作者 astr=… 同构）：
     每条 <div id="zhengwen<hexid>"> 内含标题链接 /shiwenv_<hexid>.aspx、
     <p class="source"> 作者+〔朝代〕、<div id="contson<hexid>"> 全文正文；
     下一页 <a class="amore" href="…page=N…">下一页</a>。
   - 详情页：<h1> 标题；#contson<hexid> 原文；可折叠节
     <div id="fanyi<N>"|"shangxi<N>" class="sons"> 带 <h2><span>标题</span>，
     内容长则有 fanyiShow(N,'HASH')/shangxiShow(N,'HASH') 展开钩子 → 需 AJAX
     （/nocdn/ajaxfanyi.aspx / ajaxshangxi.aspx），短则全文内联；
     创作背景可能是 shangxi<N> 折叠节，也可能是独立内联
     <div class="sons"><div class="contyishang"> 块。
   - 片段/内联内容里 译文/注释 小标题有 <strong> 包裹与纯文本两种形态；
     尾部有 .cankao 参考资料/完善/本节内容由… 版权尾巴需剥离。 */
import { cleanLine } from './annotate-lib.mjs';

/* ---------- 基础工具 ---------- */

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', hellip: '…', middot: '·',
};

export function decodeEntities(s) {
  return String(s || '')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED_ENTITIES[name] ?? m);
}

export function stripTags(s) {
  return decodeEntities(String(s || '').replace(/<[^>]*>/g, ''));
}

/* <br>/<p> → 换行，剥标签，按空行切块；块内行 cleanLine。
   返回块数组（每块可能多行，行以 \n 相连）——与 guwen 数据集 blocks 语义一致 */
export function htmlToParas(html) {
  const text = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<textarea[\s\S]*?<\/textarea>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h1|h2|h3)>/gi, '\n\n')
    .replace(/<[^>]*>/g, '');
  return decodeEntities(text)
    .split(/\n{2,}/)
    .map((block) => block.split('\n').map(cleanLine).filter(Boolean).join('\n'))
    .filter(Boolean);
}

/* 从 html[startIdx]（须指向 '<div'）起数 <div/</div> 配平，取整块 */
export function extractBalancedDiv(html, startIdx) {
  const openRe = /<div[\s>]/gi;
  const closeRe = /<\/div>/gi;
  let depth = 0;
  let i = startIdx;
  while (i < html.length) {
    openRe.lastIndex = i;
    closeRe.lastIndex = i;
    const o = openRe.exec(html);
    const c = closeRe.exec(html);
    if (!c) return html.slice(startIdx); // 不配平：给出剩余部分
    if (o && o.index < c.index) {
      depth++;
      i = o.index + 4;
    } else {
      depth--;
      i = c.index + 6;
      if (depth === 0) return html.slice(startIdx, i);
    }
  }
  return html.slice(startIdx);
}

/* 取 <div … id="<id>" …> 的配平整块；无则 null */
export function findDivById(html, id) {
  const m = new RegExp(`<div[^>]*id="${id}"[^>]*>`).exec(html);
  if (!m) return null;
  return extractBalancedDiv(html, m.index);
}

/* 版权尾巴：参考资料列表从该行起全部截断，其余噪声行逐行剥 */
const CUT_RE = /^参考资料/;
const NOISE_RE =
  /^(完善|纠错|复制|下载|收藏|朗读|有用|没用|展开阅读全文|收起)$|本节内容由.*(整理|上传)|原作者已无法考证|仅供学习参考|其观点不代表本站立场/;
export function stripFooterLines(paras) {
  const out = [];
  outer: for (const p of paras) {
    const lines = [];
    for (const line of p.split('\n')) {
      if (CUT_RE.test(line)) break outer;
      if (NOISE_RE.test(line)) continue;
      lines.push(line);
    }
    if (lines.length) out.push(lines.join('\n'));
  }
  return out;
}

/* ---------- 列表页（目录页与作者页同构） ---------- */

const ITEM_RE = /<div id="zhengwen([0-9a-f]{6,})">/g;

/* → [{hexid,title,author,dynasty,blocks}]；blocks = 正文分块（首块可能是序） */
export function parseListItems(html) {
  const items = [];
  for (const m of String(html || '').matchAll(ITEM_RE)) {
    const hexid = m[1];
    const seg = extractBalancedDiv(html, m.index);
    const tm = seg.match(
      new RegExp(`<a[^>]*href="/shiwenv_${hexid}\\.aspx"[^>]*>([\\s\\S]*?)</a>`),
    );
    const title = tm ? stripTags(tm[1]).trim() : '';
    const sm = seg.match(/<p class="source">([\s\S]*?)<\/p>/);
    let author = '';
    let dynasty = '';
    if (sm) {
      const am = sm[1].match(/<a[^>]*href="[^"]*authorv[^"]*"[^>]*>([\s\S]*?)<\/a>/);
      author = (am ? stripTags(am[1]) : stripTags(sm[1]).split('〔')[0]).trim();
      const dm = stripTags(sm[1]).match(/〔([^〕]+)〕/);
      dynasty = dm ? dm[1] : '';
    }
    const cont = findDivById(seg, `contson${hexid}`);
    const blocks = cont ? stripFooterLines(htmlToParas(cont)) : [];
    if (hexid && title && blocks.length) {
      items.push({ hexid, title, author, dynasty, blocks });
    }
  }
  return items;
}

/* → {items, nextPage: number|null} */
export function parseCatalogPage(html) {
  const items = parseListItems(html);
  let nextPage = null;
  const nm = String(html || '').match(
    /<a[^>]*class="amore"[^>]*href="[^"]*[?&]page=(\d+)[^"]*"[^>]*>下一页/,
  );
  if (nm) nextPage = parseInt(nm[1], 10);
  return { items, nextPage };
}

/* ---------- 详情页 ---------- */

const HEADING_RE = /<h2[^>]*>\s*<span[^>]*>([^<]+)<\/span>/;
const AJAX_RE = /(?:fanyiShow|shangxiShow)\((\d+),\s*'([0-9A-F]+)'/;
const BACKGROUND_HEAD_RE = /创作背景|写作背景/;
const APPRECIATION_HEAD_RE = /^(赏析|鉴赏|简析|评析|赏读|解析|解读|艺术特色)/;

/* 节内联内容：剥掉标题行与版权尾巴后的段落数组 */
function sectionParas(seg, heading) {
  let paras = stripFooterLines(htmlToParas(seg));
  if (heading) {
    paras = paras.filter((p) => {
      const first = p.split('\n')[0];
      return first !== heading && !first.startsWith(heading + ' ');
    });
  }
  return paras;
}

/* 标题 → 节归属；不认识的标题（文言知识/轶事典故/争议…）返回 null 即忽略。
   注意 fanyi<N> 折叠节里也可能挂「文言知识」等非译文块，故必须按标题判定，
   不能只看 divKind。 */
function classifyHeading(heading) {
  if (BACKGROUND_HEAD_RE.test(heading)) return 'background';
  if (heading.startsWith('译文')) return 'fanyi';
  if (APPRECIATION_HEAD_RE.test(heading)) return 'shangxi';
  return null;
}

/* → {title, author, dynasty, blocks, truncated, sections}
   sections = [{channel:'fanyi'|'shangxi'|'background', heading, n, idjm, ajaxKind, paras}]
   paras 恒为详情页内联可见文本（始终干净）：n 非空时它是被折叠的“预览”（需 AJAX 取全文，
   但若 AJAX 全文被字符投毒则回退用它），n 为空时它就是完整内联全文。 */
export function parseDetailPage(html, hexid) {
  const h = String(html || '');
  const tm = h.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  const title = tm ? stripTags(tm[1]).trim() : '';
  const sm = h.match(/<p class="source">([\s\S]*?)<\/p>/);
  let author = '';
  let dynasty = '';
  if (sm) {
    const am = sm[1].match(/<a[^>]*>([\s\S]*?)<\/a>/);
    author = (am ? stripTags(am[1]) : stripTags(sm[1]).split('〔')[0]).trim();
    const dm = stripTags(sm[1]).match(/〔([^〕]+)〕/);
    dynasty = dm ? dm[1] : '';
  }
  const cont = findDivById(h, `contson${hexid}`);
  const blocks = cont ? stripFooterLines(htmlToParas(cont)) : [];
  /* 超长原文会折叠（展开走 ajaxshiwencont）；诗词几乎不会触发，标记供校验放宽 */
  const zheng = findDivById(h, `zhengwen${hexid}`) || '';
  const truncated = /展开阅读全文/.test(zheng);

  const sections = [];
  const covered = []; // 折叠节的 [start,end)，独立内联块须在其外

  for (const m of h.matchAll(/<div id="(fanyi|shangxi)(\d+)" class="sons"/g)) {
    const seg = extractBalancedDiv(h, m.index);
    covered.push([m.index, m.index + seg.length]);
    const hm = seg.match(HEADING_RE);
    const heading = hm ? hm[1].trim() : '';
    const channel = classifyHeading(heading);
    if (!channel) continue;
    const am = seg.match(AJAX_RE);
    const paras = sectionParas(seg, heading);
    if (am) {
      sections.push({
        channel, heading, n: parseInt(am[1], 10), idjm: am[2], ajaxKind: m[1], paras,
      });
    } else {
      sections.push({ channel, heading, n: null, idjm: null, ajaxKind: null, paras });
    }
  }

  /* 独立内联节（如直接嵌页的创作背景）：.sons > .contyishang 且不在折叠节内 */
  for (const m of h.matchAll(/<div class="contyishang"/g)) {
    if (covered.some(([s, e]) => m.index >= s && m.index < e)) continue;
    const seg = extractBalancedDiv(h, m.index);
    const hm = seg.match(HEADING_RE);
    if (!hm) continue;
    const heading = hm[1].trim();
    const channel = classifyHeading(heading);
    if (!channel) continue;
    sections.push({ channel, heading, n: null, idjm: null, ajaxKind: null, paras: sectionParas(seg, heading) });
  }

  return { title, author, dynasty, blocks, truncated, sections };
}

/* ---------- AJAX 片段 ---------- */

const FANYI_HEADING_LINE = /^译文及注释[一二三四五六七八九十二三]*$/;
const TRANSLATION_MARK = /^译文[：:]?$/;
const NOTES_MARK = /^注释[：:]?$/;

/* 段落数组（已 cleanLine/去尾）→ {translationText, notesText}（\n 分隔行文本，
   交由 lib 的 parseTranslation/parseNotes 做结构化——与旧导入器完全一致）。
   <strong>译文</strong> 与纯文本标题行两种形态都归一成独立标记行。
   inline 短内容与 AJAX 全文都走这里。 */
export function splitFanyiParas(paras) {
  const translation = [];
  const notes = [];
  let mode = null; // null | 'translation' | 'notes'
  for (const p of paras) {
    for (const line of p.split('\n')) {
      if (FANYI_HEADING_LINE.test(line)) continue;
      if (TRANSLATION_MARK.test(line)) { mode = 'translation'; continue; }
      if (NOTES_MARK.test(line)) { mode = 'notes'; continue; }
      if (mode === 'notes') notes.push(line);
      else translation.push(line); // 无标记行时容忍为译文
    }
  }
  return { translationText: translation.join('\n'), notesText: notes.join('\n') };
}

export function parseFanyiFragment(html) {
  return splitFanyiParas(stripFooterLines(htmlToParas(html)));
}

/* 赏析/创作背景片段 → 段落数组 */
export function parseShangxiFragment(html) {
  const paras = stripFooterLines(htmlToParas(html));
  return paras.filter((p, i) => {
    const first = p.split('\n')[0];
    /* 掉头部的节标题行（创作背景/赏析/鉴赏…） */
    return !(i === 0 && (BACKGROUND_HEAD_RE.test(first) || APPRECIATION_HEAD_RE.test(first))
      && first.length <= 8);
  });
}

/* ---------- 反投毒（gushiwen 对部分赏析做字符替换：的→屈/光、一→楼…） ---------- */

/* 详情页内联预览恒干净；AJAX 全文可能被投毒。逐字比对二者正文前缀：
   投毒是等长 1:1 替换，故干净全文的前缀必与预览逐字相同，投毒则大量不符。
   注意投毒输出会与真实字符碰撞（一→楼，而“倚楼”本有楼），故只能检测、不可逆向还原。
   入参须为已剥掉标题/「译文」「注释」标记的纯正文串（结构差异不能算作投毒）。 */
export function contentPoisoned(cleanStr, fullStr) {
  const a = String(cleanStr || '').replace(/\s/g, '');
  const b = String(fullStr || '').replace(/\s/g, '');
  const L = Math.min(a.length, b.length, 60);
  if (L < 8) return false; // 预览过短，无法判定 → 视为干净（投毒目标都是长赏析）
  let mism = 0;
  for (let i = 0; i < L; i++) if (a[i] !== b[i]) mism++;
  /* 干净全文的前缀与预览逐字相同（实测 0 不符）；投毒只换常用虚词（的/一/之，
     约 8%），60 字窗口里约 5–8 处不符。阈值 2 既留一处偶发差异余量又稳抓投毒。 */
  return mism >= 2;
}

/* ---------- 写前硬门 ---------- */

const DIRTY_RE = /[<>]|&#|▲|参考资料|本节内容由|javascript:|function\s*\(/;

function dirtyIn(strings) {
  for (const s of strings) {
    if (DIRTY_RE.test(s)) return s.slice(0, 40);
  }
  return null;
}

/* 违规节整节丢弃并记 warning，绝不写脏数据。返回 {ann, warnings} */
export function validateScrapedAnnotation(ann) {
  const warnings = [];
  const out = { ...ann };
  const drop = (section, sample) => {
    warnings.push({ section, sample });
    if (section === 'notes') out.notes = [];
    else if (section === 'preface') { out.preface = ''; out.prefaceTranslation = ''; }
    else out[section] = [];
  };
  out.notes = (out.notes || []).filter((n) => n.term && n.def);
  {
    const bad = dirtyIn(out.notes.flatMap((n) => [n.term, n.def]));
    if (bad) drop('notes', bad);
  }
  for (const key of ['translation', 'appreciation', 'background']) {
    const bad = dirtyIn(out[key] || []);
    if (bad) drop(key, bad);
  }
  {
    const bad = dirtyIn([out.preface || '', out.prefaceTranslation || '']);
    if (bad) drop('preface', bad);
  }
  return { ann: out, warnings };
}
