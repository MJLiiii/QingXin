import { Converter } from './vendor/opencc-t2cn.js';

var toSimplified = Converter({ from: 't', to: 'cn' });
var poemCache = new WeakMap();
var authorCache = new WeakMap();
var linesCache = new WeakMap();
var punctuation = /[\p{P}\p{Z}\s]+/gu;
var surrogate = /[\uD800-\uDFFF]/;
var LINE_SUBSTRING_SCORE = 190;
var LINE_FUZZY_SCORE = 105;
var LINE_FUZZY_MIN_LENGTH = 5;
var TWO_CHARACTER_LINE_CAP = 40;
var EXCERPT_LIMIT = 40;
// 单次搜索返回的最多条数（诗集 / 诗人搜索共用；调用方不传 limit 时的默认值）。
export var SEARCH_LIMIT = 120;
// A full-width space normalizes to '', so joined excerpt lines keep the
// normalized offsets of their source lines.
var EXCERPT_JOINER = '\u3000';
var ELLIPSIS = '\u2026';

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

// Leftmost same-length window of `text` that differs from `query` by exactly
// one substituted character. Callers rule out exact containment first.
function substitutionWindow(text, query) {
  var useCodePoints = surrogate.test(text) || surrogate.test(query);
  var textUnits = useCodePoints ? Array.from(text) : text;
  var queryUnits = useCodePoints ? Array.from(query) : query;
  var size = queryUnits.length;
  for (var start = 0; start + size <= textUnits.length; start++) {
    var candidate = textUnits.slice(start, start + size);
    if (editDistanceAtMostOne(candidate, queryUnits) !== 1) continue;
    if (!useCodePoints) return { at: start, span: size };
    // Report UTF-16 offsets into the normalized body, like indexOf().
    return { at: textUnits.slice(0, start).join('').length, span: candidate.join('').length };
  }
  return null;
}

function lineMatch(type, at, span) {
  var fuzzy = type === 'fuzzy';
  return {
    field: 'line',
    type: type,
    score: fuzzy ? LINE_FUZZY_SCORE : LINE_SUBSTRING_SCORE,
    distance: fuzzy ? 1 : 0,
    start: -1,
    length: 0,
    _lengthDelta: 0,
    _at: at,
    _span: span,
  };
}

