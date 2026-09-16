import { fetchJSON, loadAnnotation, loadAuthor, loadPoem } from './data.js';
import { openSections, setCurrentPoem, syncControls } from './reader.js';
import { searchAuthorIndex } from './search-core.js';
import { searchPoems } from './search.js';
import { esc, groupStanzas, localDateKey, pad4, seededRandom } from './utils.js';
import {
  authorRow, displaySize, emptyState, entryShell, errorSection, glossLines, heroLines, listRow,
  navHref, pagerHTML, poemRow, proseEntry, searchBoxHTML, searchRow,
} from './templates.js';

// 竖排按列横向滚动；行数过多的长篇（如歌行）不提供竖排。
var VERTICAL_MAX_LINES = 60;

function wirePager(host, go) {
  var input = host.querySelector('#pager-input');
  if (!input) return;
  var route = input.getAttribute('data-route');
  var max = parseInt(input.getAttribute('max'), 10) || 1;
  function jump() {
    var n = parseInt(input.value, 10);
    if (isNaN(n)) {
      input.value = '';
      return;
    }
    n = Math.max(1, Math.min(max, n));
    go(route + '/' + (n - 1));
  }
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      jump();
    }
  });
  var goBtn = host.querySelector('#pager-go');
  if (goBtn) goBtn.addEventListener('click', jump);
}

function wireLiveSearch(o) {
  var input = o.host.querySelector(o.inputSel);
  if (!input) return null;
  var rows = o.host.querySelector(o.rowsSel);
  if (!rows) return null;
  var pager = o.host.querySelector('#pager');
  var status = o.host.querySelector(o.statusSel || ('#' + input.id + '-status'));
  var revision = 0;
  var timer = null;

  function setState(state, message) {
    var loading = state === 'loading';
    input.setAttribute('aria-busy', String(loading));
    rows.setAttribute('aria-busy', String(loading));
    rows.classList.toggle('search-results--loading', loading);
    if (!status) return;
    status.dataset.state = state;
    status.textContent = message || '';
  }

  function countMessage(result) {
    var count = Number(result.count) || 0;
    var hasTotal = Number.isFinite(result.total);
    var total = hasTotal ? result.total : count;
    if (!count) return '未找到相关结果';
    if (total > count) return '找到 ' + total + ' 条，显示前 ' + count + ' 条结果';
    if (!hasTotal && result.mayBeTruncated) return '显示前 ' + count + ' 条相关结果';
    return '显示 ' + count + ' 条相关结果';
  }

  async function run(q, token) {
    try {
      var result = await o.match(q);
      if (token !== revision || !input.isConnected || input.value.trim() !== q) return;
      rows.innerHTML = result.html;
      setState(result.count ? 'results' : 'empty', countMessage(result));
    } catch (e) {
      if (token !== revision || !input.isConnected || input.value.trim() !== q) return;
      rows.innerHTML = emptyState(
        '请稍后重试，或重新输入关键词。',
        o.errorTitle || '搜索暂不可用'
      );
      setState('error', o.errorMessage || '搜索失败，请稍后重试');
    }
  }

  function update(immediate) {
    var token = ++revision;
    var q = input.value.trim();
    window.clearTimeout(timer);
    if (!q) {
      rows.innerHTML = o.restore();
      if (pager) pager.hidden = false;
      setState('idle', '');
      if (o.onQuery) o.onQuery('');
      return;
    }
    if (pager) pager.hidden = true;
    setState('loading', o.loadingMessage || '正在搜索…');
    var fire = function () {
      // 搜索词随防抖写入地址栏（而非每次按键），返回或刷新时可复现。
      if (o.onQuery) o.onQuery(q);
      run(q, token);
    };
    if (immediate) fire();
    else timer = window.setTimeout(fire, 200);
  }

  input.addEventListener('input', function (e) {
    if (!e.isComposing) update(false);
  });
  // 输入法组合期间不检索；组合结束后补一次。
  input.addEventListener('compositionend', function () { update(false); });

  return {
    start: function (q) {
      input.value = q;
      update(true);
    },
  };
}

