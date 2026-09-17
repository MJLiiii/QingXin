import test from 'node:test';
import assert from 'node:assert/strict';
import {
  candidateBodies,
  cleanLine,
  dice,
  matchToCorpus,
  normAuthor,
  normText,
  normTitle,
  parseNotes,
  parseTranslation,
  splitParas,
  cacheKeyForAuthor,
  eligibleAuthor,
} from '../annotations/annotate-lib.mjs';

test('normText strips variant parentheticals, punctuation, ▲ and full-width spaces', () => {
  assert.equal(normText('明月几时有(何似 一作：何时)，把酒问青天。'), '明月几时有把酒问青天');
  assert.equal(normText('举杯邀明月（尊 通：樽）'), '举杯邀明月');
  assert.equal(normText('对影成三人（一本作:三人对影）'), '对影成三人');
  assert.equal(normText('▲床前明月光　，疑是地上霜。\n举头望明月 低头思故乡'), '床前明月光疑是地上霜举头望明月低头思故乡');
  assert.equal(normText('「山」『水』《诗》〈词〉…—－-[a]<b>"c"'), '山水诗词abc');
  assert.equal(normText('阑（lán）'), '阑lán');
  assert.equal(normText(null), '');
  assert.equal(normText(''), '');
});

test('normAuthor drops trailing digits, trims and folds anonymous names', () => {
  assert.equal(normAuthor('吴氏3'), '吴氏');
  assert.equal(normAuthor('吴氏１２'), '吴氏');
  assert.equal(normAuthor('  李白\t'), '李白');
  assert.equal(normAuthor('李三'), '李三');
  assert.equal(normAuthor('佚名'), '无名氏');
  assert.equal(normAuthor('无名'), '无名氏');
  assert.equal(normAuthor('无名氏'), '无名氏');
  assert.equal(normAuthor(''), '无名氏');
  assert.equal(normAuthor('   '), '无名氏');
  assert.equal(normAuthor(null), '无名氏');
  assert.equal(normAuthor('佚名2'), '无名氏');
});

test('normTitle splits alternatives, drops parentheticals and trailing ·其N', () => {
  assert.deepEqual(normTitle('琵琶行 / 琵琶引'), ['琵琶行', '琵琶引']);
  assert.deepEqual(normTitle('琵琶行/琵琶引'), ['琵琶行', '琵琶引']);
  assert.deepEqual(normTitle('秋浦歌·其十五'), ['秋浦歌']);
  assert.deepEqual(normTitle('秋浦歌·其3'), ['秋浦歌']);
  assert.deepEqual(normTitle('静夜思（一作夜思）'), ['静夜思']);
  assert.deepEqual(normTitle('送友人(并序)·其一 / 送友'), ['送友人', '送友']);
  assert.deepEqual(normTitle('相和歌辞·其一 / '), ['相和歌辞']);
  assert.deepEqual(normTitle('（）'), []);
  assert.deepEqual(normTitle(''), []);
  assert.deepEqual(normTitle(null), []);
});

test('dice is 1 for identical, 0 for disjoint or short strings, and counts bigram multiplicity', () => {
  assert.equal(dice('床前明月光', '床前明月光'), 1);
  assert.equal(dice('甲乙丙丁', '戊己庚辛'), 0);
  assert.equal(dice('甲', '甲'), 1);
  assert.equal(dice('甲', '乙'), 0);
  assert.equal(dice('甲', '甲乙'), 0);
  assert.equal(dice('', '甲乙'), 0);
  assert.equal(dice('甲乙', null), 0);
  /* 床前|前明|明月|月光 vs 举头|头望|望明|明月 — one shared bigram of 4 + 4 */
  assert.equal(dice('床前明月光', '举头望明月'), 0.25);
  /* 4 bigrams all inside the 5 of the longer string */
  assert.equal(dice('春眠不觉晓', '春眠不觉晓处'), 8 / 9);
  /* 明月 appears twice in a, once in b: hit only once */
  assert.equal(dice('明月明月', '明月'), 0.5);
  assert.equal(dice('举头望明月', '床前明月光'), 0.25); // symmetric with the assertion above
});

