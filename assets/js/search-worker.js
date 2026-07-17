import { preparePoemIndex, searchPoemIndex } from './search-core.js';

var indexPromise = null;

function loadIndex() {
  if (!indexPromise) {
    var url = new URL('../../data/search.json', self.location.href);
    indexPromise = fetch(url).then(function (res) {
      if (!res.ok) throw new Error('search index -> ' + res.status);
      return res.json();
    });
  }
  return indexPromise;
}

self.onmessage = async function (event) {
  var data = event.data || {};
  try {
    var idx = await loadIndex();
    if (data.warm) {
      preparePoemIndex(idx);
      return;
    }
    var q = String(data.q || '');
    var limit = data.limit || 120;
    var result = searchPoemIndex(idx, q, limit);
    self.postMessage({ id: data.id, result: result });
  } catch (e) {
    self.postMessage({ id: data.id, error: String(e && e.message || e) });
  }
};
