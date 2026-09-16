import { pad3, pad4 } from './utils.js';

var cache = new Map();
// 数据路径相对站点根目录（本模块在 assets/js/ 下），与页面所在目录无关。
var ROOT = new URL('../../', import.meta.url);

export async function fetchJSON(path) {
  if (cache.has(path)) return cache.get(path);
  var res = await fetch(new URL(path, ROOT));
  if (!res.ok) {
    var err = new Error(path + ' -> ' + res.status);
    err.status = res.status;
    throw err;
  }
  var data = await res.json();
  cache.set(path, data);
  return data;
}

export function preloadJSON(path) {
  return fetchJSON(path).catch(function () { return null; });
}

export function parseId(id) {
  var m = /^([tc])(\d+)-(\d+)$/.exec(id || '');
  if (!m) return null;
  return { kind: m[1] === 't' ? 'shi' : 'ci', chunk: +m[2], i: +m[3] };
}

export async function loadPoem(id) {
  var loc = parseId(id);
  if (!loc) return null;
  var sub = Math.floor(loc.i / 100);
  var slice = await fetchJSON('data/poems/' + pad4(loc.chunk) + '-' + sub + '.json');
  return slice[loc.i % 100] || null;
}

// 仅 404（确无该文件）返回 null；网络等其它失败照常抛出，由调用方决定如何降级。
export async function loadAnnotation(id) {
  try {
    return await fetchJSON('data/annotations/' + encodeURIComponent(id) + '.json');
  } catch (e) {
    if (e && e.status === 404) return null;
    throw e;
  }
}

export function authorBucket(slug) {
  var h = 0;
  for (var i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return h % 256;
}

export async function loadAuthor(slug) {
  if (!slug) return null;
  try {
    var bundle = await fetchJSON('data/authors/bucket-' + pad3(authorBucket(slug)) + '.json');
    return bundle[slug] || null;
  } catch (e) {
    if (e && e.status === 404) return null;
    throw e;
  }
}

export async function preloadListPage(displayPage) {
  var manifest = await fetchJSON('data/manifest.json');
  var perFile = manifest.pageSize / 25;
  var file = Math.floor(Math.max(0, displayPage || 0) / perFile);
  return preloadJSON('data/index/page-' + pad4(file) + '.json');
}
