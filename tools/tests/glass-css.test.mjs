/* 夜读主题的护栏：glass.css 的两个夜读 token 块（系统偏好块与 data-theme="dark" 块）必须逐键相同
   （AGENTS.md「never hard-code a color: add a token to :root and to both dark blocks」）。按过夜读的
   开发者本机只走 data-theme 块，漏改另一块在本机看不出来。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../../assets/css/glass.css', import.meta.url), 'utf8');

// 从 selector 之后的第一个 { 起取到配对的 }（token 值里没有花括号）。
function blockAfter(selector, from = 0) {
  const at = css.indexOf(selector, from);
  assert.notEqual(at, -1, `glass.css must contain ${selector}`);
  const open = css.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}' && --depth === 0) return { text: css.slice(open + 1, i), end: i };
  }
  throw new Error(`unbalanced block after ${selector}`);
}

function declarations(block) {
  const map = new Map();
  for (const m of block.matchAll(/(--[\w-]+|color-scheme)\s*:\s*([^;]+);/g)) {
    map.set(m[1], m[2].replace(/\s+/g, ' ').trim());
  }
  return map;
}

const root = declarations(blockAfter(':root {').text);
const media = blockAfter('@media (prefers-color-scheme: dark)');
const systemDark = declarations(blockAfter(':root:not([data-theme="light"])', css.indexOf('@media (prefers-color-scheme: dark)')).text);
const chosenDark = declarations(blockAfter(':root[data-theme="dark"]').text);

test('the system-preference and data-theme dark blocks declare the same tokens with the same values', () => {
  assert.ok(systemDark.size >= 50 && chosenDark.size >= 50, 'dark blocks look truncated');
  assert.deepEqual([...systemDark.keys()].sort(), [...chosenDark.keys()].sort());
  for (const [name, value] of systemDark) {
    assert.equal(chosenDark.get(name), value, `${name} differs between the two dark blocks`);
  }
  assert.equal(systemDark.get('color-scheme'), 'dark');
});

test('every dark token overrides a token that :root defines', () => {
  const missing = [...chosenDark.keys()].filter((k) => k !== 'color-scheme' && !root.has(k));
  assert.deepEqual(missing, []);
  assert.ok(media.text.includes(':root:not([data-theme="light"])'));
});