test('candidateBodies offers the full text and, with several blocks, a preface-less body', () => {
  assert.deepEqual(candidateBodies(['床前明月光']), [{ text: '床前明月光', preface: null }]);
  assert.deepEqual(candidateBodies(['丙辰中秋', '明月几时有', '不知天上宫阙']), [
    { text: '丙辰中秋\n明月几时有\n不知天上宫阙', preface: null },
    { text: '明月几时有\n不知天上宫阙', preface: '丙辰中秋' },
  ]);
});

test('cleanLine removes ▲, a glued short 《title》 head and surrounding whitespace', () => {
  assert.equal(cleanLine('▲床前明月光▲'), '床前明月光');
  assert.equal(cleanLine('《核舟记》 　　苏东坡的词'), '苏东坡的词');
  assert.equal(cleanLine('《核舟记》　文'), '文');
  assert.equal(cleanLine('《一二三四五六七八九十一二》　正文'), '正文');
  assert.equal(cleanLine('《一二三四五六七八九十一二三》　正文'), '《一二三四五六七八九十一二三》　正文');
  assert.equal(cleanLine('《核舟记》正文'), '《核舟记》正文');
  assert.equal(cleanLine('《核舟记》 正文'), '《核舟记》 正文');
  assert.equal(cleanLine('　　正文　　'), '正文');
  assert.equal(cleanLine('  正\t文\t'), '正\t文');
  assert.equal(cleanLine('▲　'), '');
});

test('splitParas splits on newlines, cleans each line and drops empties', () => {
  assert.deepEqual(splitParas('第一段\n\n▲第二段\n　　\n《序》　第三段\n'), ['第一段', '第二段', '第三段']);
  assert.deepEqual(splitParas('甲\r\n\r\n乙\r\n'), ['甲', '乙']);
  assert.deepEqual(splitParas(''), []);
  assert.deepEqual(splitParas(null), []);
});

test('parseNotes splits term:def on either colon and appends continuation lines', () => {
  assert.deepEqual(parseNotes('青天：蓝天。\n把酒: 端起酒杯。'), [
    { term: '青天', def: '蓝天。' },
    { term: '把酒', def: '端起酒杯。' },
  ]);
  assert.deepEqual(parseNotes('宫阙：宫殿。\n▲　　指月宫。\n\n琼楼：美玉砌的楼。'), [
    { term: '宫阙', def: '宫殿。指月宫。' },
    { term: '琼楼', def: '美玉砌的楼。' },
  ]);
  assert.deepEqual(parseNotes('甲：乙：丙'), [{ term: '甲', def: '乙：丙' }]);
  assert.deepEqual(parseNotes('  婵娟 ：  月亮。  '), [{ term: '婵娟', def: '月亮。' }]);
});

test('parseNotes drops entries without a definition and stray lines before the first term', () => {
  assert.deepEqual(parseNotes('没有冒号的开头\n青天：蓝天。'), [{ term: '青天', def: '蓝天。' }]);
  assert.deepEqual(parseNotes('孤词：\n'), []);
  assert.deepEqual(parseNotes('孤词：\n续行补上释义'), [{ term: '孤词', def: '续行补上释义' }]);
  assert.deepEqual(parseNotes('：只有释义'), []);
  assert.deepEqual(parseNotes(''), []);
  assert.deepEqual(parseNotes(null), []);
});

test('parseNotes limits a term to 30 characters', () => {
  const term30 = '一'.repeat(30);
  assert.deepEqual(parseNotes(term30 + '：释义'), [{ term: term30, def: '释义' }]);
  assert.deepEqual(parseNotes('一'.repeat(31) + '：释义'), []);
  assert.deepEqual(parseNotes('青天：蓝天。\n' + '一'.repeat(31) + '：释义'), [
    { term: '青天', def: '蓝天。' + '一'.repeat(31) + '：释义' },
  ]);
});

