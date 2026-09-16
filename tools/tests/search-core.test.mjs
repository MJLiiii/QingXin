import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSearchText,
  prepareLines,
  searchAuthorIndex,
  searchPoemIndex,
} from '../../assets/js/search-core.js';
import { hitCard, poetTile } from '../../assets/js/glass-templates.js';
import { searchBoxHTML } from '../../assets/js/templates.js';

test('normalizes traditional characters, whitespace, and punctuation', () => {
  assert.equal(normalizeSearchText(' 《 靜夜思 》 '), '静夜思');
  assert.equal(normalizeSearchText('聲聲慢・尋尋覓覓'), '声声慢寻寻觅觅');
});

test('ranks title matches ahead of author matches and keeps stable order', () => {
  const index = [
    ['p1', '静夜思', '李白'],
    ['p2', '李白诗', '佚名'],
    ['p3', '赠李白', '杜甫'],
    ['p4', '月下独酌', '李白'],
    ['p5', '赠李白', '杜牧'],
  ];
  const result = searchPoemIndex(index, '李白', 10);
  assert.deepEqual(result.hits.map((row) => row[0]), ['p2', 'p3', 'p5', 'p1', 'p4']);
  assert.deepEqual(result.matches.map((match) => match.type), [
    'prefix', 'substring', 'substring', 'exact', 'exact',
  ]);
  assert.equal(result.total, 5);
});

test('supports traditional queries against simplified display data', () => {
  const result = searchPoemIndex([['p1', '静夜思', '李白']], '靜夜思', 10);
  assert.equal(result.hits[0][0], 'p1');
  assert.equal(result.matches[0].type, 'exact');
  assert.deepEqual(
    { start: result.matches[0].start, length: result.matches[0].length },
    { start: 0, length: 3 },
  );
});

test('matches normalized punctuation and exposes a real display range', () => {
  const result = searchPoemIndex([['p1', '声声慢・寻寻觅觅', '李清照']], '声声慢 寻寻觅觅', 10);
  assert.equal(result.matches[0].type, 'exact');
  assert.deepEqual(
    { start: result.matches[0].start, length: result.matches[0].length },
    { start: 0, length: 8 },
  );
});

test('allows one edit but never fuzzy-matches a one-character query', () => {
  const index = [
    ['p1', '静夜思', '李白'],
    ['p2', '春晓', '孟浩然'],
  ];
  const typo = searchPoemIndex(index, '静夜诗', 10);
  assert.equal(typo.hits[0][0], 'p1');
  assert.equal(typo.matches[0].type, 'fuzzy');
  assert.equal(typo.matches[0].distance, 1);
  assert.equal(typo.matches[0].start, -1);

  const single = searchPoemIndex(index, '夜', 10);
  assert.deepEqual(single.hits.map((row) => row[0]), ['p1']);
  assert.equal(single.matches[0].type, 'substring');
});

test('supports a missing character without accepting one-character overlap noise', () => {
  const missing = searchPoemIndex([['p1', '静夜思', '李白']], '静思', 10);
  assert.equal(missing.hits[0][0], 'p1');
  assert.equal(missing.matches[0].type, 'fuzzy');

  const noisy = searchPoemIndex([['p2', '赠李', '杜甫']], '李白', 10);
  assert.equal(noisy.total, 0);
});

test('maps highlights correctly after astral characters and treats one astral as one character', () => {
  const range = searchPoemIndex([['p1', '𬤇静夜', '甲']], '静', 10);
  assert.equal(range.matches[0].start, 2);
  assert.equal(range.matches[0].length, 1);

  const single = searchPoemIndex([['p2', '静', '甲']], '𬤇', 10);
  assert.equal(single.total, 0);
});

test('honors aliases without exposing them as display fields', () => {
  const index = [['p1', '秋日', '甲', { title: ['秋天'], author: '作者甲' }]];
  const result = searchPoemIndex(index, '秋天', 10);
  assert.equal(result.hits[0], index[0]);
  assert.equal(result.matches[0].type, 'exact');
  assert.equal(result.matches[0].start, -1);
});

test('searches author names with the shared scorer and reports totals', () => {
  const authors = [
    { slug: 'libai', name: '李白' },
    { slug: 'libai-alt', name: '李白居士' },
    { slug: 'dufu', name: '杜甫' },
  ];
  const exact = searchAuthorIndex(authors, '李白', 1);
  assert.equal(exact.hits[0].slug, 'libai');
  assert.equal(exact.matches[0].type, 'exact');
  assert.equal(exact.total, 2);

  const typo = searchAuthorIndex(authors, '李百', 10);
  assert.equal(typo.hits[0].slug, 'libai');
  assert.equal(typo.matches[0].type, 'fuzzy');
});

