import test from 'node:test';
import assert from 'node:assert/strict';
import {
  contentPoisoned,
  decodeEntities,
  extractBalancedDiv,
  findDivById,
  htmlToParas,
  parseCatalogPage,
  parseDetailPage,
  parseListItems,
  parseShangxiFragment,
  splitFanyiParas,
  stripFooterLines,
  stripTags,
  validateScrapedAnnotation,
} from '../annotations/gushiwen-parse.mjs';

/* ---------- 基础工具 ---------- */

test('decodeEntities handles named, hex and decimal references', () => {
  assert.equal(decodeEntities('春&amp;秋'), '春&秋');
  assert.equal(decodeEntities('&lt;题&gt;'), '<题>');
  assert.equal(decodeEntities('床前&nbsp;明月光'), '床前 明月光');
  assert.equal(decodeEntities('&#x4E2D;&#22269;'), '中国');
  assert.equal(decodeEntities('&ldquo;水调歌头&rdquo;&hellip;'), '“水调歌头”…');
});

test('decodeEntities leaves unknown names alone and never double-decodes', () => {
  assert.equal(decodeEntities('&foo;'), '&foo;');
  assert.equal(decodeEntities('&amp;lt;'), '&lt;');
  assert.equal(decodeEntities(null), '');
  assert.equal(decodeEntities(undefined), '');
});

test('stripTags removes markup and then decodes entities', () => {
  assert.equal(stripTags('<a href="/shiwenv_1.aspx"><b>静夜思</b></a>'), '静夜思');
  assert.equal(stripTags('<span class="x">春&amp;秋</span>'), '春&秋');
  assert.equal(stripTags('<br/>'), '');
  assert.equal(stripTags(null), '');
});

test('htmlToParas turns block closers into paragraph breaks and <br> into lines', () => {
  assert.deepEqual(
    htmlToParas('<p>床前明月光，疑是地上霜。</p><p>举头望明月，低头思故乡。</p>'),
    ['床前明月光，疑是地上霜。', '举头望明月，低头思故乡。'],
  );
  assert.deepEqual(
    htmlToParas('<div>白日依山尽，<BR>黄河入海流。<br/>欲穷千里目，<br />更上一层楼。</div>'),
    ['白日依山尽，\n黄河入海流。\n欲穷千里目，\n更上一层楼。'],
  );
  assert.deepEqual(htmlToParas('<h2><span>赏析</span></h2><p>正文。</p>'), ['赏析', '正文。']);
});

test('htmlToParas decodes entities, applies cleanLine and drops empties', () => {
  assert.deepEqual(htmlToParas('<p>&nbsp;&nbsp;举头望明月&#x3002;</p>'), ['举头望明月。']);
  assert.deepEqual(htmlToParas('<p>　　床前▲明月光　　</p>'), ['床前明月光']);
  assert.deepEqual(htmlToParas('<p>《静夜思》　　床前明月光</p>'), ['床前明月光']);
  assert.deepEqual(htmlToParas('<p></p><p>   </p><div>低头思故乡</div><p><br></p>'), ['低头思故乡']);
  assert.deepEqual(htmlToParas(''), []);
  assert.deepEqual(htmlToParas(null), []);
});

test('htmlToParas discards script, style and textarea bodies', () => {
  const html = '<script>var x = "<p>脚本</p>";</script><style>p{color:red}</style>'
    + '<textarea>表单</textarea><p>正文</p>';
  assert.deepEqual(htmlToParas(html), ['正文']);
});

test('extractBalancedDiv counts nested divs and returns the whole outer block', () => {
  const html = '前<div id="a"><div class="inner">内</div>尾</div>后';
  assert.equal(extractBalancedDiv(html, 1), '<div id="a"><div class="inner">内</div>尾</div>');
});

test('extractBalancedDiv returns the remainder when the div never closes', () => {
  assert.equal(extractBalancedDiv('<div>无终<div>更无终', 0), '<div>无终<div>更无终');
  assert.equal(extractBalancedDiv('<div><div>一</div>二', 0), '<div><div>一</div>二');
});

test('findDivById returns the balanced block or null', () => {
  const html = '<div class="wrap" id="outer"><p>头</p><div id="inner">里</div></div><div id="other">别</div>';
  assert.equal(findDivById(html, 'outer'), '<div class="wrap" id="outer"><p>头</p><div id="inner">里</div></div>');
  assert.equal(findDivById(html, 'inner'), '<div id="inner">里</div>');
  assert.equal(findDivById(html, 'missing'), null);
  assert.equal(findDivById('<span id="k">非 div</span>', 'k'), null);
  assert.equal(findDivById('', 'k'), null);
});

