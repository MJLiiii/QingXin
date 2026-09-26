/* 阅读体验：主题 / 字号 / 竖排偏好、原文工具栏（复制、分享）与注释浮层。
   仅在浏览器中使用；偏好键 qingxin:prefs 与 index.html 的首帧脚本共用（诗文页标签另存 tab 键，见 glass-ui.js）。
   夜读随当地日出日落自动切换：手动选择存 theme + themeUntil（管到下一次日出或日落），其余时候当地入夜即夜读、
   白天跟随系统；「当地」是本机时区的代表城市，坐标缓存在 qingxin:place。规则与天文计算见 daylight.js。 */
import { fetchJSON } from './data.js';
import { chosenTheme, localZone, matchPlace, themeFor, toggleOverride } from './daylight.js';

var PREFS_KEY = 'qingxin:prefs';
var PLACE_KEY = 'qingxin:place';
var SCALES = [0.9, 1, 1.12, 1.25];
var RECHECK_MS = 60 * 1000;

var currentPoem = null;
var pop = null;
var popTrigger = null;
var popScroller = null;
var statusTimer = null;
var sessionPrefs = null; // 存储写不进去（隐私模式、禁用网站数据）时本次会话的偏好
var lookedUp = '';       // 本次会话已查过坐标表的时区

export function readPrefs() {
  if (sessionPrefs) return Object.assign({}, sessionPrefs);
  try {
    var prefs = JSON.parse(window.localStorage.getItem(PREFS_KEY));
    return prefs && typeof prefs === 'object' ? prefs : {};
  } catch (e) {
    return {};
  }
}

// 合并写入，值为 undefined 的键即删除；存储写不进去时只在本次会话生效（readPrefs 改读内存副本）。
export function writePrefs(patch) {
  var prefs = JSON.parse(JSON.stringify(Object.assign(readPrefs(), patch)));
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    sessionPrefs = null;
  } catch (e) {
    sessionPrefs = prefs;
  }
  return prefs;
}

function systemDark() {
  return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

function isDark() {
  var theme = document.documentElement.getAttribute('data-theme');
  if (theme) return theme === 'dark';
  return systemDark();
}

// 本机时区代表城市的坐标（qingxin:place，时区对得上才用）→ {lat, lon} 或 null。
function readPlace() {
  try {
    return matchPlace(JSON.parse(window.localStorage.getItem(PLACE_KEY)), localZone());
  } catch (e) {
    return null;
  }
}

// 查 data/timezones.json 得到本机时区代表城市的坐标，存进 qingxin:place（首帧脚本下次直接用）后重算。
// 每个时区每次会话只查一次；查不到（UTC 等）、取表失败或存不进去都不缓存，下次加载再说，其间按钟点。
function learnPlace() {
  var zone = localZone();
  if (!zone || zone === lookedUp) return;
  lookedUp = zone;
  fetchJSON('data/timezones.json').then(function (table) {
    var c = table && table.zones && table.zones[zone];
    if (!Array.isArray(c)) return;
    window.localStorage.setItem(PLACE_KEY, JSON.stringify({ zone: zone, lat: c[0], lon: c[1] }));
    applyTheme();
  }).catch(function () { /* 离线、存储被禁等 */ });
}

// 按手动选择与当地昼夜写 <html data-theme>（与首帧脚本同一规则），顺带清掉到期或旧版的手动选择。
function applyTheme() {
  var now = Date.now();
  var prefs = readPrefs();
  if ((prefs.theme !== undefined || prefs.themeUntil !== undefined) && !chosenTheme(prefs, now)) {
    prefs = writePrefs({ theme: undefined, themeUntil: undefined });
  }
  var place = readPlace();
  if (!place) learnPlace();
  var theme = themeFor(prefs, place, now);
  var root = document.documentElement;
  if (!theme) root.removeAttribute('data-theme');
  else if (root.getAttribute('data-theme') !== theme) root.setAttribute('data-theme', theme);
  syncControls();
}

function scaleIndex() {
  var i = SCALES.indexOf(Number(readPrefs().scale));
  return i < 0 ? SCALES.indexOf(1) : i;
}

export function syncControls() {
  var dark = isDark();
  var vertical = document.documentElement.getAttribute('data-vertical') === '1';
  var i = scaleIndex();
  document.querySelectorAll('[data-action="theme"]').forEach(function (btn) {
    btn.setAttribute('aria-pressed', String(dark));
  });
  document.querySelectorAll('[data-action="vertical"]').forEach(function (btn) {
    btn.setAttribute('aria-pressed', String(vertical));
  });
  document.querySelectorAll('[data-action="scale-down"]').forEach(function (btn) {
    btn.disabled = i <= 0;
  });
  document.querySelectorAll('[data-action="scale-up"]').forEach(function (btn) {
    btn.disabled = i >= SCALES.length - 1;
  });
}

export function initReader() {
  if (window.matchMedia) {
    var media = window.matchMedia('(prefers-color-scheme: dark)');
    if (media.addEventListener) media.addEventListener('change', syncControls);
  }
  applyTheme();
  // 页面开着跨过日出日落、手动选择到期：每分钟重算；切回前台、从往返缓存恢复、别的标签页改了偏好时立即重算。
  window.setInterval(applyTheme, RECHECK_MS);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) applyTheme();
  });
  window.addEventListener('pageshow', applyTheme);
  window.addEventListener('storage', function (e) {
    if (e.key === null || e.key === PREFS_KEY || e.key === PLACE_KEY) applyTheme();
  });
}

