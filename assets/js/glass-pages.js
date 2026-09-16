/* 各页面的渲染：数据与交互辅助在 pages.js / reader.js，这里决定玻璃界面的布局——
   首页今日一诗 + 搜索、诗集 / 诗人卡片网格、诗文页左栏钉住 + 右栏分段标签、作者页资料卡。 */
import { fetchJSON, loadAuthor, loadPoem } from './data.js';
import { initPin, rememberTab } from './glass-ui.js';
import {
  GLASS, ICONS, errorCard, fmt, findForm, hitCard, metaChips, pageTitle, pagerDock, pickTab,
  poemCard, poemTabs, poetTile, proseBody, seal, sealOf, workCard,
} from './glass-templates.js';
import {
  aiNotice, loadPoemData, notesHTML, pickFeatured, poemParts, wireLiveSearch, wirePager, wireSearch,
} from './pages.js';
import { readPrefs, setCurrentPoem, syncControls } from './reader.js';
import { searchAuthorIndex } from './search-core.js';
import { emptyState, heroLines, navHref, searchBoxHTML } from './templates.js';
import { esc, localDateKey, pad4 } from './utils.js';

var DISPLAY = 25;
var HINTS = ['明月', '春风', '李白', '江南'];

// 统计类数据只是点缀：加载失败时不拖垮页面，但这次渲染不缓存，返回时重试。
function soft(promise, ctx) {
  return promise.catch(function () {
    ctx.noCache();
    return null;
  });
}

// 搜索框的防抖回调可能在读者离开本页之后才触发：只在仍停留在该路由时改写地址栏。
function onRoute(name) {
  var re = new RegExp('^#/?' + name + '(?:[/?]|$)');
  return function () { return re.test(window.location.hash); };
}

// 原文逐句成块：一句折行时在标点后断开并悬挂缩进，看得出是同一句（竖排时由 CSS 取消缩进）。
function lineBlocks(original) {
  return original.replace(/(<p class="original__stanza">)([\s\S]*?)(<\/p>)/g, function (m, open, body, close) {
    return open + body.split('<br>').map(function (line) {
      return '<span class="original__line">' + line + '</span>';
    }).join('') + close;
  });
}

function latinNum(n) {
  return '<span class="latin">' + fmt(n) + '</span>';
}

function pageHead(title, facts) {
  return '<header class="gpage-head">' + pageTitle(title, 'gpage-head__title')
    + '<p class="gpage-head__facts">' + facts.map(function (fact) {
      return '<span class="gpage-head__fact">' + fact + '</span>';
    }).join('<span class="gpage-head__dot" aria-hidden="true">·</span>') + '</p>'
    + '</header>';
}

function cardHead(id, title, extra) {
  return '<div class="card-head"><h2 class="card-head__title" id="' + id + '">' + esc(title) + '</h2>'
    + (extra || '') + '</div>';
}

