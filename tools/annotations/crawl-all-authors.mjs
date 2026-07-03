/* 逐作者全量爬取驱动：按 authors-index.json（产量降序）逐位调用
   `annotate-scrape.mjs authors <名>`，每爬完一位暂停 --pause 分钟（默认 30）再继续。

   用法（在 tools/ 下）：
     node annotations/crawl-all-authors.mjs [作者名…] [--pause 30] [--workers 1] [--limit N] [--dry-run]
       无位置参数 = 全部合格作者（跳过无名氏/不详及含数字/顿号/括号等杂名，同 --top 规则）。
       --pause   每位作者之间暂停的分钟数（可小数；注意：全量 ~5050 位 × 30 分钟 ≈ 105 天纯暂停）。
       --workers 并发路数（默认 1）。各路从同一队列领作者，互不重复；每路子进程自带
                 2.5s/请求节流，故对站点的总速率 ≈ 路数 × 0.4 次/秒——建议 ≤3，封锁频繁就调低。
       --limit   透传给每次 authors 调用（= 每位作者本轮最多处理条数）。
       --dry-run 透传（演练，不写文件；注意目录进度仍会落盘，勿对未爬过的作者演练）。

   行为约定：
   - 已爬完的作者（catalog-author-<键>.json 的 done:true）直接跳过且**不暂停**，
     故中断后重跑本脚本即从上次进度继续，跳过部分零等待零请求。
   - 子进程退出码 2（被古诗文网封锁）：**全部路**暂停 60 分钟后重试同一作者，不跳过。
   - 其他非零退出码：停止派发新作者，其余路爬完当前作者后退出（修复后重跑即续）。
   - 优雅停止：创建 tools/.cache/annotate/STOP 文件（touch 即可），各路爬完当前作者后退出并消费该文件。
   - workers>1 时每路子进程写独立报表 scrape-report-w<k>.json，日志行加「[作者名]」前缀。

   长期运行建议：
     nohup node annotations/crawl-all-authors.mjs --pause 1 --workers 3 > ../crawl-all.log 2>&1 &
   中途可随时 git add data/annotations && git commit 已写入的部分。 */
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normAuthor } from './annotate-lib.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const TOOLS = resolve(SCRIPT_DIR, '..');
const REPO = resolve(SCRIPT_DIR, '..', '..');
const WEB_CACHE = join(TOOLS, '.cache', 'gushiwen-web');
const STOP_FILE = join(TOOLS, '.cache', 'annotate', 'STOP');
const REPORT = join(TOOLS, '.cache', 'annotate', 'scrape-report.json');

/* ---------- 参数 ---------- */
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const PAUSE_MIN = parseFloat(opt('--pause', '')) || 30;
const WORKERS = Math.max(1, parseInt(opt('--workers', ''), 10) || 1);
const LIMIT = opt('--limit', null);
const DRY = flag('--dry-run');
const VALUE_FLAGS = new Set(['--pause', '--workers', '--limit']);
const onlyNames = [];
for (let i = 0; i < argv.length; i++) {
  const tok = argv[i];
  if (tok.startsWith('--')) {
    if (VALUE_FLAGS.has(tok) && argv[i + 1] && !argv[i + 1].startsWith('--')) i++;
    continue;
  }
  onlyNames.push(tok);
}

