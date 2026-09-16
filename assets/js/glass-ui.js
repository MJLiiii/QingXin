/* liquidglass/ 的界面交互：分段标签、首页搜索、钉住的阅读栏（及其注释浮层）、页眉滚动态。
   与 router.js 的委托点击并存：这里只认 [role=tab][data-tab] 与 form[data-find]，二者 router 都不处理。 */
import { go } from './router.js';
import { closeGloss, repositionGloss, writePrefs } from './reader.js';

var PIN_QUERY = '(min-width: 1200px)';
var PIN_SLACK = 16;

var media = null;
var observer = null;
var pins = new Map(); // 页面 id → 可钉住的栏（[data-pin]）
var composing = false;
var ticking = false;

// 切换标签：同一 tablist 内只有一个选中项（roving tabindex），对应面板显示、其余隐藏。
// opts.remember 写入偏好；opts.reveal 在标签栏已吸顶时把新面板滚到它下面。
function selectTab(tab, opts) {
  opts = opts || {};
  var list = tab.closest('[role="tablist"]');
  if (!list) return;
  var scope = list.closest('.page') || document;
  var panel = null;
  list.querySelectorAll('[role="tab"]').forEach(function (t) {
    var on = t === tab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    var p = scope.querySelector('#' + t.getAttribute('aria-controls'));
    if (p) p.hidden = !on;
    if (on) panel = p;
  });
  if (opts.focus) tab.focus();
  if (opts.remember) {
    writePrefs({ tab: tab.getAttribute('data-tab') });
    rememberTab(tab.getAttribute('data-tab'));
  }
  if (opts.reveal && panel && isStuck(list)) panel.scrollIntoView({ block: 'start' });
}

// 把当前选的栏记在本历史项上：前进 / 后退重建这首诗时仍打开同一栏（router 的 state.qx 等字段原样保留）。
export function rememberTab(key) {
  try {
    window.history.replaceState(Object.assign({}, window.history.state, { qxTab: key }), '');
  } catch (e) { /* 频率受限时只是不记 */ }
}

function isStuck(el) {
  var top = parseFloat(window.getComputedStyle(el).top);
  return !isNaN(top) && el.getBoundingClientRect().top <= top + 1;
}

function onClick(e) {
  var tab = e.target instanceof Element && e.target.closest('[role="tab"][data-tab]');
  if (tab) selectTab(tab, { remember: true, reveal: true });
}

function onKeydown(e) {
  var target = e.target instanceof Element ? e.target : null;
  if (!target) return;
  if (e.key === 'Enter' && target.matches('form[data-find] input') && (e.isComposing || e.keyCode === 229)) {
    // 输入法确认候选的回车不算提交（Safari 的 compositionend 先于这次 keydown）；
    // 隐式提交在本次按键的默认动作里同步触发，之后即复位。
    composing = true;
    window.setTimeout(function () { composing = false; }, 0);
    return;
  }
  var tab = target.closest('[role="tab"][data-tab]');
  if (!tab || e.altKey || e.ctrlKey || e.metaKey) return; // 带修饰键的是浏览器快捷键（前进 / 后退等）
  var tabs = Array.prototype.slice.call(tab.closest('[role="tablist"]').querySelectorAll('[role="tab"]'));
  var i = tabs.indexOf(tab);
  var next = null;
  if (e.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
  else if (e.key === 'ArrowLeft') next = tabs[(i - 1 + tabs.length) % tabs.length];
  else if (e.key === 'Home') next = tabs[0];
  else if (e.key === 'End') next = tabs[tabs.length - 1];
  if (!next) return;
  e.preventDefault();
  selectTab(next, { focus: true, remember: true, reveal: true });
}

// 首页搜索卡：跳到诗集页并带上搜索词（诗集页读取 ?q= 后自动检索）。
function onSubmit(e) {
  var form = e.target instanceof Element && e.target.closest('form[data-find]');
  if (!form) return;
  e.preventDefault();
  if (composing) {
    composing = false;
    return;
  }
  var input = form.querySelector('input[name="q"]');
  var q = input ? input.value.trim() : '';
  go('list', q ? { q: q } : null);
}

// 「查看全部注释」（reader.js）展开注释栏前先切到该标签，不写入偏好；
// 焦点随之移到注释面板（浮层连同按钮已移除，否则焦点会掉回 body）。
function onExpandNotes(e) {
  var panel = e.target;
  if (!(panel instanceof Element) || !panel.id) return;
  var scope = panel.closest('.page') || document;
  var tab = scope.querySelector('[role="tab"][aria-controls="' + panel.id + '"]');
  if (!tab) return;
  selectTab(tab);
  panel.focus({ preventScroll: true });
}

// 自动关闭浮层（滚出视口、栏钉住状态变化）时，焦点若在浮层里就还给触发词。
function dismissGloss() {
  var pop = document.querySelector('.gloss-pop');
  var trigger = document.querySelector('.gloss[aria-expanded="true"]');
  var hadFocus = !!pop && pop.contains(document.activeElement);
  closeGloss();
  if (hadFocus && trigger && trigger.isConnected) trigger.focus({ preventScroll: true });
}

function updatePin(el) {
  var on = false;
  if (media && media.matches && el.isConnected && el.offsetHeight > 0) {
    var top = parseFloat(window.getComputedStyle(el).top) || 0;
    on = el.offsetHeight + top + PIN_SLACK <= window.innerHeight;
  }
  if (on !== el.hasAttribute('data-pinned')) {
    dismissGloss();
    el.toggleAttribute('data-pinned', on);
  }
}

function updatePins() {
  pins.forEach(updatePin);
}

// 诗文 / 作者页左栏：宽屏且整栏放得进视口时才钉住（sticky），否则随页面滚动。
// 页面重渲染后调用；字号、竖排、窗口变化时由 ResizeObserver / resize 重新判断。
export function initPin(host) {
  var old = pins.get(host.id);
  if (old && observer) observer.unobserve(old);
  pins.delete(host.id);
  var el = host.querySelector('[data-pin]');
  if (!el) return;
  pins.set(host.id, el);
  if (observer) observer.observe(el);
  updatePin(el);
}

function onScroll() {
  if (ticking) return;
  ticking = true;
  window.requestAnimationFrame(function () {
    ticking = false;
    var header = document.querySelector('.site-header');
    if (header) header.toggleAttribute('data-scrolled', window.scrollY > 8);
    var trigger = document.querySelector('.gloss[aria-expanded="true"]');
    if (!trigger || !trigger.closest('[data-pinned]')) return;
    var r = trigger.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) dismissGloss();
    else repositionGloss();
  });
}

export function initGlassUI() {
  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKeydown);
  document.addEventListener('submit', onSubmit);
  document.addEventListener('qx:expand-notes', onExpandNotes);
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', updatePins);
  if (window.matchMedia) {
    media = window.matchMedia(PIN_QUERY);
    if (media.addEventListener) media.addEventListener('change', updatePins);
  }
  if ('ResizeObserver' in window) {
    observer = new ResizeObserver(updatePins);
    pins.forEach(function (el) { observer.observe(el); });
  }
  onScroll();
}