export async function renderHome(param, ctx) {
  var entries = await fetchJSON('data/featured.json');
  var daily = !ctx.shuffle;
  var hero = pickFeatured(entries, daily).hero;
  var heroPoem = await loadPoem(hero.id);
  if (!ctx.isCurrent()) return;

  var lines = heroLines((heroPoem && heroPoem.paragraphs) || []);
  if (!lines.length) lines = [hero.excerpt || hero.title];
  // 大字字号按最长一行的字数铺满卡片（glass.css .hero-card__lines）。
  var heroChars = Math.max.apply(null, lines.map(function (line) { return Array.from(line).length; }).concat(4));
  var cipai = (heroPoem && heroPoem.rhythmic) || hero.title;
  var kindLabel = hero.id.charAt(0) === 'c' ? '词' : '诗';

  var heroCard = '<article class="gcard hero-card" aria-labelledby="home-hero-title">'
    + '<div class="hero-card__top">'
    + '<span class="chip chip--accent">' + (daily ? '今日一' : '随机一') + kindLabel + '</span>'
    + (daily ? '<span class="hero-card__date latin">' + localDateKey().replace(/-/g, '.') + '</span>' : '')
    + '</div>'
    + '<h1 class="hero-card__lines" id="home-hero-title" style="--hero-chars:' + heroChars + '">'
    + lines.map(function (line) { return '<span class="hero-card__line">' + esc(line) + '</span>'; }).join('')
    + '</h1>'
    + '<div class="hero-card__foot">'
    + '<p class="hero-card__meta"><span class="hero-card__title">《' + esc(cipai) + '》</span>'
    + '<span class="hero-card__by">' + esc(hero.author) + '〔' + esc(hero.dynasty) + '〕</span></p>'
    + '<div class="hero-card__actions">'
    + '<a class="btn btn--primary" href="' + navHref('poem/' + hero.id) + '" data-nav="poem/' + esc(hero.id) + '">品读全文</a>'
    + '<button class="btn btn--secondary" type="button" data-action="shuffle">换一首</button>'
    + '</div></div>'
    + '<span class="hero-card__seal" aria-hidden="true">' + esc(sealOf(hero.author)) + '</span>'
    + '</article>';

  var find = '<section class="gcard find-tile" aria-labelledby="home-find-h">'
    + cardHead('home-find-h', '寻章摘句')
    + findForm(HINTS)
    + '</section>';

  document.getElementById('page-home').innerHTML = '<div class="gpage home">'
    + '<div class="home-stack">' + heroCard + find + '</div>'
    + '</div>';
  // 「换一首」重建了卡片：焦点落回新的「换一首」，键盘读者不必从头找起。
  if (ctx.shuffle && document.activeElement === document.body) {
    var again = document.querySelector('#page-home [data-action="shuffle"]');
    if (again) again.focus({ preventScroll: true });
  }
}

export async function renderList(param, ctx) {
  var dp = parseInt(param || '0', 10) || 0;
  var manifest = await fetchJSON('data/manifest.json');
  var perFile = manifest.pageSize / DISPLAY;
  var totalPages = Math.ceil(manifest.total / DISPLAY);
  if (dp < 0) dp = 0;
  if (dp > totalPages - 1) dp = totalPages - 1;
  var file = Math.floor(dp / perFile);
  var entries = await fetchJSON('data/index/page-' + pad4(file) + '.json');
  if (!ctx.isCurrent()) return;
  var start = (dp % perFile) * DISPLAY;
  var slice = entries.slice(start, start + DISPLAY);

  ctx.setTitle('诗集', '第 ' + (dp + 1) + ' 页');
  var host = document.getElementById('page-list');
  host.innerHTML = '<div class="gpage gpage--browse">'
    + pageHead('诗集', [latinNum(manifest.total) + ' 首', '第 ' + latinNum(dp + 1) + ' / ' + latinNum(totalPages) + ' 页'])
    + searchBoxHTML()
    + '<div id="list-rows" class="card-grid card-grid--poems">' + slice.map(poemCard).join('') + '</div>'
    + pagerDock('list', dp, totalPages)
    + '</div>';

  var stillHere = onRoute('list');
  var search = wireSearch(host, slice, function (q) {
    if (stillHere()) ctx.replace('list/' + dp, q ? { q: q } : null);
  }, { entry: poemCard, hit: hitCard });
  wirePager(host, ctx.go);
  if (search && ctx.query.q) search.start(ctx.query.q);
}

