/* assets/js/weather.js 的纯函数部件：Open-Meteo 天气代码 → 天气标签（首选在前，后面是回落）与首页 chip 文字；
   标签名与构建端词表（tools/lib/weather-tags.mjs）同源。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { WEATHER_TAGS, currentWeather, weatherHTML, weatherTag } from '../../assets/js/weather.js';
import { WEATHER_TAGS as TOOL_TAGS } from '../lib/weather-tags.mjs';

const now = (code, extra) => ({ weather_code: code, temperature_2m: 18.4, is_day: 1, wind_speed_10m: 10, ...extra });

test('the tag names are shared with the build-time lexicon', () => {
  assert.equal(TOOL_TAGS, WEATHER_TAGS);
  assert.equal(new Set(WEATHER_TAGS).size, WEATHER_TAGS.length);
});

test('clear skies split into day and night, cloud and fog fall back sensibly', () => {
  assert.deepEqual(weatherTag(now(0)), { tags: ['clear'], label: '晴', temp: 18 });
  assert.deepEqual(weatherTag(now(1, { is_day: 0 })), { tags: ['moon'], label: '晴夜', temp: 18 });
  assert.deepEqual(weatherTag(now(2)), { tags: ['clear'], label: '多云', temp: 18 });
  assert.deepEqual(weatherTag(now(2, { is_day: 0 })).tags, ['moon']);
  assert.deepEqual(weatherTag(now(3)), { tags: ['cloud'], label: '阴', temp: 18 });
  assert.deepEqual(weatherTag(now(45)), { tags: ['fog', 'cloud'], label: '雾', temp: 18 });
  assert.deepEqual(weatherTag(now(48)).tags, ['fog', 'cloud']);
});

test('precipitation wins over wind and temperature', () => {
  assert.deepEqual(weatherTag(now(61)), { tags: ['rain'], label: '小雨', temp: 18 });
  assert.equal(weatherTag(now(53)).label, '小雨');
  assert.equal(weatherTag(now(65)).label, '大雨');
  assert.equal(weatherTag(now(82)).label, '暴雨');
  assert.deepEqual(weatherTag(now(95, { wind_speed_10m: 60 })), { tags: ['rain'], label: '雷雨', temp: 18 });
  assert.deepEqual(weatherTag(now(75, { temperature_2m: -8 })), { tags: ['snow'], label: '大雪', temp: -8 });
  assert.equal(weatherTag(now(85)).label, '阵雪');
});

test('strong wind, frost and heat go in front of the sky tag', () => {
  assert.deepEqual(weatherTag(now(0, { wind_speed_10m: 45 })), { tags: ['wind', 'clear'], label: '大风', temp: 18 });
  assert.deepEqual(weatherTag(now(0, { wind_speed_10m: 38.9 })).tags, ['clear']);
  assert.deepEqual(weatherTag(now(3, { temperature_2m: -0.4 })), { tags: ['cold', 'cloud'], label: '阴', temp: -0 });
  assert.deepEqual(weatherTag(now(0, { temperature_2m: 0.6 })).tags, ['clear']);
  assert.deepEqual(weatherTag(now(0, { temperature_2m: 35 })).tags, ['heat', 'clear']);
  assert.deepEqual(weatherTag(now(1, { is_day: 0, temperature_2m: -5, wind_speed_10m: 50 })).tags, ['wind', 'cold', 'moon']);
});

test('unknown or missing readings give no tag, and a missing temperature is dropped', () => {
  assert.equal(weatherTag(null), null);
  assert.equal(weatherTag({}), null);
  assert.equal(weatherTag(now(4)), null);
  assert.equal(weatherTag(now('61')), null);
  assert.deepEqual(weatherTag({ weather_code: 0 }), { tags: ['clear'], label: '晴', temp: null });
});

test('the chip names the weather for screen readers and escapes the label', () => {
  assert.equal(weatherHTML({ label: '小雨', temp: 18 }),
    '<span class="sr-only">当地天气：</span>小雨 <span class="latin">18°</span>');
  assert.equal(weatherHTML({ label: '<晴>', temp: null }), '<span class="sr-only">当地天气：</span>&lt;晴&gt;');
  assert.match(weatherHTML({ label: '小雪', temp: -2 }), /小雪 <span class="latin">\u22122°<\/span>$/);
  assert.match(weatherHTML({ label: '阴', temp: -0 }), />0°</);
});

test('outside a browser there is no weather', async () => {
  assert.equal(await currentWeather(10), null);
});