test('parseTranslation keeps the paragraphs and cuts alternative renderings from their label', () => {
  assert.deepEqual(parseTranslation('第一段\n\n▲第二段', false), {
    prefaceTranslation: '',
    translation: ['第一段', '第二段'],
  });
  assert.deepEqual(parseTranslation('第一段\n第二段\n韵译\n韵译一\n韵译二', false), {
    prefaceTranslation: '',
    translation: ['第一段', '第二段'],
  });
  assert.deepEqual(parseTranslation('第一段\n（意译）：\n意译一', false).translation, ['第一段']);
  assert.deepEqual(parseTranslation('第一段\n【直译】\n直译一', false).translation, ['第一段']);
  assert.deepEqual(parseTranslation('第一段\n[韵意译]:\n韵意译一', false).translation, ['第一段']);
  assert.deepEqual(parseTranslation('第一段\n韵译如下\n第三段', false).translation, ['第一段', '韵译如下', '第三段']);
  assert.deepEqual(parseTranslation('', false), { prefaceTranslation: '', translation: [] });
  assert.deepEqual(parseTranslation(null, false), { prefaceTranslation: '', translation: [] });
});

test('parseTranslation skips a leading label and stops at the next one', () => {
  assert.deepEqual(parseTranslation('意译\n意译一\n意译二\n（韵译）\n韵译一', false).translation, ['意译一', '意译二']);
  assert.deepEqual(parseTranslation('【直译】：\n甲\n乙', false).translation, ['甲', '乙']);
  assert.deepEqual(parseTranslation('韵译', false).translation, []);
  assert.deepEqual(parseTranslation('韵译\n意译\n甲', false).translation, []);
});

test('parseTranslation moves the first paragraph to prefaceTranslation for prefaced poems', () => {
  assert.deepEqual(parseTranslation('序的译文\n正文译一\n正文译二', true), {
    prefaceTranslation: '序的译文',
    translation: ['正文译一', '正文译二'],
  });
  assert.deepEqual(parseTranslation('序的译文\n正文译一\n韵译\n韵译一', true), {
    prefaceTranslation: '序的译文',
    translation: ['正文译一'],
  });
  assert.deepEqual(parseTranslation('只有一段', true), { prefaceTranslation: '', translation: ['只有一段'] });
  assert.deepEqual(parseTranslation('序的译文\n正文译一', false), {
    prefaceTranslation: '',
    translation: ['序的译文', '正文译一'],
  });
});

/* Mirrors the index loadQingxinIndex builds (annotate-lib.mjs, the per-poem body of its loop)
   from an inline poem list instead of data/poems: the same entry fields
   (id, title, titleNorms, author, rawAuthor, kind, paras, normFull), the same
   "author|first 12 normalized chars" byKey formula, byAuthor, byId and a per-entry total. */
function makeIdx(poems) {
  const byKey = new Map();
  const byAuthor = new Map();
  const byId = new Map();
  let total = 0;
  for (const p of poems) {
    const paras = p.paragraphs || [];
    const normFull = normText(paras.join(''));
    if (!normFull) continue;
    const entry = {
      id: p.id,
      title: p.title || '',
      titleNorms: normTitle(p.title || ''),
      author: normAuthor(p.author),
      rawAuthor: p.author || '',
      kind: p.kind,
      paras,
      normFull,
    };
    const key = entry.author + '|' + normFull.slice(0, 12);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(entry);
    if (!byAuthor.has(entry.author)) byAuthor.set(entry.author, []);
    byAuthor.get(entry.author).push(entry);
    byId.set(entry.id, entry);
    total++;
  }
  return { byKey, byAuthor, byId, total };
}

const JINGYESI = ['床前明月光，疑是地上霜。', '举头望明月，低头思故乡。'];
const JINGYESI_NORM = '床前明月光疑是地上霜举头望明月低头思故乡';
const LIBAI_IDX = () =>
  makeIdx([
    { id: 't1-1', title: '静夜思', author: '李白', kind: '诗', paragraphs: JINGYESI },
    { id: 't1-2', title: '怨情', author: '李白', kind: '诗', paragraphs: ['美人卷珠帘，深坐颦蛾眉。', '但见泪痕湿，不知心恨谁。'] },
    { id: 't2-1', title: '春晓', author: '孟浩然', kind: '诗', paragraphs: ['春眠不觉晓，处处闻啼鸟。', '夜来风雨声，花落知多少。'] },
  ]);