export async function renderAuthors(param, ctx) {
  var page = parseInt(param || '0', 10) || 0;
  var idx = await fetchJSON('data/authors-index.json');
  if (!ctx.isCurrent()) return;
  var totalPages = Math.ceil(idx.length / DISPLAY);
  if (page < 0) page = 0;
  if (page > totalPages - 1) page = totalPages - 1;
  var slice = idx.slice(page * DISPLAY, page * DISPLAY + DISPLAY);

  ctx.setTitle('诗人', '第 ' + (page + 1) + ' 页');
  var host = document.getElementById('page-authors');
  host.innerHTML = '<div class="gpage gpage--browse">'
    + pageHead('诗人', [latinNum(idx.length) + ' 位', '第 ' + latinNum(page + 1) + ' / ' + latinNum(totalPages) + ' 页'])
    + searchBoxHTML({
      id: 'author-search',
      placeholder: '搜索诗人姓名或近似关键词…',
      aria: '搜索诗人',
      tag: 'poets',
      controls: 'authors-rows',
    })
    + '<div id="authors-rows" class="card-grid card-grid--poets">' + slice.map(poetTile).join('') + '</div>'
    + pagerDock('authors', page, totalPages)
    + '</div>';

  var stillHere = onRoute('authors');
  var search = wireLiveSearch({
    host: host,
    inputSel: '#author-search',
    rowsSel: '#authors-rows',
    onQuery: function (q) {
      if (stillHere()) ctx.replace('authors/' + page, q ? { q: q } : null);
    },
    restore: function () { return slice.map(poetTile).join(''); },
    match: async function (q) {
      var result = searchAuthorIndex(idx, q, 120);
      var hits = result.hits || [];
      var matches = result.matches || [];
      return {
        html: hits.length
          ? hits.map(function (author, k) { return poetTile(author, q, matches[k]); }).join('')
          : emptyState('请缩短关键词，或检查是否有错字。', '没有找到相近的诗人'),
        count: hits.length,
        total: Number.isFinite(result.total) ? result.total : hits.length,
      };
    },
    errorTitle: '诗人搜索暂不可用',
  });
  wirePager(host, ctx.go);
  if (search && ctx.query.q) search.start(ctx.query.q);
}