test('stripFooterLines removes noise lines and cuts everything from 参考资料 on', () => {
  assert.deepEqual(
    stripFooterLines(['白日依山尽\n完善', '黄河入海流', '参考资料：\n1、某书', '收起']),
    ['白日依山尽', '黄河入海流'],
  );
  assert.deepEqual(
    stripFooterLines(['本节内容由匿名网友上传，原作者已无法考证。', '仅供学习参考之用', '纠错', '真正的内容']),
    ['真正的内容'],
  );
  assert.deepEqual(stripFooterLines(['展开阅读全文', '朗读']), []);
  assert.deepEqual(stripFooterLines([]), []);
  assert.deepEqual(
    stripFooterLines(['完善了这首诗的注释', '其观点不代表本站立场', '复制的意象十分丰富']),
    ['完善了这首诗的注释', '复制的意象十分丰富'],
  );
});

test('stripFooterLines drops the earlier lines of the paragraph that holds the 参考资料 cut', () => {
  assert.deepEqual(stripFooterLines(['欲穷千里目\n参考资料', '更上一层楼']), []);
  assert.deepEqual(stripFooterLines(['欲穷千里目', '参考资料']), ['欲穷千里目']);
});

/* ---------- 列表页 ---------- */

const LISTING = `
<div class="left">
<div id="zhengwena1b2c3d4">
  <p><a href="/shiwenv_a1b2c3d4.aspx" target="_blank"><b>静夜思</b></a></p>
  <p class="source"><a href="/authorv_1c8d.aspx">李白</a><a href="/shiwens/default.aspx?cstr=唐代">〔唐代〕</a></p>
  <div id="contsona1b2c3d4">床前明月光，疑是地上霜。<br>举头望明月，低头思故乡。<br></div>
  <div class="tool"><a href="#">复制</a><a href="#">完善</a></div>
</div>
<div id="zhengwen0f0f0f0f">
  <p><a href="/shiwenv_0f0f0f0f.aspx"><b>水调歌头</b></a></p>
  <p class="source">苏轼〔宋代〕</p>
  <div id="contson0f0f0f0f"><p>丙辰中秋，欢饮达旦，作此篇。</p>明月几时有？把酒问青天。<br></div>
</div>
<div id="zhengwendeadbeef">
  <p><a href="/shiwenv_deadbeef.aspx"><b>杂曲歌辞</b></a></p>
  <p class="source">佚名</p>
  <div id="contsondeadbeef">江南可采莲，莲叶何田田。</div>
</div>
<div id="zhengwen00ff00ff">
  <p><a href="/shiwenv_00ff00ff.aspx"><b>空正文</b></a></p>
  <p class="source">佚名〔汉代〕</p>
  <div id="contson00ff00ff"><a>完善</a></div>
</div>
<a class="amore" href="/shiwens/default.aspx?page=1&amp;cstr=唐代">上一页</a>
<a class="amore" href="/shiwens/default.aspx?page=3&amp;cstr=唐代">下一页</a>
</div>`;

test('parseListItems reads hexid, title, author, dynasty and body blocks of every entry', () => {
  const items = parseListItems(LISTING);
  assert.deepEqual(items.map((it) => it.hexid), ['a1b2c3d4', '0f0f0f0f', 'deadbeef']);
  assert.deepEqual(items[0], {
    hexid: 'a1b2c3d4',
    title: '静夜思',
    author: '李白',
    dynasty: '唐代',
    blocks: ['床前明月光，疑是地上霜。\n举头望明月，低头思故乡。'],
  });
  const dynastyFirst = '<div id="zhengwenaabbcc"><a href="/shiwenv_aabbcc.aspx">春望</a>'
    + '<p class="source"><a href="/shiwens/default.aspx?cstr=唐代">唐代</a>'
    + '<a href="/authorv_9.aspx">杜甫</a>〔唐代〕</p><div id="contsonaabbcc">国破山河在</div></div>';
  assert.equal(parseListItems(dynastyFirst)[0].author, '杜甫');
});

test('parseListItems falls back to plain-text authors and keeps a preface as its own block', () => {
  const [, ci, yuefu] = parseListItems(LISTING);
  assert.equal(ci.author, '苏轼');
  assert.equal(ci.dynasty, '宋代');
  assert.deepEqual(ci.blocks, ['丙辰中秋，欢饮达旦，作此篇。', '明月几时有？把酒问青天。']);
  assert.equal(yuefu.author, '佚名');
  assert.equal(yuefu.dynasty, '');
  assert.deepEqual(yuefu.blocks, ['江南可采莲，莲叶何田田。']);
});