test('makeIdx keys entries by normalized author and the first 12 normalized characters', () => {
  const idx = makeIdx([{ id: 'x1', title: '古诗', author: '佚名2', kind: '诗', paragraphs: JINGYESI }]);
  const e = idx.byId.get('x1');
  assert.equal(e.normFull, JINGYESI_NORM);
  assert.equal(e.rawAuthor, '佚名2');
  assert.deepEqual(idx.byKey.get('无名氏|' + JINGYESI_NORM.slice(0, 12)), [e]);
  assert.deepEqual(idx.byAuthor.get('无名氏'), [e]);
});

test('matchToCorpus Tier A: same author and first 12 normalized chars, Dice ≥ 0.75', () => {
  const idx = LIBAI_IDX();
  /* the variant sits after the 12th character, so the exact key still hits */
  const blocks = ['床前明月光，疑是地上霜。', '举头望山月，低头思故乡。'];
  const norm = normText(blocks.join('\n'));
  assert.equal(norm.slice(0, 12), JINGYESI_NORM.slice(0, 12));
  const s = dice(norm, JINGYESI_NORM);
  assert.equal(s, 34 / 38);
  assert.ok(s >= 0.75 && s < 0.9);

  const res = matchToCorpus({ title: '静夜思', author: '李白 ', blocks }, idx);
  assert.equal(res.matches.length, 1);
  const [m] = res.matches;
  assert.equal(m.entry.id, 't1-1');
  assert.equal(m.tier, 'A');
  assert.equal(m.score, s);
  assert.equal(m.preface, null);

  const exact = matchToCorpus({ title: '夜思', author: '李白', blocks: JINGYESI }, idx);
  assert.equal(exact.matches[0].score, 1);
  assert.equal(exact.matches[0].tier, 'A');
});

test('matchToCorpus Tier A: a named author needs Dice ≥ 0.75, and Tier B does not rescue a Tier A miss', () => {
  const idx = LIBAI_IDX();
  /* two variants after the 12th character: the key still hits, the score drops to 0.789 */
  const near = ['床前明月光，疑是地上霜。', '举头望山月，低头忆故乡。'];
  assert.equal(normText(near.join('\n')).slice(0, 12), JINGYESI_NORM.slice(0, 12));
  assert.equal(dice(normText(near.join('\n')), JINGYESI_NORM), 30 / 38);
  const res = matchToCorpus({ title: '别的题目', author: '李白', blocks: near }, idx);
  assert.equal(res.matches.length, 1);
  assert.equal(res.matches[0].entry.id, 't1-1');
  assert.equal(res.matches[0].tier, 'A');
  assert.equal(res.matches[0].score, 30 / 38);

  /* three variants: 0.737 < 0.75 — Tier A refuses, and Tier B then needs a title hit */
  const below = ['床前明月光，疑是地上霜。', '举头望山月，低头忆他乡。'];
  assert.equal(dice(normText(below.join('\n')), JINGYESI_NORM), 28 / 38);
  assert.deepEqual(matchToCorpus({ title: '别的题目', author: '李白', blocks: below }, idx), { matches: [] });
  const viaB = matchToCorpus({ title: '静夜思', author: '李白', blocks: below }, idx);
  assert.equal(viaB.matches[0].tier, 'B');
  assert.equal(viaB.matches[0].score, 28 / 38);
});

test('matchToCorpus: anonymous authors only get Tier A and need Dice ≥ 0.90', () => {
  const idx = makeIdx([
    { id: 't0-1', title: '古诗', author: '佚名', kind: '诗', paragraphs: JINGYESI },
  ]);
  assert.ok(idx.byAuthor.has('无名氏'));
  const blocks = ['床前明月光，疑是地上霜。', '举头望山月，低头思故乡。'];
  const s = dice(normText(blocks.join('\n')), JINGYESI_NORM);
  assert.equal(s, 34 / 38);
  /* would pass Tier A for a named author (≥ 0.75) and Tier B (≥ 0.85), but not the anonymous 0.90 */
  assert.ok(s >= 0.85 && s < 0.9);
  assert.deepEqual(matchToCorpus({ title: '古诗', author: '无名', blocks }, idx), { matches: [] });
  assert.deepEqual(matchToCorpus({ title: '古诗', author: '', blocks }, idx), { matches: [] });

  /* one variant in the last character: 0.947 clears 0.90 but would not clear 0.95 */
  const close = ['床前明月光，疑是地上霜。', '举头望明月，低头思故里。'];
  const sc = dice(normText(close.join('\n')), JINGYESI_NORM);
  assert.equal(sc, 36 / 38);
  assert.ok(sc >= 0.9 && sc < 0.95);
  const hit = matchToCorpus({ title: '古诗', author: '佚名', blocks: close }, idx);
  assert.equal(hit.matches.length, 1);
  assert.equal(hit.matches[0].entry.id, 't0-1');
  assert.equal(hit.matches[0].tier, 'A');
  assert.equal(hit.matches[0].score, sc);
});

