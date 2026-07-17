import { Converter } from './vendor/opencc-t2cn.js';

var toSimplified = Converter({ from: 't', to: 'cn' });
var poemCache = new WeakMap();
var authorCache = new WeakMap();
var punctuation = /[\p{P}\p{Z}\s]+/gu;
var surrogate = /[\uD800-\uDFFF]/;

function compactText(value) {
  return String(value == null ? '' : value)
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(punctuation, '');
}

export function normalizeSearchText(value) {
  return compactText(toSimplified(String(value == null ? '' : value)));
}

function characterLength(value) {
  return surrogate.test(value) ? Array.from(value).length : value.length;
}

function appendAliases(target, value) {
  if (Array.isArray(value)) {
    value.forEach(function (item) { appendAliases(target, item); });
  } else if (typeof value === 'string' && value) {
    var normalized = normalizeSearchText(value);
    if (normalized && target.indexOf(normalized) < 0) target.push(normalized);
  }
}

function poemAliases(row, field) {
  var values = [];
  var extra = row[3];
  if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
    appendAliases(values, extra[field]);
  } else if (Array.isArray(extra)) {
    appendAliases(values, field === 'title' ? extra[0] : extra[1]);
  } else if (field === 'title') {
    appendAliases(values, extra);
  }
  if (field === 'author') appendAliases(values, row[4]);
  return values;
}

function cachedPoem(row) {
  var cached = poemCache.get(row);
  if (cached) return cached;
  cached = {
    title: normalizeSearchText(row[1]),
    author: normalizeSearchText(row[2]),
    titleAliases: poemAliases(row, 'title'),
    authorAliases: poemAliases(row, 'author'),
  };
  poemCache.set(row, cached);
  return cached;
}

function cachedAuthor(author) {
  var cached = authorCache.get(author);
  if (cached) return cached;
  var aliases = [];
  appendAliases(aliases, author.alias);
  appendAliases(aliases, author.searchAlias);
  appendAliases(aliases, author.nameAlias);
  cached = { name: normalizeSearchText(author.name), aliases: aliases };
  authorCache.set(author, cached);
  return cached;
}

function displayRange(display, normalizedDisplay, start, queryLength) {
  if (start < 0 || queryLength < 1) return { start: -1, length: 0 };
  var positions = [];
  var rebuilt = '';
  var source = String(display == null ? '' : display);
  var offset = 0;
  for (var char of source) {
    var normalized = normalizeSearchText(char);
    var end = offset + char.length;
    for (var output of normalized) {
      rebuilt += output;
      // indexOf() and slice() expose UTF-16 offsets. Repeat the source
      // coordinate for both halves of an astral output character.
      for (var unit = 0; unit < output.length; unit++) {
        positions.push({ start: offset, end: end });
      }
    }
    offset = end;
  }
  if (rebuilt !== normalizedDisplay || start + queryLength > positions.length) {
    return { start: -1, length: 0 };
  }
  var first = positions[start];
  var last = positions[start + queryLength - 1];
  return { start: first.start, length: last.end - first.start };
}

function editDistanceAtMostOne(a, b) {
  var delta = a.length - b.length;
  if (delta > 1 || delta < -1) return 2;
  if (a === b) return 0;
  if (a.length === b.length) {
    var mismatches = 0;
    for (var i = 0; i < a.length; i++) {
      if (a[i] !== b[i] && ++mismatches > 1) return 2;
    }
    return mismatches;
  }
  var longer = a.length > b.length ? a : b;
  var shorter = a.length > b.length ? b : a;
  var x = 0;
  var y = 0;
  var edits = 0;
  while (x < longer.length && y < shorter.length) {
    if (longer[x] === shorter[y]) {
      x += 1;
      y += 1;
    } else {
      edits += 1;
      x += 1;
      if (edits > 1) return 2;
    }
  }
  return edits + (x < longer.length ? 1 : 0);
}

