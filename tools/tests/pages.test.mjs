/* pages.js 的纯函数部件：诗文页原文 / 工具栏 / 注释行（第 k 个 .gloss 对应第 k 个 .notes__row，
   reader.js 按下标取释义，错位即静默错释义）、今日一诗选取、AI 免责文案。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { aiNotice, notesHTML, pickFeatured, poemParts } from '../../assets/js/pages.js';

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
    notes: [{ term: '丙辰', def: '年份' }, { term: '婵娟', def: '明月' }, { term: '无此词', def: '不出现' }],
  };
  const poem = { paragraphs: ['明月几时有，把酒问青天。', '但愿人长久，千里共婵娟。'] };
  const parts = poemParts(poem, ann);
  assert.equal(parts.hasNotes, true);
  assert.equal(parts.notes, ann.notes);
  assert.match(parts.original, /^<div class="original"><div class="original__preface"><span class="badge">词序<\/span><br>/);
  assert.match(parts.original, /data-gloss="0">丙辰<\/span>中秋/);
  assert.match(parts.original, /千里共<span class="gloss"[^>]*data-gloss="1">婵娟<\/span>/);
  assert.doesNotMatch(parts.original, /data-gloss="2"/);
  const rows = notesHTML(ann, parts.notes, false);
  assert.equal(count(rows, /class="notes__row"/g), parts.notes.length);
  assert.match(rows, /notes__term">丙辰<\/div><div class="notes__def">年份</);
});

test('empty note entries count as no notes and render the placeholder', () => {
  const parts = poemParts({ paragraphs: ['床前明月光'] }, { notes: [{ term: '', def: '' }] });
  assert.equal(parts.hasNotes, false);
  assert.deepEqual(parts.notes, []);
  assert.doesNotMatch(parts.original, /data-gloss/);
  assert.equal(notesHTML({}, parts.notes, false), '<div class="notes"><p class="prose--faint">尚未收录，敬请期待。</p></div>');
});

// 原文整串 golden —— 归 D1（poemParts 直接输出 .original__line）维护：改输出时同 commit 更新。
test('original text groups stanzas on blank lines and escapes text', () => {
  const parts = poemParts({ paragraphs: ['床前明月光，', '疑是地上霜。', '', '举头望<明月>，', '低头思故乡。'] }, {});
  assert.equal(parts.original,
    '<div class="original"><div class="original__body">'
    + '<p class="original__stanza">床前明月光，<br>疑是地上霜。</p>'
    + '<p class="original__stanza">举头望&lt;明月&gt;，<br>低头思故乡。</p>'
    + '</div></div>');
  assert.deepEqual(parts.paragraphs, ['床前明月光，', '疑是地上霜。', '', '举头望<明月>，', '低头思故乡。']);
});

test('the AI notice appears only for ai-sourced annotations', () => {
  assert.match(aiNotice({ source: 'ai' }), /AI 生成/);
  assert.equal(aiNotice({ source: 'gushiwen-web' }), '');
  assert.equal(aiNotice({}), '');
  assert.match(notesHTML({ source: 'ai' }, [{ term: 'a', def: 'b' }], true), /^<div class="notes"><p class="prose--faint">/);
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