test('matchToCorpus Tier B: a same-author fuzzy scan when the first 12 chars differ, Dice ≥ 0.85', () => {
  const idx = LIBAI_IDX();
  const blocks = ['床前看月光，疑是地上霜。', '举头望明月，低头思故乡。'];
  const norm = normText(blocks.join('\n'));
  assert.notEqual(norm.slice(0, 12), JINGYESI_NORM.slice(0, 12));
  assert.equal(idx.byKey.get('李白|' + norm.slice(0, 12)), undefined);
  const s = dice(norm, JINGYESI_NORM);
  assert.equal(s, 34 / 38);
  assert.ok(s >= 0.85);
  /* 怨情 shares no bigram with the record: the runner-up is far outside the 0.05 window */
  assert.equal(dice(norm, idx.byId.get('t1-2').normFull), 0);

  const res = matchToCorpus({ title: '别的题目', author: '李白', blocks }, idx);
  assert.equal(res.matches.length, 1);
  assert.equal(res.matches[0].entry.id, 't1-1');
  assert.equal(res.matches[0].tier, 'B');
  assert.equal(res.matches[0].score, s);
  assert.equal(res.matches[0].preface, null);

  /* a second variant drops the score to 0.842: below 0.85, so a title-less record is refused */
  const under = ['床前看月光，疑是地上霜。', '举头望明月，低头思故里。'];
  const normUnder = normText(under.join('\n'));
  assert.equal(idx.byKey.get('李白|' + normUnder.slice(0, 12)), undefined);
  assert.equal(dice(normUnder, JINGYESI_NORM), 32 / 38);
  assert.deepEqual(matchToCorpus({ title: '别的题目', author: '李白', blocks: under }, idx), { matches: [] });
});

test('matchToCorpus Tier B: a 0.70–0.85 score is accepted only with a title hit', () => {
  const idx = LIBAI_IDX();
  const blocks = ['床前看月光，疑是地上霜。', '举头望山月，低头思故乡。'];
  const norm = normText(blocks.join('\n'));
  assert.notEqual(norm.slice(0, 12), JINGYESI_NORM.slice(0, 12));
  const s = dice(norm, JINGYESI_NORM);
  assert.equal(s, 30 / 38);
  assert.ok(s >= 0.7 && s < 0.85);

  assert.deepEqual(matchToCorpus({ title: '别的题目', author: '李白', blocks }, idx), { matches: [] });

  const res = matchToCorpus({ title: '夜思 / 静夜思（一作）', author: '李白', blocks }, idx);
  assert.equal(res.matches.length, 1);
  assert.equal(res.matches[0].entry.id, 't1-1');
  assert.equal(res.matches[0].tier, 'B');
  assert.equal(res.matches[0].score, s);
});

/* 28-character bodies: the dice granularity (2/54 ≈ 0.037) is finer than the 0.05 window,
   so the runner-up sits at a real, ordered distance from the best instead of an exact tie. */