// 手动切换管到下一次日出或日落；切到与此刻自动结果相同的一边即回到自动（daylight.js toggleOverride）。
function toggleTheme() {
  writePrefs(toggleOverride(isDark(), systemDark(), readPlace(), Date.now()));
  applyTheme();
}

function stepScale(delta) {
  var i = Math.max(0, Math.min(SCALES.length - 1, scaleIndex() + delta));
  document.documentElement.style.setProperty('--reading-scale', String(SCALES[i]));
  writePrefs({ scale: SCALES[i] });
  closeGloss();
  syncControls();
}

function toggleVertical() {
  var root = document.documentElement;
  var on = root.getAttribute('data-vertical') !== '1';
  if (on) root.setAttribute('data-vertical', '1');
  else root.removeAttribute('data-vertical');
  writePrefs({ vertical: on });
  closeGloss();
  syncControls();
}

export function setCurrentPoem(poem) {
  currentPoem = poem;
}

function flash(message) {
  var status = document.querySelector('#page-poem .reader-tools__status');
  if (!status) return;
  status.textContent = message;
  window.clearTimeout(statusTimer);
  statusTimer = window.setTimeout(function () { status.textContent = ''; }, 2400);
}

function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  // 非安全上下文（如局域网 http 预览）没有 Clipboard API，退回 execCommand。
  return new Promise(function (resolve, reject) {
    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    area.remove();
    if (ok) resolve();
    else reject(new Error('copy failed'));
  });
}

function copyPoem() {
  if (!currentPoem) return;
  var p = currentPoem;
  var text = '《' + p.title + '》\n' + p.author + '〔' + p.dynasty + '〕\n\n'
    + p.lines.join('\n') + '\n\n' + window.location.href;
  copyText(text).then(function () { flash('已复制全文'); }, function () { flash('复制失败，请手动选择文字'); });
}

function copyLink() {
  copyText(window.location.href).then(function () { flash('链接已复制'); }, function () { flash('复制失败'); });
}

function sharePoem() {
  if (!currentPoem) return;
  if (!navigator.share) {
    copyLink();
    return;
  }
  navigator.share({
    title: '《' + currentPoem.title + '》' + currentPoem.author,
    text: currentPoem.lines[0] || '',
    url: window.location.href,
  }).catch(function (e) {
    if (!e || e.name !== 'AbortError') copyLink(); // 用户取消分享时不打扰
  });
}

function closeOnViewportChange() {
  closeGloss();
}

// 视口上下被悬浮控件占去的高度（页眉、底部标签栏）：由 glass.css 注册的长度属性给出，取不到时为 0。
function viewportInsets() {
  var cs = window.getComputedStyle(document.documentElement);
  return {
    top: parseFloat(cs.getPropertyValue('--pop-inset-top')) || 0,
    bottom: parseFloat(cs.getPropertyValue('--pop-inset-bottom')) || 0,
  };
}

