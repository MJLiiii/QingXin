/* tools/lib：id / 分桶 / 分片公式与前端同源，参数解析与读文件语义。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ANN_FILE_RE, SUB_CHUNK, authorBucket, pad3, pad4, parseId, poemShardFile } from '../lib/ids.mjs';
import { flag, opt, positionals } from '../lib/argv.mjs';
import { ANN_DIR, DATA, ROOT, TOOLS, readJson } from '../lib/paths.mjs';
import * as data from '../../assets/js/data.js';

test('ids and buckets come from the browser module and match the documented scheme', () => {
  assert.equal(parseId, data.parseId);
  assert.equal(authorBucket, data.authorBucket);
  assert.deepEqual(parseId('c59-66'), { kind: 'ci', chunk: 59, i: 66 });
  assert.deepEqual(parseId('t0-999'), { kind: 'shi', chunk: 0, i: 999 });
  assert.equal(parseId('x1-2'), null);
  assert.equal(parseId('c59-66.json'), null);
  assert.equal(authorBucket('苏轼'), 141);
  assert.ok(authorBucket('李白') >= 0 && authorBucket('李白') < 256);
  assert.equal(pad3(7), '007');
  assert.equal(pad4(59), '0059');
});

test('the shard formula agrees with data.js and is driven by the manifest sub-chunk size', () => {
  assert.equal(SUB_CHUNK, 100);
  assert.deepEqual(poemShardFile(parseId('c59-66'), SUB_CHUNK), { file: '0059-0.json', index: 66 });
  assert.deepEqual(poemShardFile(parseId('t12-999'), SUB_CHUNK), { file: '0012-9.json', index: 99 });
  assert.deepEqual(poemShardFile({ chunk: 3, i: 250 }, 50), { file: '0003-5.json', index: 0 });
  assert.throws(() => poemShardFile({ chunk: 0, i: 0 }), TypeError);
});

test('annotation filenames exclude README and conflict copies', () => {
  assert.ok(ANN_FILE_RE.test('c59-66.json'));
  assert.ok(!ANN_FILE_RE.test('README.md'));
  assert.ok(!ANN_FILE_RE.test('c59-66 2.json'));
  assert.ok(!ANN_FILE_RE.test('c59-66.json.bak'));
});

test('argv helpers: flags, valued options and positionals with an explicit start', () => {
  const VALUE_FLAGS = new Set(['--limit', '--top']);
  const argv = ['authors', '李白', '--limit', '5', '--dry-run', '杜甫', '--top', '--force'];
  assert.equal(flag(argv, '--dry-run'), true);
  assert.equal(flag(argv, '--verbose'), false);
  assert.equal(opt(argv, '--limit', ''), '5');
  assert.equal(opt(argv, '--top', ''), ''); // 后面紧跟 --force，不算值
  assert.equal(opt(argv, '--missing', 'x'), 'x');
  assert.deepEqual(positionals(argv, VALUE_FLAGS, 1), ['李白', '杜甫']); // 跳过模式名 authors
  assert.deepEqual(positionals(argv, VALUE_FLAGS), ['authors', '李白', '杜甫']);
  assert.deepEqual(positionals(['--pause', '30', '--workers', '3'], new Set(['--pause', '--workers'])), []);
});

test('paths resolve from the tools directory and readJson throws only without a default', async () => {
  assert.equal(TOOLS, join(ROOT, 'tools'));
  assert.equal(DATA, join(ROOT, 'data'));
  assert.equal(ANN_DIR, join(ROOT, 'data', 'annotations'));
  const dir = await mkdtemp(join(tmpdir(), 'qx-'));
  try {
    await writeFile(join(dir, 'ok.json'), '{"a":1}');
    await writeFile(join(dir, 'bad.json'), '{');
    assert.deepEqual(await readJson(join(dir, 'ok.json')), { a: 1 });
    await assert.rejects(readJson(join(dir, 'missing.json')), (e) => e.code === 'ENOENT');
    await assert.rejects(readJson(join(dir, 'bad.json')), SyntaxError);
    assert.deepEqual(await readJson(join(dir, 'missing.json'), {}), {});
    assert.equal(await readJson(join(dir, 'bad.json'), null), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