function wireSearch(host, pageEntries, onQuery) {
  var limit = 120;
  return wireLiveSearch({
    host: host,
    inputSel: '#search-input',
    rowsSel: '#list-rows',
    onQuery: onQuery,
    restore: function () { return pageEntries.map(poemRow).join(''); },
    match: async function (q) {
      var hits = await searchPoems(q, limit);
      var hasTotal = Number.isFinite(hits.total);
      return {
        html: hits.length
          ? hits.map(function (hit) { return searchRow(hit, q); }).join('')
          : emptyState('请缩短关键词，或检查是否有错字。', '没有找到相近的诗词'),
        count: hits.length,
        total: hasTotal ? hits.total : undefined,
        mayBeTruncated: !hasTotal && hits.length === limit,
      };
    },
    errorTitle: '诗词搜索暂不可用',
    errorMessage: '搜索索引加载失败，请稍后重试',
  });
}

function aiNotice(ann) {
  if (ann.source !== 'ai') return '';
  return '<p class="prose--faint">本篇注释、译文、赏析由 AI 生成，仅供参考。</p>';
}

// 页面大标题 + 计数（诗集页 / 诗人页）
function pageHead(title, count) {
  return '<header class="page-head">'
    + '<h1 class="page-head__title display" data-size="' + displaySize(title) + '">' + esc(title) + '</h1>'
    + '<span class="page-head__count latin">' + Number(count).toLocaleString('en-US') + '</span>'
    + '</header>';
}

// 元信息行：每格一个 dt/dd；值为已转义或已构造的 HTML，空值不出格。
function metaRow(items) {
  var cells = items.filter(function (item) { return item && item.value; }).map(function (item) {
    return '<div class="meta__item"><dt>' + esc(item.label) + '</dt>'
      + '<dd>' + item.value + '</dd></div>';
  });
  return cells.length ? '<dl class="meta">' + cells.join('') + '</dl>' : '';
}

export async function renderHome(param, ctx) {
  var entries = await fetchJSON('data/featured.json');
  var daily = !ctx.shuffle;
  // 「今日一诗」：以本地日期为种子，当天刷新不变；「换一首」才真正随机。
  var random = daily ? seededRandom('qingxin:' + localDateKey()) : Math.random;
  var pick = entries.slice();
  for (var k = pick.length - 1; k > 0; k--) {
    var j = Math.floor(random() * (k + 1));
    var t = pick[k];
    pick[k] = pick[j];
    pick[j] = t;
  }
  var hero = null;
  for (var m = 0; m < pick.length; m++) {
    if (pick[m].excerpt && pick[m].excerpt.length) {
      hero = pick[m];
      break;
    }
  }
  if (!hero) hero = pick[0];
  var heroPoem = await loadPoem(hero.id);
  if (!ctx.isCurrent()) return;
  var lines = heroLines((heroPoem && heroPoem.paragraphs) || []);
  if (!lines.length) lines = [hero.excerpt || hero.title];
  // 超大标题字号按最长一行的字数铺满版心（styles.css .hero__title）。
  var heroChars = Math.max.apply(null, lines.map(function (line) { return Array.from(line).length; }).concat(4));
  var cipai = (heroPoem && heroPoem.rhythmic) || hero.title;
  var kindLabel = hero.id.charAt(0) === 'c' ? '词' : '诗';
  var list = pick.filter(function (e) { return e.id !== hero.id; }).slice(0, 5);

  document.getElementById('page-home').innerHTML =
    '<section class="hero">'
    + '<div class="hero__top">'
    + '<span class="hero__eyebrow">' + (daily ? '今日一' : '随机一') + kindLabel + '</span>'
    + (daily ? '<span class="hero__date latin">' + localDateKey().replace(/-/g, '.') + '</span>' : '')
    + '</div>'
    + '<h1 class="hero__title" style="--hero-chars:' + heroChars + '">'
    + lines.map(function (line) { return '<span class="hero__line">' + esc(line) + '</span>'; }).join('')
    + '</h1>'
    + '<div class="hero__foot">'
    + '<div class="hero__meta">《' + esc(cipai) + '》　' + esc(hero.author) + '〔' + esc(hero.dynasty) + '〕</div>'
    + '<div class="hero__actions">'
    + '<a class="hero__cta" href="' + navHref('poem/' + hero.id) + '" data-nav="poem/' + esc(hero.id) + '">品读全文</a>'
    + '<button class="hero__shuffle" type="button" data-action="shuffle">换一首</button>'
    + '</div>'
    + '</div>'
    + '</section>'
    + '<section class="section section--list">'
    + '<div class="section-head"><h2 class="section-head__title">精选诗词</h2>'
    + '<span class="section-head__tag latin">curated</span></div>'
    + list.map(poemRow).join('')
    + '<a class="section__more" href="' + navHref('list') + '" data-nav="list">浏览全部诗集</a>'
    + '</section>';
}

