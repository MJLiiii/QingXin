import { preloadJSON, preloadListPage } from './data.js';
import { warmSearchIndex } from './search.js';
import { idle } from './utils.js';
import { errorSection } from './templates.js';
import { RENDERERS, renderHome } from './pages.js';

var PAGES = ['home', 'list', 'poem', 'author', 'authors', 'about'];

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

export function go(path) {
  var target = '#/' + path.split('/').map(encodeURIComponent).join('/');
  if (window.location.hash === target) render();
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

export async function render() {
  var r = parseHash();
  try {
    await (RENDERERS[r.name] || renderHome)(r.param, { go: go });
  } catch (e) {
    if (window.console) console.error(e);
    var el = document.getElementById('page-' + r.name);
    if (el) el.innerHTML = errorSection('内容加载失败，请稍后重试。');
  }
  show(r.name);
  schedulePreload(r);
  try { window.scrollTo({ top: 0, behavior: 'auto' }); }
  catch (e) { window.scrollTo(0, 0); }
}

export function startRouter() {
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
}
