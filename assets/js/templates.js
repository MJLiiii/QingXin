import { esc, hashPath } from './utils.js';

var GLOSS_PAREN = /（[^（）]*）|\([^()]*\)/g;

export function navHref(path) {
  return esc('#/' + hashPath(path));
}

// 超大标题按字数（码点，生僻扩展字算一个）分档，对应 kyne.css / glass.css 的 [data-size]。
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

export function listRow(nav, title, by, excerpt) {
  var rendered = arguments[4] || {};
  return '<a class="poem-list__item poem-list__item--link" href="' + navHref(nav)
    + '" data-nav="' + esc(nav) + '">'
    + '<div><div class="poem-list__title">' + (rendered.title || esc(title)) + '</div>'
    + (excerpt ? '<div class="poem-list__excerpt">' + (rendered.excerpt || esc(excerpt)) + '</div>' : '')
    + '</div>'
    + '<div class="poem-list__by">' + (rendered.by || by) + '</div>'
    + '</a>';
}

export function poemRow(e) {
  return listRow('poem/' + e.id, e.title, esc(e.author) + ' · ' + esc(e.dynasty), e.excerpt);
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

export function searchRow(a, query) {
  var id = String(a[0] || '');
  var match = a[3] || {};
  var by = highlighted(a[2], query, match, 'author') + ' · ' + (id.charAt(0) === 't' ? '唐' : '宋');
  if (match.field === 'line' && match.line) {
    // 诗句命中：标题照常显示，命中句作为摘句并高亮。
    return listRow('poem/' + id, a[1], '', match.line, {
      title: esc(a[1]),
      by: by,
      excerpt: highlighted(match.line, query, match, 'line'),
    });
  }
  return listRow('poem/' + id, a[1], '', '', {
    title: highlighted(a[1], query, match, 'title'),
    by: by,
  });
}

export function authorRow(a, query, match) {
  if (typeof query !== 'string') {
    query = '';
    match = null;
  }
  match = match || a._search || {};
  return listRow('author/' + a.slug, a.name, esc(a.dynasty) + ' · ' + esc(a.count) + ' 首', '', {
    title: query ? highlighted(a.name, query, match, 'name') : esc(a.name),
  });
}

export function emptyState(hint, title) {
  return '<div class="poem-list__item poem-list__empty"><div><div class="poem-list__title">'
    + esc(title || '无匹配') + '</div>'
    + '<div class="poem-list__excerpt">' + esc(hint) + '</div></div></div>';
}

// opts: section（data-section，记住展开用）、open、empty（标题行「未收录」）、headExtra（非折叠栏标题行右侧内容）。
export function entryShell(title, roman, inner, ruleClass, collapsible, opts) {
  opts = opts || {};
  var rule = '<div class="entry-head__rule' + (ruleClass ? ' ' + ruleClass : '') + '"></div>';
  var section = opts.section ? ' data-section="' + esc(opts.section) + '"' : '';
  if (!collapsible) {
    return '<section class="section entry"' + section + '>'
      + '<div class="entry-head"><span class="entry-head__title">' + esc(title) + '</span>'
      + '<span class="entry-head__num latin">' + roman + '</span>'
      + (opts.headExtra || '') + '</div>'
      + rule + inner
      + '</section>';
  }
  var open = !!opts.open;
  return '<section class="section entry entry--collapsible' + (open ? '' : ' entry--collapsed') + '"' + section + '>'
    + '<button class="entry-head entry-head--toggle" data-toggle aria-expanded="' + open + '">'
    + '<span class="entry-head__title">' + esc(title) + '</span>'
    + '<span class="entry-head__num latin">' + roman + '</span>'
    + (opts.empty ? '<span class="entry-head__empty">未收录</span>' : '')
    + '<span class="entry-head__chev" aria-hidden="true"></span>'
    + '</button>'
    + rule
    + '<div class="entry-body"><div class="entry-body__inner">' + inner + '</div></div>'
    + '</section>';
}

export function proseEntry(title, roman, paras, faintFirst, opts) {
  opts = opts || {};
  var has = !!(paras && paras.length);
  var body;
  if (has) {
    body = paras.map(function (p, i) {
      var faint = faintFirst && i === 0;
      return '<p' + (faint ? ' class="prose--faint"' : '') + '>' + esc(p) + '</p>';
    }).join('');
  } else {
    body = '<p class="prose--faint">尚未收录，敬请期待。</p>';
  }
  return entryShell(title, roman, '<div class="prose">' + body + '</div>', '', true, {
    section: opts.section,
    open: has && opts.open,
    empty: !has,
  });
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

export function pagerHTML(route, page, pages) {
  function btn(target, label, on) {
    var path = route + '/' + target;
    return on
      ? '<a class="pager__btn" href="' + navHref(path) + '" data-nav="' + esc(path) + '">' + label + '</a>'
      : '<span class="pager__btn pager__btn--off">' + label + '</span>';
  }
  return '<div class="pager" id="pager">'
    + btn(0, '«', page > 0)
    + btn(page - 1, '← 上一页', page > 0)
    + '<span class="pager__jump">第 '
    + '<input class="pager__input" id="pager-input" type="number" min="1" max="' + pages + '"'
    + ' value="' + (page + 1) + '" data-route="' + route + '" aria-label="跳转到页码">'
    + ' / ' + pages + ' 页 '
    + '<button class="pager__go" id="pager-go">跳转</button>'
    + '</span>'
    + btn(page + 1, '下一页 →', page < pages - 1)
    + btn(pages - 1, '»', page < pages - 1)
    + '</div>';
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
