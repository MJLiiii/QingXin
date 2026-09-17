/* tools/lib/weather-tags.mjs：推荐池天气标签的词表规则（build-featured.mjs 生成 data/weather.json，validate.mjs 按同一规则复核）。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MIN_SCORE, WEATHER_TAGS, minScore, tagPoem, tagScores, titleText } from '../lib/weather-tags.mjs';

test('every tag is scored, in the shared order', () => {
  assert.deepEqual(Object.keys(tagScores('', '')), WEATHER_TAGS);
  assert.deepEqual(tagPoem('', ''), []);
});

test('a clear weather image is enough, a passing mention is not', () => {
  assert.deepEqual(tagPoem('夜雨寄北', '君问归期未有期，巴山夜雨涨秋池。何当共剪西窗烛，却话巴山夜雨时。'), ['rain']);
  assert.ok(tagPoem('江雪', '千山鸟飞绝，万径人踪灭。孤舟蓑笠翁，独钓寒江雪。').includes('snow'));
  assert.ok(tagPoem('', '床前看月色').includes('moon'));
  assert.deepEqual(tagPoem('', '一雨'), []);
  assert.equal(tagScores('', '雨雨雨').rain, MIN_SCORE);
});

test('long poems need more weather to earn a tag', () => {
  const filler = (n) => '江'.repeat(n);
  assert.equal(minScore('夜雨，'), MIN_SCORE);
  assert.equal(minScore(filler(99) + '，。'), MIN_SCORE);
  assert.equal(minScore(filler(200)), MIN_SCORE + 2);
  assert.deepEqual(tagPoem('', '夜雨' + filler(40)), ['rain']);
  assert.deepEqual(tagPoem('', '五岭炎蒸地' + filler(195)), []);
  assert.deepEqual(tagPoem('', '炎蒸，苦热，' + filler(190)), ['heat']);
});

test('figurative and non-weather uses are excluded', () => {
  assert.equal(tagScores('', '风流风流风流').wind, 0);
  assert.equal(tagScores('', '雨露雨露雨露').rain, 0);
  assert.equal(tagScores('', '鬓如雪，发如雪，白如雪').snow, 0);
  assert.equal(tagScores('', '疑是地上霜').cold, 0);
  assert.equal(tagScores('', '岁月三月正月').moon, 0);
  assert.equal(tagScores('', '绿阴光阴山阴').cloud, 0);
  assert.equal(tagScores('', '春风东风清风').wind, 0);
  assert.equal(tagScores('', '笔落惊风雨').wind, 1);
});

test('short titles weigh triple, long titles (names, places) count once', () => {
  assert.deepEqual(tagPoem('雪', '尽道丰年瑞，丰年事若何。'), ['snow']);
  assert.equal(tagScores('雪', '').snow, 3);
  assert.equal(tagScores('宣州谢朓楼饯别校书叔云', '').cloud, 1);
  assert.equal(tagScores('题李次云窗竹', '').cloud, 1);
});

test('titles lose the 词牌 name, 乐府 category, series numbering, and a ci first line', () => {
  assert.equal(titleText('西江月·夜行黄沙道中', '西江月', '明月别枝惊鹊'), '夜行黄沙道中');
  assert.equal(titleText('定风波·莫听穿林打叶声', '定风波', '莫听穿林打叶声。何妨吟啸且徐行。'), '');
  assert.equal(titleText('沁园春·雪', '沁园春', '北国风光'), '雪');
  assert.equal(titleText('杂曲歌辞 北风行', null, ''), '北风行');
  assert.equal(titleText('对雪二首 二', null, ''), '对雪');
  assert.equal(titleText('古风 十五', null, ''), '古风');
  assert.equal(titleText('', null, ''), '');
  // 词牌名本身带天气字，不该计分
  assert.deepEqual(tagPoem(titleText('雨霖铃·寒蝉凄切', '雨霖铃', '寒蝉凄切。'), '寒蝉凄切。'), []);
});