test('matchToCorpus gives up when a runner-up is within 0.05 of the best', () => {
  const idx = makeIdx([
    { id: 'p1', title: '早发白帝城', author: '李白', kind: '诗', paragraphs: ['朝辞白帝彩云中，千里江陵一日还。', '两岸猿声啼不住，轻舟已过万重天。'] },
    { id: 'p2', title: '白帝城', author: '李白', kind: '诗', paragraphs: ['朝辞白帝彩霞间，千里江陵一日还。', '两岸猿声鸣不住，轻舟已过万重山。'] },
  ]);
  const blocks = ['朝辞白帝彩云间，千里江陵一日还。', '两岸猿声啼不住，轻舟已过万重山。'];
  const norm = normText(blocks.join('\n'));
  assert.equal(idx.byKey.get('李白|' + norm.slice(0, 12)), undefined);
  assert.equal(dice(norm, idx.byId.get('p1').normFull), 48 / 54); // 0.889, best
  assert.equal(dice(norm, idx.byId.get('p2').normFull), 46 / 54); // 0.852, runner: gap 0.037 ≤ 0.05
  assert.equal(dice(idx.byId.get('p1').normFull, idx.byId.get('p2').normFull), 42 / 54); // 0.778 < 0.80: not 重出

  const res = matchToCorpus({ title: '早发白帝城', author: '李白', blocks }, idx);
  assert.equal(res.matches, undefined);
  assert.deepEqual(res.ambiguous, {
    title: '早发白帝城',
    writer: '李白',
    best: { id: 'p1', title: '早发白帝城', score: 0.889 },
    runner: { id: 'p2', title: '白帝城', score: 0.852 },
  });
});

test('matchToCorpus keeps the best match when the runner-up is more than 0.05 behind', () => {
  const idx = makeIdx([
    { id: 'p1', title: '早发白帝城', author: '李白', kind: '诗', paragraphs: ['朝辞白帝彩云中，千里江陵一日还。', '两岸猿声啼不住，轻舟已过万重天。'] },
    { id: 'p4', title: '白帝城', author: '李白', kind: '诗', paragraphs: ['朝别白帝彩云间，千里江水一日还。', '两岸猿声鸣不住，轻舟已过万重山。'] },
  ]);
  const blocks = ['朝辞白帝彩云间，千里江陵一日还。', '两岸猿声啼不住，轻舟已过万重山。'];
  const norm = normText(blocks.join('\n'));
  assert.equal(idx.byKey.get('李白|' + norm.slice(0, 12)), undefined);
  assert.equal(dice(norm, idx.byId.get('p1').normFull), 48 / 54); // 0.889
  assert.equal(dice(norm, idx.byId.get('p4').normFull), 42 / 54); // 0.778: gap 0.111 > 0.05
  assert.equal(dice(idx.byId.get('p1').normFull, idx.byId.get('p4').normFull), 36 / 54); // 0.667 < 0.80

  const res = matchToCorpus({ title: '早发白帝城', author: '李白', blocks }, idx);
  assert.deepEqual(res.matches.map((m) => m.entry.id), ['p1']);
  assert.equal(res.matches[0].tier, 'B');
  assert.equal(res.matches[0].score, 48 / 54);
});

test('matchToCorpus accepts every copy of a re-collected poem instead of calling it ambiguous', () => {
  const idx = makeIdx([
    { id: 't1-1', title: '静夜思', author: '李白', kind: '诗', paragraphs: JINGYESI },
    { id: 't9-9', title: '夜思', author: '李白', kind: '诗', paragraphs: ['床前明月光，疑是地上霜。', '举头望山月，低头思故乡。'] },
  ]);
  /* the two corpus copies differ by one 异文 character — still ≥ 0.80, so not ambiguous */
  assert.equal(dice(idx.byId.get('t1-1').normFull, idx.byId.get('t9-9').normFull), 34 / 38);
  /* the record is equidistant from both copies and misses both keys */
  const blocks = ['床前看月光，疑是地上霜。', '举头望海月，低头思故乡。'];
  const norm = normText(blocks.join('\n'));
  assert.equal(idx.byKey.get('李白|' + norm.slice(0, 12)), undefined);
  assert.equal(dice(norm, idx.byId.get('t1-1').normFull), 30 / 38);
  assert.equal(dice(norm, idx.byId.get('t9-9').normFull), 30 / 38);
  const res = matchToCorpus({ title: '静夜思 / 夜思', author: '李白', blocks }, idx);
  assert.deepEqual(res.matches.map((m) => [m.entry.id, m.tier, m.score]), [
    ['t1-1', 'B', 30 / 38],
    ['t9-9', 'B', 30 / 38],
  ]);
});

/* The 0.6–1.5 (Tier A) and 0.5–2 (Tier B) length-ratio windows are pure short-circuits: at any ratio
   outside them the best attainable Dice is already below the matching floor, so they cannot be
   observed through matchToCorpus and are intentionally untested. */