function positionGloss() {
  var rects = popTrigger.getClientRects();
  var r = rects.length ? rects[0] : popTrigger.getBoundingClientRect();
  var gap = 10;
  var margin = 12;
  var width = pop.offsetWidth;
  var height = pop.offsetHeight;
  var insets = viewportInsets();
  var minTop = margin + insets.top;
  var maxBottom = window.innerHeight - margin - insets.bottom;
  var vertical = !!popScroller && window.getComputedStyle(popScroller).writingMode.indexOf('vertical') === 0;
  var left;
  var top;
  if (vertical) {
    left = r.left - gap - width;
    if (left < margin) left = r.right + gap;
    top = r.top;
    // 左右都放不下时改放到词的上下方，免得盖住词本身
    if (left + width > window.innerWidth - margin) {
      left = r.left + r.width / 2 - width / 2;
      top = r.bottom + gap;
      if (top + height > maxBottom) top = r.top - gap - height;
    }
  } else {
    left = r.left + r.width / 2 - width / 2;
    top = r.bottom + gap;
    if (top + height > maxBottom && r.top - gap - height >= minTop) top = r.top - gap - height;
  }
  left = Math.max(margin, Math.min(window.innerWidth - width - margin, left));
  top = Math.max(minTop, Math.min(maxBottom - height, top));
  // 触发词在钉住的栏里（[data-pinned]）时浮层按视口定位，页面滚动时不与之脱开。
  var fixed = !!popTrigger.closest('[data-pinned]');
  pop.style.position = fixed ? 'fixed' : '';
  pop.style.left = Math.round(left + (fixed ? 0 : window.scrollX)) + 'px';
  pop.style.top = Math.round(top + (fixed ? 0 : window.scrollY)) + 'px';
}

// 页面滚动后按触发词的新位置重新摆放（触发词所在的栏被钉住时由 glass-ui.js 调用）。
export function repositionGloss() {
  if (pop && popTrigger && popTrigger.isConnected) positionGloss();
}

// 第 k 个可点词对应注释栏第 k 行（.notes__row），浮层直接取其文字，不重复存数据。
export function openGloss(el) {
  if (popTrigger === el) {
    closeGloss();
    return;
  }
  closeGloss();
  var host = document.getElementById('page-poem');
  var row = host && host.querySelectorAll('.notes__row')[Number(el.getAttribute('data-gloss'))];
  if (!row) return;
  var term = row.querySelector('.notes__term');
  var def = row.querySelector('.notes__def');

  pop = document.createElement('div');
  pop.className = 'gloss-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', '注释');
  pop.tabIndex = -1;
  var termEl = document.createElement('div');
  termEl.className = 'gloss-pop__term';
  termEl.textContent = term ? term.textContent : '';
  var defEl = document.createElement('div');
  defEl.className = 'gloss-pop__def';
  defEl.textContent = def ? def.textContent : '';
  var more = document.createElement('button');
  more.type = 'button';
  more.className = 'gloss-pop__more';
  more.setAttribute('data-action', 'gloss-all');
  more.textContent = '查看全部注释';
  pop.append(termEl, defEl, more);
  document.body.appendChild(pop);

  popTrigger = el;
  popScroller = el.closest('.original__body');
  el.setAttribute('aria-expanded', 'true');
  positionGloss();
  if (popScroller) popScroller.addEventListener('scroll', closeOnViewportChange, { passive: true });
  window.addEventListener('resize', closeOnViewportChange);
  pop.focus({ preventScroll: true });
}

export function closeGloss(returnFocus) {
  if (!pop) return;
  var trigger = popTrigger;
  pop.remove();
  window.removeEventListener('resize', closeOnViewportChange);
  if (popScroller) popScroller.removeEventListener('scroll', closeOnViewportChange);
  pop = null;
  popTrigger = null;
  popScroller = null;
  if (trigger) {
    trigger.setAttribute('aria-expanded', 'false');
    if (returnFocus === true && trigger.isConnected) trigger.focus();
  }
}

function expandNotes() {
  closeGloss();
  var entry = document.querySelector('#page-poem .entry[data-section="notes"]');
  if (!entry) return;
  // 注释栏是分段标签页：先由 glass-ui.js 同步切到该栏，再滚动过去。
  entry.dispatchEvent(new CustomEvent('qx:expand-notes', { bubbles: true }));
  entry.scrollIntoView({ block: 'start' });
}

export function handleAction(name) {
  if (name === 'copy') copyPoem();
  else if (name === 'share') sharePoem();
  else if (name === 'vertical') toggleVertical();
  else if (name === 'scale-down') stepScale(-1);
  else if (name === 'scale-up') stepScale(1);
  else if (name === 'theme') toggleTheme();
  else if (name === 'gloss-all') expandNotes();
}
