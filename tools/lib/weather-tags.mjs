/* 推荐池的天气标签：按标题与正文里的天气字词打分（build-featured.mjs 用它生成 data/weather.json）。
   每个标签三组词：exclude 先整体抹掉（比喻、地名、人事等并非写天气的用法），strong 复合词每处 3 分
   （一个明确的意象即可入选），single 单字每处 1 分（已被 strong 或 exclude 吃掉的不重复计）。短标题（如《江雪》《夜雨寄北》）按 3 倍计，
   长标题多含人名地名（「校书叔云」「扶风界」），只按 1 倍计；词的标题若只是首句，正文里已算过，不再计。
   总分达到门槛才入选：MIN_SCORE，正文每满 LONG_STEP 个汉字再加 1（长篇里一句「五岭炎蒸地」不算写暑热）。
   一首诗可以有多个标签。标签名与前端 assets/js/weather.js 共用。 */
export { WEATHER_TAGS } from '../../assets/js/weather.js';

export const MIN_SCORE = 3;
const LONG_STEP = 100;
const STRONG_WEIGHT = 3;
const TITLE_WEIGHT = 3;
const SHORT_TITLE = 5; // 字数不超过它的标题才加权

const LEXICON = {
  rain: {
    strong: '夜雨 春雨 秋雨 细雨 疏雨 微雨 暮雨 骤雨 急雨 冷雨 寒雨 苦雨 烟雨 梅雨 雨声 听雨 雨后 雨余 雨过 '
      + '雨中 雨霁 雨歇 积雨 久雨 喜雨 对雨 新雨 宿雨 山雨 暴雨 潇潇 淋铃',
    single: '雨',
    exclude: '雨露 云雨 覆雨 如雨 雨泪 泪雨 雨花 霖雨',
  },
  snow: {
    strong: '飞雪 风雪 大雪 雪花 雪夜 春雪 残雪 积雪 暮雪 雪满 雪中 雪后 霰',
    single: '雪',
    exclude: '如雪 似雪 胜雪 若雪 欺雪 鬓雪 雪鬓 发雪 雪发 雪肤 雪藕 雪浪 雪涛 雪耻 阳春白雪',
  },
  fog: {
    strong: '烟雨 烟波 烟霭 雾霭 薄雾 云雾 晓雾 烟霏 暮烟 寒烟 轻烟 烟笼 雾失',
    single: '雾 烟 霭',
    exclude: '烽烟 狼烟 炊烟 烟火 烟花 烟尘 香烟 烟霞',
  },
  wind: {
    strong: '大风 狂风 秋风 北风 朔风 西风 风急 风吹 风声 风起 长风 寒风 悲风 风萧萧 萧萧 飒飒',
    single: '风',
    exclude: '春风 东风 清风 微风 和风 风流 风尘 风俗 风骨 风华 风光 风景 风物 风月 风姿 风情 风韵 风度 '
      + '风采 风骚 风雅 风味 风波 风云 风化 风期 国风 家风 威风 古风 扶风 风疾',
  },
  cloud: {
    strong: '阴云 浓云 愁云 黑云 乌云 云低 天阴 晚阴 秋阴 春阴 轻阴 阴雨 漠漠',
    single: '阴 云',
    exclude: '光阴 阴阳 阴山 山阴 华阴 淮阴 江阴 汉阴 绿阴 树阴 柳阴 槐阴 桐阴 花阴 清阴 浓阴 繁阴 松阴 竹阴 '
      + '阴阴 青云 云鬓 云髻 云鬟 云雨 云霄 云中 云梦 白云 云间',
  },
  clear: {
    strong: '晴空 晴川 晴日 新晴 初晴 晚晴 晴光 晴天 天晴 晴明 丽日 艳阳 日暖 暖日 春光 春日 晴好',
    single: '晴',
    exclude: '',
  },
  moon: {
    strong: '明月 月明 月色 月光 月华 月下 月夜 皓月 新月 残月 秋月 圆月 满月 月圆 望月 素月 孤月 月落 月出 '
      + '月照',
    single: '月',
    exclude: '岁月 年月 日月 经月 累月 月余 数月 风月 [一二三四五六七八九十正腊闰冬]月',
  },
  cold: {
    strong: '严寒 苦寒 寒冬 冰雪 冰封 霜天 霜寒 天寒 岁寒 寒风 朔风 凝霜 霜重 冻',
    single: '霜 寒 冰',
    exclude: '寒士 贫寒 寒门 寒微 寒食 寒暄 如霜 似霜 鬓霜 霜鬓 霜发 地上霜 冰心 冰清 冰轮 冰壶 冰肌 冰弦',
  },
  heat: {
    strong: '酷暑 苦热 炎热 暑气 炎蒸 溽暑 盛夏 夏日 消暑 避暑 纳凉 炎天 赤日 火云',
    single: '暑 炎 热',
    exclude: '热闹 炎凉 热肠 炎帝 炎黄',
  },
};