test('matchToCorpus matches a prefaced record through its preface-less body', () => {
  const body = ['明月几时有？把酒问青天。', '不知天上宫阙，今夕是何年。'];
  const idx = makeIdx([
    { id: 'c59-66', title: '水调歌头·丙辰中秋', author: '苏轼', kind: '词', paragraphs: body },
  ]);
  const preface = '丙辰中秋，欢饮达旦，大醉，作此篇，兼怀子由。';
  const blocks = [preface, ...body];
  const bodies = candidateBodies(blocks);
  assert.equal(bodies.length, 2);
  const full = normText(bodies[0].text);
  const entry = idx.byId.get('c59-66');
  /* the full text (preface included) misses the key and, at 0.702, also misses the 0.75 floor */
  assert.equal(idx.byKey.get('苏轼|' + full.slice(0, 12)), undefined);
  assert.ok(dice(full, entry.normFull) < 0.75);
  assert.equal(normText(bodies[1].text), entry.normFull);

  const res = matchToCorpus({ title: '水调歌头', author: '苏轼', blocks }, idx);
  assert.equal(res.matches.length, 1);
  const [m] = res.matches;
  assert.equal(m.entry.id, 'c59-66');
  assert.equal(m.tier, 'A');
  assert.equal(m.score, 1);
  assert.equal(m.preface, preface);
});

test('matchToCorpus returns no matches for empty, tiny or unknown-author records', () => {
  const idx = LIBAI_IDX();
  assert.deepEqual(matchToCorpus({ title: '静夜思', author: '李白', blocks: [] }, idx), { matches: [] });
  assert.deepEqual(matchToCorpus({ title: '静夜思', author: '杜甫', blocks: JINGYESI }, idx), { matches: [] });
  assert.deepEqual(matchToCorpus({ title: '春晓', author: '李白', blocks: ['春眠不觉晓，处处闻啼鸟。', '夜来风雨声，花落知多少。'] }, idx), { matches: [] });

  /* the body normalizes to 3 characters — below the 4-character floor — even though it is an exact copy */
  const shortIdx = makeIdx([{ id: 's1', title: '残句', author: '李白', kind: '诗', paragraphs: ['床前明'] }]);
  assert.equal(shortIdx.byId.get('s1').normFull, '床前明');
  assert.deepEqual(matchToCorpus({ title: '残句', author: '李白', blocks: ['床前明'] }, shortIdx), { matches: [] });
  /* one character more clears the floor and matches exactly */
  const okIdx = makeIdx([{ id: 's2', title: '残句', author: '李白', kind: '诗', paragraphs: ['床前明月'] }]);
  assert.equal(matchToCorpus({ title: '残句', author: '李白', blocks: ['床前明月'] }, okIdx).matches[0].score, 1);
});

test('author cache keys are stable resume keys; eligibility skips anonymous and messy names', () => {
  // 磁盘上 5,000+ 个 catalog-author-<key>.json 断点文件按它命名：这些用例是「改了就会重爬」的护栏。
  assert.equal(cacheKeyForAuthor('李白'), '李白');
  assert.equal(cacheKeyForAuthor(' 李白 '), '李白');
  assert.equal(cacheKeyForAuthor('吴氏3'), '吴氏');
  assert.equal(cacheKeyForAuthor('佚名'), '无名氏');
  assert.equal(cacheKeyForAuthor('王氏（女）'), '王氏_女_');
  assert.equal(cacheKeyForAuthor('李白、杜甫'), '李白_杜甫');
  assert.equal(cacheKeyForAuthor('a/b\\c:d'), 'a_b_c_d');

  assert.equal(eligibleAuthor({ name: '李白' }), true);
  assert.equal(eligibleAuthor({ name: '南唐嗣主李璟' }), true);
  assert.equal(eligibleAuthor({ name: '无名氏' }), false);
  assert.equal(eligibleAuthor({ name: '佚名' }), false);
  assert.equal(eligibleAuthor({ name: '不详' }), false);
  assert.equal(eligibleAuthor({ name: '李白、杜甫' }), false);
  assert.equal(eligibleAuthor({ name: '王氏（女）' }), false);
  assert.equal(eligibleAuthor({ name: '吴氏3' }), false); // 原名带数字即跳过（normAuthor 去尾数字只用于键）
});
