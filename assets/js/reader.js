/* 阅读体验：主题 / 字号 / 竖排偏好、记住展开的栏目、原文工具栏（复制、分享）与注释浮层。
   仅在浏览器中使用；偏好键 qingxin:prefs 与 index.html 的首帧脚本共用。 */
var PREFS_KEY = 'qingxin:prefs';
var SCALES = [0.9, 1, 1.12, 1.25];

var currentPoem = null;
var pop = null;
var popTrigger = null;
var popScroller = null;
var statusTimer = null;

function readPrefs() {
  try {
    var prefs = JSON.parse(window.localStorage.getItem(PREFS_KEY));
    return prefs && typeof prefs === 'object' ? prefs : {};
  } catch (e) {
    return {};
  }
}

function writePrefs(patch) {
  var prefs = Object.assign(readPrefs(), patch);
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch (e) { /* 隐私模式等：仅本次会话生效 */ }
  return prefs;
}

export function openSections() {
  var open = readPrefs().open;
  return Array.isArray(open) ? open : [];
}

export function rememberSection(section, open) {
  if (!section) return;
  var list = openSections().filter(function (s) { return s !== section; });
  if (open) list.push(section);
  writePrefs({ open: list });
}

function isDark() {
  var theme = document.documentElement.getAttribute('data-theme');
  if (theme) return theme === 'dark';
  return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
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
  syncControls();
}

function toggleTheme() {
  var next = isDark() ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  writePrefs({ theme: next });
  syncControls();
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

function positionGloss() {
  var rects = popTrigger.getClientRects();
  var r = rects.length ? rects[0] : popTrigger.getBoundingClientRect();
  var gap = 10;
  var margin = 12;
  var width = pop.offsetWidth;
  var height = pop.offsetHeight;
  var vertical = !!popScroller && window.getComputedStyle(popScroller).writingMode.indexOf('vertical') === 0;
  var left;
  var top;
  if (vertical) {
    left = r.left - gap - width;
    if (left < margin) left = r.right + gap;
    top = r.top;
  } else {
    left = r.left + r.width / 2 - width / 2;
    top = r.bottom + gap;
    if (top + height > window.innerHeight - margin && r.top - gap - height >= margin) top = r.top - gap - height;
  }
  left = Math.max(margin, Math.min(window.innerWidth - width - margin, left));
  top = Math.max(margin, Math.min(window.innerHeight - height - margin, top));
  pop.style.left = Math.round(left + window.scrollX) + 'px';
  pop.style.top = Math.round(top + window.scrollY) + 'px';
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
  // 一次性跳转，不写入「记住展开」偏好。
  entry.classList.remove('entry--collapsed');
  var toggle = entry.querySelector('[data-toggle]');
  if (toggle) toggle.setAttribute('aria-expanded', 'true');
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