export async function renderPoem(id, ctx) {
  var data = await loadPoemData(id);
  if (!ctx.isCurrent()) return;
  var poem = data.poem;
  var host = document.getElementById('page-poem');
  if (!poem) {
    ctx.setTitle('未找到这首诗');
    host.innerHTML = errorCard('未找到这首诗。', [
      { nav: 'list', label: '浏览诗集', primary: true },
      { nav: 'home', label: '回到首页' },
    ]);
    initPin(host);
    return;
  }
  if (data.degraded) ctx.noCache();
  var ann = data.ann;
  var author = data.author;
  var parts = poemParts(poem, ann);

  var isCi = poem.kind === 'ci';
  var titleText = isCi ? (poem.rhythmic || poem.title) : poem.title;
  var sub = isCi ? (poem.title.split('·')[1] || '') : '';
  var authorHref = navHref('author/' + poem.authorSlug);
  var authorNav = 'author/' + esc(poem.authorSlug);
  // 最长一句的字数：原文字号按它铺满原文卡（glass.css .original__stanza），放不下再在标点后折行。
  var lineChars = Math.min(32, Math.max.apply(null, parts.paragraphs.map(function (line) {
    return Array.from(String(line)).length;
  }).concat(5)));

  // 左栏：标题 + 元信息 + 工具胶囊 + 原文；超长篇不钉住（改为单栏）。
  var aside = '<div class="poem-aside"' + (parts.longPoem ? '' : ' data-pin') + '>'
    + '<header class="poem-head">'
    + pageTitle(titleText, 'poem-head__title')
    + (sub ? '<p class="poem-head__sub">' + esc(sub) + '</p>' : '')
    + metaChips([
      { label: '作者', value: '<a class="author-link" href="' + authorHref + '" data-nav="' + authorNav + '">' + esc(poem.author) + '</a>' },
      { label: '朝代', value: esc(poem.dynasty) },
      { label: '体裁', value: isCi ? ('词 · ' + esc(poem.rhythmic || '')) : '诗' },
      { label: '编号', value: '<span class="latin">' + esc(poem.id) + '</span>' },
    ])
    + '</header>'
    + '<div class="tools-dock">' + GLASS + parts.tools + '</div>'
    + '<section class="gcard original-card" aria-labelledby="poem-orig-h" style="--line-chars:' + lineChars + '">'
    + '<h2 class="card-label" id="poem-orig-h">原文</h2>'
    + lineBlocks(parts.original)
    + '</section>'
    + '</div>';

  // 右栏：注释 / 译文 / 赏析 / 创作背景 分段标签，记住上次选的栏（有内容时）。
  var trans = (ann.prefaceTranslation ? [ann.prefaceTranslation] : []).concat(ann.translation || []);
  var appreciation = ann.appreciation || [];
  var background = ann.background || [];
  var sections = [
    { key: 'notes', label: '注释', html: notesHTML(ann, parts.notes, false), empty: !parts.hasNotes },
    { key: 'translation', label: '译文', html: proseBody(trans, !!ann.prefaceTranslation), empty: !trans.length },
    { key: 'appreciation', label: '赏析', html: proseBody(appreciation), empty: !appreciation.length },
    { key: 'background', label: '<span class="tabs__trim">创作</span>背景', html: proseBody(background), empty: !background.length },
  ];
  // 同一历史项（前进 / 后退重建）沿用当时选的栏，滚动位置才对得上；新打开的诗用记住的偏好。
  var state = window.history.state || {};
  var selected = pickTab(sections, state.qxTab || readPrefs().tab);
  var tabs = poemTabs(sections, selected);
  var ai = aiNotice(ann);

  var others = ((author && author.works) || []).filter(function (w) { return w.id !== poem.id; }).slice(0, 4);
  var authorCard = '<section class="gcard author-card" aria-labelledby="poem-author-h">'
    + '<h2 class="card-label" id="poem-author-h">关于作者</h2>'
    + '<a class="author-card__link" href="' + authorHref + '" data-nav="' + authorNav + '">'
    + seal(poem.author, poem.dynasty, 'md')
    + '<span class="author-card__text"><span class="author-card__name">' + esc(poem.author) + '</span>'
    + (author && author.style ? '<span class="author-card__style">' + esc(author.style) + '</span>' : '')
    + '</span>'
    + '<span class="author-card__go" aria-hidden="true">' + ICONS.arrow + '</span></a>'
    + (others.length ? '<div class="card-grid card-grid--works">' + others.map(workCard).join('') + '</div>' : '')
    + '</section>';

  ctx.setTitle('《' + poem.title + '》' + poem.author);
  host.innerHTML = '<div class="gpage poem-layout' + (parts.longPoem ? ' poem-layout--long' : '') + '">'
    + aside
    + '<div class="poem-main">'
    + (ai ? '<div class="ai-note">' + ai + '</div>' : '')
    + '<div class="tab-group">' + tabs.tablist + tabs.panels + '</div>'
    + authorCard
    + '</div>'
    + '</div>';
  setCurrentPoem({
    id: poem.id,
    title: poem.title,
    author: poem.author,
    dynasty: poem.dynasty,
    lines: parts.paragraphs.filter(function (line) { return String(line).trim() !== ''; }),
  });
  syncControls();
  initPin(host);
  rememberTab(selected);
}

