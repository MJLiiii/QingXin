import { esc } from './utils.js';

export function listRow(nav, title, by, excerpt) {
  var rendered = arguments[4] || {};
  var path = String(nav).split('/').map(function (part) { return encodeURIComponent(part); }).join('/');
  var safeNav = esc(nav);
  return '<a class="poem-list__item poem-list__item--link" href="' + esc('#/' + path)
    + '" data-nav="' + safeNav + '">'
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

function highlighted(text, query, match, field) {
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
  return listRow('poem/' + id, a[1], '', '', {
    title: highlighted(a[1], query, match, 'title'),
    by: highlighted(a[2], query, match, 'author') + ' · ' + (id.charAt(0) === 't' ? '唐' : '宋'),
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

export function entryShell(title, roman, inner, ruleClass, collapsible) {
  var rule = '<div class="entry-head__rule' + (ruleClass ? ' ' + ruleClass : '') + '"></div>';
  if (!collapsible) {
    return '<section class="section entry">'
      + '<div class="entry-head"><span class="entry-head__title">' + esc(title) + '</span>'
      + '<span class="entry-head__num latin">' + roman + '</span></div>'
      + rule + inner
      + '</section>';
  }
  return '<section class="section entry entry--collapsible entry--collapsed">'
    + '<button class="entry-head entry-head--toggle" data-toggle aria-expanded="false">'
    + '<span class="entry-head__title">' + esc(title) + '</span>'
    + '<span class="entry-head__num latin">' + roman + '</span>'
    + '<span class="entry-head__chev" aria-hidden="true"></span>'
    + '</button>'
    + rule
    + '<div class="entry-body"><div class="entry-body__inner">' + inner + '</div></div>'
    + '</section>';
}

export function proseEntry(title, roman, paras, faintFirst) {
  var body;
  if (paras && paras.length) {
    body = paras.map(function (p, i) {
      var faint = faintFirst && i === 0;
      return '<p' + (faint ? ' class="prose--faint"' : '') + '>' + esc(p) + '</p>';
    }).join('');
  } else {
    body = '<p class="prose--faint">尚未收录，敬请期待。</p>';
  }
  return entryShell(title, roman, '<div class="prose">' + body + '</div>', '', true);
}

export function errorSection(msg) {
  return '<section class="section section--top"><div class="prose"><p class="prose--faint">'
    + esc(msg) + '</p></div></section>';
}

export function pagerHTML(route, page, pages) {
  function btn(target, label, on) {
    return on
      ? '<button class="pager__btn" data-nav="' + route + '/' + target + '">' + label + '</button>'
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
    + ' placeholder="' + esc(o.placeholder || '搜索诗词标题、作者或近似关键词…') + '"'
    + ' aria-label="' + esc(aria) + '" aria-controls="' + esc(controls) + '"'
    + ' aria-describedby="' + esc(statusId) + '">'
    + '<span class="search__tag latin" aria-hidden="true">' + esc(o.tag || 'search') + '</span>'
    + '</div>'
    + '<div class="search__status" id="' + esc(statusId)
    + '" role="status" aria-live="polite" aria-atomic="true"></div>';
}