test('parseListItems skips entries whose body is empty after footer stripping', () => {
  const ids = parseListItems(LISTING).map((it) => it.hexid);
  assert.equal(ids.length, 3);
  assert.ok(!ids.includes('00ff00ff'));
  assert.deepEqual(parseListItems(''), []);
  assert.deepEqual(parseListItems(null), []);
  const noTitle = '<div id="zhengwenabcdef"><div id="contsonabcdef">正文</div></div>';
  assert.deepEqual(parseListItems(noTitle), []);
  const extraAttr = '<div id="zhengwenaabbcc" class="main3"><a href="/shiwenv_aabbcc.aspx">春望</a>'
    + '<div id="contsonaabbcc">国破山河在</div></div>';
  assert.deepEqual(parseListItems(extraAttr), []);
  assert.deepEqual(parseListItems(extraAttr.replace(/aabbcc/g, 'AABBCC')), []);
  assert.deepEqual(parseListItems(extraAttr.replace(/ class="main3"/, '').replace(/aabbcc/g, 'aabbc')), []);
});

test('parseCatalogPage reports the 下一页 page number, ignoring 上一页', () => {
  const page = parseCatalogPage(LISTING);
  assert.equal(page.items.length, 3);
  assert.equal(page.nextPage, 3);
});

test('parseCatalogPage reports null when there is no next page', () => {
  const last = LISTING.replace(/<a class="amore"[^>]*>下一页<\/a>/, '');
  assert.equal(parseCatalogPage(last).nextPage, null);
  assert.equal(parseCatalogPage('<a href="/shiwens/default.aspx?page=7">下一页</a>').nextPage, null);
  assert.equal(parseCatalogPage('<a href="/shiwens/default.aspx?page=7" class="amore">下一页</a>').nextPage, null);
  assert.deepEqual(parseCatalogPage(''), { items: [], nextPage: null });
});

/* ---------- 详情页 ---------- */

const DETAIL = `
<div class="main3">
<div id="zhengwenbeef01"><div class="cont">
  <h1>登鹳雀楼</h1>
  <p class="source"><a href="/authorv_aaaa.aspx">王之涣</a><a href="/shiwens/default.aspx?cstr=唐代">〔唐代〕</a></p>
  <div id="contsonbeef01">白日依山尽，黄河入海流。<br>欲穷千里目，更上一层楼。<br></div>
</div></div>
<div id="fanyi123" class="sons">
  <div class="contyishang">
    <h2><span>译文及注释</span></h2>
    <p>译文<br>太阳依傍山峦渐渐下落，黄河向着大海滔滔东流。</p>
    <p>注释<br>鹳雀楼：旧址在山西永济。</p>
    <div class="tool"><a href="javascript:fanyiShow(123,'ABCDEF01')">展开阅读全文</a></div>
  </div>
</div>
<div id="shangxi45" class="sons">
  <div class="contyishang">
    <h2><span>赏析</span></h2>
    <p>这首合成的赏析只用来测试段落切分与参考资料截断，与任何真实文本无关。</p>
    <p>参考资料：</p><p>1、某某《唐诗鉴赏辞典》</p>
  </div>
</div>
<div id="shangxi46" class="sons">
  <h2><span>文言知识</span></h2><p>此处应忽略。</p>
</div>
<div id="shangxi47" class="sons">
  <h2><span>创作背景</span></h2>
  <p>此诗是诗人登楼时所作。</p>
  <a onclick="shangxiShow(47,'0A1B2C')">展开阅读全文</a>
</div>
<div class="sons"><div class="contyishang">
  <h2><span>写作背景</span></h2><p>一说作于开元年间。</p>
</div></div>
</div>`;

test('parseDetailPage reads title, author, dynasty and the 原文 blocks', () => {
  const d = parseDetailPage(DETAIL, 'beef01');
  assert.equal(d.title, '登鹳雀楼');
  assert.equal(d.author, '王之涣');
  assert.equal(d.dynasty, '唐代');
  assert.deepEqual(d.blocks, ['白日依山尽，黄河入海流。\n欲穷千里目，更上一层楼。']);
  assert.equal(d.truncated, false);
});

