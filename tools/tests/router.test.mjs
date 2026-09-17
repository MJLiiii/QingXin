/* hash 路由解析：渲染缓存键（rendered[name]）的唯一来源。列表页码在键上归一为整数、
   ?q= 进入键、首页键带本地日期、未知路由回首页。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHash } from '../../assets/js/router.js';

test('list and author routes normalize the page number in the key only', () => {
  const r = parseHash('#/list/3?q=春风');
  assert.equal(r.name, 'list');
  assert.equal(r.param, '3');
  assert.deepEqual(r.rest, []);
  assert.deepEqual(r.query, { q: '春风' });
  assert.equal(r.key, 'list/3?q=春风');

  assert.equal(parseHash('#/list/abc').key, 'list/0');
  assert.equal(parseHash('#/list/abc').param, 'abc'); // 渲染器自己 parseInt，这里只归一键
  assert.equal(parseHash('#/list').key, 'list/0');
  assert.equal(parseHash('#/list').param, undefined);
  assert.equal(parseHash('#/authors/12').key, 'authors/12');
});

test('poem and author routes key on the decoded segment and keep the remainder', () => {
  const poem = parseHash('#/poem/c59-66');
  assert.equal(poem.param, 'c59-66');
  assert.equal(poem.key, 'poem/c59-66');
  const author = parseHash('#/author/%E6%9D%8E%E7%99%BD/extra');
  assert.equal(author.param, '李白');
  assert.deepEqual(author.rest, ['extra']);
  assert.equal(author.key, 'author/李白');
});

test('empty query values are dropped and do not enter the key', () => {
  const r = parseHash('#/list/2?q=&x=1');
  assert.deepEqual(r.query, { x: '1' });
  assert.equal(r.key, 'list/2');
});

test('home keys carry the local date and unknown routes fall back to home', () => {
  assert.equal(parseHash('#/home', new Date(2026, 0, 5, 23, 59)).key, 'home/@2026-01-05');
  assert.equal(parseHash('', new Date(2026, 8, 17)).key, 'home/@2026-09-17');
  const nope = parseHash('#/nope/1');
  assert.equal(nope.name, 'home');
  assert.equal(nope.param, '1');
  assert.ok(nope.key.startsWith('home/@'));
});
