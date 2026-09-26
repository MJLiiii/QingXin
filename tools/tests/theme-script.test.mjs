/* index.html 的首帧脚本与两个旧地址跳转页各抄了一份夜读规则（首帧时模块还没加载），必须与
   assets/js/daylight.js 的 themeFor 一致：用 node:vm 直接跑页面里的内联脚本（假 localStorage、Date、
   Intl、location），逐点比较。天文算式抄得一字不差，所以结果逐位相同，不必避开日出日落附近的时刻。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { matchPlace, themeFor } from '../../assets/js/daylight.js';

const HOUR = 36e5;
const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const headScript = (html) => /<head>[\s\S]*?<script>([\s\S]*?)<\/script>/.exec(html)[1];

// 编译一次、复用一个上下文；每次运行前改 state，脚本读到的就是新的假环境。
function sandbox(html) {
  const state = {};
  const reset = () => Object.assign(state, {
    now: 0, zone: 'Asia/Shanghai', store: {}, storageThrows: false, intlThrows: false,
    href: 'https://example.org/QingXin/', referrer: '', attrs: {}, props: {}, replaced: null, replacedState: null,
  });
  class FakeDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [state.now]));
    }

    static now() {
      return state.now;
    }
  }
  const location = {
    get href() { return state.href; },
    get origin() { return new URL(state.href).origin; },
    get pathname() { return new URL(state.href).pathname; },
    get hash() { return new URL(state.href).hash; },
    replace(url) { state.replaced = url; },
  };
  const context = vm.createContext({
    Date: FakeDate,
    URL,
    Intl: {
      DateTimeFormat: function DateTimeFormat() {
        if (state.intlThrows) throw new Error('no Intl');
        return { resolvedOptions: () => ({ timeZone: state.zone }) };
      },
    },
    localStorage: {
      getItem(key) {
        if (state.storageThrows) throw new Error('storage denied');
        return Object.hasOwn(state.store, key) ? state.store[key] : null;
      },
    },
    document: {
      get referrer() { return state.referrer; },
      documentElement: {
        setAttribute(name, value) { state.attrs[name] = value; },
        style: { setProperty(name, value) { state.props[name] = value; } },
      },
    },
    window: { location, history: { state: null, replaceState(s, t, url) { state.replacedState = url; } } },
  });
  const script = new vm.Script(headScript(html));
  return {
    state,
    run(patch) {
      reset();
      Object.assign(state, patch);
      script.runInContext(context);
      return state.attrs['data-theme'] ?? null;
    },
  };
}

const DAYS = ['2026-03-20', '2026-06-21', '2026-09-23', '2026-12-21'];
const PLACES = [
  // [存下的 qingxin:place 原文, 本机时区]
  [JSON.stringify({ zone: 'Asia/Shanghai', lat: 31.2, lon: 121.5 }), 'Asia/Shanghai'],
  [JSON.stringify({ zone: 'Australia/Sydney', lat: -33.9, lon: 151.2 }), 'Australia/Sydney'],
  [JSON.stringify({ zone: 'Europe/Oslo', lat: 69.6, lon: 19 }), 'Europe/Oslo'],
  [null, 'Asia/Shanghai'],
  [JSON.stringify({ zone: 'Asia/Tokyo', lat: 35.7, lon: 139.7 }), 'Asia/Shanghai'],
  [JSON.stringify({ zone: 'Asia/Shanghai', lat: '31.2', lon: 121.5 }), 'Asia/Shanghai'],
  ['not json', 'Asia/Shanghai'],
];
const PREFS = (now) => [
  {},
  { theme: 'dark', themeUntil: now + 3 * HOUR },
  { theme: 'light', themeUntil: now + 3 * HOUR, scale: 1.12 },
  { theme: 'dark', themeUntil: now - 1 },
  { theme: 'light' },
  { theme: 'light', themeUntil: now + 72 * HOUR },
  { theme: 'sepia', themeUntil: now + HOUR, vertical: true },
];
const parse = (raw) => {
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
};

test('the index.html head script sets the same theme as daylight.js themeFor', () => {
  const page = sandbox(read('index.html'));
  let runs = 0;
  for (const day of DAYS) {
    for (let minute = 0; minute < 1440; minute += 20) {
      const now = Date.parse(`${day}T00:00:00Z`) + minute * 6e4;
      for (const [rawPlace, zone] of PLACES) {
        for (const prefs of PREFS(now)) {
          const store = { 'qingxin:prefs': JSON.stringify(prefs) };
          if (rawPlace !== null) store['qingxin:place'] = rawPlace;
          const got = page.run({ now, zone, store });
          const want = themeFor(prefs, matchPlace(parse(rawPlace), zone), now);
          assert.equal(got, want, `${new Date(now).toISOString()} ${rawPlace} @${zone} ${JSON.stringify(prefs)}`);
          runs++;
        }
      }
    }
  }
  assert.equal(runs, DAYS.length * 72 * PLACES.length * PREFS(0).length);
});

test('the head script still decides when storage or Intl is unavailable', () => {
  const page = sandbox(read('index.html'));
  const clock = (h) => new Date(2026, 5, 21, h, 0).getTime();
  // 存储被禁：没有偏好也没有坐标，按钟点
  assert.equal(page.run({ now: clock(20), storageThrows: true }), 'dark');
  assert.equal(page.run({ now: clock(12), storageThrows: true }), null);
  // 取不到时区：存下的坐标不能用，按钟点。挑一个钟点与上海日出日落说法不一的时刻来证明坐标被忽略。
  const shanghai = { zone: 'Asia/Shanghai', lat: 31.2, lon: 121.5 };
  const store = { 'qingxin:place': JSON.stringify(shanghai) };
  const split = Array.from({ length: 96 }, (_, i) => Date.parse('2026-06-21T00:00:00Z') + i * 15 * 6e4)
    .find((t) => themeFor({}, shanghai, t) !== themeFor({}, null, t));
  assert.ok(split, 'a moment where the clock and the sun disagree');
  assert.equal(page.run({ now: split, store, intlThrows: true }), themeFor({}, null, split));
  assert.equal(page.run({ now: split, store }), themeFor({}, shanghai, split));
});

test('the head script keeps applying the reading scale, vertical text and the empty-query strip', () => {
  const page = sandbox(read('index.html'));
  page.run({ store: { 'qingxin:prefs': JSON.stringify({ scale: 1.25, vertical: true }) } });
  assert.equal(page.state.props['--reading-scale'], '1.25');
  assert.equal(page.state.attrs['data-vertical'], '1');
  page.run({ store: { 'qingxin:prefs': JSON.stringify({ scale: 3 }) } });
  assert.equal(page.state.props['--reading-scale'], undefined);
  page.run({ href: 'https://example.org/QingXin/?#/poem/c59-66' });
  assert.equal(page.state.replacedState, '/QingXin/#/poem/c59-66');
  page.run({ href: 'https://example.org/QingXin/#/poem/c59-66' });
  assert.equal(page.state.replacedState, null);
});

test('the redirect stubs use the clock rule unless a manual choice is still valid, and still redirect', () => {
  const stub = sandbox(read('kyne/index.html')); // liquidglass/index.html 与它逐字节相同（shell.test.mjs）
  for (const day of DAYS) {
    for (let minute = 0; minute < 1440; minute += 20) {
      const now = Date.parse(`${day}T00:00:00Z`) + minute * 6e4;
      for (const prefs of PREFS(now)) {
        const got = stub.run({ now, store: { 'qingxin:prefs': JSON.stringify(prefs) }, href: 'https://example.org/QingXin/kyne/#/about' });
        assert.equal(got, themeFor(prefs, null, now), `${new Date(now).toISOString()} ${JSON.stringify(prefs)}`);
        assert.equal(stub.state.replaced, '../#/about');
      }
    }
  }
  assert.equal(stub.run({ storageThrows: true, now: new Date(2026, 5, 21, 23, 0).getTime() }), 'dark');
  // 从根目录（旧 Worker 缓存的界面选择页）转来时去 ../?，免得来回跳
  const href = 'https://example.org/QingXin/liquidglass/#/poem/c59-66';
  stub.run({ href, referrer: 'https://example.org/QingXin/' });
  assert.equal(stub.state.replaced, '../?#/poem/c59-66');
  stub.run({ href, referrer: 'https://example.org/QingXin/index.html' });
  assert.equal(stub.state.replaced, '../?#/poem/c59-66');
  stub.run({ href, referrer: 'https://other.example/QingXin/' });
  assert.equal(stub.state.replaced, '../#/poem/c59-66');
});