test('parseDetailPage takes the first source link, or the text before 〔 when there is none', () => {
  assert.equal(parseDetailPage('<h1>春望</h1><p class="source">杜甫〔唐代〕</p>', 'z').author, '杜甫');
  const onlyDynastyLink = '<h1>春望</h1><p class="source"><a href="/shiwens/default.aspx?cstr=唐代">〔唐代〕</a></p>';
  assert.equal(parseDetailPage(onlyDynastyLink, 'z').author, '〔唐代〕');
  assert.equal(parseDetailPage(onlyDynastyLink, 'z').dynasty, '唐代');
});

test('parseDetailPage extracts the folded 译文 section with its AJAX hook and inline preview', () => {
  const d = parseDetailPage(DETAIL, 'beef01');
  const fanyi = d.sections.find((s) => s.channel === 'fanyi');
  assert.deepEqual(fanyi, {
    channel: 'fanyi',
    heading: '译文及注释',
    n: 123,
    idjm: 'ABCDEF01',
    ajaxKind: 'fanyi',
    paras: ['译文\n太阳依傍山峦渐渐下落，黄河向着大海滔滔东流。', '注释\n鹳雀楼：旧址在山西永济。'],
  });
  assert.deepEqual(splitFanyiParas(fanyi.paras), {
    translationText: '太阳依傍山峦渐渐下落，黄河向着大海滔滔东流。',
    notesText: '鹳雀楼：旧址在山西永济。',
  });
});

test('parseDetailPage keeps a short inline 赏析 whole, without heading or 参考资料 tail', () => {
  const d = parseDetailPage(DETAIL, 'beef01');
  const shangxi = d.sections.filter((s) => s.channel === 'shangxi');
  assert.deepEqual(shangxi, [{
    channel: 'shangxi',
    heading: '赏析',
    n: null,
    idjm: null,
    ajaxKind: null,
    paras: ['这首合成的赏析只用来测试段落切分与参考资料截断，与任何真实文本无关。'],
  }]);
});

test('parseDetailPage classifies 创作背景 whether folded under shangxi<N> or a standalone inline block', () => {
  const d = parseDetailPage(DETAIL, 'beef01');
  const bg = d.sections.filter((s) => s.channel === 'background');
  assert.deepEqual(bg, [
    {
      channel: 'background', heading: '创作背景', n: 47, idjm: '0A1B2C', ajaxKind: 'shangxi',
      paras: ['此诗是诗人登楼时所作。'],
    },
    {
      channel: 'background', heading: '写作背景', n: null, idjm: null, ajaxKind: null,
      paras: ['一说作于开元年间。'],
    },
  ]);
});

test('parseDetailPage ignores unknown headings and does not double-count nested .contyishang blocks', () => {
  const d = parseDetailPage(DETAIL, 'beef01');
  assert.deepEqual(d.sections.map((s) => s.heading), ['译文及注释', '赏析', '创作背景', '写作背景']);
  const nestedUnderIgnored = '<div id="shangxi9" class="sons"><h2><span>文言知识</span></h2>'
    + '<div class="contyishang"><h2><span>赏析</span></h2><p>不应出现。</p></div></div>';
  assert.deepEqual(parseDetailPage(nestedUnderIgnored, 'beef01').sections, []);
});

test('parseDetailPage classifies by heading, not by the fanyi/shangxi div name', () => {
  const notFanyi = '<div id="fanyi9" class="sons"><h2><span>文言知识</span></h2><p>“尽”在此为动词。</p></div>';
  assert.deepEqual(parseDetailPage(notFanyi, 'beef01').sections, []);
  const fanyiUnderShangxi = '<div id="shangxi9" class="sons"><h2><span>译文及注释</span></h2><p>太阳依傍山峦渐渐下落。</p></div>';
  assert.deepEqual(parseDetailPage(fanyiUnderShangxi, 'beef01').sections, [{
    channel: 'fanyi', heading: '译文及注释', n: null, idjm: null, ajaxKind: null,
    paras: ['太阳依傍山峦渐渐下落。'],
  }]);
});

test('parseDetailPage flags a folded 原文 as truncated', () => {
  const html = '<h1>长歌行</h1><div id="zhengwenbeef02"><div id="contsonbeef02">青青园中葵，朝露待日晞。</div>'
    + '<a href="javascript:">展开阅读全文</a></div>';
  const d = parseDetailPage(html, 'beef02');
  assert.equal(d.truncated, true);
  assert.deepEqual(d.blocks, ['青青园中葵，朝露待日晞。']);
  assert.equal(d.author, '');
});

