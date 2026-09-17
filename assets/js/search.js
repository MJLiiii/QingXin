import { fetchJSON } from './data.js';
import { SEARCH_LIMIT, searchPoemIndex } from './search-core.js';

var worker = null;
var workerFailed = false;
var seq = 0;
var pending = new Map();
var searchDataPromise = null;

function ensureWorker() {
  if (workerFailed) return null;
  if (worker) return worker;
  if (!('Worker' in window)) {
    workerFailed = true;
    return null;
  }
  try {
    worker = new Worker(new URL('./search-worker.js', import.meta.url), {
      name: 'qingxin-search',
      type: 'module',
    });
    worker.onmessage = function (event) {
      var data = event.data || {};
      var p = pending.get(data.id);
      if (!p) return;
      pending.delete(data.id);
      if (data.error) p.reject(new Error(data.error));
      else p.resolve(data.result || { hits: [], matches: [], total: 0 });
    };
    worker.onerror = function () {
      workerFailed = true;
      for (var item of pending.values()) item.reject(new Error('search worker failed'));
      pending.clear();
      if (worker) worker.terminate();
      worker = null;
    };
    return worker;
  } catch (e) {
    workerFailed = true;
    return null;
  }
}

function withMatchMetadata(result) {
  var rows = (result.hits || []).map(function (row, i) {
    var match = (result.matches || [])[i] || {};
    return [row[0], row[1], row[2], {
      field: match.field || '',
      type: match.type || '',
      distance: match.distance || 0,
      start: Number.isInteger(match.start) ? match.start : -1,
      length: Number.isInteger(match.length) ? match.length : 0,
      line: typeof match.line === 'string' ? match.line : '',
    }];
  });
  rows.total = Number.isFinite(result.total) ? result.total : rows.length;
  return rows;
}

// Same loading contract as search-worker.js: both files in parallel, a missing
// lines.json degrades to title/author search, a failed search.json is retried.
function loadSearchData() {
  if (!searchDataPromise) {
    var lines = fetchJSON('data/lines.json').catch(function () { return null; });
    searchDataPromise = Promise.all([fetchJSON('data/search.json'), lines]).then(function (loaded) {
      return { index: loaded[0], lines: loaded[1] };
    }, function (error) {
      searchDataPromise = null;
      throw error;
    });
  }
  return searchDataPromise;
}

async function searchOnMainThread(q, limit) {
  var data = await loadSearchData();
  return withMatchMetadata(searchPoemIndex(data.index, q, limit, { lines: data.lines }));
}

export async function searchPoems(q, limit) {
  limit = limit || SEARCH_LIMIT;
  var w = ensureWorker();
  if (!w) return searchOnMainThread(q, limit);
  var id = ++seq;
  try {
    var result = await new Promise(function (resolve, reject) {
      pending.set(id, { resolve: resolve, reject: reject });
      w.postMessage({ id: id, q: q, limit: limit });
    });
    return withMatchMetadata(result);
  } catch (e) {
    return searchOnMainThread(q, limit);
  }
}

export function warmSearchIndex() {
  var w = ensureWorker();
  if (w) {
    try { w.postMessage({ id: ++seq, warm: true }); } catch (e) { workerFailed = true; }
  } else {
    loadSearchData().catch(function () { return null; });
  }
}
