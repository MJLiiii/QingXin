/* ===========================================================
   情心 — 客户端路由 + 数据渲染层
   数据来自 data/**（由 tools/data/prep.mjs 生成），诗文不写死在 HTML。
   路由：#/home | #/list/:page | #/poem/:id | #/author/:slug
   =========================================================== */

(function () {
  'use strict';

  var PAGES = ['home', 'list', 'poem', 'author', 'authors', 'about'];
  var cache = new Map();

  /* ---------- 基础工具 ---------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function pad4(n) { return String(n).padStart(4, '0'); }

  function debounce(fn, ms) {
    var t;
    return function () {
      var args = arguments, ctx = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, ms);
    };
  }

  async function fetchJSON(path) {
    if (cache.has(path)) return cache.get(path);
    var res = await fetch(path);
    if (!res.ok) throw new Error(path + ' → ' + res.status);
    var data = await res.json();
    cache.set(path, data);
    return data;
  }

  // id 形如 t<块>-<序> / c<块>-<序>，直接编码存储位置
  function parseId(id) {
    var m = /^([tc])(\d+)-(\d+)$/.exec(id || '');
    if (!m) return null;
    return { kind: m[1] === 't' ? 'shi' : 'ci', chunk: +m[2], i: +m[3] };
  }

  async function loadPoem(id) {
    var loc = parseId(id);
    if (!loc) return null;
    var chunk = await fetchJSON('data/poems/' + pad4(loc.chunk) + '.json');
    return chunk[loc.i] || null;
  }

  async function loadAnnotation(id) {
    try { return await fetchJSON('data/annotations/' + encodeURIComponent(id) + '.json'); }
    catch (e) { return null; }
  }

  async function loadAuthor(slug) {
    try { return await fetchJSON('data/authors/' + encodeURIComponent(slug) + '.json'); }
    catch (e) { return null; }
  }

  // 原文按空串分节；无空串则整首一节
  function groupStanzas(paras) {
    var stanzas = [], cur = [];
    (paras || []).forEach(function (line) {
      if (String(line).trim() === '') { if (cur.length) { stanzas.push(cur); cur = []; } }
      else cur.push(line);
    });
    if (cur.length) stanzas.push(cur);
    return stanzas.length ? stanzas : [paras || []];
  }

  /* ---------- 片段模板（复用现有 CSS 类） ---------- */

  function poemRow(e) {
    return '<div class="poem-list__item poem-list__item--link" data-nav="poem/' + esc(e.id) + '">'
      + '<div>'
      + '<div class="poem-list__title">' + esc(e.title) + '</div>'
      + (e.excerpt ? '<div class="poem-list__excerpt">' + esc(e.excerpt) + '</div>' : '')
      + '</div>'
      + '<div class="poem-list__by">' + esc(e.author) + ' · ' + esc(e.dynasty) + '</div>'
      + '</div>';
  }

  // 搜索结果行（search.json 为紧凑数组 [id,title,author]）
  function searchRow(a) {
    var id = a[0], dyn = id.charAt(0) === 't' ? '唐' : '宋';
    return '<div class="poem-list__item poem-list__item--link" data-nav="poem/' + esc(id) + '">'
      + '<div><div class="poem-list__title">' + esc(a[1]) + '</div></div>'
      + '<div class="poem-list__by">' + esc(a[2]) + ' · ' + dyn + '</div>'
      + '</div>';
  }

  function entryShell(title, roman, inner, ruleClass, collapsible) {
    var rule = '<div class="entry-head__rule' + (ruleClass ? ' ' + ruleClass : '') + '"></div>';
    if (!collapsible) {
      return '<section class="section entry">'
        + '<div class="entry-head"><span class="entry-head__title">' + esc(title) + '</span>'
        + '<span class="entry-head__num latin">' + roman + '</span></div>'
        + rule + inner
        + '</section>';
    }
    // 可折叠版：标题行是按钮（默认折叠），点击经委托处理器切换
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

  // 译文/赏析/背景：有内容渲染段落，无则显示标题 + 占位（保留板块，默认折叠）
  function proseEntry(title, roman, paras, faintFirst) {
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

  function errorSection(msg) {
    return '<section class="section section--top"><div class="prose"><p class="prose--faint">'
      + esc(msg) + '</p></div></section>';
  }

  function pagerHTML(route, page, pages) {
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

  // 跳转到指定页（诗集 / 诗人 共用）
  function wirePager(host) {
    var input = host.querySelector('#pager-input');
    if (!input) return;
    var route = input.getAttribute('data-route');
    var max = parseInt(input.getAttribute('max'), 10) || 1;
    function jump() {
      var n = parseInt(input.value, 10);
      if (isNaN(n)) { input.value = ''; return; }
      n = Math.max(1, Math.min(max, n));
      go(route + '/' + (n - 1));
    }
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); jump(); }
    });
    var goBtn = host.querySelector('#pager-go');
    if (goBtn) goBtn.addEventListener('click', jump);
  }

  function searchBoxHTML() {
    return '<div class="search">'
      + '<input class="search__input" id="search-input" type="search" autocomplete="off"'
      + ' placeholder="搜索诗词标题、作者…" aria-label="搜索">'
      + '<span class="search__tag latin">search</span>'
      + '</div>';
  }

  /* ---------- 各页渲染 ---------- */

  // 全库随机：随机取一个索引页，从中抽 hero + 5 首随机列表
  async function renderHome() {
    var manifest = await fetchJSON('data/manifest.json');
    var p = Math.floor(Math.random() * manifest.pages);
    var entries = await fetchJSON('data/index/page-' + pad4(p) + '.json');
    var pick = entries.slice();
    for (var k = pick.length - 1; k > 0; k--) {
      var j = Math.floor(Math.random() * (k + 1)), t = pick[k]; pick[k] = pick[j]; pick[j] = t;
    }
    // hero：取首个正文非空者，避免空白封面
    var hero = null, heroPoem = null;
    for (var m = 0; m < pick.length && m < 8; m++) {
      var poem = await loadPoem(pick[m].id);
      if (poem && poem.paragraphs && poem.paragraphs.length) { hero = pick[m]; heroPoem = poem; break; }
    }
    if (!hero) { hero = pick[0]; heroPoem = await loadPoem(hero.id); }
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
      + '<div class="section-head"><span class="section-head__title">随机诗词</span>'
      + '<span class="section-head__tag latin">random</span></div>'
      + '<div class="rule"></div>'
      + list.map(poemRow).join('')
      + '</section>';
  }

  // 诗集：底层索引文件仍 500/个，但每屏只显示 DISPLAY 首（小分页）
  async function renderList(dp) {
    dp = dp || 0;
    var manifest = await fetchJSON('data/manifest.json');
    var DISPLAY = 25, perFile = manifest.pageSize / DISPLAY; // 500/25 = 20 显示页/文件
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
    wirePager(host);
  }

  function wireSearch(host, pageEntries) {
    var input = host.querySelector('#search-input');
    if (!input) return;
    var rows = host.querySelector('#list-rows');
    var pager = host.querySelector('#pager');

    input.addEventListener('input', debounce(async function () {
      var q = input.value.trim();
      if (!q) {
        rows.innerHTML = pageEntries.map(poemRow).join('');
        if (pager) pager.style.display = '';
        return;
      }
      var idx;
      try { idx = await fetchJSON('data/search.json'); }
      catch (e) { rows.innerHTML = errorSection('搜索索引加载失败'); return; }
      var hits = [];
      for (var k = 0; k < idx.length && hits.length < 120; k++) {
        if (idx[k][1].indexOf(q) >= 0 || idx[k][2].indexOf(q) >= 0) hits.push(idx[k]);
      }
      rows.innerHTML = hits.length
        ? hits.map(searchRow).join('')
        : '<div class="poem-list__item"><div><div class="poem-list__title">无匹配</div>'
          + '<div class="poem-list__excerpt">换个关键词试试</div></div></div>';
      if (pager) pager.style.display = 'none';
    }, 200));
  }

  async function renderPoem(id) {
    var poem = await loadPoem(id);
    var host = document.getElementById('page-poem');
    if (!poem) { host.innerHTML = errorSection('未找到这首诗。'); return; }
    var ann = (await loadAnnotation(id)) || {};
    var author = await loadAuthor(poem.authorSlug);

    var isCi = poem.kind === 'ci';
    var cipai = isCi ? ('词牌 · ' + esc(poem.rhythmic || '')) : (esc(poem.dynasty) + '诗');
    var title = isCi ? esc(poem.rhythmic || poem.title) : esc(poem.title);
    var sub = isCi ? esc((poem.title.split('·')[1] || '')) : '';
    var seal = esc((poem.author || '').charAt(0));

    // 诗题头
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

    // 原文
    var original = '<div class="original">';
    if (ann.preface) {
      original += '<div class="original__preface"><span class="badge">词序</span><br>' + esc(ann.preface) + '</div>';
    }
    original += groupStanzas(poem.paragraphs).map(function (lines) {
      return '<p class="original__stanza">' + lines.map(esc).join('<br>') + '</p>';
    }).join('');
    original += '</div>';
    html += entryShell('原文', 'i', original, 'entry-head__rule--wide');

    // 注释（有则列出，无则占位）
    var notesInner;
    if (ann.notes && ann.notes.length && ann.notes.some(function (n) { return n.term || n.def; })) {
      notesInner = '<div class="notes">' + ann.notes.map(function (n) {
        return '<div class="notes__row"><div class="notes__term">' + esc(n.term)
          + '</div><div class="notes__def">' + esc(n.def) + '</div></div>';
      }).join('') + '</div>';
    } else {
      notesInner = '<div class="notes"><p class="prose--faint">尚未收录，敬请期待。</p></div>';
    }
    html += entryShell('注释', 'ii', notesInner, 'entry-head__rule--tight', true);

    // 译文（词序译文作首段淡墨）/ 赏析 / 创作背景
    var trans = (ann.prefaceTranslation ? [ann.prefaceTranslation] : []).concat(ann.translation || []);
    html += proseEntry('译文', 'iii', trans, !!ann.prefaceTranslation);
    html += proseEntry('赏析', 'iv', ann.appreciation || []);
    html += proseEntry('创作背景', 'v', ann.background || []);

    // 关于作者入口
    var styleSmall = author && author.style ? '　<small>' + esc(author.style) + '</small>' : '';
    html += '<section class="section author-cta"><div class="author-cta__link" data-nav="author/' + esc(poem.authorSlug) + '">'
      + '<div><div class="author-cta__label">关于作者</div>'
      + '<div class="author-cta__name">' + esc(poem.author) + styleSmall + '</div></div>'
      + '<span class="author-cta__arrow">→</span></div></section>';

    host.innerHTML = html;
  }

  async function renderAuthor(slug) {
    var a = await loadAuthor(slug);
    var host = document.getElementById('page-author');
    if (!a) { host.innerHTML = errorSection('未找到这位作者。'); return; }

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

  /* ---------- 诗人列表 ---------- */

  function authorRow(a) {
    return '<div class="poem-list__item poem-list__item--link" data-nav="author/' + esc(a.slug) + '">'
      + '<div><div class="poem-list__title">' + esc(a.name) + '</div></div>'
      + '<div class="poem-list__by">' + esc(a.dynasty) + ' · ' + a.count + ' 首</div>'
      + '</div>';
  }

  async function renderAuthors(page) {
    page = page || 0;
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
      + '<div class="search">'
      + '<input class="search__input" id="author-search" type="search" autocomplete="off"'
      + ' placeholder="搜索诗人…" aria-label="搜索诗人">'
      + '<span class="search__tag latin">poets</span>'
      + '</div>'
      + '<div class="rule"></div>'
      + '<div id="authors-rows">' + slice.map(authorRow).join('') + '</div>'
      + pagerHTML('authors', page, totalPages)
      + '</section>';

    wireAuthorSearch(host, idx, slice);
    wirePager(host);
  }

  function wireAuthorSearch(host, idx, pageSlice) {
    var input = host.querySelector('#author-search');
    if (!input) return;
    var rows = host.querySelector('#authors-rows');
    var pager = host.querySelector('#pager');
    input.addEventListener('input', debounce(function () {
      var q = input.value.trim();
      if (!q) {
        rows.innerHTML = pageSlice.map(authorRow).join('');
        if (pager) pager.style.display = '';
        return;
      }
      var hits = [];
      for (var k = 0; k < idx.length && hits.length < 120; k++) {
        if (idx[k].name.indexOf(q) >= 0) hits.push(idx[k]);
      }
      rows.innerHTML = hits.length
        ? hits.map(authorRow).join('')
        : '<div class="poem-list__item"><div><div class="poem-list__title">无匹配</div>'
          + '<div class="poem-list__excerpt">换个名字试试</div></div></div>';
      if (pager) pager.style.display = 'none';
    }, 200));
  }

  /* ---------- 关于 ---------- */

  async function renderAbout() {
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

  /* ---------- 路由 ---------- */

  var RENDERERS = {
    home: renderHome,
    list: function (p) { return renderList(parseInt(p || '0', 10) || 0); },
    poem: renderPoem,
    author: renderAuthor,
    authors: function (p) { return renderAuthors(parseInt(p || '0', 10) || 0); },
    about: renderAbout,
  };

  function show(name) {
    var boot = document.getElementById('boot');
    if (boot) boot.remove();
    PAGES.forEach(function (p) {
      var el = document.getElementById('page-' + p);
      if (el) el.classList.toggle('is-active', p === name);
    });
  }

  function parseHash() {
    var raw = window.location.hash.replace(/^#\/?/, '');
    var parts = raw.split('/').map(function (s) {
      try { return decodeURIComponent(s); } catch (e) { return s; }
    });
    var name = parts[0] || 'home';
    if (PAGES.indexOf(name) === -1) name = 'home';
    return { name: name, param: parts[1] };
  }

  async function render() {
    var r = parseHash();
    try {
      await (RENDERERS[r.name] || renderHome)(r.param);
    } catch (e) {
      if (window.console) console.error(e);
      var el = document.getElementById('page-' + r.name);
      if (el) el.innerHTML = errorSection('内容加载失败，请稍后重试。');
    }
    show(r.name);
    try { window.scrollTo({ top: 0, behavior: 'auto' }); }
    catch (e) { window.scrollTo(0, 0); }
  }

  function go(path) {
    var target = '#/' + path.split('/').map(encodeURIComponent).join('/');
    if (window.location.hash === target) render();
    else window.location.hash = target;
  }

  document.addEventListener('click', function (e) {
    var toggle = e.target.closest('[data-toggle]');
    if (toggle) {
      var entry = toggle.closest('.entry');
      var collapsed = entry.classList.toggle('entry--collapsed');
      toggle.setAttribute('aria-expanded', String(!collapsed));
      return;
    }
    var trigger = e.target.closest('[data-nav]');
    if (!trigger) return;
    e.preventDefault();
    go(trigger.getAttribute('data-nav'));
  });

  window.addEventListener('hashchange', render);
  document.addEventListener('DOMContentLoaded', render);
})();
