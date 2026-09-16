import { esc, hashPath } from './utils.js';

var GLOSS_PAREN = /（[^（）]*）|\([^()]*\)/g;

export function navHref(path) {
  return esc('#/' + hashPath(path));
}

// 超大标题按字数（码点，生僻扩展字算一个）分档，对应 glass.css 的 [data-size]。
export function displaySize(text) {
  var n = Array.from(String(text == null ? '' : text)).length;
  if (n <= 4) return 's';
  if (n <= 8) return 'm';
  if (n <= 16) return 'l';
  if (n <= 40) return 'xl';
  return 'xxl';
}

var HERO_SPLIT = /^(.+?)[，,；;？?！!](.+)$/;
var HERO_TAIL = /[，,。．.；;：:？?！!、…—\s]+$/;
var HERO_MAX = 12;

function heroClean(line) {
  return String(line == null ? '' : line).trim().replace(HERO_TAIL, '');
}

// 首页超大标题：首句在第一个逗号 / 分号 / 问叹号处拆成两行并去掉句末标点；
// 拆不开或某行超过 HERO_MAX 字时，退回原文前两行。
export function heroLines(paragraphs) {
  var lines = (paragraphs || []).map(heroClean).filter(Boolean);
  if (!lines.length) return [];
  var m = HERO_SPLIT.exec(lines[0]);
  if (m) {
    var pair = [heroClean(m[1]), heroClean(m[2])];
    var fits = pair.every(function (line) { return line && Array.from(line).length <= HERO_MAX; });
    if (fits) return pair;
  }
  return lines.slice(0, 2);
}

function isFuzzyMatch(match) {
  return match && (match.fuzzy === true || Number(match.distance) > 0
    || String(match.type || match.matchType || '').toLowerCase().indexOf('fuzzy') >= 0);
}

function isMatchField(match, field) {
  var actual = String((match && (match.field || match.matchField)) || '').toLowerCase();
  if (!actual) return true;
  if (actual === field) return true;
  return field === 'name' && actual === 'author';
}

export function highlighted(text, query, match, field) {
  var value = String(text == null ? '' : text);
  if (isFuzzyMatch(match) || !isMatchField(match, field)) return esc(value);

  var start = match && Number(match.start);
  var length = match && Number(match.length);
  if (Number.isInteger(start) && Number.isInteger(length)
      && start >= 0 && length > 0 && start < value.length) {
    var end = Math.min(value.length, start + length);
    return esc(value.slice(0, start))
      + '<mark class="search-match">' + esc(value.slice(start, end)) + '</mark>'
      + esc(value.slice(end));
  }

  // 兼容旧索引：仅高亮展示文本中真实存在的连续片段。
  var needle = String(query == null ? '' : query).trim();
  var at = needle ? value.indexOf(needle) : -1;
  if (at < 0) return esc(value);
  return esc(value.slice(0, at))
    + '<mark class="search-match">' + esc(value.slice(at, at + needle.length)) + '</mark>'
    + esc(value.slice(at + needle.length));
}

export function emptyState(hint, title) {
  return '<div class="poem-list__item poem-list__empty"><div><div class="poem-list__title">'
    + esc(title || '无匹配') + '</div>'
    + '<div class="poem-list__excerpt">' + esc(hint) + '</div></div></div>';
}

export function glossTerm(term) {
  return String(term == null ? '' : term).replace(GLOSS_PAREN, '').trim();
}

// 把注释词条定位到原文各行：按注释顺序用游标向后找（找不到再从头找），不跨行；
// 与已定位的词重叠时保留较长者。返回每行转义后的 HTML，第 k 条注释对应 data-gloss="k"。
export function glossLines(lines, notes) {
  var text = (lines || []).map(function (line) { return String(line == null ? '' : line); });
  var claims = text.map(function () { return []; });
  var cursor = { line: 0, pos: 0 };

  (notes || []).forEach(function (note, k) {
    var term = glossTerm(note && note.term);
    if (!term) return;
    var hits = [];
    text.forEach(function (line, li) {
      for (var at = line.indexOf(term); at >= 0; at = line.indexOf(term, at + 1)) {
        hits.push({ line: li, start: at, end: at + term.length });
      }
    });
    var ahead = hits.filter(function (h) {
      return h.line > cursor.line || (h.line === cursor.line && h.start >= cursor.pos);
    });
    var ordered = ahead.concat(hits.filter(function (h) { return ahead.indexOf(h) < 0; }));
    for (var i = 0; i < ordered.length; i++) {
      var hit = ordered[i];
      var overlaps = claims[hit.line].filter(function (c) { return c.start < hit.end && hit.start < c.end; });
      if (overlaps.some(function (c) { return c.end - c.start >= term.length; })) continue;
      claims[hit.line] = claims[hit.line]
        .filter(function (c) { return overlaps.indexOf(c) < 0; })
        .concat({ start: hit.start, end: hit.end, k: k });
      cursor = { line: hit.line, pos: hit.end };
      return;
    }
  });

  return text.map(function (line, li) {
    var html = '';
    var pos = 0;
    claims[li].sort(function (a, b) { return a.start - b.start; }).forEach(function (c) {
      html += esc(line.slice(pos, c.start))
        + '<span class="gloss" role="button" tabindex="0" aria-haspopup="dialog" aria-expanded="false"'
        + ' data-gloss="' + c.k + '">' + esc(line.slice(c.start, c.end)) + '</span>';
      pos = c.end;
    });
    return html + esc(line.slice(pos));
  });
}

export function errorSection(msg) {
  return '<section class="section section--top"><div class="prose"><p class="prose--faint">'
    + esc(msg) + '</p></div></section>';
}

export function searchBoxHTML(o) {
  o = o || {};
  var id = o.id || 'search-input';
  var statusId = o.statusId || (id + '-status');
  var controls = o.controls || 'list-rows';
  var aria = o.aria || '搜索诗词';
  return '<div class="search" role="search" aria-label="' + esc(aria) + '">'
    + '<input class="search__input" id="' + esc(id) + '" type="search" autocomplete="off"'
    + ' autocapitalize="off" spellcheck="false" enterkeyhint="search"'
    + ' placeholder="' + esc(o.placeholder || '搜索标题、作者或名句…') + '"'
    + ' aria-label="' + esc(aria) + '" aria-controls="' + esc(controls) + '"'
    + ' aria-describedby="' + esc(statusId) + '">'
    + '<span class="search__tag latin" aria-hidden="true">' + esc(o.tag || 'search') + '</span>'
    + '</div>'
    + '<div class="search__status" id="' + esc(statusId)
    + '" role="status" aria-live="polite" aria-atomic="true"></div>';
}