export async function renderList(param, ctx) {
  var dp = parseInt(param || '0', 10) || 0;
  var manifest = await fetchJSON('data/manifest.json');
  var DISPLAY = 25;
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
  host.innerHTML =
    '<section class="section section--top">'
    + pageHead('诗集', manifest.total)
    + searchBoxHTML()
    + '<div id="list-rows">' + slice.map(poemRow).join('') + '</div>'
    + pagerHTML('list', dp, totalPages)
    + '</section>';

  var search = wireSearch(host, slice, function (q) {
    ctx.replace('list/' + dp, q ? { q: q } : null);
  });
  wirePager(host, ctx.go);
  if (search && ctx.query.q) search.start(ctx.query.q);
}

export async function renderPoem(id, ctx) {
  var degraded = false;
  function soft(promise) {
    // 注释 / 作者加载失败（非 404）时降级展示，但不缓存这次渲染，返回时会重试。
    return promise.catch(function () {
      degraded = true;
      return null;
    });
  }

  var loaded = await Promise.all([loadPoem(id), soft(loadAnnotation(id))]);
  var poem = loaded[0];
  var host = document.getElementById('page-poem');
  if (!poem) {
    if (!ctx.isCurrent()) return;
    ctx.setTitle('未找到这首诗');
    host.innerHTML = errorSection('未找到这首诗。');
    return;
  }
  var ann = loaded[1] || {};
  var author = await soft(loadAuthor(poem.authorSlug));
  if (!ctx.isCurrent()) return;
  if (degraded) ctx.noCache();

  var isCi = poem.kind === 'ci';
  var titleText = isCi ? (poem.rhythmic || poem.title) : poem.title;
  var sub = isCi ? esc((poem.title.split('·')[1] || '')) : '';
  var authorHref = navHref('author/' + poem.authorSlug);
  var authorNav = 'author/' + esc(poem.authorSlug);

  var html = '<section class="poem-hero">'
    + '<h1 class="poem-hero__title display" data-size="' + displaySize(titleText) + '">' + esc(titleText) + '</h1>'
    + (sub ? '<p class="poem-hero__sub">' + sub + '</p>' : '')
    + metaRow([
      { label: '作者', value: '<a class="author-link" href="' + authorHref + '" data-nav="' + authorNav + '">' + esc(poem.author) + '</a>' },
      { label: '朝代', value: esc(poem.dynasty) },
      { label: '体裁', value: isCi ? ('词 · ' + esc(poem.rhythmic || '')) : '诗' },
      { label: '编号', value: '<span class="latin">' + esc(poem.id) + '</span>' },
    ])
    + '</section>';

  var paragraphs = poem.paragraphs || [];
  var hasNotes = !!(ann.notes && ann.notes.length && ann.notes.some(function (n) { return n.term || n.def; }));
  var notes = hasNotes ? ann.notes : [];
  // 词序作为第 0 行一起定位注释词条；第 k 个可点词对应注释栏第 k 行。
  var glossed = glossLines((ann.preface ? [ann.preface] : []).concat(paragraphs), notes);
  var prefaceHTML = ann.preface ? glossed.shift() : '';
  var longPoem = paragraphs.length > VERTICAL_MAX_LINES;

  var tools = '<div class="reader-tools" role="toolbar" aria-label="阅读工具">'
    + '<span class="reader-tools__status" role="status" aria-live="polite"></span>'
    + '<button type="button" class="reader-tools__btn" data-action="copy">复制</button>'
    + '<button type="button" class="reader-tools__btn" data-action="share">分享</button>'
    + (longPoem ? '' : '<button type="button" class="reader-tools__btn" data-action="vertical" aria-pressed="false">竖排</button>')
    + '<button type="button" class="reader-tools__btn" data-action="scale-down" aria-label="缩小字号">A−</button>'
    + '<button type="button" class="reader-tools__btn" data-action="scale-up" aria-label="放大字号">A+</button>'
    + '</div>';

  var original = '<div class="original">';
  if (ann.preface) {
    original += '<div class="original__preface"><span class="badge">词序</span><br>' + prefaceHTML + '</div>';
  }
  original += '<div class="original__body' + (longPoem ? ' original__body--long' : '') + '">'
    + groupStanzas(paragraphs, function (line, i) { return glossed[i]; }).map(function (lines) {
      return '<p class="original__stanza">' + lines.join('<br>') + '</p>';
    }).join('')
    + '</div></div>';
  html += entryShell('原文', 'i', original, 'entry-head__rule--wide', false, { section: 'original', headExtra: tools });

  var remembered = openSections();
  function isOpen(section) { return remembered.indexOf(section) >= 0; }

  var notesInner = '<div class="notes">' + aiNotice(ann) + (hasNotes
    ? notes.map(function (n) {
      return '<div class="notes__row"><div class="notes__term">' + esc(n.term)
        + '</div><div class="notes__def">' + esc(n.def) + '</div></div>';
    }).join('')
    : '<p class="prose--faint">尚未收录，敬请期待。</p>') + '</div>';
  html += entryShell('注释', 'ii', notesInner, 'entry-head__rule--tight', true, {
    section: 'notes',
    open: hasNotes && isOpen('notes'),
    empty: !hasNotes,
  });

  var trans = (ann.prefaceTranslation ? [ann.prefaceTranslation] : []).concat(ann.translation || []);
  html += proseEntry('译文', 'iii', trans, !!ann.prefaceTranslation, { section: 'translation', open: isOpen('translation') });
  html += proseEntry('赏析', 'iv', ann.appreciation || [], false, { section: 'appreciation', open: isOpen('appreciation') });
  html += proseEntry('创作背景', 'v', ann.background || [], false, { section: 'background', open: isOpen('background') });

  // 关于作者：大号作者名入口 + 同一作者的其他作品（作者数据加载失败时只出入口）
  var styleSmall = author && author.style ? '　<small>' + esc(author.style) + '</small>' : '';
  var others = ((author && author.works) || []).filter(function (w) { return w.id !== poem.id; }).slice(0, 3);
  html += '<section class="section author-cta">'
    + '<div class="section-head"><h2 class="section-head__title">关于作者</h2>'
    + '<span class="section-head__tag latin">more</span></div>'
    + '<a class="author-cta__link" href="' + authorHref + '" data-nav="' + authorNav + '">'
    + '<span class="author-cta__name">' + esc(poem.author) + styleSmall + '</span>'
    + '<span class="author-cta__arrow" aria-hidden="true">→</span></a>'
    + (others.length
      ? '<div class="author-cta__works">' + others.map(function (w) {
        return listRow('poem/' + w.id, w.title, esc(w.kind));
      }).join('') + '</div>'
      : '')
    + '</section>';

  ctx.setTitle('《' + poem.title + '》' + poem.author);
  host.innerHTML = html;
  setCurrentPoem({
    id: poem.id,
    title: poem.title,
    author: poem.author,
    dynasty: poem.dynasty,
    lines: paragraphs.filter(function (line) { return String(line).trim() !== ''; }),
  });
  syncControls();
}

