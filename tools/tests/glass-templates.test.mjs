import test from 'node:test';
import assert from 'node:assert/strict';
import {
  errorCard,
  fmt,
  findForm,
  hitCard,
  metaChips,
  pageTitle,
  pagerDock,
  pickTab,
  poemCard,
  poemTabs,
  poetTile,
  proseBody,
  seal,
  sealOf,
  workCard,
} from '../../assets/js/glass-templates.js';

test('seal glyphs take the first code point of the name', () => {
  assert.equal(sealOf('𬤇禅师'), '𬤇');
  assert.equal(sealOf(' 李白'), '李');
  assert.equal(sealOf(''), '·');
  assert.equal(sealOf(null), '·');
  assert.match(seal('苏轼', '宋', 'lg'), /^<span class="seal seal--song seal--lg" aria-hidden="true">苏<\/span>$/);
  assert.match(seal('<b>', '唐'), /seal--tang[^>]*>&lt;<\/span>/);
});

test('numbers use grouped Latin digits', () => {
  assert.equal(fmt(78660), '78,660');
  assert.equal(fmt('5119'), '5,119');
  assert.equal(fmt('x'), '');
});

test('poem cards escape text and carry router hooks', () => {
  const html = poemCard({ id: 'c1-2', title: '<题>', author: '苏&轼', dynasty: '宋', excerpt: '明月"几时"' });
  assert.match(html, /^<a class="pcard" href="#\/poem\/c1-2" data-nav="poem\/c1-2">/);
  assert.match(html, /pcard__title">&lt;题&gt;</);
  assert.match(html, /pcard__excerpt">明月&quot;几时&quot;</);
  assert.match(html, /pcard__by">苏&amp;轼 · 宋</);
  assert.match(html, /pcard__kind">词</);
  assert.doesNotMatch(poemCard({ id: 't0-0', title: 'a', author: 'b', dynasty: '唐' }), /pcard__excerpt/);
  assert.match(workCard({ id: 't0-1', title: '静夜思', kind: '诗' }), /class="pcard pcard--work"[\s\S]*pcard__kind">诗</);
  assert.doesNotMatch(workCard({ id: 't0-1', title: '静夜思', kind: '诗' }), /pcard__by/);
});

test('search hit cards highlight exact matches and show matched lines as excerpts', () => {
  const title = hitCard(['t1-1', '静夜思', '李白', { field: 'title', start: 0, length: 2 }], '静夜');
  assert.match(title, /pcard__title"><mark class="search-match">静夜<\/mark>思</);
  assert.match(title, /pcard__by">李白 · 唐</);
  assert.doesNotMatch(title, /pcard__excerpt/);

  const line = hitCard(['c2-3', '水调歌头', '苏轼', { field: 'line', line: '明月几时有', start: 0, length: 2 }], '明月');
  assert.match(line, /pcard__title">水调歌头</);
  assert.match(line, /pcard__excerpt"><mark class="search-match">明月<\/mark>几时有</);
  assert.match(line, /pcard__by">苏轼 · 宋</);
  assert.match(line, /pcard__kind">词</);

  const fuzzy = hitCard(['t1-1', '静夜思', '李白', { field: 'title', fuzzy: true, distance: 1, start: 0, length: 2 }], '静液');
  assert.doesNotMatch(fuzzy, /<mark/);
});

test('poet tiles work with Array#map and with search matches', () => {
  const a = { slug: '𬤇禅师', name: '𬤇禅师', dynasty: '唐', count: 1207 };
  const mapped = [a].map(poetTile)[0];
  assert.match(mapped, /href="#\/author\/%F0%AC%A4%87%E7%A6%85%E5%B8%88"/);
  assert.match(mapped, /seal--tang" aria-hidden="true">𬤇</);
  assert.match(mapped, /ptile__name">𬤇禅师</);
  assert.match(mapped, /唐 · <span class="latin">1,207<\/span> 首/);
  const hit = poetTile({ slug: '李白', name: '李白', dynasty: '唐', count: 3 }, '李', { field: 'name', start: 0, length: 1 });
  assert.match(hit, /ptile__name"><mark class="search-match">李<\/mark>白</);
});

test('meta chips skip empty values', () => {
  assert.equal(metaChips([{ label: '朝代', value: '' }]), '');
  const html = metaChips([{ label: '朝代', value: '宋' }, null, { label: '<x>', value: '<b>v</b>' }]);
  assert.equal((html.match(/class="fact"/g) || []).length, 2);
  assert.match(html, /<dt class="fact__label">&lt;x&gt;<\/dt><dd class="fact__value"><b>v<\/b><\/dd>/);
});

test('pager dock keeps the wirePager hooks and disables the ends', () => {
  const first = pagerDock('list', 0, 3147);
  assert.match(first, /<nav class="pager" id="pager" aria-label="分页">/);
  assert.match(first, /id="pager-input" type="number" inputmode="numeric" min="1" max="3147" value="1" data-route="list"/);
  assert.match(first, /id="pager-go" type="button"/);
  assert.equal((first.match(/pager__btn--off/g) || []).length, 2);
  assert.match(first, /href="#\/list\/1" data-nav="list\/1" aria-label="下一页"/);
  assert.match(first, /href="#\/list\/3146" data-nav="list\/3146" aria-label="最后一页"/);
  assert.match(first, /pager__total latin" aria-hidden="true">\/ 3,147</);

  const last = pagerDock('authors', 204, 205);
  assert.match(last, /href="#\/authors\/0" data-nav="authors\/0" aria-label="第一页"/);
  assert.match(last, /href="#\/authors\/203" data-nav="authors\/203" aria-label="上一页"/);
  assert.equal((last.match(/pager__btn--off/g) || []).length, 2);
  assert.doesNotMatch(last, /aria-label="下一页"/);

  const only = pagerDock('list', 0, 1);
  assert.equal((only.match(/pager__btn--off/g) || []).length, 4);
});

test('prose body escapes paragraphs and shows a placeholder when empty', () => {
  assert.equal(proseBody([]), '<div class="prose"><p class="prose--faint">尚未收录，敬请期待。</p></div>');
  assert.equal(proseBody(null), proseBody([]));
  assert.equal(proseBody(['<a>', 'b'], true), '<div class="prose"><p class="prose--faint">&lt;a&gt;</p><p>b</p></div>');
  assert.equal(proseBody(['a'], false), '<div class="prose"><p>a</p></div>');
});

const SECTIONS = [
  { key: 'notes', label: '注释', html: '<div class="notes"></div>', empty: false },
  { key: 'translation', label: '译文', html: 'T', empty: false },
  { key: 'appreciation', label: '赏析', html: 'A', empty: true },
  { key: 'background', label: '<span class="tabs__trim">创作</span>背景', html: 'B', empty: true },
];

test('tab choice prefers the remembered non-empty tab', () => {
  assert.equal(pickTab(SECTIONS, 'translation'), 'translation');
  assert.equal(pickTab(SECTIONS, 'background'), 'notes');
  assert.equal(pickTab(SECTIONS, undefined), 'notes');
  const later = SECTIONS.map((s, i) => ({ ...s, empty: i !== 2 }));
  assert.equal(pickTab(later, 'notes'), 'appreciation');
  const none = SECTIONS.map((s) => ({ ...s, empty: true }));
  assert.equal(pickTab(none, 'translation'), 'notes');
});

test('poem tabs follow the ARIA tabs pattern', () => {
  const { tablist, panels } = poemTabs(SECTIONS, 'translation');
  assert.match(tablist, /^<div class="tabs" role="tablist" aria-label="注解"><span class="glass" aria-hidden="true">/);
  const tabs = tablist.match(/<button[^>]*>/g);
  assert.equal(tabs.length, 4);
  assert.equal(tabs.filter((t) => t.includes('aria-selected="true"')).length, 1);
  assert.match(tablist, /id="poem-tab-translation" data-tab="translation" aria-controls="poem-panel-translation" aria-selected="true" tabindex="0"/);
  assert.match(tablist, /id="poem-tab-notes" data-tab="notes" aria-controls="poem-panel-notes" aria-selected="false" tabindex="-1"/);
  assert.match(tablist, /class="tabs__tab tabs__tab--empty" id="poem-tab-appreciation"[^>]*>[^]*?<span class="sr-only">（未收录）<\/span><\/button>/);
  assert.doesNotMatch(tablist.split('poem-tab-appreciation')[0], /sr-only/);

  const sections = panels.match(/<section[^>]*>/g);
  assert.equal(sections.length, 4);
  assert.equal(sections.filter((s) => !s.includes(' hidden')).length, 1);
  assert.match(panels, /<section class="tab-panel entry" role="tabpanel" id="poem-panel-translation" aria-labelledby="poem-tab-translation" data-section="translation" tabindex="0">T<\/section>/);
  assert.match(panels, /id="poem-panel-notes"[^>]*data-section="notes"[^>]* hidden><div class="notes">/);
});

test('home search form carries hint links to the list search', () => {
  const html = findForm(['明月', '<x>']);
  assert.match(html, /<form class="find" role="search" aria-label="搜索诗词" data-find>/);
  assert.match(html, /id="home-find" name="q" type="search"/);
  assert.match(html, /href="#\/list\?q=%E6%98%8E%E6%9C%88">明月<\/a>/);
  assert.match(html, /href="#\/list\?q=%3Cx%3E">&lt;x&gt;<\/a>/);
  assert.doesNotMatch(findForm([]), /find__hints/);
});

test('page titles carry their size tier and code-point count', () => {
  assert.equal(pageTitle('中宗皇帝', 'profile-card__name'),
    '<h1 class="profile-card__name display" data-size="s" style="--chars:4">中宗皇帝</h1>');
  assert.match(pageTitle('𬤇禅师<', 'x'), /style="--chars:4">𬤇禅师&lt;<\/h1>$/);
});

test('error cards have a heading and optional ways out', () => {
  const html = errorCard('未找到<这首诗>。', [{ nav: 'list', label: '浏览诗集', primary: true }, { nav: 'home', label: '回到首页' }]);
  assert.match(html, /^<section class="section section--top"><div class="prose error-card"><h1 class="error-card__title">未找到&lt;这首诗&gt;。<\/h1>/);
  assert.match(html, /<a class="btn btn--primary" href="#\/list" data-nav="list">浏览诗集<\/a><a class="btn btn--chip" href="#\/home" data-nav="home">回到首页<\/a>/);
  assert.doesNotMatch(errorCard('x'), /error-card__actions/);
});
