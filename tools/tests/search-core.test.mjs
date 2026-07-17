import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSearchText,
  searchAuthorIndex,
  searchPoemIndex,
} from '../../assets/js/search-core.js';
import {
  authorRow,
  searchBoxHTML,
  searchRow,
} from '../../assets/js/templates.js';

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

test('module worker and main-thread fallback return equivalent ranked matches', async () => {
  const originalFetch = globalThis.fetch;
  const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, 'window');
  const originalWindow = globalThis.window;
  const hadSelf = Object.prototype.hasOwnProperty.call(globalThis, 'self');
  const originalSelf = globalThis.self;
  const index = [
    ['p1', '静夜思', '李白'],
    ['p2', '秋夜思', '刘方平'],
  ];
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => index,
  });

  try {
    globalThis.window = {};
    const mainModule = await import('../../assets/js/search.js?fallback-integration');
    const main = await mainModule.searchPoems('靜夜思', 10);

    let posted = null;
    globalThis.self = {
      location: { href: 'https://example.test/assets/js/search-worker.js' },
      postMessage(message) { posted = message; },
    };
    await import('../../assets/js/search-worker.js?worker-integration');
    await globalThis.self.onmessage({ data: { id: 7, q: '靜夜思', limit: 10 } });

    assert.equal(posted.id, 7);
    assert.deepEqual(main.map((row) => row[0]), posted.result.hits.map((row) => row[0]));
    assert.deepEqual(
      main.map((row) => row[3].type),
      posted.result.matches.map((match) => match.type),
    );
    assert.equal(main.total, posted.result.total);
  } finally {
    globalThis.fetch = originalFetch;
    if (hadWindow) globalThis.window = originalWindow;
    else delete globalThis.window;
    if (hadSelf) globalThis.self = originalSelf;
    else delete globalThis.self;
  }
});

test('templates highlight only real direct ranges and expose search status semantics', () => {
  const exact = searchRow(
    ['p1', '静夜思', '李白', {
      field: 'title', type: 'exact', distance: 0, start: 0, length: 3,
    }],
    '静夜思',
  );
  assert.match(exact, /<mark class="search-match">静夜思<\/mark>/);

  const fuzzy = searchRow(
    ['p1', '静夜思', '李白', {
      field: 'title', type: 'fuzzy', distance: 1, start: -1, length: 0,
    }],
    '静夜诗',
  );
  assert.doesNotMatch(fuzzy, /<mark/);
  assert.doesNotMatch(authorRow({ slug: 'libai', name: '李白', dynasty: '唐', count: 1 }), /<mark/);

  const box = searchBoxHTML({ id: 'poem-search', controls: 'results' });
  assert.match(box, /aria-controls="results"/);
  assert.match(box, /role="status"/);
  assert.match(box, /aria-live="polite"/);
});
