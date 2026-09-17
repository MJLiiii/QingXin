import { preloadJSON, preloadListPage } from './data.js';
import { closeGloss, handleAction, initReader, openGloss } from './reader.js';
import { warmSearchIndex } from './search.js';
import { errorSection } from './templates.js';
import { hrefFor, idle, localDateKey } from './utils.js';

// 页面 → 高亮的导航项：诗文页归到「诗集」，页眉导航与底部标签栏始终有一项选中。
// 键就是全部页面名（index.html 的 #page-<name> 容器）——PAGES 由它派生，须先声明。
var NAV_OF = { home: 'home', list: 'list', poem: 'list', authors: 'authors', author: 'authors', about: 'about' };
var PAGES = Object.keys(NAV_OF);
var DEFAULT_TITLE = '情心 · 慢读古典';

var renderers = {};         // 页面 → 渲染函数，由 startRouter(pages) 传入（glass-pages.js）
var rendered = {};          // 页面 → 当前 DOM 对应的规范化路由键；命中时返回不重建 DOM
var titles = {};            // 页面 → document.title
var seq = 0;                // 导航序号：过期的异步渲染不得写 DOM、不得切换页面
var entrySeq = 0;
var currentEntry = null;    // 当前历史项 id（history.state.qx）
var scrollById = new Map(); // 历史项 id → 离开时的滚动位置

