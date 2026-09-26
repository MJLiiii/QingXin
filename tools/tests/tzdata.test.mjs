/* tools/lib/tzdata.mjs：IANA tz 数据 → 时区代表城市坐标表（build-timezones.mjs 生成 data/timezones.json）。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTable, parseIso6709, parseLinks, parseVersion, parseZoneTab } from '../lib/tzdata.mjs';

const near = (actual, expected) => {
  assert.equal(actual.length, 2);
  actual.forEach((x, i) => assert.ok(Math.abs(x - expected[i]) < 1e-9, `${actual} ≉ ${expected}`));
};

const ZONE_TAB = [
  '# tzdb timezone descriptions (deprecated version)',
  '#country-',
  'CN\t+3114+12128\tAsia/Shanghai\tBeijing Time',
  'MO\t+221150+1133230\tAsia/Macau',
  'AU\t-3352+15113\tAustralia/Sydney\tNew South Wales (most areas)',
  'IS\t+6409-02151\tAtlantic/Reykjavik',
  'CI\t+0519-00402\tAfrica/Abidjan',
  'DE\t+5230+01322\tEurope/Berlin\tmost of Germany',
  'NO\t+5955+01045\tEurope/Oslo',
  'SJ\t+7800+01600\tArctic/Longyearbyen',
  'XX\tsomewhere\tBad/Coords',
  'not a zone line',
  '',
].join('\n');

const LINKS = [
  '# version 2026c',
  'Z Asia/Shanghai 8:5:43 - LMT 1901',
  'L Asia/Shanghai PRC',
  'L Asia/Shanghai Asia/Chongqing',
  'L PRC Asia/Harbin',
  'L Africa/Abidjan Atlantic/Reykjavik',
  'L Europe/Berlin Europe/Oslo',
  'L Europe/Berlin Arctic/Longyearbyen',
  'L Etc/UTC UTC',
  'L Loop/A Loop/B',
  'L Loop/B Loop/A',
  '# Link Asia/Shanghai Commented/Out',
  'Link\tAustralia/Sydney\t\tAustralia/NSW\t# backward 的写法',
].join('\n');

test('ISO 6709 coordinates parse with and without seconds, in all four quadrants', () => {
  near(parseIso6709('+3114+12128'), [31 + 14 / 60, 121 + 28 / 60]);
  near(parseIso6709('+221150+1133230'), [22 + 11 / 60 + 50 / 3600, 113 + 32 / 60 + 30 / 3600]);
  near(parseIso6709('-3352+15113'), [-(33 + 52 / 60), 151 + 13 / 60]);
  near(parseIso6709('+6409-02151'), [64 + 9 / 60, -(21 + 51 / 60)]);
  for (const bad of ['', '+31+121', '3114+12128', '+3114+2128', '+3114+12128x']) assert.equal(parseIso6709(bad), null);
});

test('zone.tab rows keep the name and coordinates, skipping comments and bad rows', () => {
  const coords = parseZoneTab(ZONE_TAB);
  assert.equal(coords.size, 8);
  assert.ok(coords.has('Asia/Shanghai') && coords.has('Asia/Macau'));
  assert.ok(!coords.has('Bad/Coords'));
  // zone1970.tab 的首列可以是多个国家码
  assert.deepEqual([...parseZoneTab('CH,DE,LI\t+4723+00832\tEurope/Zurich\tBüsingen').keys()], ['Europe/Zurich']);
});

test('links come from both tzdata.zi (L) and the IANA source files (Link)', () => {
  const links = parseLinks(LINKS);
  assert.deepEqual(links.find(([, alias]) => alias === 'PRC'), ['Asia/Shanghai', 'PRC']);
  assert.deepEqual(links.find(([, alias]) => alias === 'Australia/NSW'), ['Australia/Sydney', 'Australia/NSW']);
  assert.equal(links.length, 10);
  assert.ok(!links.some(([, alias]) => alias === 'Commented/Out'), 'comment lines are not links');
});

test('the tzdata version is read from tzdata.zi or a version file', () => {
  assert.equal(parseVersion(LINKS), '2026c');
  assert.equal(parseVersion('2026c\n'), '2026c');
  assert.equal(parseVersion('no version here'), '');
});

test('the table prefers a zone\'s own coordinates, follows link chains and drops what has none', () => {
  const zones = buildTable(parseZoneTab(ZONE_TAB), parseLinks(LINKS));
  // 自带坐标优先：新版数据里这些是链接，但不能被挪到链接目标那里
  assert.deepEqual(zones['Atlantic/Reykjavik'], [64.2, -21.8]);
  assert.deepEqual(zones['Europe/Oslo'], [59.9, 10.8]);
  assert.deepEqual(zones['Arctic/Longyearbyen'], [78, 16]);
  // 旧名、别名与链式链接取目标的坐标
  assert.deepEqual(zones.PRC, zones['Asia/Shanghai']);
  assert.deepEqual(zones['Asia/Chongqing'], [31.2, 121.5]);
  assert.deepEqual(zones['Asia/Harbin'], [31.2, 121.5]);
  assert.deepEqual(zones['Australia/NSW'], [-33.9, 151.2]);
  // 追不到坐标的（UTC）与成环的不收
  for (const name of ['UTC', 'Etc/UTC', 'Loop/A', 'Loop/B', 'Bad/Coords']) assert.equal(zones[name], undefined, name);
  // 1 位小数，键按字典序
  for (const [lat, lon] of Object.values(zones)) {
    assert.equal(Math.round(lat * 10) / 10, lat);
    assert.equal(Math.round(lon * 10) / 10, lon);
  }
  assert.deepEqual(Object.keys(zones), Object.keys(zones).sort());
  assert.deepEqual(buildTable(new Map([['Near/Zero', [-0.04, 0.02]]]), []), { 'Near/Zero': [0, 0] }); // 严格比较：不是 -0
});
