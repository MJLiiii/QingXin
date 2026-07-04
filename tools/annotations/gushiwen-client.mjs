/* 古诗文网礼貌 HTTP 客户端：磁盘缓存、限速、重试、封锁检测。
   - 串行使用（调用方顺序 await，绝不并发）；请求间隔 delayMs ±20% 抖动。
   - 缓存 <cacheDir>/<sha1(url)>.html + .meta.json（url/status/fetchedAt）；
     命中即免网络——这就是断点续爬机制。疑似封锁的响应体不入缓存。
   - 404 作为类型化结果返回（页面确实不存在，不重试、入缓存）。
   - 403/验证页/登录墙弹回，以及 5xx/429/网络错误重试耗尽 → 抛 BlockedError，
     调用方应立即中止并提示稍后续跑（crawl-all 驱动对退出码 2 全体暂停 60 分钟重试）。 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export class BlockedError extends Error {
  constructor(url, reason) {
    super(`疑似被封锁（${reason}）：${url}`);
    this.name = 'BlockedError';
    this.url = url;
  }
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
/* 站点自身对未登录访客做两件事：① search.aspx 弹回登录；② 赏析正文字符投毒
   （的→光、夜→作…）。gsw2017user 只是站点前端 JS 自设的布尔存在性标记
   （getCookie('gsw2017user')==null 即弹登录），并非账号凭证；带上任意非空值即
   得到与真实浏览器一致的干净全文，无需注册/登录。 */
const COOKIE = 'gsw2017user=1';
const RETRY_BACKOFF = [5000, 15000, 45000];
const FETCH_TIMEOUT = 30000;

function sha1(s) {
  return createHash('sha1').update(s).digest('hex');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 登录墙弹回/验证页判定：正常内容页开头绝不会出现这些 */
function looksBlocked(status, html) {
  if (status === 403) return '403';
  const head = String(html || '').slice(0, 500);
  if (head.includes('/user/login.aspx?from=')) return '登录墙弹回';
  if (/验证码|滑动验证|人机验证|access denied/i.test(head)) return '验证页';
  return null;
}

export function createClient({ cacheDir, delayMs = 2500, verbose = false }) {
  const stats = { networkRequests: 0, cacheHits: 0, retries: 0, errors: 0 };
  let lastRequestAt = 0;
  let dirReady = false;

  function cachePaths(url) {
    const h = sha1(url);
    return {
      html: join(cacheDir, h + '.html'),
      meta: join(cacheDir, h + '.meta.json'),
    };
  }

  async function readCache(url) {
    const p = cachePaths(url);
    let meta;
    try {
      meta = JSON.parse(await readFile(p.meta, 'utf8'));
    } catch {
      return null;
    }
    if (meta.status === 404) return { status: 404, html: null };
    try {
      return { status: meta.status, html: await readFile(p.html, 'utf8') };
    } catch {
      return null; // meta 在而 html 丢失：当未缓存重取
    }
  }

  async function writeCache(url, status, html) {
    if (!dirReady) {
      await mkdir(cacheDir, { recursive: true });
      dirReady = true;
    }
    const p = cachePaths(url);
    if (html != null) await writeFile(p.html, html, 'utf8');
    await writeFile(
      p.meta,
      JSON.stringify({ url, status, fetchedAt: new Date().toISOString() }) + '\n',
      'utf8',
    );
  }

  /* 距上次网络请求不足 delayMs±20% 时补足等待 */
  async function politeWait() {
    const jittered = delayMs * (0.8 + Math.random() * 0.4);
    const wait = lastRequestAt + jittered - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
  }

  /* 返回 {status, html, fromCache}；404 时 html=null */
  async function fetchHtml(url, { referer } = {}) {
    const cached = await readCache(url);
    if (cached) {
      stats.cacheHits++;
      return { ...cached, fromCache: true };
    }
    let lastErr = null;
    let pushback = false; // 最后一次失败是否 5xx/429/网络错误（服务器侧推开）
    for (let attempt = 0; attempt <= RETRY_BACKOFF.length; attempt++) {
      if (attempt > 0) {
        stats.retries++;
        const backoff = RETRY_BACKOFF[attempt - 1];
        if (verbose) console.log(`  重试 ${attempt}（等待 ${backoff / 1000}s）：${url}`);
        await sleep(backoff);
      }
      await politeWait();
      stats.networkRequests++;
      if (verbose) console.log(`  GET ${url}`);
      let res;
      try {
        res = await fetch(url, {
          headers: {
            'User-Agent': UA,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9',
            Cookie: COOKIE,
            ...(referer ? { Referer: referer } : {}),
          },
          signal: AbortSignal.timeout(FETCH_TIMEOUT),
          redirect: 'follow',
        });
      } catch (e) {
        lastErr = e;
        pushback = true;
        continue; // 网络错误 → 重试
      }
      if (res.status === 404) {
        await writeCache(url, 404, null);
        return { status: 404, html: null, fromCache: false };
      }
      if (res.status === 403) throw new BlockedError(url, '403');
      if (res.status >= 500 || res.status === 429) {
        lastErr = new Error(`HTTP ${res.status}`);
        pushback = true;
        continue;
      }
      let html;
      try {
        html = await res.text();
      } catch (e) {
        lastErr = e;      // 读响应体途中连接被掐断（如 HTTP/2 流错误）→ 重试
        pushback = true;
        continue;
      }
      const blocked = looksBlocked(res.status, html);
      if (blocked) throw new BlockedError(url, blocked); // 不入缓存
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status}`);
        pushback = false;
        continue;
      }
      await writeCache(url, res.status, html);
      return { status: res.status, html, fromCache: false };
    }
    stats.errors++;
    /* 重试耗尽仍是 5xx/429/网络错误 = 服务器在推开我们，按封锁语义上抛：
       调用方以退出码 2 结束，驱动的「全体暂停 60 分钟再重试」接管，而非崩溃停摆。
       其余（持续 4xx 等确定性失败）仍走普通异常 → 退出码 1，避免对坏 URL 无限循环。 */
    if (pushback) throw new BlockedError(url, lastErr ? lastErr.message : '重试耗尽');
    throw lastErr || new Error(`请求失败：${url}`);
  }

  return { fetchHtml, stats };
}
