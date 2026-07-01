/* 极简静态文件服务器（仅本地预览用）。
   根目录由脚本位置推导，不依赖 cwd，规避 launcher 的 getcwd 限制。
   用法：node tools/serve.mjs  （默认端口 8080，可 PORT=xxxx 覆盖）*/
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url))); // tools/.. = 仓库根
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
    if (p === '/' || p === '') p = '/index.html';
    const fp = normalize(join(ROOT, p));
    if (!fp.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
    const s = await stat(fp).catch(() => null);
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
