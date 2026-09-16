/* 极简静态文件服务器（仅本地预览用）。
   根目录由脚本位置推导，不依赖 cwd，规避 launcher 的 getcwd 限制。
   用法：node tools/server/serve.mjs  （默认端口 8080，可 PORT=xxxx 覆盖）*/
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = process.env.PORT || 8080;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
};

http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent((req.url || '/').split('?')[0]);
    if (p === '') p = '/';
    let fp = normalize(join(ROOT, p));
    if (fp !== ROOT && !fp.startsWith(ROOT + sep)) { res.writeHead(403); res.end('forbidden'); return; }
    let s = await stat(fp).catch(() => null);
    // 目录：与 GitHub Pages 一致——缺尾斜杠先 301 补上，再返回其中的 index.html（/kyne/、/liquidglass/）
    if (s && s.isDirectory()) {
      if (!p.endsWith('/')) {
        const url = req.url || '/';
        const at = url.indexOf('?');
        const raw = at >= 0 ? url.slice(0, at) : url; // 仍是百分号编码的原始路径
        const q = at >= 0 ? url.slice(at) : '';
        // 去掉开头多余的 / 与 \，避免 //host 被浏览器当成协议相对地址跳去别的主机
        res.writeHead(301, { Location: '/' + raw.replace(/^[\\/]+/, '') + '/' + q });
        res.end();
        return;
      }
      fp = join(fp, 'index.html');
      s = await stat(fp).catch(() => null);
    }
    if (!s || !s.isFile()) { res.writeHead(404); res.end('not found'); return; }
    const buf = await readFile(fp);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(fp)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  } catch (e) {
    res.writeHead(500);
    res.end(String(e));
  }
}).listen(PORT, () => console.log(`serving ${ROOT} on http://localhost:${PORT}`));