// 解析 hash 路由。可注入 hash 与日期以便测试（tools/tests/router.test.mjs）；不传则读当前地址栏 / 当天。
export function parseHash(hash, now) {
  var raw = String(hash === undefined ? window.location.hash : hash).replace(/^#\/?/, '');
  var at = raw.indexOf('?');
  var parts = (at >= 0 ? raw.slice(0, at) : raw).split('/').map(function (s) {
    try { return decodeURIComponent(s); } catch (e) { return s; }
  });
  var query = {};
  new URLSearchParams(at >= 0 ? raw.slice(at + 1) : '').forEach(function (value, key) {
    if (value !== '') query[key] = value;
  });
  var name = PAGES.indexOf(parts[0]) >= 0 ? parts[0] : 'home';
  var param = parts[1];
  var keyParam = name === 'list' || name === 'authors' ? String(parseInt(param || '0', 10) || 0)
    : name === 'poem' || name === 'author' ? (param || '') : '';
  var key = name + '/' + keyParam + (query.q ? '?q=' + query.q : '')
    + (name === 'home' ? '@' + localDateKey(now) : '');
  return { name: name, param: param, rest: parts.slice(2), query: query, key: key };
}

// 给每个历史项打 id：没有 id 的是新导航（滚到顶），有 id 的是前进/后退（恢复位置）。
function historyEntry() {
  var state = window.history.state;
  if (state && state.qx) return { id: state.qx, fresh: false };
  var id = Date.now().toString(36) + '.' + (++entrySeq);
  try {
    window.history.replaceState(Object.assign({}, state, { qx: id }), '', window.location.href);
  } catch (e) { /* 无法标记时按新导航处理 */ }
  return { id: id, fresh: true };
}

// 路由复位/恢复滚动必须瞬时完成：glass.css 的 smooth 若残留动画，会把恢复的位置又拉走。
function scrollToY(y) {
  var root = document.documentElement;
  var behavior = root.style.scrollBehavior;
  root.style.scrollBehavior = 'auto';
  void window.getComputedStyle(root).scrollBehavior; // 先刷新样式：Chrome 的 scrollTo(0, 0) 不会自行刷新
  try {
    window.scrollTo({ top: y, left: 0, behavior: 'instant' });
  } catch (e) {
    window.scrollTo(0, y);
  }
  root.style.scrollBehavior = behavior;
}

function show(name) {
  var boot = document.getElementById('boot');
  if (boot) boot.remove();
  PAGES.forEach(function (p) {
    var el = document.getElementById('page-' + p);
    if (!el) return;
    el.classList.toggle('is-active', p === name);
    el.hidden = p !== name;
  });
  document.title = titles[name] || DEFAULT_TITLE;
  var current = NAV_OF[name] || '';
  document.querySelectorAll('.site-nav__link[data-nav]').forEach(function (link) {
    if (link.getAttribute('data-nav') === current) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

// 只改地址栏（不产生历史项、不触发 hashchange），并让渲染缓存认得新地址。
function replace(path, query) {
  var target = hrefFor(path, query);
  if (window.location.hash === target) return;
  try {
    window.history.replaceState(window.history.state, '', target);
  } catch (e) {
    return; // Safari 等对 replaceState 有频率限制：失败只是不更新地址栏
  }
  var r = parseHash();
  if (rendered[r.name] != null) rendered[r.name] = r.key;
}

export function go(path, query) {
  var target = hrefFor(path, query);
  if (window.location.hash === target) render({ force: true });
  else window.location.hash = target;
}

function schedulePreload(route) {
  idle(function () {
    preloadJSON('data/featured.json');
    if (route.name === 'list') {
      warmSearchIndex();
      preloadListPage(parseInt(route.param || '0', 10) || 0);
    } else if (route.name === 'authors' || route.name === 'home') {
      preloadJSON('data/authors-index.json');
    } else if (route.name === 'poem' || route.name === 'author') {
      preloadJSON('data/manifest.json');
    }
  });
}

async function render(opts) {
  opts = opts || {};
  var token = ++seq;
  var route = parseHash();
  var here = historyEntry();
  closeGloss();
  if (opts.force || rendered[route.name] !== route.key) {
    delete rendered[route.name];
    titles[route.name] = DEFAULT_TITLE;
    var cacheable = true;
    var ctx = {
      go: go,
      replace: replace,
      query: route.query,
      rest: route.rest,
      shuffle: !!opts.shuffle,
      isCurrent: function () { return token === seq; },
      noCache: function () { cacheable = false; },
      setTitle: function () {
        var parts = Array.prototype.slice.call(arguments).filter(Boolean);
        titles[route.name] = parts.length ? parts.concat('情心').join(' · ') : DEFAULT_TITLE;
      },
    };
    try {
      await renderers[route.name](route.param, ctx);
      if (token === seq && cacheable) rendered[route.name] = route.key;
    } catch (e) {
      if (window.console) console.error(e);
      var el = document.getElementById('page-' + route.name);
      if (el && token === seq) el.innerHTML = errorSection('内容加载失败，请稍后重试。');
    }
  }
  if (token !== seq) return;
  show(route.name);
  scrollToY(here.fresh || opts.force ? 0 : (scrollById.get(here.id) || 0));
  currentEntry = here.id;
  schedulePreload(route);
}

function onHashChange() {
  if (currentEntry) scrollById.set(currentEntry, window.scrollY);
  render();
}

function onClick(e) {
  var target = e.target;
  if (!(target instanceof Element)) return;
  var gloss = target.closest('[data-gloss]');
  if (!gloss && !target.closest('.gloss-pop')) closeGloss();
  if (gloss) {
    openGloss(gloss);
    return;
  }

  var action = target.closest('[data-action]');
  if (action) {
    var name = action.getAttribute('data-action');
    if (name === 'shuffle') render({ force: true, shuffle: true });
    else handleAction(name);
    return;
  }

  var trigger = target.closest('[data-nav]');
  if (!trigger) return;
  // 修饰键 / 非主键点击交给浏览器（新标签页、新窗口）。
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  go(trigger.getAttribute('data-nav'));
}

function onKeydown(e) {
  if (e.key === 'Escape') {
    closeGloss(true);
    return;
  }
  if ((e.key === 'Enter' || e.key === ' ') && e.target instanceof Element && e.target.matches('[data-gloss]')) {
    e.preventDefault();
    openGloss(e.target);
  }
}

export function startRouter(pages) {
  if (!pages) {
    // 不传渲染器的只有已删除的 Kyne 入口 app.js（kyne/ 页面，及 v7 之前根目录的旧版页面）：
    // 那是旧版 Worker 从缓存送来的旧页面，直接去站点根目录的新站。目标按本模块位置（assets/js/）求，
    // 与旧页面在哪一层无关；带空查询（?）是为了不在旧缓存里命中旧页面。旧 Worker 淘汰后可删。
    window.location.replace(new URL('../../?', import.meta.url).href + window.location.hash);
    return;
  }
  renderers = pages;
  if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKeydown);
  window.addEventListener('hashchange', onHashChange);
  document.addEventListener('DOMContentLoaded', function () {
    initReader();
    render();
  });
}