export async function renderAuthor(slug, ctx) {
  var loaded = await Promise.all([loadAuthor(slug), soft(fetchJSON('data/authors-index.json'), ctx)]);
  if (!ctx.isCurrent()) return;
  var a = loaded[0];
  var host = document.getElementById('page-author');
  if (!a) {
    ctx.setTitle('未找到这位作者');
    host.innerHTML = errorCard('未找到这位作者。', [
      { nav: 'authors', label: '浏览诗人', primary: true },
      { nav: 'home', label: '回到首页' },
    ]);
    initPin(host);
    return;
  }
  var works = a.works || [];
  // 作者记录只带前 50 首代表作；总数取诗人索引（加载失败时退回代表作数，满 50 标「+」）。
  var entry = (loaded[1] || []).find(function (e) { return e.slug === a.slug; });
  var total = entry ? entry.count : works.length;
  var totalText = total ? latinNum(total) + (entry || works.length < 50 ? '' : '+') + ' 首' : '';

  var profile = '<div class="author-aside" data-pin>'
    + '<section class="gcard profile-card">'
    + seal(a.name, a.dynasty, 'lg')
    + '<div class="profile-card__id">'
    + pageTitle(a.name, 'profile-card__name')
    + (a.style ? '<p class="profile-card__style">' + esc(a.style) + '</p>' : '')
    + '</div>'
    + metaChips([
      { label: '朝代', value: esc(a.dynasty) },
      { label: '籍贯', value: a.origin ? esc(a.origin) : '' },
      { label: '生卒', value: a.life ? '<span class="latin">' + esc(a.life) + '</span>' : '' },
      { label: '作品', value: totalText },
    ])
    + '</section></div>';

  ctx.setTitle(a.name, '诗人');
  host.innerHTML = '<div class="gpage author-layout">'
    + profile
    + '<div class="author-main">'
    + '<section class="gcard bio-card" aria-labelledby="author-bio-h">'
    + '<h2 class="card-label" id="author-bio-h">生平</h2>'
    + proseBody(a.bio)
    + '</section>'
    + '<section class="author-works" aria-labelledby="author-works-h">'
    + '<div class="gpage-bar"><h2 class="gpage-bar__title" id="author-works-h">代表作品</h2>'
    + (works.length ? '<span class="chip">' + latinNum(works.length) + ' 首</span>' : '') + '</div>'
    + '<div class="card-grid card-grid--works">'
    + (works.length ? works.map(workCard).join('') : emptyState('敬请期待。', '暂无作品'))
    + '</div></section>'
    + '</div>'
    + '</div>';
  initPin(host);
}

export async function renderAbout(param, ctx) {
  var loaded = await Promise.all([fetchJSON('data/about.json'), soft(fetchJSON('data/manifest.json'), ctx)]);
  if (!ctx.isCurrent()) return;
  var about = loaded[0];
  var manifest = loaded[1];
  var proseOf = function (paras) {
    return '<div class="prose">'
      + (paras || []).map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('')
      + '</div>';
  };

  var html = '<div class="gpage about"><div class="about-grid">'
    + '<section class="gcard about-hero">'
    + pageTitle(about.title, 'about-hero__title')
    + (about.subtitle ? '<p class="about-hero__sub">' + esc(about.subtitle) + '</p>' : '')
    + (about.lead && about.lead.length ? proseOf(about.lead) : '')
    + '</section>';
  (about.sections || []).forEach(function (s, i) {
    html += '<section class="gcard about-card" aria-labelledby="about-sec-' + i + '">'
      + cardHead('about-sec-' + i, s.heading)
      + proseOf(s.paragraphs)
      + '</section>';
  });
  var dyn = manifest && manifest.dynasties;
  if (dyn) {
    html += '<section class="gcard about-card" aria-labelledby="about-stats">'
      + cardHead('about-stats', '收录')
      + '<dl class="figures">'
      + '<div class="figure"><dt>诗词</dt><dd>' + latinNum(manifest.total) + ' 首</dd></div>'
      + Object.keys(dyn).map(function (k) {
        return '<div class="figure"><dt>' + esc(k) + '</dt><dd>' + latinNum(dyn[k]) + ' 首</dd></div>';
      }).join('')
      + '</dl></section>';
  }
  html += '</div></div>';
  ctx.setTitle('关于');
  document.getElementById('page-about').innerHTML = html;
}

export var RENDERERS = {
  home: renderHome,
  list: renderList,
  poem: renderPoem,
  author: renderAuthor,
  authors: renderAuthors,
  about: renderAbout,
};
