/* 玻璃界面的页面片段（纯函数，node 可测）：卡片、标签、分页胶囊等。
   转义与路由链接来自 utils.js，navHref / displaySize / 命中高亮来自 templates.js；
   钩子（data-nav、#pager-input 等）与 router / reader 约定一致。 */
import { displaySize, highlighted, navHref } from './templates.js';
import { esc, hrefFor } from './utils.js';

// 悬浮控件的玻璃三层（折射 / 染色 / 高光），垫在控件内容下；span 以便放进 button / a。
export var GLASS = '<span class="glass" aria-hidden="true">'
  + '<span class="glass__effect"></span><span class="glass__tint"></span><span class="glass__shine"></span></span>';

function svg(body) {
  return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + body + '</svg>';
}

export var ICONS = {
  arrow: svg('<path d="M5 12h13M13 6l6 6-6 6"/>'),
  search: svg('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>'),
  first: svg('<path d="M12 6 6 12l6 6M18 6l-6 6 6 6"/>'),
  prev: svg('<path d="M15 6 9 12l6 6"/>'),
  next: svg('<path d="m9 6 6 6-6 6"/>'),
  last: svg('<path d="m6 6 6 6-6 6M12 6l6 6-6 6"/>'),
};

// 印章头像取名字的第一个字（码点）：数据里的 seal 字段对扩展区汉字只存了半个代理对。
export function sealOf(name) {
  var chars = Array.from(String(name == null ? '' : name).trim());
  return chars.length ? chars[0] : '·';
}

// 印章纯装饰（aria-hidden）；朝代另有文字，底色只是附加线索。
export function seal(name, dynasty, size) {
  var era = dynasty === '唐' ? ' seal--tang' : dynasty === '宋' ? ' seal--song' : '';
  return '<span class="seal' + era + (size ? ' seal--' + size : '') + '" aria-hidden="true">'
    + esc(sealOf(name)) + '</span>';
}

export function fmt(n) {
  var v = Number(n);
  return Number.isFinite(v) ? v.toLocaleString('en-US') : '';
}

function kindOfId(id) {
  return String(id || '').charAt(0) === 'c' ? '词' : '诗';
}

function link(nav, cls, inner, extra) {
  return '<a class="' + cls + '" href="' + navHref(nav) + '" data-nav="' + esc(nav) + '"' + (extra || '') + '>'
    + inner + '</a>';
}

// 诗卡：标题 / 摘句 / 作者·朝代 + 体裁。o 的各字段是已转义的 HTML。
function card(nav, o) {
  return link(nav, 'pcard' + (o.mod ? ' pcard--' + o.mod : ''),
    '<span class="pcard__title">' + o.title + '</span>'
    + (o.excerpt ? '<span class="pcard__excerpt">' + o.excerpt + '</span>' : '')
    + '<span class="pcard__foot">'
    + (o.by ? '<span class="pcard__by">' + o.by + '</span>' : '')
    + '<span class="pcard__kind">' + o.kind + '</span>'
    + '</span>');
}

export function poemCard(e) {
  return card('poem/' + e.id, {
    title: esc(e.title),
    excerpt: e.excerpt ? esc(e.excerpt) : '',
    by: esc(e.author) + ' · ' + esc(e.dynasty),
    kind: kindOfId(e.id),
  });
}

// 搜索命中 [id, 标题, 作者, match]：按 templates.js highlighted() 的规则高亮，诗句命中时命中句作摘句。
export function hitCard(a, query) {
  var id = String(a[0] || '');
  var match = a[3] || {};
  var line = match.field === 'line' && match.line;
  return card('poem/' + id, {
    title: line ? esc(a[1]) : highlighted(a[1], query, match, 'title'),
    excerpt: line ? highlighted(match.line, query, match, 'line') : '',
    by: highlighted(a[2], query, match, 'author') + ' · ' + (id.charAt(0) === 't' ? '唐' : '宋'),
    kind: kindOfId(id),
  });
}

export function workCard(w) {
  return card('poem/' + w.id, { mod: 'work', title: esc(w.title), kind: esc(w.kind) });
}

// 诗人卡：印章 + 姓名 + 朝代·作品数。可直接用于 Array#map（第二个参数不是字符串时视为无搜索词）。
export function poetTile(a, query, match) {
  if (typeof query !== 'string') {
    query = '';
    match = null;
  }
  match = match || a._search || {};
  return link('author/' + a.slug, 'ptile',
    seal(a.name, a.dynasty)
    + '<span class="ptile__text">'
    + '<span class="ptile__name">' + (query ? highlighted(a.name, query, match, 'name') : esc(a.name)) + '</span>'
    + '<span class="ptile__meta">' + esc(a.dynasty) + ' · <span class="latin">' + fmt(a.count) + '</span> 首</span>'
    + '</span>');
}

// 元信息胶囊：dt/dd 成对，值为已转义或已构造的 HTML，空值不出。
export function metaChips(items) {
  var cells = (items || []).filter(function (item) { return item && item.value; }).map(function (item) {
    return '<div class="fact"><dt class="fact__label">' + esc(item.label) + '</dt>'
      + '<dd class="fact__value">' + item.value + '</dd></div>';
  });
  return cells.length ? '<dl class="facts">' + cells.join('') + '</dl>' : '';
}

// 大标题：--chars（码点数）供需要按字数缩放的位置使用（如资料卡姓名）。
export function pageTitle(text, cls) {
  return '<h1 class="' + cls + ' display" data-size="' + displaySize(text) + '"'
    + ' style="--chars:' + Array.from(String(text == null ? '' : text)).length + '">' + esc(text) + '</h1>';
}

