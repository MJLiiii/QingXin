import { esc } from './utils.js';

export function listRow(nav, title, by, excerpt) {
  return '<div class="poem-list__item poem-list__item--link" data-nav="' + nav + '">'
    + '<div><div class="poem-list__title">' + esc(title) + '</div>'
    + (excerpt ? '<div class="poem-list__excerpt">' + esc(excerpt) + '</div>' : '')
    + '</div>'
    + '<div class="poem-list__by">' + by + '</div>'
    + '</div>';
}

export function poemRow(e) {
  return listRow('poem/' + esc(e.id), e.title, esc(e.author) + ' · ' + esc(e.dynasty), e.excerpt);
}

export function searchRow(a) {
  var id = a[0];
  return listRow('poem/' + esc(id), a[1], esc(a[2]) + ' · ' + (id.charAt(0) === 't' ? '唐' : '宋'));
}

export function authorRow(a) {
  return listRow('author/' + esc(a.slug), a.name, esc(a.dynasty) + ' · ' + a.count + ' 首');
}

export function emptyState(hint) {
  return '<div class="poem-list__item"><div><div class="poem-list__title">无匹配</div>'
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
  return '<div class="search">'
    + '<input class="search__input" id="' + (o.id || 'search-input') + '" type="search" autocomplete="off"'
    + ' placeholder="' + (o.placeholder || '搜索诗词标题、作者…') + '" aria-label="' + (o.aria || '搜索') + '">'
    + '<span class="search__tag latin">' + (o.tag || 'search') + '</span>'
    + '</div>';
}