const shuidiao = [
  '明月几时有，把酒问青天。',
  '不知天上宫阙，今夕是何年。',
  '我欲乘风归去，又恐琼楼玉宇，高处不胜寒。',
  '起舞弄清影，何似在人间。',
  '转朱阁，低绮户，照无眠。',
  '不应有恨，何事长向别时圆。',
  '人有悲欢离合，月有阴晴圆缺，此事古难全。',
  '但愿人长久，千里共婵娟。',
].join('\n');
const lineIndex = [
  ['t8-125', '静夜思', '李白'],
  ['c59-66', '水调歌头·明月几时有', '苏轼'],
  ['c58-837', '阮郎归·天边金掌露成霜', '晏几道'],
];
const lineRows = [
  ['t8-125', '床前看月光，疑是地上霜。\n举头望山月，低头思故乡。'],
  ['c59-66', shuidiao],
  ['c58-837', '天边金掌露成霜。\n云随雁字长。\n绿杯红袖称重阳。\n人情似故乡。\n兰佩紫，菊簪黄。\n殷勤理旧狂。\n欲将沈醉换悲凉。\n清歌莫断肠。'],
];
const highlightedText = (match) => match.line.slice(match.start, match.start + match.length);

test('prepareLines caches per rows array and records normalized line offsets', () => {
  const rows = [['p1', '床前看月光，\n疑是地上霜。']];
  const prepared = prepareLines(rows);
  assert.equal(prepareLines(rows), prepared);
  assert.deepEqual(prepared.get('p1'), {
    lines: ['床前看月光，', '疑是地上霜。'],
    normLines: ['床前看月光', '疑是地上霜'],
    norm: '床前看月光疑是地上霜',
    offsets: [0, 5],
  });
});

test('finds a famous line in body text with an excerpt-relative highlight', () => {
  const result = searchPoemIndex(lineIndex, '但愿人长久', 10, { lines: lineRows });
  assert.deepEqual(result.hits.map((row) => row[0]), ['c59-66']);
  const match = result.matches[0];
  assert.deepEqual(Object.keys(match), ['field', 'type', 'score', 'distance', 'start', 'length', 'line']);
  assert.equal(match.field, 'line');
  assert.equal(match.type, 'substring');
  assert.equal(match.line, '但愿人长久，千里共婵娟。');
  assert.equal(highlightedText(match), '但愿人长久');
  assert.equal(result.total, 1);
});

test('maps body queries spanning punctuation and line breaks back to the excerpt', () => {
  const inLine = searchPoemIndex(lineIndex, '起舞弄清影何似在人间', 10, { lines: lineRows }).matches[0];
  assert.equal(inLine.field, 'line');
  assert.equal(highlightedText(inLine), '起舞弄清影，何似在人间');

  const across = searchPoemIndex(lineIndex, '此事古难全但愿人长久', 10, { lines: lineRows }).matches[0];
  assert.equal(across.line, '人有悲欢离合，月有阴晴圆缺，此事古难全。　但愿人长久，千里共婵娟。');
  assert.equal(highlightedText(across), '此事古难全。　但愿人长久');
});

test('tolerates one substituted character in body queries of five or more characters', () => {
  const result = searchPoemIndex(lineIndex, '床前明月光', 10, { lines: lineRows });
  assert.deepEqual(result.hits.map((row) => row[0]), ['t8-125']);
  assert.deepEqual(result.matches[0], {
    field: 'line', type: 'fuzzy', score: 105, distance: 1, start: -1, length: 0,
    line: '床前看月光，疑是地上霜。',
  });
  assert.equal(searchPoemIndex(lineIndex, '床前明月', 10, { lines: lineRows }).total, 0);
});

