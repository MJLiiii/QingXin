import { prepareLines, preparePoemIndex, searchPoemIndex } from './search-core.js';

var dataPromise = null;

function fetchData(file, label) {
  var url = new URL('../../data/' + file, self.location.href);
  return fetch(url).then(function (res) {
    if (!res.ok) throw new Error(label + ' -> ' + res.status);
    return res.json();
  });
}

// search.json is required; lines.json only adds body-text (名句) matches, so
// losing it degrades to title/author search. A failed search.json is not
// cached, which lets a later message retry.
function loadData() {
  if (!dataPromise) {
    var lines = fetchData('lines.json', 'line index').catch(function () { return null; });
    dataPromise = Promise.all([fetchData('search.json', 'search index'), lines]).then(function (loaded) {
      return { index: loaded[0], lines: loaded[1] };
    }, function (error) {
      dataPromise = null;
      throw error;
    });
  }
  return dataPromise;
}

self.onmessage = async function (event) {
  var data = event.data || {};
  try {
    var loaded = await loadData();
    if (data.warm) {
      preparePoemIndex(loaded.index);
      if (loaded.lines) prepareLines(loaded.lines);
      return;
    }
    var q = String(data.q || '');
    var limit = data.limit || 120;
    var result = searchPoemIndex(loaded.index, q, limit, { lines: loaded.lines });
    self.postMessage({ id: data.id, result: result });
  } catch (e) {
    self.postMessage({ id: data.id, error: String(e && e.message || e) });
  }
};