test('parseDetailPage returns an empty shape for a page with nothing to read', () => {
  assert.deepEqual(parseDetailPage('', 'beef01'), {
    title: '', author: '', dynasty: '', blocks: [], truncated: false, sections: [],
  });
  assert.deepEqual(parseDetailPage(DETAIL, 'nope').blocks, []);
});

/* ---------- AJAX 片段 ---------- */

test('splitFanyiParas splits on 译文/注释 marker lines and drops the 译文及注释 heading', () => {
  const r = splitFanyiParas(['译文及注释', '译文\n白日依傍山峦落下。\n黄河向着大海奔流。', '注释\n尽：消失。\n穷：尽头。']);
  assert.equal(r.translationText, '白日依傍山峦落下。\n黄河向着大海奔流。');
  assert.equal(r.notesText, '尽：消失。\n穷：尽头。');
});

test('splitFanyiParas accepts numbered headings and colon-suffixed markers', () => {
  const r = splitFanyiParas(['译文及注释二', '译文：', '明月何时才有？', '注释:', '把酒：端起酒杯。']);
  assert.equal(r.translationText, '明月何时才有？');
  assert.equal(r.notesText, '把酒：端起酒杯。');
});

test('splitFanyiParas treats unmarked text as 译文 and lets a later 译文 marker switch back', () => {
  assert.deepEqual(splitFanyiParas(['空山不见人。']), { translationText: '空山不见人。', notesText: '' });
  const r = splitFanyiParas(['注释\n甲：乙。', '译文\n丙。']);
  assert.equal(r.translationText, '丙。');
  assert.equal(r.notesText, '甲：乙。');
  assert.deepEqual(splitFanyiParas([]), { translationText: '', notesText: '' });
});

test('parseShangxiFragment drops a leading heading line and the footer', () => {
  const html = '<div><h2>赏析</h2><p>这首诗描写了登高望远的胸襟。</p><p>末句气象开阔。</p>'
    + '<p>参考资料：</p><p>1、某书</p></div>';
  assert.deepEqual(parseShangxiFragment(html), ['这首诗描写了登高望远的胸襟。', '末句气象开阔。']);
  assert.deepEqual(
    parseShangxiFragment('<p>创作背景</p><p>此诗作于开元年间。</p><a>完善</a>'),
    ['此诗作于开元年间。'],
  );
});

test('parseShangxiFragment only strips the heading when it is first and short', () => {
  assert.deepEqual(parseShangxiFragment('<p>正文一。</p><p>赏析</p>'), ['正文一。', '赏析']);
  assert.deepEqual(
    parseShangxiFragment('<p>赏析这首诗的意象十分丰富。</p>'),
    ['赏析这首诗的意象十分丰富。'],
  );
  assert.deepEqual(parseShangxiFragment(''), []);
});

/* ---------- 反投毒 ---------- */

const PREVIEW = '这首诗的意境一片清明，写的是一个游子的思乡之情，读来令人动容。';

test('contentPoisoned is false when the full text extends a clean preview', () => {
  const full = PREVIEW + '尾联更见深情。';
  assert.equal(contentPoisoned(PREVIEW, full), false);
  assert.equal(contentPoisoned(full, PREVIEW), false);
  assert.equal(contentPoisoned(PREVIEW, PREVIEW), false);
});

test('contentPoisoned is true when common characters were substituted', () => {
  const poisoned = PREVIEW.replace(/的/g, '屈').replace(/一/g, '楼');
  assert.equal(contentPoisoned(PREVIEW, poisoned), true);
  assert.equal(contentPoisoned(poisoned, PREVIEW), true);
});

test('contentPoisoned tolerates a single mismatch', () => {
  const one = PREVIEW.replace('的', '屈');
  assert.equal(contentPoisoned(PREVIEW, one), false);
  const two = PREVIEW.replace('的', '屈').replace('一', '楼');
  assert.equal(contentPoisoned(PREVIEW, two), true);
});

test('contentPoisoned ignores whitespace and previews shorter than 8 characters', () => {
  assert.equal(contentPoisoned('床前明月光，\n疑是地上霜。 举头', '床前明月光，疑是地上霜。举头望明月。'), false);
  assert.equal(contentPoisoned('一二三四五六七', '甲乙丙丁戊己庚'), false);
  assert.equal(contentPoisoned('一二三四五六七八', '甲乙丙丁戊己庚辛'), true);
  assert.equal(contentPoisoned('甲乙丙丁戊', '春眠不觉晓处处闻啼鸟'), false); // 短侧 5 字 → 无法判定
  assert.equal(contentPoisoned('', ''), false);
  assert.equal(contentPoisoned(null, undefined), false);
});