/* 与 annotate-scrape.mjs 的 cacheKeyForAuthor 保持一致（改动需同步） */
const cacheKeyForAuthor = (name) =>
  (normAuthor(name).replace(/[\/\\?%*:|"<>\s、，,\[\]（）()□]/g, '_') || 'author');

/* 与 annotate-scrape.mjs authorTargets 的 --top 合格规则一致 */
function eligible(a) {
  const na = normAuthor(a.name);
  if (na === '无名氏' || na === '不详') return false;
  if (/[、，,\[\]（）()□\s0-9]/.test(a.name)) return false;
  return true;
}

function isDone(name) {
  try {
    const prog = JSON.parse(readFileSync(join(WEB_CACHE, `catalog-author-${cacheKeyForAuthor(name)}.json`), 'utf8'));
    return prog.done === true;
  } catch { return false; }
}

function readWritten(reportPath) {
  try { return JSON.parse(readFileSync(reportPath, 'utf8')).totals.written; } catch { return '?'; }
}

const sleep = (min) => new Promise((r) => setTimeout(r, min * 60 * 1000));

/* prefix 非空时子进程输出走管道、逐行加「[prefix]」，多路并跑日志不串。 */
function runScrape(name, reportPath, prefix) {
  return new Promise((res) => {
    const args = [join(SCRIPT_DIR, 'annotate-scrape.mjs'), 'authors', name];
    if (reportPath !== REPORT) args.push('--report', reportPath);
    if (LIMIT) args.push('--limit', LIMIT);
    if (DRY) args.push('--dry-run');
    const child = spawn(process.execPath, args, { stdio: prefix ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
    if (prefix) {
      const tag = (stream, out) => {
        let buf = '';
        stream.setEncoding('utf8');
        stream.on('data', (d) => {
          buf += d;
          let nl;
          while ((nl = buf.indexOf('\n')) >= 0) { out.write(`[${prefix}] ${buf.slice(0, nl)}\n`); buf = buf.slice(nl + 1); }
        });
        stream.on('end', () => { if (buf) out.write(`[${prefix}] ${buf}\n`); });
      };
      tag(child.stdout, process.stdout);
      tag(child.stderr, process.stderr);
    }
    const onSig = (sig) => child.kill(sig);
    process.on('SIGTERM', onSig);
    child.on('exit', (code) => { process.removeListener('SIGTERM', onSig); res(code == null ? 1 : code); });
  });
}

/* ---------- 主流程 ---------- */
const index = JSON.parse(readFileSync(join(REPO, 'data', 'authors-index.json'), 'utf8'));
const targets = onlyNames.length ? onlyNames : index.filter(eligible).map((a) => a.name);

console.log(`目标作者 ${targets.length} 位；并发 ${WORKERS} 路，每位之间暂停 ${PAUSE_MIN} 分钟${DRY ? '（dry-run）' : ''}${LIMIT ? `，每位上限 ${LIMIT} 条` : ''}。`);
console.log(`优雅停止：touch ${STOP_FILE}\n`);

let cursor = 0, crawled = 0, totalWritten = 0;
let stopping = false;    // STOP 文件或某路出错：不再派发新作者
let blockedUntil = 0;    // 任一路被封锁 → 全部路暂停到此时刻再继续

function checkStop() {
  if (!stopping && existsSync(STOP_FILE)) {
    rmSync(STOP_FILE);
    stopping = true;
    console.log('检测到 STOP 文件，各路爬完当前作者后停止。');
  }
  return stopping;
}

async function worker(k) {
  if (k > 0) await sleep((k * 15) / 60); // 错峰启动，避免起步瞬间三路同时打点
  const tag = WORKERS > 1 ? ` (w${k + 1})` : '';
  const reportPath = WORKERS > 1 ? join(TOOLS, '.cache', 'annotate', `scrape-report-w${k + 1}.json`) : REPORT;
  while (true) {
    if (checkStop()) return;
    while (Date.now() < blockedUntil) {
      await sleep(1);
      if (checkStop()) return;
    }
    const i = cursor++;
    if (i >= targets.length) return;
    const name = targets[i];
    if (isDone(name)) { console.log(`[${i + 1}/${targets.length}] ${name} 已爬完，跳过`); continue; }

    console.log(`\n[${i + 1}/${targets.length}]${tag} ▶ ${name}`);
    let code = await runScrape(name, reportPath, WORKERS > 1 ? name : null);
    while (code === 2) {
      blockedUntil = Math.max(blockedUntil, Date.now() + 60 * 60000);
      console.log(`  ⚠ 被封锁，全部路暂停至 ${new Date(blockedUntil).toTimeString().slice(0, 8)}，再重试「${name}」…`);
      while (Date.now() < blockedUntil) {
        await sleep(1);
        if (checkStop()) return;
      }
      code = await runScrape(name, reportPath, WORKERS > 1 ? name : null);
    }
    if (code !== 0) {
      console.error(`  ✗ ${name} 退出码 ${code}，停止派发（修复后重跑本脚本即可续跑）。`);
      stopping = true;
      process.exitCode = code;
      return;
    }

    crawled++;
    const w = readWritten(reportPath);
    if (typeof w === 'number') totalWritten += w;
    console.log(`  ✔ ${name} 完成（本位写入 ${w}；本轮累计 ${totalWritten}）`);

    if (checkStop()) return;
    if (cursor < targets.length) {
      const until = new Date(Date.now() + PAUSE_MIN * 60000);
      console.log(`  ⏸${tag} 暂停 ${PAUSE_MIN} 分钟，${until.toTimeString().slice(0, 8)} 继续`);
      await sleep(PAUSE_MIN);
    }
  }
}

await Promise.all(Array.from({ length: WORKERS }, (_, k) => worker(k)));
console.log(`\n==== 结束：实爬 ${crawled} 位，共写入 ${totalWritten} 首 ====`);
