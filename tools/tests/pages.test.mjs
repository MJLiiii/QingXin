/* pages.js 的纯函数部件：诗文页原文 / 工具栏 / 注释行（第 k 个 .gloss 对应第 k 个 .notes__row，
   reader.js 按下标取释义，错位即静默错释义）、今日一诗选取（含天气子池）、AI 免责文案。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { WEATHER_MIN_POOL, aiNotice, notesHTML, pickFeatured, poemParts, weatherPool } from '../../assets/js/pages.js';

const count = (html, re) => (html.match(re) || []).length;
const lines = (n) => Array.from({ length: n }, (_, i) => `第${i + 1}句。`);

test('vertical reading is offered up to 60 lines and dropped above', () => {
  const short = poemParts({ paragraphs: lines(60) }, {});
  assert.equal(short.longPoem, false);
  assert.match(short.tools, /data-action="vertical"/);
  assert.doesNotMatch(short.original, /original__body--long/);

  const long = poemParts({ paragraphs: lines(61) }, {});
  assert.equal(long.longPoem, true);
  assert.doesNotMatch(long.tools, /data-action="vertical"/);
  assert.match(long.original, /original__body--long/);
  for (const parts of [short, long]) {
    assert.match(parts.tools, /role="toolbar"[\s\S]*role="status"[\s\S]*data-action="copy"[\s\S]*data-action="share"[\s\S]*data-action="scale-down"[\s\S]*data-action="scale-up"/);
  }
});

test('the preface is gloss line 0, body glosses keep their note index, and rows match', () => {
  const ann = {
    preface: '丙辰中秋，欢饮达旦。',
    // 第 0 条在原文里不存在：其后两条的 data-gloss 必须仍是它们在 notes 里的下标（1、2），不能顺位补上。
    notes: [{ term: '无此词', def: '不出现' }, { term: '丙辰', def: '年份' }, { term: '婵娟', def: '明月' }],
  };
  const poem = { paragraphs: ['明月几时有，把酒问青天。', '但愿人长久，千里共婵娟。'] };
  const parts = poemParts(poem, ann);
  assert.equal(parts.hasNotes, true);
  assert.equal(parts.notes, ann.notes);
  assert.match(parts.original, /^<div class="original"><div class="original__preface"><span class="badge">词序<\/span><br>/);
  assert.match(parts.original, /data-gloss="1">丙辰<\/span>中秋/);
  assert.match(parts.original, /千里共<span class="gloss"[^>]*data-gloss="2">婵娟<\/span>/);
  assert.doesNotMatch(parts.original, /data-gloss="0"/);
  // 第 k 个 .gloss 对应第 k 个 .notes__row（reader.js 按下标取）：行序必须与 notes 一致，不能只留命中的。
  const rows = notesHTML(parts.notes);
  const terms = [...rows.matchAll(/notes__term">([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(terms, ['无此词', '丙辰', '婵娟']);
  assert.match(rows, /notes__term">丙辰<\/div><div class="notes__def">年份</);
});

test('empty note entries count as no notes and render the placeholder', () => {
  const parts = poemParts({ paragraphs: ['床前明月光'] }, { notes: [{ term: '', def: '' }] });
  assert.equal(parts.hasNotes, false);
  assert.deepEqual(parts.notes, []);
  assert.doesNotMatch(parts.original, /data-gloss/);
  assert.equal(notesHTML(parts.notes), '<div class="notes"><p class="prose--faint">尚未收录，敬请期待。</p></div>');
});

// 原文整串 golden：每句一个 .original__line 块（折行时悬挂缩进），空行分节，文本已转义。
test('original text wraps each line in a block, groups stanzas on blank lines and escapes text', () => {
  const parts = poemParts({ paragraphs: ['床前明月光，', '疑是地上霜。', '', '举头望<明月>，', '低头思故乡。'] }, {});
  assert.equal(parts.original,
    '<div class="original"><div class="original__body">'
    + '<p class="original__stanza"><span class="original__line">床前明月光，</span><span class="original__line">疑是地上霜。</span></p>'
    + '<p class="original__stanza"><span class="original__line">举头望&lt;明月&gt;，</span><span class="original__line">低头思故乡。</span></p>'
    + '</div></div>');
  assert.deepEqual(parts.paragraphs, ['床前明月光，', '疑是地上霜。', '', '举头望<明月>，', '低头思故乡。']);
});

test('the AI notice appears only for ai-sourced annotations', () => {
  assert.match(aiNotice({ source: 'ai' }), /AI 生成/);
  assert.equal(aiNotice({ source: 'gushiwen-web' }), '');
  assert.equal(aiNotice({}), '');
  assert.match(notesHTML([{ term: 'a', def: 'b' }]), /^<div class="notes"><div class="notes__row">/);
});

test('the daily pick is stable within a day, the shuffle is not, and the hero has an excerpt', () => {
  const entries = Array.from({ length: 40 }, (_, i) => ({ id: `t0-${i}`, title: `题${i}`, excerpt: i % 3 === 0 ? '' : `句${i}` }));
  const a = pickFeatured(entries, true);
  const b = pickFeatured(entries, true);
  assert.deepEqual(a, b);
  assert.deepEqual([...a.pick].sort((x, y) => x.id.localeCompare(y.id)), [...entries].sort((x, y) => x.id.localeCompare(y.id)));
  assert.equal(a.hero, a.pick.find((e) => e.excerpt));
  const random = pickFeatured(entries, false);
  assert.equal(random.pick.length, entries.length);
  assert.notDeepEqual(random.pick.map((e) => e.id), a.pick.map((e) => e.id));
  assert.ok(random.hero.excerpt);

  const bare = [{ id: 'x', title: 'a' }, { id: 'y', title: 'b' }];
  const none = pickFeatured(bare, true);
  assert.equal(none.hero, none.pick[0]);
  assert.deepEqual(pickFeatured([], true), { pick: [], hero: undefined });
});

test('a weather salt gives a different but equally stable daily pick', () => {
  const entries = Array.from({ length: 40 }, (_, i) => ({ id: `t0-${i}`, title: `题${i}`, excerpt: `句${i}` }));
  const plain = pickFeatured(entries, true);
  const rain = pickFeatured(entries, true, 'rain');
  assert.deepEqual(pickFeatured(entries, true, 'rain'), rain);
  assert.deepEqual(pickFeatured(entries, true, ''), plain);
  assert.notDeepEqual(rain.pick.map((e) => e.id), plain.pick.map((e) => e.id));
  assert.notDeepEqual(pickFeatured(entries, true, 'snow').pick.map((e) => e.id), rain.pick.map((e) => e.id));
});

test('the weather pool is the first tag with enough featured poems, else null', () => {
  const entries = Array.from({ length: 30 }, (_, i) => ({ id: `t0-${i}` }));
  const ids = (from, n) => Array.from({ length: n }, (_, i) => `t0-${from + i}`);
  const index = {
    tags: {
      heat: ids(0, WEATHER_MIN_POOL - 1), // 太少
      wind: [...ids(0, WEATHER_MIN_POOL - 1), 'c9-9'], // 凑够了个数，但有一首不在推荐池里
      clear: ids(10, WEATHER_MIN_POOL),
      moon: ids(0, 20),
    },
  };
  const got = weatherPool(entries, index, ['heat', 'wind', 'fog', 'clear', 'moon']);
  assert.equal(got.tag, 'clear');
  assert.deepEqual(got.pool.map((e) => e.id), ids(10, WEATHER_MIN_POOL));
  assert.equal(weatherPool(entries, index, ['heat', 'wind']), null);
  assert.equal(weatherPool(entries, null, ['moon']), null);
  assert.equal(weatherPool(entries, {}, ['moon']), null);
});