test('contentPoisoned compares only the first 60 characters', () => {
  const head = '春'.repeat(60);
  assert.equal(contentPoisoned(head + '夏'.repeat(10), head + '秋'.repeat(10)), false);
  assert.equal(contentPoisoned('秋秋' + head, '夏夏' + head), true);
});

/* ---------- 写前硬门 ---------- */

const VALID = {
  id: 't1-2',
  preface: '并序',
  notes: [{ term: '鹳雀楼', def: '旧址在山西永济。' }, { term: '尽', def: '消失。' }],
  prefaceTranslation: '有序。',
  translation: ['太阳依傍山峦渐渐下落。'],
  appreciation: ['这首诗写登高望远的胸襟。'],
  background: ['此诗是诗人登楼时所作。'],
};

test('validateScrapedAnnotation passes a clean annotation through untouched', () => {
  const { ann, warnings } = validateScrapedAnnotation(VALID);
  assert.deepEqual(ann, VALID);
  assert.deepEqual(warnings, []);
  assert.notEqual(ann, VALID);
});

test('validateScrapedAnnotation silently drops note rows without both term and def, or of the wrong type', () => {
  const { ann, warnings } = validateScrapedAnnotation({
    ...VALID,
    notes: [{ term: '尽', def: '' }, { term: '', def: '消失。' }, '穷：尽头。', 42, { term: '穷', def: '尽头。' }],
  });
  assert.deepEqual(ann.notes, [{ term: '穷', def: '尽头。' }]);
  assert.deepEqual(warnings, []);
});

test('validateScrapedAnnotation empties a notes list that still carries markup', () => {
  const { ann, warnings } = validateScrapedAnnotation({
    ...VALID,
    notes: [{ term: '尽', def: '消失。' }, { term: '<b>穷</b>', def: '尽头。' }],
  });
  assert.deepEqual(ann.notes, []);
  assert.deepEqual(warnings, [{ section: 'notes', sample: '<b>穷</b>' }]);
});

test('validateScrapedAnnotation drops each dirty section on its own and reports a 40-char sample', () => {
  const long = '参考资料' + '一'.repeat(50);
  const { ann, warnings } = validateScrapedAnnotation({
    ...VALID,
    translation: ['干净的译文。', long],
    appreciation: ['被吃掉的&#23383;'],
    background: ['javascript:alert(1)'],
  });
  assert.deepEqual(ann.translation, []);
  assert.deepEqual(ann.appreciation, []);
  assert.deepEqual(ann.background, []);
  assert.deepEqual(ann.notes, VALID.notes);
  assert.deepEqual(warnings.map((w) => w.section), ['translation', 'appreciation', 'background']);
  assert.equal(warnings[0].sample, long.slice(0, 40));
  assert.notEqual(warnings[0].sample, '干净的译文。'); // sample is the offending string, not the first row
});

test('validateScrapedAnnotation clears both preface fields when either is dirty', () => {
  const a = validateScrapedAnnotation({ ...VALID, preface: '序▲' });
  assert.equal(a.ann.preface, '');
  assert.equal(a.ann.prefaceTranslation, '');
  assert.deepEqual(a.warnings, [{ section: 'preface', sample: '序▲' }]);
  const b = validateScrapedAnnotation({ ...VALID, prefaceTranslation: '本节内容由网友上传' });
  assert.equal(b.ann.preface, '');
  assert.equal(b.ann.prefaceTranslation, '');
  assert.equal(b.warnings[0].section, 'preface');
});

test('validateScrapedAnnotation rejects function bodies and stray angle brackets', () => {
  const { ann, warnings } = validateScrapedAnnotation({
    ...VALID,
    appreciation: ['function () { return 1 }'],
    background: ['a > b'],
  });
  assert.deepEqual(ann.appreciation, []);
  assert.deepEqual(ann.background, []);
  assert.deepEqual(warnings, [
    { section: 'appreciation', sample: 'function () { return 1 }' },
    { section: 'background', sample: 'a > b' },
  ]);
});

test('validateScrapedAnnotation tolerates a bare object and never mutates its input', () => {
  assert.deepEqual(validateScrapedAnnotation({}), { ann: { notes: [] }, warnings: [] });
  const input = { ...VALID, notes: [{ term: '<i>', def: 'x' }] };
  const copy = structuredClone(input);
  validateScrapedAnnotation(input);
  assert.deepEqual(input, copy);
});