// 词表 → 正则（长词优先，避免「风萧萧」被「萧萧」抢先）；exclude 里允许写字符类。
function wordsRe(words) {
  const list = words.split(/\s+/).filter(Boolean).sort((a, b) => b.length - a.length);
  return list.length ? new RegExp(list.join('|'), 'g') : null;
}

const RULES = Object.entries(LEXICON).map(([tag, w]) => ({
  tag,
  exclude: wordsRe(w.exclude),
  strong: wordsRe(w.strong),
  single: new RegExp(`[${w.single.replace(/\s+/g, '')}]`, 'g'),
}));

function count(text, re) {
  return re ? (text.match(re) || []).length : 0;
}

function score(text, rule) {
  let s = rule.exclude ? text.replace(rule.exclude, '□') : text;
  const strong = count(s, rule.strong);
  if (rule.strong) s = s.replace(rule.strong, '□');
  return STRONG_WEIGHT * strong + count(s, rule.single);
}

const PUNCT = /[\s·・，。、；：！？“”‘’（）《》〈〉【】「」『』\[\]()!?,.;:'"-]/g;
const plain = (t) => String(t || '').replace(PUNCT, '');

/* 参与计分的标题：去掉词牌名（「西江月·…」的「西江月」与天气无关）、乐府类目前缀（「杂曲歌辞 北风行」）
   与组诗编号（「对雪二首 二」「古风 十五」）；词的标题只是首句时返回 ''（正文已含）。 */
export function titleText(title, rhythmic, text) {
  let t = String(title || '');
  if (rhythmic && t.startsWith(rhythmic)) {
    t = t.slice(rhythmic.length).replace(/^[·・\s]+/, '');
    if (t && plain(text).startsWith(plain(t))) return '';
  }
  return t.replace(/^\S*[歌曲]辞\s+/, '')
    .replace(/\s+[一二三四五六七八九十]+$/, '')
    .replace(/[一二三四五六七八九十]+首$/, '')
    .trim();
}

// 各标签得分（按 LEXICON 顺序）；title 应先经 titleText 处理。
export function tagScores(title, text) {
  const t = String(title || '');
  const weight = Array.from(plain(t)).length <= SHORT_TITLE ? TITLE_WEIGHT : 1;
  const out = {};
  for (const rule of RULES) {
    out[rule.tag] = weight * score(t, rule) + score(String(text || ''), rule);
  }
  return out;
}

// 入选门槛：正文越长，要求的天气笔墨越多。
export function minScore(text) {
  return MIN_SCORE + Math.floor((String(text || '').match(/\p{Script=Han}/gu) || []).length / LONG_STEP);
}

// 一首诗的天气标签：得分达到门槛的标签。
export function tagPoem(title, text) {
  const min = minScore(text);
  return Object.entries(tagScores(title, text)).filter(([, s]) => s >= min).map(([tag]) => tag);
}
