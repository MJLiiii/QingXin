/* 页面共用的数据与交互辅助：搜索框联动、分页跳转、今日一诗选取、诗文页数据与原文部件
   （含原文逐句块 .original__line）。各页面的布局在 glass-pages.js。 */
import { loadAnnotation, loadAuthor, loadPoem } from './data.js';
import { SEARCH_LIMIT } from './search-core.js';
import { searchPoems } from './search.js';
import { esc, groupStanzas, localDateKey, seededRandom } from './utils.js';
import { emptyState, glossLines } from './templates.js';

// 竖排按列横向滚动；行数过多的长篇（如歌行）不提供竖排。
var VERTICAL_MAX_LINES = 60;

export function wirePager(host, go) {
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

export function wireLiveSearch(o) {
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

// rows：{ entry, hit } —— 整页条目与搜索命中的卡片模板。
export function wireSearch(host, pageEntries, onQuery, rows) {
  var limit = SEARCH_LIMIT;
  var entryRow = rows.entry;
  var hitRow = rows.hit;
  return wireLiveSearch({
    host: host,
    inputSel: '#search-input',
    rowsSel: '#list-rows',
    onQuery: onQuery,
    restore: function () { return pageEntries.map(entryRow).join(''); },
    match: async function (q) {
      var hits = await searchPoems(q, limit);
      var hasTotal = Number.isFinite(hits.total);
      return {
        html: hits.length
          ? hits.map(function (hit) { return hitRow(hit, q); }).join('')
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

export function aiNotice(ann) {
  if (ann.source !== 'ai') return '';
  return '<p class="prose--faint">本篇注释、译文、赏析由 AI 生成，仅供参考。</p>';
}

// 「今日一诗」：以本地日期为种子，当天刷新不变；「换一首」才真正随机。
// 返回洗牌后的精选条目与首页主推（第一首有摘句的）。
export function pickFeatured(entries, daily) {
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
  return { pick: pick, hero: hero || pick[0] };
}

// 诗文页数据：诗（找不到为 null）、注解（无则 {}）、作者。
// 注释 / 作者加载失败（非 404）时降级展示（degraded），调用方应 ctx.noCache()，返回时会重试。
export async function loadPoemData(id) {
  var degraded = false;
  function soft(promise) {
    return promise.catch(function () {
      degraded = true;
      return null;
    });
  }
  var loaded = await Promise.all([loadPoem(id), soft(loadAnnotation(id))]);
  var poem = loaded[0];
  if (!poem) return { poem: null, ann: {}, author: null, degraded: degraded };
  var author = await soft(loadAuthor(poem.authorSlug));
  return { poem: poem, ann: loaded[1] || {}, author: author, degraded: degraded };
}

// 注释条目：第 k 行对应原文第 k 个可点词（reader.js 按下标取释义）。AI 免责文案由 glass-pages.js 另行渲染。
export function notesHTML(notes) {
  return '<div class="notes">' + (notes.length
    ? notes.map(function (n) {
      return '<div class="notes__row"><div class="notes__term">' + esc(n.term)
        + '</div><div class="notes__def">' + esc(n.def) + '</div></div>';
    }).join('')
    : '<p class="prose--faint">尚未收录，敬请期待。</p>') + '</div>';
}

// 原文区的共用部件：阅读工具栏、带注释词的原文、注释条目（与 .notes__row 顺序一一对应）。
export function poemParts(poem, ann) {
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
  // 原文逐句成块：一句折行时在标点后断开并悬挂缩进（glass.css .original__line；竖排时由 CSS 取消缩进）。词序不分块。
  original += '<div class="original__body' + (longPoem ? ' original__body--long' : '') + '">'
    + groupStanzas(paragraphs, function (line, i) { return glossed[i]; }).map(function (lines) {
      return '<p class="original__stanza">' + lines.map(function (line) {
        return '<span class="original__line">' + line + '</span>';
      }).join('') + '</p>';
    }).join('')
    + '</div></div>';

  return {
    paragraphs: paragraphs,
    hasNotes: hasNotes,
    notes: notes,
    longPoem: longPoem,
    tools: tools,
    original: original,
  };
}
