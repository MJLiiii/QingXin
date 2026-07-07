import { fetchJSON } from './data.js';

var worker = null;
var workerFailed = false;
var seq = 0;
var pending = new Map();
var searchIndexPromise = null;

function ensureWorker() {
  if (workerFailed) return null;
  if (worker) return worker;
  if (!('Worker' in window)) {
    workerFailed = true;
    return null;
  }
  try {
    worker = new Worker(new URL('./search-worker.js', import.meta.url), { name: 'qingxin-search' });
    worker.onmessage = function (event) {
      var data = event.data || {};
      var p = pending.get(data.id);
      if (!p) return;
      pending.delete(data.id);
      if (data.error) p.reject(new Error(data.error));
      else p.resolve(data.hits || []);
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

async function searchOnMainThread(q, limit) {
  if (!searchIndexPromise) searchIndexPromise = fetchJSON('data/search.json');
  var idx = await searchIndexPromise;
  var hits = [];
  for (var k = 0; k < idx.length && hits.length < limit; k++) {
    if (idx[k][1].indexOf(q) >= 0 || idx[k][2].indexOf(q) >= 0) hits.push(idx[k]);
  }
  return hits;
}

export async function searchPoems(q, limit) {
  limit = limit || 120;
  var w = ensureWorker();
  if (!w) return searchOnMainThread(q, limit);
  var id = ++seq;
  try {
    return await new Promise(function (resolve, reject) {
      pending.set(id, { resolve: resolve, reject: reject });
      w.postMessage({ id: id, q: q, limit: limit });
    });
  } catch (e) {
    return searchOnMainThread(q, limit);
  }
}

export function warmSearchIndex() {
  var w = ensureWorker();
  if (w) {
    try { w.postMessage({ id: ++seq, warm: true }); } catch (e) { workerFailed = true; }
  } else if (!searchIndexPromise) {
    searchIndexPromise = fetchJSON('data/search.json').catch(function () { return null; });
  }
}
