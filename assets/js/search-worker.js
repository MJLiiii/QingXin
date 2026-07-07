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
    if (data.warm) return;
    var q = String(data.q || '').trim();
    var limit = data.limit || 120;
    var hits = [];
    if (q) {
      for (var k = 0; k < idx.length && hits.length < limit; k++) {
        if (idx[k][1].indexOf(q) >= 0 || idx[k][2].indexOf(q) >= 0) hits.push(idx[k]);
      }
    }
    self.postMessage({ id: data.id, hits: hits });
  } catch (e) {
    self.postMessage({ id: data.id, error: String(e && e.message || e) });
  }
};
