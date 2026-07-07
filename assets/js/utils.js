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

export function debounce(fn, ms) {
  var t;
  return function () {
    var args = arguments;
    var ctx = this;
    clearTimeout(t);
    t = setTimeout(function () { fn.apply(ctx, args); }, ms);
  };
}

export function groupStanzas(paras) {
  var stanzas = [];
  var cur = [];
  (paras || []).forEach(function (line) {
    if (String(line).trim() === '') {
      if (cur.length) {
        stanzas.push(cur);
        cur = [];
      }
    } else {
      cur.push(line);
    }
  });
  if (cur.length) stanzas.push(cur);
  return stanzas.length ? stanzas : [paras || []];
}

export function idle(fn) {
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(fn, { timeout: 1600 });
  } else {
    window.setTimeout(fn, 250);
  }
}