test('direct title/author hits outrank body hits, which outrank title/author typos', () => {
  const index = [
    ['p1', '饮中八仙歌', '杜甫'],
    ['p2', '赠汪伦', '李白'],
  ];
  const lines = [
    ['p1', '李白一斗诗百篇，长安市上酒家眠。'],
    ['p2', '李白乘舟将欲行，忽闻岸上踏歌声。'],
  ];
  const result = searchPoemIndex(index, '李白', 10, { lines });
  assert.deepEqual(result.hits.map((row) => row[0]), ['p2', 'p1']);
  assert.deepEqual(result.matches.map((match) => match.field), ['author', 'line']);
  assert.equal(result.total, 2);

  const typo = searchPoemIndex([['p0', '长安市', '佚名'], ...index], '长安市上', 10, { lines });
  assert.deepEqual(typo.hits.map((row) => row[0]), ['p1', 'p0']);
  assert.deepEqual(typo.matches.map((match) => `${match.field}:${match.type}`), ['line:substring', 'title:fuzzy']);
});

test('caps two-character body hits at 40 and never searches bodies for one character', () => {
  const index = [['t0', '春风', '佚名']];
  const lines = [];
  for (let i = 1; i <= 45; i++) {
    index.push([`t${i}`, `无题${i}`, '佚名']);
    lines.push([`t${i}`, `第${i}首\n春风又绿江南岸`]);
  }
  const two = searchPoemIndex(index, '春风', 120, { lines });
  assert.equal(two.hits.length, 41);
  assert.equal(two.matches[0].field, 'title');
  assert.equal(two.matches.filter((match) => match.field === 'line').length, 40);
  assert.equal(two.total, 41);

  const narrow = searchPoemIndex(index, '春风', 10, { lines });
  assert.equal(narrow.hits.length, 10);
  assert.equal(narrow.total, 41);

  const three = searchPoemIndex(index, '春风又', 120, { lines });
  assert.equal(three.matches.filter((match) => match.field === 'line').length, 45);
  assert.equal(three.matches[45].type, 'fuzzy');
  assert.equal(three.total, 46);

  const one = searchPoemIndex(index, '春', 120, { lines });
  assert.deepEqual(one.hits.map((row) => row[0]), ['t0']);
  assert.ok(one.matches.every((match) => match.field !== 'line'));
});

test('keeps an excerpt when an OpenCC phrase conversion defeats per-character highlighting', () => {
  // Whole-line normalization turns 沈醉 into 沉醉; per-character it stays 沈醉.
  const result = searchPoemIndex(lineIndex, '欲将沉醉换悲凉', 10, { lines: lineRows });
  assert.deepEqual(result.hits.map((row) => row[0]), ['c58-837']);
  assert.equal(result.matches[0].field, 'line');
  assert.equal(result.matches[0].type, 'substring');
  assert.equal(result.matches[0].line, '欲将沈醉换悲凉。');
});

test('clips long excerpts around the match without splitting surrogate pairs', () => {
  const astral = '𬤇'.repeat(30);
  const filler = '天涯共此时'.repeat(8);
  for (const text of [astral + '海上生明' + filler, filler + '海上生明' + astral]) {
    const result = searchPoemIndex([['p1', '无题', '佚名']], '海上生明', 10, { lines: [['p1', text]] });
    const match = result.matches[0];
    assert.equal(match.field, 'line');
    assert.ok(match.line.length <= 40, match.line);
    assert.ok(match.line.startsWith('…') && match.line.endsWith('…'), match.line);
    assert.ok(match.line.isWellFormed(), match.line);
    assert.equal(highlightedText(match), '海上生明');
  }
});

const integrationIndex = [
  ['p1', '静夜思', '李白'],
  ['p2', '秋夜思', '刘方平'],
  ['p3', '月夜', '杜甫'],
];
const integrationLines = [
  ['p1', '床前看月光，疑是地上霜。\n举头望山月，低头思故乡。'],
  ['p3', '香雾云鬟湿，清辉玉臂寒。\n何时倚虚幌，双照泪痕干。'],
];

// Routes by URL: the worker fetches absolute URLs, the main thread data/*.json.
function routeFetch(routes) {
  return async (input) => {
    const url = String(input);
    const file = Object.keys(routes).find((suffix) => url.endsWith(suffix));
    if (!file || routes[file] === 404) {
      return { ok: false, status: 404, json: async () => { throw new SyntaxError('not found'); } };
    }
    return { ok: true, status: 200, json: async () => routes[file] };
  };
}

async function withBrowserGlobals(fetchImpl, run) {
  const originalFetch = globalThis.fetch;
  const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, 'window');
  const originalWindow = globalThis.window;
  const hadSelf = Object.prototype.hasOwnProperty.call(globalThis, 'self');
  const originalSelf = globalThis.self;
  globalThis.fetch = fetchImpl;
  globalThis.window = {};
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
    if (hadWindow) globalThis.window = originalWindow;
    else delete globalThis.window;
    if (hadSelf) globalThis.self = originalSelf;
    else delete globalThis.self;
  }
}