function fuzzyDistance(text, query) {
  var useCodePoints = surrogate.test(text) || surrogate.test(query);
  var textUnits = useCodePoints ? Array.from(text) : text;
  var queryUnits = useCodePoints ? Array.from(query) : query;
  if (queryUnits.length < 2 || !textUnits.length) return 2;
  // For a two-character query, a one-character window is only a 50%
  // overlap and creates thousands of weak deletion matches. Same-length
  // substitutions and a three-character missing-letter window remain valid.
  var minLength = queryUnits.length === 2 ? 2 : Math.max(1, queryUnits.length - 1);
  var maxLength = Math.min(textUnits.length, queryUnits.length + 1);
  for (var size = minLength; size <= maxLength; size++) {
    for (var start = 0; start + size <= textUnits.length; start++) {
      if (editDistanceAtMostOne(textUnits.slice(start, start + size), queryUnits) === 1) return 1;
    }
  }
  return 2;
}

function directCandidate(display, normalized, query, alias) {
  var type = '';
  var at = -1;
  if (normalized === query) {
    type = 'exact';
    at = 0;
  } else if (normalized.startsWith(query)) {
    type = 'prefix';
    at = 0;
  } else {
    at = normalized.indexOf(query);
    if (at >= 0) type = 'substring';
  }
  if (!type) return null;
  var range = alias ? { start: -1, length: 0 }
    : displayRange(display, normalized, at, query.length);
  return {
    type: type,
    distance: 0,
    start: range.start,
    length: range.length,
    alias: alias,
    lengthDelta: Math.abs(normalized.length - query.length),
  };
}

function typeRank(type) {
  return type === 'exact' ? 3 : type === 'prefix' ? 2 : type === 'substring' ? 1 : 0;
}

function betterFieldMatch(a, b) {
  if (!b) return a;
  if (!a) return b;
  var typeDelta = typeRank(a.type) - typeRank(b.type);
  if (typeDelta) return typeDelta > 0 ? a : b;
  if (a.alias !== b.alias) return a.alias ? b : a;
  if (a.distance !== b.distance) return a.distance < b.distance ? a : b;
  return a.lengthDelta <= b.lengthDelta ? a : b;
}

function matchField(display, normalized, aliases, query) {
  var best = directCandidate(display, normalized, query, false);
  for (var alias of aliases) {
    best = betterFieldMatch(directCandidate(display, alias, query, true), best);
  }
  if (best || characterLength(query) < 2) return best;

  var fuzzy = fuzzyDistance(normalized, query);
  var fuzzyAlias = false;
  var fuzzyLength = Math.abs(normalized.length - query.length);
  for (var candidate of aliases) {
    var distance = fuzzyDistance(candidate, query);
    var delta = Math.abs(candidate.length - query.length);
    if (distance < fuzzy || (distance === fuzzy && delta < fuzzyLength)) {
      fuzzy = distance;
      fuzzyAlias = true;
      fuzzyLength = delta;
    }
  }
  if (fuzzy !== 1) return null;
  return {
    type: 'fuzzy',
    distance: 1,
    start: -1,
    length: 0,
    alias: fuzzyAlias,
    lengthDelta: fuzzyLength,
  };
}

function poemScore(field, type) {
  if (field === 'title') {
    if (type === 'exact') return 600;
    if (type === 'prefix') return 500;
    if (type === 'substring') return 400;
    return 110;
  }
  if (type === 'exact') return 300;
  if (type === 'prefix') return 220;
  if (type === 'substring') return 200;
  return 100;
}

function authorScore(type) {
  if (type === 'exact') return 500;
  if (type === 'prefix') return 400;
  if (type === 'substring') return 300;
  return 100;
}

function finishMatch(field, match, score) {
  if (!match) return null;
  return {
    field: field,
    type: match.type,
    score: score,
    distance: match.distance,
    start: match.start,
    length: match.length,
    _lengthDelta: match.lengthDelta,
  };
}

function bestPoemMatch(row, query) {
  var normalized = cachedPoem(row);
  var title = matchField(row[1], normalized.title, normalized.titleAliases, query);
  var author = matchField(row[2], normalized.author, normalized.authorAliases, query);
  var titleMatch = finishMatch('title', title, title && poemScore('title', title.type));
  var authorMatch = finishMatch('author', author, author && poemScore('author', author.type));
  if (!titleMatch) return authorMatch;
  if (!authorMatch) return titleMatch;
  if (titleMatch.score !== authorMatch.score) {
    return titleMatch.score > authorMatch.score ? titleMatch : authorMatch;
  }
  return titleMatch;
}