export async function renderAuthor(slug, ctx) {
  var a = await loadAuthor(slug);
  if (!ctx.isCurrent()) return;
  var host = document.getElementById('page-author');
  if (!a) {
    ctx.setTitle('未找到这位作者');
    host.innerHTML = errorSection('未找到这位作者。');
    return;
  }

  var bio = (a.bio && a.bio.length)
    ? a.bio.map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('')
    : '<p class="prose--faint">尚未收录，敬请期待。</p>';

  var works = (a.works && a.works.length)
    ? a.works.map(function (w) {
      return '<a class="works-list__item works-list__item--link" href="' + navHref('poem/' + w.id)
        + '" data-nav="poem/' + esc(w.id) + '">'
        + '<div class="works-list__title">' + esc(w.title) + '</div>'
        + '<div class="works-list__kind">' + esc(w.kind) + '</div></a>';
    }).join('')
    : '<div class="works-list__item"><div class="works-list__title prose--faint">暂无作品</div></div>';

  ctx.setTitle(a.name, '诗人');
  host.innerHTML =
    '<section class="author-hero">'
    + '<h1 class="author-hero__name display" data-size="' + displaySize(a.name) + '">' + esc(a.name) + '</h1>'
    + (a.style ? '<p class="author-hero__style">' + esc(a.style) + '</p>' : '')
    + metaRow([
      { label: '朝代', value: esc(a.dynasty) },
      { label: '籍贯', value: a.origin ? esc(a.origin) : '' },
      { label: '生卒', value: a.life ? '<span class="latin">' + esc(a.life) + '</span>' : '' },
      { label: '作品', value: (a.works && a.works.length) ? esc(a.works.length) + ' 首' : '' },
    ])
    + '</section>'
    + '<section class="author-bio"><div class="prose">' + bio + '</div></section>'
    + '<section class="section author-works">'
    + '<div class="section-head"><h2 class="section-head__title">代表作品</h2>'
    + '<span class="section-head__tag latin">works</span></div>' + works
    + '</section>';
}

