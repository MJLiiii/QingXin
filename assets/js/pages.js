import { fetchJSON, loadAnnotation, loadAuthor, loadPoem } from './data.js';
import { searchAuthorIndex } from './search-core.js';
import { searchPoems } from './search.js';
import { esc, groupStanzas, pad4 } from './utils.js';
import {
  authorRow, emptyState, entryShell, errorSection, pagerHTML,
  poemRow, proseEntry, searchBoxHTML, searchRow,
} from './templates.js';

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
  if (!input) return;
  var rows = o.host.querySelector(o.rowsSel);
  if (!rows) return;
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

  input.addEventListener('input', function () {
    var token = ++revision;
    var q = input.value.trim();
    window.clearTimeout(timer);
    if (!q) {
      rows.innerHTML = o.restore();
      if (pager) pager.hidden = false;
      setState('idle', '');
      return;
    }
    if (pager) pager.hidden = true;
    setState('loading', o.loadingMessage || '正在搜索…');
    timer = window.setTimeout(function () { run(q, token); }, 200);
  });
}

function wireSearch(host, pageEntries) {
  var limit = 120;
  wireLiveSearch({
    host: host,
    inputSel: '#search-input',
    rowsSel: '#list-rows',
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

export async function renderHome() {
  var entries = await fetchJSON('data/featured.json');
  var pick = entries.slice();
  for (var k = pick.length - 1; k > 0; k--) {
    var j = Math.floor(Math.random() * (k + 1));
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
  var lines = ((heroPoem && heroPoem.paragraphs) || []).slice(0, 2).map(esc).join('<br>');
  var cipai = (heroPoem && heroPoem.rhythmic) || hero.title;
  var kindLabel = hero.id.charAt(0) === 'c' ? '词' : '诗';
  var list = pick.filter(function (e) { return e.id !== hero.id; }).slice(0, 5);

  document.getElementById('page-home').innerHTML =
    '<section class="hero">'
    + '<div class="moon"></div>'
    + '<div class="hero__body">'
    + '<div class="hero__eyebrow">' + esc(hero.dynasty) + ' · ' + kindLabel + '</div>'
    + '<h1 class="hero__title">' + lines + '</h1>'
    + '<div class="hero__meta">《' + esc(cipai) + '》　' + esc(hero.author) + '〔' + esc(hero.dynasty) + '〕</div>'
    + '<div class="hero__actions">'
    + '<button class="hero__cta" data-nav="poem/' + esc(hero.id) + '"><span>品读全文</span><span>→</span></button>'
    + '<button class="hero__shuffle" data-nav="home">换一首 ↻</button>'
    + '</div>'
    + '</div>'
    + '</section>'
    + '<section class="section section--list">'
    + '<div class="section-head"><span class="section-head__title">精选诗词</span>'
    + '<span class="section-head__tag latin">curated</span></div>'
    + '<div class="rule"></div>'
    + list.map(poemRow).join('')
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
  var start = (dp % perFile) * DISPLAY;
  var slice = entries.slice(start, start + DISPLAY);

  var host = document.getElementById('page-list');
  host.innerHTML =
    '<section class="section section--top">'
    + '<div class="section-head"><span class="section-head__title">诗集</span>'
    + '<span class="section-head__tag latin">' + manifest.total + '</span></div>'
    + searchBoxHTML()
    + '<div class="rule"></div>'
    + '<div id="list-rows">' + slice.map(poemRow).join('') + '</div>'
    + pagerHTML('list', dp, totalPages)
    + '</section>';

  wireSearch(host, slice);
  wirePager(host, ctx.go);
}

export async function renderPoem(id) {
  var poem = await loadPoem(id);
  var host = document.getElementById('page-poem');
  if (!poem) {
    host.innerHTML = errorSection('未找到这首诗。');
    return;
  }
  var ann = (await loadAnnotation(id)) || {};
  var author = await loadAuthor(poem.authorSlug);

  var isCi = poem.kind === 'ci';
  var cipai = isCi ? ('词牌 · ' + esc(poem.rhythmic || '')) : (esc(poem.dynasty) + '诗');
  var title = isCi ? esc(poem.rhythmic || poem.title) : esc(poem.title);
  var sub = isCi ? esc((poem.title.split('·')[1] || '')) : '';
  var seal = esc((poem.author || '').charAt(0));

  var html = '<section class="poem-hero"><div class="moon"></div><div class="poem-hero__body">'
    + '<div class="poem-hero__cipai">' + cipai + '</div>'
    + '<h1 class="poem-hero__title">' + title + '</h1>'
    + (sub ? '<div class="poem-hero__sub">' + sub + '</div>' : '')
    + '<div class="poem-hero__author">'
    + '<button class="author-link" data-nav="author/' + esc(poem.authorSlug) + '">' + esc(poem.author) + '</button>'
    + '<span class="dot"></span>'
    + '<span class="poem-hero__dynasty">' + esc(poem.dynasty) + '</span>'
    + '<span class="seal poem-hero__seal">' + seal + '</span>'
    + '</div></div></section>';

  var original = '<div class="original">';
  if (ann.preface) {
    original += '<div class="original__preface"><span class="badge">词序</span><br>' + esc(ann.preface) + '</div>';
  }
  original += groupStanzas(poem.paragraphs).map(function (lines) {
    return '<p class="original__stanza">' + lines.map(esc).join('<br>') + '</p>';
  }).join('');
  original += '</div>';
  html += entryShell('原文', 'i', original, 'entry-head__rule--wide');

  var notesInner;
  if (ann.notes && ann.notes.length && ann.notes.some(function (n) { return n.term || n.def; })) {
    notesInner = '<div class="notes">' + aiNotice(ann) + ann.notes.map(function (n) {
      return '<div class="notes__row"><div class="notes__term">' + esc(n.term)
        + '</div><div class="notes__def">' + esc(n.def) + '</div></div>';
    }).join('') + '</div>';
  } else {
    notesInner = '<div class="notes">' + aiNotice(ann)
      + '<p class="prose--faint">尚未收录，敬请期待。</p></div>';
  }
  html += entryShell('注释', 'ii', notesInner, 'entry-head__rule--tight', true);

  var trans = (ann.prefaceTranslation ? [ann.prefaceTranslation] : []).concat(ann.translation || []);
  html += proseEntry('译文', 'iii', trans, !!ann.prefaceTranslation);
  html += proseEntry('赏析', 'iv', ann.appreciation || []);
  html += proseEntry('创作背景', 'v', ann.background || []);

  var styleSmall = author && author.style ? '　<small>' + esc(author.style) + '</small>' : '';
  html += '<section class="section author-cta"><div class="author-cta__link" data-nav="author/' + esc(poem.authorSlug) + '">'
    + '<div><div class="author-cta__label">关于作者</div>'
    + '<div class="author-cta__name">' + esc(poem.author) + styleSmall + '</div></div>'
    + '<span class="author-cta__arrow">→</span></div></section>';

  host.innerHTML = html;
}

export async function renderAuthor(slug) {
  var a = await loadAuthor(slug);
  var host = document.getElementById('page-author');
  if (!a) {
    host.innerHTML = errorSection('未找到这位作者。');
    return;
  }

  var facts = [];
  facts.push('<span>' + esc(a.dynasty) + (a.origin ? ' · ' + esc(a.origin) : '') + '</span>');
  if (a.life) facts.push('<span class="dot"></span><span class="latin">' + esc(a.life) + '</span>');

  var bio = (a.bio && a.bio.length)
    ? a.bio.map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('')
    : '<p class="prose--faint">尚未收录，敬请期待。</p>';

  var works = (a.works && a.works.length)
    ? a.works.map(function (w) {
      return '<div class="works-list__item works-list__item--link" data-nav="poem/' + esc(w.id) + '">'
        + '<div class="works-list__title">' + esc(w.title) + '</div>'
        + '<div class="works-list__kind">' + esc(w.kind) + '</div></div>';
    }).join('')
    : '<div class="works-list__item"><div class="works-list__title prose--faint">暂无作品</div></div>';

  host.innerHTML =
    '<section class="author-hero"><div class="moon"></div><div class="author-hero__body">'
    + '<div class="author-hero__eyebrow">诗 人</div>'
    + '<div class="author-hero__namerow"><h1 class="author-hero__name">' + esc(a.name) + '</h1>'
    + '<span class="seal author-hero__seal">' + esc((a.seal || a.name || '').charAt(0)) + '</span></div>'
    + (a.style ? '<div class="author-hero__style">' + esc(a.style) + '</div>' : '')
    + '<div class="author-hero__facts">' + facts.join('') + '</div>'
    + '</div></section>'
    + '<section class="author-bio"><div class="prose">' + bio + '</div></section>'
    + '<section class="section author-works">'
    + '<div class="section-head"><span class="section-head__title">代表作品</span>'
    + '<span class="section-head__tag latin">works</span></div>'
    + '<div class="rule"></div>' + works
    + '</section>';
}

export async function renderAuthors(param, ctx) {
  var page = parseInt(param || '0', 10) || 0;
  var idx = await fetchJSON('data/authors-index.json');
  var DISPLAY = 25;
  var totalPages = Math.ceil(idx.length / DISPLAY);
  if (page < 0) page = 0;
  if (page > totalPages - 1) page = totalPages - 1;
  var slice = idx.slice(page * DISPLAY, page * DISPLAY + DISPLAY);

  var host = document.getElementById('page-authors');
  host.innerHTML =
    '<section class="section section--top">'
    + '<div class="section-head"><span class="section-head__title">诗人</span>'
    + '<span class="section-head__tag latin">' + idx.length + '</span></div>'
    + searchBoxHTML({
      id: 'author-search',
      placeholder: '搜索诗人姓名或近似关键词…',
      aria: '搜索诗人',
      tag: 'poets',
      controls: 'authors-rows',
    })
    + '<div class="rule"></div>'
    + '<div id="authors-rows">' + slice.map(authorRow).join('') + '</div>'
    + pagerHTML('authors', page, totalPages)
    + '</section>';

  wireLiveSearch({
    host: host,
    inputSel: '#author-search',
    rowsSel: '#authors-rows',
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
}

export async function renderAbout() {
  var about = await fetchJSON('data/about.json');
  var proseOf = function (paras) {
    return '<div class="prose">'
      + (paras || []).map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('')
      + '</div>';
  };
  var html = '<section class="poem-hero"><div class="moon"></div><div class="poem-hero__body">'
    + '<div class="poem-hero__cipai">关 于</div>'
    + '<h1 class="poem-hero__title">' + esc(about.title) + '</h1>'
    + (about.subtitle ? '<div class="poem-hero__sub">' + esc(about.subtitle) + '</div>' : '')
    + '</div></section>';
  if (about.lead && about.lead.length) {
    html += '<section class="author-bio">' + proseOf(about.lead) + '</section>';
  }
  (about.sections || []).forEach(function (s) {
    html += entryShell(s.heading, s.roman || '', proseOf(s.paragraphs));
  });
  document.getElementById('page-about').innerHTML = html;
}

export var RENDERERS = {
  home: function () { return renderHome(); },
  list: renderList,
  poem: function (id) { return renderPoem(id); },
  author: function (slug) { return renderAuthor(slug); },
  authors: renderAuthors,
  about: function () { return renderAbout(); },
};
