/* 应景的「今日一诗」：按访客所在地的当前天气，从推荐池的天气子池里选诗。
   站点无后端，两个外部请求都在浏览器里发出（sw.js 只管同源，跨域请求不经它）：
   GeoJS 按 IP 估算经纬度（取整到 0.1°，约 10 公里）→ Open-Meteo 查当前天气（WMO 天气代码）。
   结果只存在本机 localStorage；任何一步失败都返回 null，首页回落到按日期选诗。
   import 期不碰 window，tools/tests/weather.test.mjs 直接测 weatherTag。 */
import { esc } from './utils.js';

// 天气标签：与 data/weather.json 的键一致（tools/lib/weather-tags.mjs 复用这一份，build-featured.mjs 据此打标签）。
export var WEATHER_TAGS = ['rain', 'snow', 'fog', 'wind', 'cloud', 'clear', 'moon', 'cold', 'heat'];

var GEO_URL = 'https://get.geojs.io/v1/ip/geo.json';
var WX_URL = 'https://api.open-meteo.com/v1/forecast';
var GEO_KEY = 'qingxin:geo';
var WX_KEY = 'qingxin:wx';
var HOUR = 3600 * 1000;
var GEO_TTL = 24 * HOUR;
var WX_FRESH = HOUR; // 一小时内直接用
var WX_STALE = 3 * HOUR; // 三小时内先用着，后台刷新
var FETCH_TIMEOUT = 8000; // 单个请求的上限；首页只等 currentWeather 的 budget，超出的结果留给下次
var WINDY_KMH = 39; // 蒲福 6 级（强风）起
var COLD_C = 0;
var HOT_C = 33;

var RAIN = {
  51: '小雨', 53: '小雨', 55: '小雨', 56: '冻雨', 57: '冻雨',
  61: '小雨', 63: '中雨', 65: '大雨', 66: '冻雨', 67: '冻雨',
  80: '阵雨', 81: '阵雨', 82: '暴雨',
  95: '雷雨', 96: '雷雨', 99: '雷雨',
};
var SNOW = { 71: '小雪', 73: '中雪', 75: '大雪', 77: '小雪', 85: '阵雪', 86: '大雪' };

// Open-Meteo 的 current → { tags: [首选, …回落], label, temp }；认不出天气代码时为 null。
export function weatherTag(current) {
  if (!current || typeof current !== 'object' || !Number.isInteger(current.weather_code)) return null;
  var code = current.weather_code;
  var temp = Number.isFinite(current.temperature_2m) ? Math.round(current.temperature_2m) : null;
  var tags;
  var label;
  if (RAIN[code]) {
    return { tags: ['rain'], label: RAIN[code], temp: temp };
  }
  if (SNOW[code]) {
    return { tags: ['snow'], label: SNOW[code], temp: temp };
  }
  if (code === 0 || code === 1 || code === 2) {
    var night = current.is_day === 0;
    tags = [night ? 'moon' : 'clear'];
    label = code === 2 ? '多云' : (night ? '晴夜' : '晴');
  } else if (code === 3) {
    tags = ['cloud'];
    label = '阴';
  } else if (code === 45 || code === 48) {
    tags = ['fog', 'cloud'];
    label = '雾';
  } else {
    return null;
  }
  // 无降水时，冷热与大风比晴阴更醒目：依次插到最前（大风优先）。
  if (temp !== null && temp <= COLD_C) tags.unshift('cold');
  if (temp !== null && temp >= HOT_C) tags.unshift('heat');
  if (Number.isFinite(current.wind_speed_10m) && current.wind_speed_10m >= WINDY_KMH) {
    tags.unshift('wind');
    label = '大风';
  }
  return { tags: tags, label: label, temp: temp };
}

// 首页天气 chip 的内容，如「小雨 18°」「小雪 −2°」（气温数字走 .latin，负号用 U+2212，
// 连字符在 chip 的字距下会与数字脱开；读屏先念「当地天气」）。
export function weatherHTML(wx) {
  return '<span class="sr-only">当地天气：</span>' + esc(wx.label)
    + (wx.temp === null ? '' : ' <span class="latin">' + String(wx.temp).replace('-', '\u2212') + '°</span>');
}

function isWeather(wx) {
  return !!wx && Array.isArray(wx.tags) && wx.tags.length > 0 && typeof wx.label === 'string'
    && (wx.temp === null || Number.isFinite(wx.temp)) && Number.isFinite(wx.at);
}

// 隐私模式、存储被禁用时 localStorage 会抛错：读不到就当没有缓存。
function readStore(key) {
  try {
    var raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function writeStore(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // 存不下只是下次多请求一次
  }
}

function getJSON(url) {
  var ctrl = new AbortController();
  var timer = setTimeout(function () { ctrl.abort(); }, FETCH_TIMEOUT);
  return fetch(url, { signal: ctrl.signal, credentials: 'omit', referrerPolicy: 'no-referrer' })
    .then(function (res) {
      if (!res.ok) throw new Error(url + ' -> ' + res.status);
      return res.json();
    })
    .finally(function () { clearTimeout(timer); });
}

function round1(x) {
  return Math.round(parseFloat(x) * 10) / 10;
}

async function locate() {
  var geo = readStore(GEO_KEY);
  var age = geo ? Date.now() - geo.at : -1;
  if (geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lon) && age >= 0 && age < GEO_TTL) return geo;
  var d = await getJSON(GEO_URL);
  geo = { lat: round1(d.latitude), lon: round1(d.longitude), at: Date.now() };
  if (!Number.isFinite(geo.lat) || !Number.isFinite(geo.lon)) throw new Error('GeoJS 没有给出经纬度');
  writeStore(GEO_KEY, geo);
  return geo;
}

async function refresh() {
  var geo = await locate();
  var d = await getJSON(WX_URL + '?latitude=' + geo.lat + '&longitude=' + geo.lon
    + '&current=weather_code,temperature_2m,is_day,wind_speed_10m&timezone=auto');
  var wx = weatherTag(d && d.current);
  if (!wx) throw new Error('无法识别的天气');
  wx.at = Date.now();
  writeStore(WX_KEY, wx);
  return wx;
}

// 同一时刻只发一轮请求（后台刷新与首页渲染可能同时要天气）。
var pending = null;
function refreshOnce() {
  if (!pending) {
    pending = refresh().catch(function () { return null; }).finally(function () { pending = null; });
  }
  return pending;
}

// 当前天气：有新鲜缓存立即返回；缓存稍旧先用着并后台刷新；否则最多等 budgetMs，等不到返回 null。
export function currentWeather(budgetMs) {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return Promise.resolve(null);
  var cached = readStore(WX_KEY);
  var age = isWeather(cached) ? Date.now() - cached.at : -1;
  if (age >= 0 && age < WX_FRESH) return Promise.resolve(cached);
  var job = refreshOnce();
  if (age >= 0 && age < WX_STALE) return Promise.resolve(cached);
  return Promise.race([job, new Promise(function (resolve) {
    setTimeout(function () { resolve(null); }, budgetMs == null ? 1500 : budgetMs);
  })]);
}
