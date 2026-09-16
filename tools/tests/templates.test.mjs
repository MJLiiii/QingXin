import test from 'node:test';
import assert from 'node:assert/strict';
import {
  displaySize,
  entryShell,
  glossLines,
  glossTerm,
  heroLines,
  pagerHTML,
  proseEntry,
  searchRow,
} from '../../assets/js/templates.js';
import {
  groupStanzas,
  hashPath,
  hrefFor,
  localDateKey,
  seededRandom,
} from '../../assets/js/utils.js';

test('display sizes count code points, not UTF-16 units', () => {
  assert.equal(displaySize('静夜思'), 's');
  assert.equal(displaySize('𬸦𬸦𬸦𬸦'), 's');
  assert.equal(displaySize('一二三四五六七八'), 'm');
  assert.equal(displaySize('一二三四五六七八九'), 'l');
  assert.equal(displaySize('一'.repeat(16)), 'l');
  assert.equal(displaySize('一'.repeat(17)), 'xl');
  assert.equal(displaySize('一'.repeat(40)), 'xl');
  assert.equal(displaySize('一'.repeat(41)), 'xxl');
  assert.equal(displaySize(null), 's');
});

test('hero lines split the first sentence and fall back to the first two lines', () => {
  assert.deepEqual(heroLines(['床前明月光，疑是地上霜。', '举头望明月，低头思故乡。']), ['床前明月光', '疑是地上霜']);
  assert.deepEqual(heroLines(['明月几时有？把酒问青天。']), ['明月几时有', '把酒问青天']);
  assert.deepEqual(heroLines(['', '转朱阁，低绮户，照无眠。']), ['转朱阁', '低绮户，照无眠']);
  assert.deepEqual(
    heroLines(['一二三四五六七八九十一二三，甲乙。', '第二行。']),
    ['一二三四五六七八九十一二三，甲乙', '第二行']
  );
  assert.deepEqual(heroLines(['无标点的一行', '次行']), ['无标点的一行', '次行']);
  assert.deepEqual(heroLines([]), []);
});

test('gloss terms drop pinyin annotations', () => {
  assert.equal(glossTerm('阑（lán）'), '阑');
  assert.equal(glossTerm('踏莎（suō）行'), '踏莎行');
  assert.equal(glossTerm('婵娟(chán juān)'), '婵娟');
});

test('gloss lines follow note order, include the preface line and escape text', () => {
  const lines = ['丙辰中秋，欢饮达旦', '明月几时有，把酒问青天。', '<转朱阁>，低绮户，照无眠。'];
  const notes = [{ term: '丙辰' }, { term: '达旦' }, { term: '绮户' }, { term: '无此词' }];
  const html = glossLines(lines, notes);
  assert.match(html[0], /<span class="gloss"[^>]*data-gloss="0">丙辰<\/span>/);
  assert.match(html[0], /data-gloss="1">达旦<\/span>/);
  assert.equal(html[1], '明月几时有，把酒问青天。');
  assert.match(html[2], /^&lt;转朱阁&gt;，低<span[^>]*data-gloss="2">绮户<\/span>/);
  assert.doesNotMatch(html.join(''), /data-gloss="3"/);
});

test('repeated single-character terms bind to the occurrence after the previous note', () => {
  const html = glossLines(['月出惊山鸟，时鸣春涧中', '人闲桂花落，夜静春山空'], [{ term: '闲' }, { term: '春' }]);
  assert.doesNotMatch(html[0], /data-gloss/);
  assert.match(html[1], /data-gloss="0">闲</);
  assert.match(html[1], /data-gloss="1">春</);
});

test('overlapping gloss terms keep the longer one', () => {
  const longerLater = glossLines(['琼楼玉宇，高处不胜寒'], [{ term: '玉宇' }, { term: '琼楼玉宇' }]);
  assert.match(longerLater[0], /data-gloss="1">琼楼玉宇<\/span>/);
  assert.doesNotMatch(longerLater[0], /data-gloss="0"/);
  const longerFirst = glossLines(['琼楼玉宇，高处不胜寒'], [{ term: '琼楼玉宇' }, { term: '玉宇' }]);
  assert.match(longerFirst[0], /data-gloss="0">琼楼玉宇<\/span>/);
  assert.doesNotMatch(longerFirst[0], /data-gloss="1"/);
});

test('daily seed is deterministic per local date', () => {
  const a = seededRandom('qingxin:2026-09-15');
  const b = seededRandom('qingxin:2026-09-15');
  const c = seededRandom('qingxin:2026-09-16');
  const first = [a(), a(), a()];
  assert.deepEqual([b(), b(), b()], first);
  assert.notDeepEqual([c(), c(), c()], first);
  first.forEach((n) => assert.ok(n >= 0 && n < 1));
  assert.equal(localDateKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});

test('route hrefs encode each path segment and a sorted query', () => {
  assert.equal(hashPath('author/李白'), 'author/%E6%9D%8E%E7%99%BD');
  assert.equal(hrefFor('list/0', { q: '春风', empty: '' }), '#/list/0?q=%E6%98%A5%E9%A3%8E');
  assert.equal(hrefFor('home'), '#/home');
});

test('line search hits render the matched line as a highlighted excerpt', () => {
  const exact = searchRow(['c59-66', '水调歌头·明月几时有', '苏轼', {
    field: 'line', type: 'substring', distance: 0, start: 0, length: 5, line: '但愿人长久，千里共婵娟。',
  }], '但愿人长久');
  assert.match(exact, /poem-list__excerpt"><mark class="search-match">但愿人长久<\/mark>，千里共婵娟。/);
  assert.doesNotMatch(exact, /poem-list__title"><mark/);

  const variant = searchRow(['t8-125', '静夜思', '李白', {
    field: 'line', type: 'fuzzy', distance: 1, start: -1, length: 0, line: '床前看月光，疑是地上霜。',
  }], '床前明月光');
  assert.match(variant, /床前看月光/);
  assert.doesNotMatch(variant, /<mark/);
});

test('collapsible sections carry section ids, open state and empty markers', () => {
  const empty = proseEntry('译文', 'iii', [], false, { section: 'translation', open: true });
  assert.match(empty, /data-section="translation"/);
  assert.match(empty, /entry--collapsed/);
  assert.match(empty, /entry-head__empty">未收录</);

  const open = proseEntry('译文', 'iii', ['一段译文'], false, { section: 'translation', open: true });
  assert.doesNotMatch(open, /entry--collapsed/);
  assert.match(open, /aria-expanded="true"/);
  assert.doesNotMatch(open, /未收录/);

  assert.match(entryShell('关于', 'i', '<p></p>'), /^<section class="section entry"><div class="entry-head">/);
});

test('pager uses real links and stanza grouping keeps paragraph indices', () => {
  const pager = pagerHTML('authors', 2, 3);
  assert.match(pager, /<a class="pager__btn" href="#\/authors\/0" data-nav="authors\/0">«<\/a>/);
  assert.match(pager, /<span class="pager__btn pager__btn--off">»<\/span>/);
  assert.deepEqual(groupStanzas(['a', '', 'b', 'c'], (line, i) => line + i), [['a0'], ['b2', 'c3']]);
});
