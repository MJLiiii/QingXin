/* 生成 data/timezones.json —— 时区 → 代表城市坐标 {tzdata, zones: {时区名: [纬度, 经度]}}，
   供夜读按本机时区的日出日落自动切换（assets/js/reader.js 按需加载，查到的坐标缓存在读者浏览器的 qingxin:place）。
   数据来自 IANA tz 数据库：默认读系统的 /usr/share/zoneinfo（zone.tab、zone1970.tab、tzdata.zi），
   也可用 --zoneinfo 指向 IANA 源码目录（zone.tab、zone1970.tab、backward 等含 Link 的文件、version）。
   macOS 的 zoneinfo 没有链接数据，旧名（Asia/Calcutta 等）会查不到，本脚本会报错退出。
   只在想跟进新版 tzdata 时重跑（prep.mjs 不碰这个文件）：
     node tools/data/build-timezones.mjs [--zoneinfo <dir>] */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { opt } from '../lib/argv.mjs';
import { DATA } from '../lib/paths.mjs';
import { buildTable, parseLinks, parseVersion, parseZoneTab } from '../lib/tzdata.mjs';

const DIR = opt(process.argv.slice(2), '--zoneinfo', '/usr/share/zoneinfo');
const OUT = join(DATA, 'timezones.json');
// IANA 源码里带 Link 行的文件（系统 zoneinfo 把它们编进了 tzdata.zi）
const SOURCE_FILES = ['africa', 'antarctica', 'asia', 'australasia', 'backward', 'etcetera', 'europe', 'northamerica', 'southamerica'];

async function readOptional(name) {
  try {
    return await readFile(join(DIR, name), 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return '';
    throw e;
  }
}

const coords = parseZoneTab(await readOptional('zone.tab'));
for (const [name, c] of parseZoneTab(await readOptional('zone1970.tab'))) {
  if (!coords.has(name)) coords.set(name, c);
}
if (!coords.size) {
  console.error(`build-timezones: ${DIR} 里没有 zone.tab / zone1970.tab`);
  process.exit(1);
}

const zi = await readOptional('tzdata.zi');
const linkText = zi || (await Promise.all(SOURCE_FILES.map(readOptional))).join('\n');
const links = parseLinks(linkText);
if (!links.length) {
  console.error(`build-timezones: ${DIR} 里没有链接数据（tzdata.zi 或 backward 等源码文件），`
    + 'Asia/Calcutta 这类旧名会查不到；请用 --zoneinfo 指向 IANA 源码目录');
  process.exit(1);
}

const version = parseVersion(zi) || parseVersion(await readOptional('version')) || parseVersion(await readOptional('+VERSION')) || 'unknown';
const zones = buildTable(coords, links);
const json = JSON.stringify({ tzdata: version, zones }) + '\n';
await writeFile(OUT, json, 'utf8');
const total = Object.keys(zones).length;
console.log(`timezones.json：tzdata ${version}，${total} 个时区名（自带坐标 ${coords.size}，经链接的旧名 / 别名 ${total - coords.size}），`
  + `${json.length} 字节`);
