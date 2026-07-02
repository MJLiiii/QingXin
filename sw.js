/* 情心 Service Worker —— 跨刷新/离线缓存。纯原生、零依赖。
   策略：对同源 GET 一律 stale-while-revalidate——命中缓存立即返回、后台再拉新写回，
   故二次访问秒开，而代码/注释更新至多滞后一次刷新（不会卡在旧版本）。
   预缓存仅应用外壳，保证首个离线可用；大文件（search.json 等）按访问懒缓存。
   改动缓存格式时 bump CACHE_NAME，旧缓存在 activate 清除。
   作用域随注册路径（GitHub Pages 子路径 /QingXin/ 亦可）。 */
const CACHE_NAME = 'qingxin-v1';
const SHELL = ['./', './index.html', './assets/css/styles.css', './assets/js/app.js'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // 只管同源 GET；跨域（Google Fonts 等）与非 GET 直接放行。
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => {
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => cached); // 离线且未缓存 → 交由调用方处理失败
        // 命中缓存立即返回，后台静默更新；未命中则等网络。
        return cached || network;
      }),
    ),
  );
});
