#!/usr/bin/env node
/* 统一检查入口（npm run check）：
   1. node --check 逐个语法检查 assets/js/**\/*.js、sw.js、tools/**\/*.mjs（遍历目录，新增/删除文件自动纳入）；
   2. node --test tests/（单元测试）；
   3. node data/validate.mjs（只读数据一致性校验）。
   路径一律相对本文件解析，不依赖 cwd；任一步非零退出即整体失败。
   遍历跳过 node_modules/、.cache/ 与含「空格+数字」的 iCloud 冲突副本（如 pages 2.js，见 .gitignore）。 */
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOLS = fileURLToPath(new URL('./', import.meta.url));
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SKIP_DIRS = new Set(['node_modules', '.cache']);
const CONFLICT_COPY = / \d/; // iCloud 冲突副本：「原名 2.js」「poems 3」

function walk(dir, exts, out) {
  for (const name of readdirSync(dir).sort()) {
    if (SKIP_DIRS.has(name) || CONFLICT_COPY.test(name)) continue;
    const fp = join(dir, name);
    if (statSync(fp).isDirectory()) walk(fp, exts, out);
    else if (exts.has(extname(name))) out.push(fp);
  }
  return out;
}

function run(label, args, opts) {
  console.log(`▸ ${label}`);
  const r = spawnSync(process.execPath, args, { stdio: 'inherit', cwd: TOOLS, ...opts });
  if (r.error) {
    console.error(`✗ ${label}: ${r.error.message}`);
    process.exit(1);
  }
  if (r.status !== 0) process.exit(r.status || 1);
}

const files = [
  ...walk(join(ROOT, 'assets', 'js'), new Set(['.js']), []),
  join(ROOT, 'sw.js'),
  ...walk(TOOLS, new Set(['.mjs']), []),
];
for (const fp of files) {
  const r = spawnSync(process.execPath, ['--check', fp], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`✗ 语法检查失败：${fp}`);
    process.exit(r.status || 1);
  }
}
console.log(`✓ 语法检查 ${files.length} 个文件`);

run('单元测试', ['--test', join(TOOLS, 'tests')]);
run('数据校验', [join(TOOLS, 'data', 'validate.mjs')]);
console.log('✓ check 通过');
