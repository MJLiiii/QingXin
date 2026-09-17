/* 应用外壳的护栏：sw.js 预缓存清单必须与磁盘上的前端资源一一对应（AGENTS.md「Adding/renaming a
   frontend module or shell means updating its SHELL list」），两个旧地址跳转页必须字节一致，
   且跳转页的 '../?' 分支与根页去掉空查询的逻辑只能一起删（二者是同一套过渡机制的两半）。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const CONFLICT_COPY = / \d/; // iCloud 冲突副本（如 pages 2.js）不算资源，见 .gitignore

function walk(dir, ext, out = []) {
  for (const name of readdirSync(dir).sort()) {
    if (CONFLICT_COPY.test(name)) continue;
    const fp = join(dir, name);
    if (statSync(fp).isDirectory()) walk(fp, ext, out);
    else if (name.endsWith(ext)) out.push('./' + relative(ROOT, fp).split('\\').join('/'));
  }
  return out;
}

const sw = read('sw.js');
const shellSource = /const SHELL = \[([\s\S]*?)\];/.exec(sw);
const SHELL = shellSource ? [...shellSource[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : null;
const cacheName = /const CACHE_NAME = '([^']+)'/.exec(sw);

test('sw.js precaches exactly the shell pages, the stylesheet and every assets/js module', () => {
  assert.ok(SHELL, 'sw.js must declare `const SHELL = [ … ];`');
  const expected = [
    './', './index.html', './kyne/', './liquidglass/',
    ...walk(join(ROOT, 'assets', 'css'), '.css'),
    ...walk(join(ROOT, 'assets', 'js'), '.js'),
  ];
  assert.deepEqual([...SHELL].sort(), [...expected].sort());
  assert.equal(new Set(SHELL).size, SHELL.length, 'SHELL has a duplicate entry');
});

test('sw.js cache name follows the qingxin-v<n> scheme', () => {
  assert.ok(cacheName, 'sw.js must declare `const CACHE_NAME = \'…\'`');
  assert.match(cacheName[1], /^qingxin-v\d+$/);
});

test('the two legacy redirect stubs are byte-identical', () => {
  assert.equal(read('kyne/index.html'), read('liquidglass/index.html'));
});

test('the stub redirect to ../? and the root ? strip are removed together', () => {
  // 旧 worker 缓存里的根页可能仍是界面选择页：从根转来的 stub 去 '../?'（缓存里没有的地址），
  // 根页再把这个空查询去掉。删其中一半，另一半就会来回跳或留下 ?。
  assert.match(read('kyne/index.html'), /fromRoot \? '\.\.\/\?' : '\.\.\/'/);
  assert.match(read('index.html'), /\/\\\?\$\/\.test\(window\.location\.href\.split\('#'\)\[0\]\)/);
});