function compareRanked(a, b) {
  if (a.match.score !== b.match.score) return b.match.score - a.match.score;
  if (a.match.distance !== b.match.distance) return a.match.distance - b.match.distance;
  if (a.match.field !== b.match.field) return a.match.field === 'title' ? -1 : 1;
  if (a.match._lengthDelta !== b.match._lengthDelta) {
    return a.match._lengthDelta - b.match._lengthDelta;
  }
  return a.index - b.index;
}

function insertTop(top, entry, limit) {
  var low = 0;
  var high = top.length;
  while (low < high) {
    var mid = (low + high) >> 1;
    if (compareRanked(entry, top[mid]) < 0) high = mid;
    else low = mid + 1;
  }
  if (low >= limit) return;
  top.splice(low, 0, entry);
  if (top.length > limit) top.pop();
}

function publicMatch(match) {
  return {
    field: match.field,
    type: match.type,
    score: match.score,
    distance: match.distance,
    start: match.start,
    length: match.length,
  };
}

function resultFromTop(top, total) {
  return {
    hits: top.map(function (entry) { return entry.value; }),
    matches: top.map(function (entry) { return publicMatch(entry.match); }),
    total: total,
  };
}

function createCollector(limit) {
  return {
    direct: [],
    fuzzy: [],
    directTotal: 0,
    fuzzyTotal: 0,
    hasExact: false,
    limit: limit,
  };
}

function collectMatch(collector, entry) {
  if (entry.match.type === 'fuzzy') {
    collector.fuzzyTotal += 1;
    insertTop(collector.fuzzy, entry, collector.limit);
  } else {
    collector.directTotal += 1;
    collector.hasExact = collector.hasExact || entry.match.type === 'exact';
    insertTop(collector.direct, entry, collector.limit);
  }
}

function collectedResult(collector, queryLength) {
  var room = Math.max(0, collector.limit - collector.direct.length);
  // A one-edit match on two characters is only 50% similar. Keep a small,
  // ranked suggestion set, and suppress fuzzy noise when an exact hit exists.
  var fuzzyLimit = collector.hasExact ? 0 : (queryLength === 2 ? 12 : room);
  var acceptedFuzzy = Math.min(room, fuzzyLimit, collector.fuzzyTotal);
  var top = collector.direct.concat(collector.fuzzy.slice(0, acceptedFuzzy));
  return resultFromTop(top, collector.directTotal + acceptedFuzzy);
}

export function preparePoemIndex(index) {
  if (!Array.isArray(index)) return;
  for (var row of index) {
    if (Array.isArray(row) && row.length >= 3) cachedPoem(row);
  }
}

export function searchPoemIndex(index, query, limit) {
  if (!Array.isArray(index)) throw new TypeError('search index must be an array');
  var normalizedQuery = normalizeSearchText(query);
  var cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 120;
  if (!normalizedQuery) return { hits: [], matches: [], total: 0 };
  var collector = createCollector(cap);
  for (var i = 0; i < index.length; i++) {
    var row = index[i];
    if (!Array.isArray(row) || typeof row[1] !== 'string' || typeof row[2] !== 'string') continue;
    var match = bestPoemMatch(row, normalizedQuery);
    if (!match) continue;
    collectMatch(collector, { value: row, match: match, index: i });
  }
  return collectedResult(collector, characterLength(normalizedQuery));
}

export function searchAuthorIndex(index, query, limit) {
  if (!Array.isArray(index)) throw new TypeError('author index must be an array');
  var normalizedQuery = normalizeSearchText(query);
  var cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 120;
  if (!normalizedQuery) return { hits: [], matches: [], total: 0 };
  var collector = createCollector(cap);
  for (var i = 0; i < index.length; i++) {
    var author = index[i];
    if (!author || typeof author !== 'object' || typeof author.name !== 'string') continue;
    var normalized = cachedAuthor(author);
    var raw = matchField(author.name, normalized.name, normalized.aliases, normalizedQuery);
    if (!raw) continue;
    var match = finishMatch('name', raw, authorScore(raw.type));
    collectMatch(collector, { value: author, match: match, index: i });
  }
  return collectedResult(collector, characterLength(normalizedQuery));
}
