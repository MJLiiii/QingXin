export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

export function pad3(n) {
  return String(n).padStart(3, '0');
}

export function pad4(n) {
  return String(n).padStart(4, '0');
}

// 路由路径逐段 encode（中文 slug 安全）；go()、列表行与分页链接共用。
export function hashPath(path) {
  return String(path == null ? '' : path).split('/').map(encodeURIComponent).join('/');
}

export function hrefFor(path, query) {
  var pairs = Object.keys(query || {}).filter(function (k) {
    return query[k] != null && query[k] !== '';
  }).sort().map(function (k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(query[k]);
  });
  return '#/' + hashPath(path) + (pairs.length ? '?' + pairs.join('&') : '');
}

export function debounce(fn, ms) {
  var t;
  return function () {
    var args = arguments;
    var ctx = this;
    clearTimeout(t);
    t = setTimeout(function () { fn.apply(ctx, args); }, ms);
  };
}

export function groupStanzas(paras, map) {
  var stanzas = [];
  var cur = [];
  (paras || []).forEach(function (line, i) {
    if (String(line).trim() === '') {
      if (cur.length) {
        stanzas.push(cur);
        cur = [];
      }
    } else {
      cur.push(map ? map(line, i) : line);
    }
  });
  if (cur.length) stanzas.push(cur);
  return stanzas.length ? stanzas : [(paras || []).map(function (line, i) {
    return map ? map(line, i) : line;
  })];
}

export function idle(fn) {
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(fn, { timeout: 1600 });
  } else {
    window.setTimeout(fn, 250);
  }
}

// 本地日期（不用 UTC 的 toISOString）：东八区零点即换「今日一诗」。
export function localDateKey(date) {
  var d = date || new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
    + '-' + String(d.getDate()).padStart(2, '0');
}

// 可复现的伪随机数：字符串种子哈希 → mulberry32，返回 [0, 1) 的生成函数。
export function seededRandom(seed) {
  var str = String(seed);
  var h = 1779033703 ^ str.length;
  for (var i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  var state = h >>> 0;
  return function () {
    state = (state + 0x6D2B79F5) | 0;
    var t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