export async function renderAuthors(param, ctx) {
  var page = parseInt(param || '0', 10) || 0;
  var idx = await fetchJSON('data/authors-index.json');
  if (!ctx.isCurrent()) return;
  var DISPLAY = 25;
  var totalPages = Math.ceil(idx.length / DISPLAY);
  if (page < 0) page = 0;
  if (page > totalPages - 1) page = totalPages - 1;
  var slice = idx.slice(page * DISPLAY, page * DISPLAY + DISPLAY);

  ctx.setTitle('诗人', '第 ' + (page + 1) + ' 页');
  var host = document.getElementById('page-authors');
  host.innerHTML =
    '<section class="section section--top">'
    + pageHead('诗人', idx.length)
    + searchBoxHTML({
      id: 'author-search',
      placeholder: '搜索诗人姓名或近似关键词…',
      aria: '搜索诗人',
      tag: 'poets',
      controls: 'authors-rows',
    })
    + '<div id="authors-rows">' + slice.map(authorRow).join('') + '</div>'
    + pagerHTML('authors', page, totalPages)
    + '</section>';

  var search = wireLiveSearch({
    host: host,
    inputSel: '#author-search',
    rowsSel: '#authors-rows',
    onQuery: function (q) {
      ctx.replace('authors/' + page, q ? { q: q } : null);
    },
    restore: function () { return slice.map(authorRow).join(''); },
    match: async function (q) {
      var result = searchAuthorIndex(idx, q, 120);
      var hits = result.hits || [];
      var matches = result.matches || [];
      return {
        html: hits.length
          ? hits.map(function (author, k) { return authorRow(author, q, matches[k]); }).join('')
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

export async function renderAbout(param, ctx) {
  var about = await fetchJSON('data/about.json');
  if (!ctx.isCurrent()) return;
  var proseOf = function (paras) {
    return '<div class="prose">'
      + (paras || []).map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('')
      + '</div>';
  };
  var html = '<section class="poem-hero">'
    + '<h1 class="poem-hero__title display" data-size="' + displaySize(about.title) + '">' + esc(about.title) + '</h1>'
    + (about.subtitle ? '<p class="poem-hero__sub">' + esc(about.subtitle) + '</p>' : '')
    + '</section>';
  if (about.lead && about.lead.length) {
    html += '<section class="author-bio">' + proseOf(about.lead) + '</section>';
  }
  (about.sections || []).forEach(function (s) {
    html += entryShell(s.heading, s.roman || '', proseOf(s.paragraphs));
  });
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
