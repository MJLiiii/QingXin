/* assets/js/daylight.js：夜读随当地日出日落自动切换的天文计算与规则（纯函数）。
   首帧脚本与跳转页里的副本由 theme-script.test.mjs 对照这里的 themeFor 核对。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chosenTheme, isNight, localZone, matchPlace, nextChange, sunAltitude, themeFor, toggleOverride,
} from '../../assets/js/daylight.js';

const MIN = 6e4;
const HOUR = 36e5;
const SHANGHAI = { lat: 31.2, lon: 121.5 }; // data/timezones.json 里 Asia/Shanghai 的坐标
const TROMSO = { lat: 69.6, lon: 19 };
// 某地当地时刻（UTC 偏移 offset 小时）→ 毫秒
const at = (local, offset) => Date.parse(local + 'Z') - offset * HOUR;
// 本机时区的当地时刻（钟点规则按本机时钟，这样写与跑测试的机器在哪个时区无关）
const clock = (h, m) => new Date(2026, 8, 26, h, m).getTime();

test('sunrise and sunset match published times to within two minutes', () => {
  const cases = [
    // 地点、坐标、UTC 偏移、日期、公布的日出与日落（timeanddate.com）
    ['上海', SHANGHAI, 8, '2026-06-21', '04:50', '19:01'],
    ['北京', { lat: 39.9, lon: 116.4 }, 8, '2026-06-21', '04:46', '19:46'],
    ['上海', SHANGHAI, 8, '2026-12-21', '06:49', '16:55'],
    ['北京', { lat: 39.9, lon: 116.4 }, 8, '2026-12-21', '07:33', '16:53'],
    ['伦敦', { lat: 51.5, lon: -0.1 }, 1, '2026-06-21', '04:43', '21:21'],
    ['伦敦', { lat: 51.5, lon: -0.1 }, 0, '2026-12-21', '08:04', '15:53'],
    ['悉尼', { lat: -33.9, lon: 151.2 }, 10, '2026-06-21', '07:00', '16:54'],
  ];
  for (const [name, place, offset, day, rise, set] of cases) {
    const midnight = at(`${day}T00:00:00`, offset);
    assert.equal(isNight(midnight, place), true, `${name} ${day} 零点是夜里`);
    const sunrise = nextChange(midnight, place);
    const sunset = nextChange(sunrise, place);
    assert.ok(Math.abs(sunrise - at(`${day}T${rise}:00`, offset)) <= 2 * MIN, `${name} ${day} 日出`);
    assert.ok(Math.abs(sunset - at(`${day}T${set}:00`, offset)) <= 2 * MIN, `${name} ${day} 日落`);
  }
});

test('the sun stands overhead at the subsolar point and below the antipode', () => {
  const solstice = Date.parse('2026-06-21T12:00:00Z');
  assert.ok(sunAltitude(solstice, 23.4, -0.4) > 88);
  assert.ok(sunAltitude(solstice, -23.4, 179.6) < -88);
});

test('polar day and polar night never switch', () => {
  const june = Date.parse('2026-06-21T00:00:00Z');
  for (let h = 0; h < 24; h++) assert.equal(isNight(june + h * HOUR, TROMSO), false, `6/21 ${h}:00Z`);
  assert.equal(nextChange(june, TROMSO), null);
  const decemberNoon = Date.parse('2026-12-21T11:00:00Z'); // 特罗姆瑟当地正午
  assert.equal(isNight(decemberNoon, TROMSO), true);
  assert.equal(nextChange(decemberNoon, TROMSO), null);
});

test('without coordinates the local clock decides: night is 18:00 to 6:00', () => {
  assert.equal(isNight(clock(17, 59), null), false);
  assert.equal(isNight(clock(18, 0), null), true);
  assert.equal(isNight(clock(5, 59), null), true);
  assert.equal(isNight(clock(6, 0), null), false);
  assert.equal(isNight(clock(20, 0), { lat: '31.2', lon: 121.5 }), true, 'unusable coordinates fall back to the clock');
  assert.equal(isNight(clock(12, 0), { lat: NaN, lon: 0 }), false);
  const change = nextChange(clock(17, 59), null);
  assert.ok(change >= clock(18, 0) && change - clock(18, 0) <= 1000);
});

test('nextChange returns the first moment after the switch', () => {
  for (const start of [at('2026-06-21T12:00:00', 8), at('2026-06-21T22:00:00', 8), clock(3, 0)]) {
    const place = start === clock(3, 0) ? null : SHANGHAI;
    const change = nextChange(start, place);
    assert.notEqual(isNight(change, place), isNight(start, place));
    assert.equal(isNight(change - 1000, place), isNight(start, place));
  }
});

test('a manual choice counts only until it expires, and never for more than two days', () => {
  const now = at('2026-06-21T12:00:00', 8);
  assert.equal(chosenTheme({}, now), null);
  assert.equal(chosenTheme(null, now), null);
  assert.equal(chosenTheme({ theme: 'dark', themeUntil: now + HOUR }, now), 'dark');
  assert.equal(chosenTheme({ theme: 'light', themeUntil: now + 48 * HOUR }, now), 'light');
  assert.equal(chosenTheme({ theme: 'dark', themeUntil: now }, now), null, 'expired');
  assert.equal(chosenTheme({ theme: 'dark' }, now), null, 'the old permanent choice');
  assert.equal(chosenTheme({ theme: 'dark', themeUntil: now + 48 * HOUR + 1 }, now), null, 'set while the clock was wrong');
  assert.equal(chosenTheme({ theme: 'sepia', themeUntil: now + HOUR }, now), null);
  assert.equal(chosenTheme({ theme: 'dark', themeUntil: 'soon' }, now), null);
});

test('the theme is the manual choice, else dark at night, else left to the system', () => {
  const noon = at('2026-06-21T12:00:00', 8);
  const night = at('2026-06-21T22:00:00', 8);
  assert.equal(themeFor({}, SHANGHAI, noon), null);
  assert.equal(themeFor({}, SHANGHAI, night), 'dark');
  assert.equal(themeFor({ theme: 'light', themeUntil: night + HOUR }, SHANGHAI, night), 'light');
  assert.equal(themeFor({ theme: 'dark', themeUntil: noon + HOUR }, SHANGHAI, noon), 'dark');
  assert.equal(themeFor({ theme: 'light' }, SHANGHAI, night), 'dark', 'an old permanent choice is ignored');
});

test('pressing 夜读 holds the choice until the next sunrise or sunset, or returns to auto', () => {
  const noon = at('2026-06-21T12:00:00', 8);
  const night = at('2026-06-21T22:00:00', 8);
  const sunset = nextChange(noon, SHANGHAI);
  const sunrise = nextChange(night, SHANGHAI);
  assert.ok(Math.abs(sunset - at('2026-06-21T19:01:00', 8)) <= 2 * MIN);
  assert.ok(Math.abs(sunrise - at('2026-06-22T04:50:00', 8)) <= 2 * MIN);
  const cleared = { theme: undefined, themeUntil: undefined };
  // 白天、系统浅色：夜读到日落；再按一下与自动相同，回到自动
  assert.deepEqual(toggleOverride(false, false, SHANGHAI, noon), { theme: 'dark', themeUntil: sunset });
  assert.deepEqual(toggleOverride(true, false, SHANGHAI, noon), cleared);
  // 夜里自动夜读：白天到日出
  assert.deepEqual(toggleOverride(true, false, SHANGHAI, night), { theme: 'light', themeUntil: sunrise });
  assert.deepEqual(toggleOverride(false, false, SHANGHAI, night), cleared);
  // 系统深色的白天（跟随系统在夜读）：白天到日落
  assert.deepEqual(toggleOverride(true, true, SHANGHAI, noon), { theme: 'light', themeUntil: sunset });
  // 极昼等不到日落：管 24 小时
  const polar = Date.parse('2026-06-21T12:00:00Z');
  assert.deepEqual(toggleOverride(false, false, TROMSO, polar), { theme: 'dark', themeUntil: polar + 24 * HOUR });
  // 刚写下的选择此刻就有效
  assert.equal(chosenTheme(toggleOverride(false, false, SHANGHAI, noon), noon), 'dark');
});

test('a cached place is used only for the zone it was looked up for', () => {
  const stored = { zone: 'Asia/Shanghai', lat: 31.2, lon: 121.5 };
  assert.deepEqual(matchPlace(stored, 'Asia/Shanghai'), SHANGHAI);
  assert.equal(matchPlace(stored, 'Asia/Tokyo'), null, 'the reader changed time zone');
  assert.equal(matchPlace(stored, ''), null, 'the zone is unknown');
  assert.equal(matchPlace({ zone: 'Asia/Shanghai', lat: '31.2', lon: 121.5 }, 'Asia/Shanghai'), null);
  assert.equal(matchPlace({ zone: 'Asia/Shanghai' }, 'Asia/Shanghai'), null);
  for (const junk of [null, undefined, 5, 'x', [], {}]) assert.equal(matchPlace(junk, 'Asia/Shanghai'), null);
  assert.equal(typeof localZone(), 'string');
});
