/* 夜读随当地日出日落自动切换：天文计算与切换规则，全是纯函数（import 期不碰全局，
   tools/tests/daylight.test.mjs 直接测），由 reader.js 接到页面上。
   「当地」= 本机时区的代表城市：reader.js 查 data/timezones.json（tzdata 的 zone.tab 坐标）后存进
   localStorage 的 qingxin:place = {zone, lat, lon}，换了时区即作废；没有坐标时按本机钟点 18:00–6:00。
   手动选择存在 qingxin:prefs 的 theme + themeUntil（下一次日出或日落），到期恢复自动。
   index.html 首帧脚本抄了一份 themeFor / matchPlace / isNight（首帧时模块还没加载），两个旧地址跳转页
   抄了钟点规则；tools/tests/theme-script.test.mjs 逐点核对，改这里的规则或算式须同改那三处。 */

var RAD = Math.PI / 180;
var DAY = 864e5;
var HORIZON = -0.833;       // 日出日落：日轮上沿切地平线（含大气折射），度
var NIGHT_FROM = 18;        // 没有坐标时的钟点规则：18:00 起算夜里
var NIGHT_UNTIL = 6;        // 到 6:00
var STEP = 10 * 60 * 1000;  // nextChange 逐段查找的步长
var MAX_OVERRIDE = 2 * DAY; // 手动选择的最长有效期：更远的到期时间只能是设备时钟拨错时写下的，作废

// 太阳高度角（度）。USNO 近似太阳坐标：本世纪内误差约 1′，日出日落时刻误差不到一分钟。
export function sunAltitude(ms, lat, lon) {
  var d = ms / DAY - 10957.5; // 距 J2000.0（2000-01-01T12:00Z）的天数
  var g = (357.529 + 0.98560028 * d) * RAD;
  var l = (280.459 + 0.98564736 * d + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  var e = (23.439 - 3.6e-7 * d) * RAD;
  var ra = Math.atan2(Math.cos(e) * Math.sin(l), Math.cos(l));
  var dec = Math.asin(Math.sin(e) * Math.sin(l));
  var h = (280.46061837 + 360.98564736629 * d + lon) * RAD - ra;
  var phi = lat * RAD;
  return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(h)) / RAD;
}

// 此刻是否已入夜：place = {lat, lon} 时看太阳是否落到地平线下；没有坐标看本机钟点。
export function isNight(ms, place) {
  if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lon)) {
    var hour = new Date(ms).getHours();
    return hour >= NIGHT_FROM || hour < NIGHT_UNTIL;
  }
  return sunAltitude(ms, place.lat, place.lon) < HORIZON;
}

// 下一次日出或日落（isNight 翻转）：返回翻转后的第一刻，精确到 1 秒；48 小时内不翻转（极昼、极夜）时为 null。
export function nextChange(ms, place) {
  var night = isNight(ms, place);
  for (var t = ms + STEP; t <= ms + 2 * DAY; t += STEP) {
    if (isNight(t, place) === night) continue;
    var lo = t - STEP;
    var hi = t;
    while (hi - lo > 1000) {
      var mid = Math.floor((lo + hi) / 2);
      if (isNight(mid, place) === night) lo = mid;
      else hi = mid;
    }
    return hi;
  }
  return null;
}

// 本机时区名（如 Asia/Shanghai）；取不到为 ''。
export function localZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch (e) {
    return '';
  }
}

// qingxin:place 里存的坐标，时区与本机一致才用（换了时区即作废）→ {lat, lon} 或 null。
export function matchPlace(stored, zone) {
  return stored && zone && stored.zone === zone && Number.isFinite(stored.lat) && Number.isFinite(stored.lon)
    ? { lat: stored.lat, lon: stored.lon } : null;
}

// 仍然有效的手动选择（'dark' / 'light'）；没有选过、已到期、旧版没有到期时间或到期时间远得离谱时为 null。
export function chosenTheme(prefs, now) {
  if (!prefs || (prefs.theme !== 'dark' && prefs.theme !== 'light')) return null;
  var until = prefs.themeUntil;
  return now < until && until - now <= MAX_OVERRIDE ? prefs.theme : null;
}

// <html data-theme> 该取的值：有效的手动选择 → 它；当地入夜 → 'dark'；否则 null（不写，跟随系统深浅色）。
export function themeFor(prefs, place, now) {
  return chosenTheme(prefs, now) || (isNight(now, place) ? 'dark' : null);
}

/* 按一下页眉「夜读」：dark = 当前是否夜读，osDark = 系统是否深色。切换后若正好等于此刻的自动结果
   （系统深色或当地入夜即夜读），就清掉手动选择、回到自动；否则记下它，管到下一次日出或日落
   （极昼极夜 48 小时内等不到时管 24 小时）。返回要写进 qingxin:prefs 的补丁，值为 undefined 的键即删除。 */
export function toggleOverride(dark, osDark, place, now) {
  var next = dark ? 'light' : 'dark';
  var auto = osDark || isNight(now, place) ? 'dark' : 'light';
  if (next === auto) return { theme: undefined, themeUntil: undefined };
  return { theme: next, themeUntil: nextChange(now, place) || now + DAY };
}
