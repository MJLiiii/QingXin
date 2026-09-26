/* IANA tz 数据库 → 时区代表城市坐标表 data/timezones.json（build-timezones.mjs 用它生成）。
   夜读按本机时区的日出日落自动切换（assets/js/daylight.js）：浏览器只报得出时区名，坐标取该时区在
   zone.tab / zone1970.tab 里登记的代表城市（Asia/Shanghai → 上海）。旧名与别名（Asia/Calcutta、PRC…，
   V8 常报旧名）来自 tzdata.zi 的「L 目标 别名」或 IANA 源码 backward 等文件的「Link 目标 别名」。
   纯函数，tools/tests/tzdata.test.mjs 直接测。 */

// ISO 6709 坐标（zone.tab 第二列）：±DDMM[SS]±DDDMM[SS] → [纬度, 经度]（度）；格式不符为 null。
export function parseIso6709(text) {
  const m = /^([+-])(\d{2})(\d{2})(\d{2})?([+-])(\d{3})(\d{2})(\d{2})?$/.exec(String(text).trim());
  if (!m) return null;
  const deg = (sign, d, min, sec) => (sign === '-' ? -1 : 1) * (Number(d) + Number(min) / 60 + Number(sec || 0) / 3600);
  return [deg(m[1], m[2], m[3], m[4]), deg(m[5], m[6], m[7], m[8])];
}

// zone.tab / zone1970.tab：「国家码[,国家码…]\t坐标\t时区名[\t注释]」→ Map(时区名 → [纬度, 经度])；跳过注释行与坏行。
export function parseZoneTab(text) {
  const out = new Map();
  for (const line of String(text).split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const cols = line.split('\t');
    const coords = cols.length >= 3 ? parseIso6709(cols[1]) : null;
    if (coords && cols[2].trim()) out.set(cols[2].trim(), coords);
  }
  return out;
}

// 链接：tzdata.zi 的「L 目标 别名」与 IANA 源码的「Link 目标 别名 # 注释」→ [[目标, 别名], …]
export function parseLinks(text) {
  return [...String(text).matchAll(/^(?:L|Link)[ \t]+(\S+)[ \t]+(\S+)/gm)].map((m) => [m[1], m[2]]);
}

// tzdata 版本：tzdata.zi 首行「# version 2026c」，或 IANA 源码的 version 文件（整份就是「2026c」）；认不出为 ''。
export function parseVersion(text) {
  const m = /^(?:#[ \t]*version[ \t]+)?(\d{4}[a-z])[ \t]*$/m.exec(String(text));
  return m ? m[1] : '';
}

/* 合并成 {时区名: [纬度, 经度]}。zone.tab / zone1970.tab 自带的坐标永远优先：各国的旧时区在新版数据里
   多是链接（如 Atlantic/Reykjavik → Africa/Abidjan），不能让链接把冰岛挪到赤道附近。其余名字沿链接追到
   有坐标的时区（防环），追不到的（Etc/UTC、GMT 等）不收。坐标保留 1 位小数（约 10 公里，日出日落差不到
   半分钟），键按字典序（diff 稳定）。 */
export function buildTable(coords, links) {
  const target = new Map();
  for (const [to, alias] of links) {
    if (!target.has(alias)) target.set(alias, to);
  }
  const resolve = (name) => {
    const seen = new Set();
    let at = name;
    while (!coords.has(at)) {
      if (seen.has(at) || !target.has(at)) return null;
      seen.add(at);
      at = target.get(at);
    }
    return coords.get(at);
  };
  const round = (x) => Math.round(x * 10) / 10 || 0; // || 0：不写出 -0
  const zones = {};
  for (const name of [...new Set([...coords.keys(), ...target.keys()])].sort()) {
    const c = resolve(name);
    if (c) zones[name] = [round(c[0]), round(c[1])];
  }
  return zones;
}