// Body matches only matter when they outrank the title/author match, so the
// scans are skipped when they cannot win.
function bestLineMatch(body, query, queryLength, currentScore) {
  if (currentScore >= LINE_SUBSTRING_SCORE) return null;
  var at = body.norm.indexOf(query);
  if (at >= 0) return lineMatch('substring', at, query.length);
  if (queryLength < LINE_FUZZY_MIN_LENGTH || currentScore >= LINE_FUZZY_SCORE) return null;
  var found = substitutionWindow(body.norm, query);
  return found ? lineMatch('fuzzy', found.at, found.span) : null;
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

// Index of the line holding normalized offset `position`: the last line that
// starts at or before it (a line normalizing to '' shares the next line's
// offset and holds no positions).
function lineIndexAt(offsets, position) {
  var low = 0;
  var high = offsets.length - 1;
  while (low < high) {
    var mid = (low + high + 1) >> 1;
    if (offsets[mid] <= position) low = mid;
    else high = mid - 1;
  }
  return low;
}

function isHighSurrogate(code) {
  return code >= 0xD800 && code <= 0xDBFF;
}

function isLowSurrogate(code) {
  return code >= 0xDC00 && code <= 0xDFFF;
}

// Clip a long excerpt to EXCERPT_LIMIT units around [focusStart, focusEnd),
// marking each cut side with an ellipsis. The focus itself is never cut.
function clipExcerpt(text, focusStart, focusEnd, range) {
  var focusLength = Math.max(0, focusEnd - focusStart);
  var room = Math.max(focusLength, EXCERPT_LIMIT - 2);
  var from = Math.max(0, focusStart - Math.floor((room - focusLength) / 2));
  var to = Math.min(text.length, from + room);
  from = Math.max(0, to - room);
  // A side that keeps the text's own edge needs no ellipsis: reuse its unit.
  if (from === 0) to = Math.min(text.length, to + 1);
  else if (to === text.length) from -= 1;
  if (from > 0 && isLowSurrogate(text.charCodeAt(from))) from += 1;
  if (to < text.length && isHighSurrogate(text.charCodeAt(to - 1))) to -= 1;
  var prefix = from > 0 ? ELLIPSIS : '';
  var suffix = to < text.length ? ELLIPSIS : '';
  return {
    line: prefix + text.slice(from, to) + suffix,
    start: range.start >= 0 ? range.start - from + prefix.length : -1,
    length: range.start >= 0 ? range.length : 0,
  };
}

// Display excerpt for a body match: the source lines covering the match,
// with an excerpt-relative highlight range for substring hits.
function lineExcerpt(body, match) {
  var first = lineIndexAt(body.offsets, match._at);
  var last = lineIndexAt(body.offsets, match._at + match._span - 1);
  var text = body.lines.slice(first, last + 1).join(EXCERPT_JOINER);
  var normalized = body.normLines.slice(first, last + 1).join('');
  var at = match._at - body.offsets[first];
  var range = match.type === 'fuzzy' ? { start: -1, length: 0 }
    : displayRange(text, normalized, at, match._span);
  if (text.length <= EXCERPT_LIMIT) return { line: text, start: range.start, length: range.length };
  var focus = range;
  if (focus.start < 0 && match.type === 'fuzzy') focus = displayRange(text, normalized, at, match._span);
  if (focus.start < 0) {
    // OpenCC phrase conversions defeat the per-character map: estimate.
    var ratio = normalized.length ? text.length / normalized.length : 1;
    focus = { start: Math.floor(at * ratio), length: Math.ceil(match._span * ratio) };
  }
  return clipExcerpt(text, focus.start, Math.min(text.length, focus.start + focus.length), range);
}

function publicMatch(match, excerpt) {
  var result = {
    field: match.field,
    type: match.type,
    score: match.score,
    distance: match.distance,
    start: excerpt ? excerpt.start : match.start,
    length: excerpt ? excerpt.length : match.length,
  };
  if (excerpt) result.line = excerpt.line;
  return result;
}

// Excerpts are built only for the entries actually returned.
function resultFromTop(top, total) {
  return {
    hits: top.map(function (entry) { return entry.value; }),
    matches: top.map(function (entry) {
      return publicMatch(entry.match, entry.body ? lineExcerpt(entry.body, entry.match) : null);
    }),
    total: total,
  };
}

function createCollector(limit) {
  return {
    direct: [],
    line: [],
    fuzzy: [],
    directTotal: 0,
    lineTotal: 0,
    fuzzyTotal: 0,
    hasExact: false,
    limit: limit,
  };
}

function collectMatch(collector, entry) {
  if (entry.match.type === 'fuzzy') {
    collector.fuzzyTotal += 1;
    insertTop(collector.fuzzy, entry, collector.limit);
  } else if (entry.match.field === 'line') {
    collector.lineTotal += 1;
    insertTop(collector.line, entry, collector.limit);
  } else {
    collector.directTotal += 1;
    collector.hasExact = collector.hasExact || entry.match.type === 'exact';
    insertTop(collector.direct, entry, collector.limit);
  }
}

function collectedResult(collector, queryLength) {
  var room = Math.max(0, collector.limit - collector.direct.length);
  // Body (名句) substring hits follow direct title/author hits. A two-character
  // query hits hundreds of bodies, so it keeps a capped, ranked sample.
  var lineCap = queryLength === 2 ? TWO_CHARACTER_LINE_CAP : room;
  var acceptedLines = Math.min(room, lineCap, collector.lineTotal);
  room -= acceptedLines;
  // A one-edit match on two characters is only 50% similar. Keep a small,
  // ranked suggestion set, and suppress fuzzy noise when an exact hit exists.
  var fuzzyLimit = collector.hasExact ? 0 : (queryLength === 2 ? 12 : room);
  var acceptedFuzzy = Math.min(room, fuzzyLimit, collector.fuzzyTotal);
  var top = collector.direct.concat(
    collector.line.slice(0, acceptedLines),
    collector.fuzzy.slice(0, acceptedFuzzy)
  );
  var lineCount = queryLength === 2
    ? Math.min(collector.lineTotal, TWO_CHARACTER_LINE_CAP)
    : collector.lineTotal;
  return resultFromTop(top, collector.directTotal + lineCount + acceptedFuzzy);
}

// rows: [[id, text]] from data/lines.json, lines joined by '\n'. Each line is
// normalized separately: OpenCC converts whole phrases, so per-line pieces
// (not the whole body) are what displayRange() can map back for excerpts.
export function prepareLines(rows) {
  if (!Array.isArray(rows)) return new Map();
  var cached = linesCache.get(rows);
  if (cached) return cached;
  cached = new Map();
  for (var row of rows) {
    if (!Array.isArray(row) || typeof row[0] !== 'string' || typeof row[1] !== 'string') continue;
    if (cached.has(row[0])) continue;
    var lines = row[1].split('\n');
    var normLines = [];
    var offsets = [];
    var norm = '';
    for (var line of lines) {
      var normalized = normalizeSearchText(line);
      offsets.push(norm.length);
      normLines.push(normalized);
      norm += normalized;
    }
    cached.set(row[0], { lines: lines, normLines: normLines, norm: norm, offsets: offsets });
  }
  linesCache.set(rows, cached);
  return cached;
}

export function preparePoemIndex(index) {
  if (!Array.isArray(index)) return;
  for (var row of index) {
    if (Array.isArray(row) && row.length >= 3) cachedPoem(row);
  }
}

// options.lines: optional data/lines.json rows ([[id, text]]) adding body-text
// (名句) matches for multi-character queries.
export function searchPoemIndex(index, query, limit, options) {
  if (!Array.isArray(index)) throw new TypeError('search index must be an array');
  var normalizedQuery = normalizeSearchText(query);
  var cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : SEARCH_LIMIT;
  if (!normalizedQuery) return { hits: [], matches: [], total: 0 };
  var queryLength = characterLength(normalizedQuery);
  var bodies = options && Array.isArray(options.lines) && queryLength >= 2
    ? prepareLines(options.lines) : null;
  var collector = createCollector(cap);
  for (var i = 0; i < index.length; i++) {
    var row = index[i];
    if (!Array.isArray(row) || typeof row[1] !== 'string' || typeof row[2] !== 'string') continue;
    var match = bestPoemMatch(row, normalizedQuery);
    var body = bodies ? bodies.get(row[0]) : undefined;
    if (body) {
      var line = bestLineMatch(body, normalizedQuery, queryLength, match ? match.score : 0);
      if (line && (!match || line.score > match.score)) match = line;
    }
    if (!match) continue;
    collectMatch(collector, {
      value: row,
      match: match,
      index: i,
      body: match.field === 'line' ? body : null,
    });
  }
  return collectedResult(collector, queryLength);
}

export function searchAuthorIndex(index, query, limit) {
  if (!Array.isArray(index)) throw new TypeError('author index must be an array');
  var normalizedQuery = normalizeSearchText(query);
  var cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : SEARCH_LIMIT;
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