// 未找到 / 出错：标题 + 去处。actions: [{ nav, label, primary }]
export function errorCard(message, actions) {
  return '<section class="section section--top"><div class="prose error-card">'
    + '<h1 class="error-card__title">' + esc(message) + '</h1>'
    + ((actions && actions.length)
      ? '<p class="error-card__actions">' + actions.map(function (a) {
        return link(a.nav, 'btn ' + (a.primary ? 'btn--primary' : 'btn--chip'), esc(a.label));
      }).join('') + '</p>'
      : '')
    + '</div></section>';
}

// 悬浮分页胶囊：保留 reader 之外 pages.js wirePager 依赖的 #pager / #pager-input[data-route][max] / #pager-go。
export function pagerDock(route, page, pages) {
  function btn(target, icon, label, on, edge) {
    var cls = 'pager__btn' + (edge ? ' pager__btn--edge' : '');
    if (!on) return '<span class="' + cls + ' pager__btn--off" aria-hidden="true">' + icon + '</span>';
    var path = route + '/' + target;
    return '<a class="' + cls + '" href="' + navHref(path) + '" data-nav="' + esc(path) + '" aria-label="' + label + '">'
      + icon + '</a>';
  }
  return '<nav class="pager" id="pager" aria-label="分页">' + GLASS
    + btn(0, ICONS.first, '第一页', page > 0, true)
    + btn(page - 1, ICONS.prev, '上一页', page > 0)
    + '<span class="pager__jump">'
    + '<input class="pager__input" id="pager-input" type="number" inputmode="numeric" min="1" max="' + pages + '"'
    + ' value="' + (page + 1) + '" data-route="' + esc(route) + '" aria-label="页码（共 ' + pages + ' 页）">'
    + '<span class="pager__total latin" aria-hidden="true">/ ' + fmt(pages) + '</span>'
    + '<button class="pager__go" id="pager-go" type="button">跳转</button>'
    + '</span>'
    + btn(page + 1, ICONS.next, '下一页', page < pages - 1)
    + btn(pages - 1, ICONS.last, '最后一页', page < pages - 1, true)
    + '</nav>';
}

export function proseBody(paras, faintFirst) {
  if (!paras || !paras.length) return '<div class="prose"><p class="prose--faint">尚未收录，敬请期待。</p></div>';
  return '<div class="prose">' + paras.map(function (p, i) {
    return '<p' + (faintFirst && i === 0 ? ' class="prose--faint"' : '') + '>' + esc(p) + '</p>';
  }).join('') + '</div>';
}

// 标签初选：记住的那栏有内容就用它，否则第一个有内容的栏，全空时第一栏。
export function pickTab(sections, remembered) {
  var filled = sections.filter(function (s) { return !s.empty; }).map(function (s) { return s.key; });
  if (filled.indexOf(remembered) >= 0) return remembered;
  return filled.length ? filled[0] : sections[0].key;
}

// 注释 / 译文 / 赏析 / 创作背景的分段标签。sections: [{ key, label(HTML), html, empty }]
// 面板保留 .entry[data-section]：reader.js 的「查看全部注释」按它找注释栏；隐藏的面板仍在 DOM 里供注释浮层取词。
export function poemTabs(sections, selected) {
  var tabs = sections.map(function (s) {
    var on = s.key === selected;
    return '<button type="button" role="tab" class="tabs__tab' + (s.empty ? ' tabs__tab--empty' : '') + '"'
      + ' id="poem-tab-' + s.key + '" data-tab="' + s.key + '" aria-controls="poem-panel-' + s.key + '"'
      + ' aria-selected="' + on + '" tabindex="' + (on ? '0' : '-1') + '">'
      + '<span class="tabs__label">' + s.label + '</span>'
      + (s.empty ? '<span class="sr-only">（未收录）</span>' : '')
      + '</button>';
  }).join('');
  var panels = sections.map(function (s) {
    return '<section class="tab-panel entry" role="tabpanel" id="poem-panel-' + s.key + '"'
      + ' aria-labelledby="poem-tab-' + s.key + '" data-section="' + s.key + '" tabindex="0"'
      + (s.key === selected ? '' : ' hidden') + '>' + s.html + '</section>';
  }).join('');
  return {
    tablist: '<div class="tabs" role="tablist" aria-label="注解">' + GLASS + tabs + '</div>',
    panels: panels,
  };
}

// 首页搜索卡：提交由 glass-ui.js 接管，跳到 #/list?q=…；热门词是普通 hash 链接。
export function findForm(hints) {
  return '<form class="find" role="search" aria-label="搜索诗词" data-find>'
    + '<span class="find__icon" aria-hidden="true">' + ICONS.search + '</span>'
    + '<input class="find__input" id="home-find" name="q" type="search" autocomplete="off"'
    + ' autocapitalize="off" spellcheck="false" enterkeyhint="search"'
    + ' placeholder="标题、作者或名句" aria-label="搜索诗词">'
    + '<button class="btn btn--primary find__go" type="submit">搜索</button>'
    + '</form>'
    + ((hints && hints.length)
      ? '<p class="find__hints"><span class="find__hint-label">试试</span>' + hints.map(function (word) {
        return '<a class="chip chip--link" href="' + esc(hrefFor('list', { q: word })) + '">' + esc(word) + '</a>';
      }).join('') + '</p>'
      : '');
}