async function loadWorker(tag) {
  const posted = [];
  globalThis.self = {
    location: { href: 'https://example.test/assets/js/search-worker.js' },
    postMessage(message) { posted.push(message); },
  };
  await import(`../../assets/js/search-worker.js?${tag}`);
  const onmessage = globalThis.self.onmessage;
  return async (data) => {
    posted.length = 0;
    await onmessage({ data });
    return posted[0];
  };
}

// Must stay before the equivalence test: data.js memoizes fetchJSON() per path
// for the whole process, so lines.json must not have loaded successfully yet.
test('title/author search still works on both paths when lines.json is missing', async () => {
  await withBrowserGlobals(routeFetch({ '/search.json': integrationIndex, '/lines.json': 404 }), async () => {
    const mainModule = await import('../../assets/js/search.js?fallback-missing-lines');
    const workerSearch = await loadWorker('worker-missing-lines');

    const main = await mainModule.searchPoems('靜夜思', 10);
    assert.deepEqual(main.map((row) => [row[0], row[3].field, row[3].type, row[3].line]), [
      ['p1', 'title', 'exact', ''],
    ]);
    const posted = await workerSearch({ id: 1, q: '靜夜思', limit: 10 });
    assert.equal(posted.error, undefined);
    assert.deepEqual(posted.result.hits.map((row) => row[0]), ['p1']);
    assert.equal(posted.result.matches[0].field, 'title');

    // Without body text a famous line finds nothing on either path.
    assert.equal((await mainModule.searchPoems('床前看月光', 10)).length, 0);
    assert.equal((await workerSearch({ id: 2, q: '床前看月光', limit: 10 })).result.total, 0);
  });
});

test('module worker and main-thread fallback return equivalent ranked matches', async () => {
  const routes = { '/search.json': integrationIndex, '/lines.json': integrationLines };
  await withBrowserGlobals(routeFetch(routes), async () => {
    const mainModule = await import('../../assets/js/search.js?fallback-integration');
    const workerSearch = await loadWorker('worker-integration');
    const mainRows = {};
    let id = 0;
    for (const q of ['靜夜思', '床前明月光', '清辉玉臂', '李白']) {
      const main = await mainModule.searchPoems(q, 10);
      const posted = await workerSearch({ id: ++id, q, limit: 10 });
      mainRows[q] = main;
      assert.equal(posted.id, id);
      assert.deepEqual(main.map((row) => row[0]), posted.result.hits.map((row) => row[0]), q);
      assert.deepEqual(
        main.map((row) => [row[3].field, row[3].type, row[3].start, row[3].length, row[3].line]),
        posted.result.matches.map((match) => [
          match.field, match.type, match.start, match.length,
          typeof match.line === 'string' ? match.line : '',
        ]),
        q,
      );
      assert.equal(main.total, posted.result.total, q);
    }
    assert.deepEqual(mainRows['床前明月光'][0].slice(0, 1), ['p1']);
    assert.equal(mainRows['床前明月光'][0][3].field, 'line');
    assert.equal(mainRows['床前明月光'][0][3].line, '床前看月光，疑是地上霜。');
    const body = mainRows['清辉玉臂'][0][3];
    assert.equal(body.line.slice(body.start, body.start + body.length), '清辉玉臂');
  });
});

test('templates highlight only real direct ranges and expose search status semantics', () => {
  const exact = hitCard(
    ['p1', '静夜思', '李白', {
      field: 'title', type: 'exact', distance: 0, start: 0, length: 3,
    }],
    '静夜思',
  );
  assert.match(exact, /<mark class="search-match">静夜思<\/mark>/);

  const fuzzy = hitCard(
    ['p1', '静夜思', '李白', {
      field: 'title', type: 'fuzzy', distance: 1, start: -1, length: 0,
    }],
    '静夜诗',
  );
  assert.doesNotMatch(fuzzy, /<mark/);
  assert.doesNotMatch(poetTile({ slug: 'libai', name: '李白', dynasty: '唐', count: 1 }), /<mark/);

  const box = searchBoxHTML({ id: 'poem-search', controls: 'results' });
  assert.match(box, /aria-controls="results"/);
  assert.match(box, /role="status"/);
  assert.match(box, /aria-live="polite"/);
});
