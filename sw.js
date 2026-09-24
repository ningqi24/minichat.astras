const CACHE_NAME = 'minichat-v49';
const STATIC_ASSETS = [
  '/',
  '/login/',
  '/index.html',
  // CSS / JS 已从 index.html 拆成独立文件，必须一起预缓存，
  // 否则离线打开时页面在但样式和脚本都缺
  '/css/app.css',
  '/js/app.js',      // 聊天页
  '/js/login.js',    // 登录页专用（由 app.js 裁剪而来，约 60KB）
  '/assets/logo.svg',
  '/assets/favicon.svg',
  '/favicon.ico',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js',
];

// 安装时缓存核心资源
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// 激活时清理旧缓存
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME)
            .map(key => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// 拦截请求
//
// ⚠️ 这里原本是「一律缓存优先」：只要缓存里有就直接返回。
//    后果是 sw.js 换新版本以后，用户浏览器里的 js/app.js / login.js / app.css
//    仍然是旧的（典型症状：应用内显示"当前版本 4.7.0"，而 vision.json 已是 4.7.2）。
//    所以改成：
//      · 同源页面与脚本样式（导航请求 + .js/.css/.html）→ 网络优先，失败才回退缓存
//      · 其它资源（图片、字体、第三方 SDK）→ 缓存优先，保持离线可用
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isAppAsset = sameOrigin && (
    req.mode === 'navigate' ||
    url.pathname === '/' || url.pathname.endsWith('/') ||
    /\.(js|css|html)$/.test(url.pathname)
  );

  if (isAppAsset) {
    event.respondWith(
      // cache: 'no-store' 很关键：GitHub Pages 对 .css/.js 发的是
      // cache-control: max-age=3600，浏览器会直接拿本地副本、根本不问服务器。
      // 加了 no-store 才会真正走网络，拿到最新代码。
      fetch(req, { cache: 'no-store' }).then(res => {
        if (res && res.ok) { const c2 = res.clone(); caches.open(CACHE_NAME).then(c => c.put(req, c2)); }
        return res;
      }).catch(() => caches.match(req).then(r => r || new Response('离线状态，请检查网络', { status: 503 })))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(r => {
      if (r) return r;
      return fetch(req).then(res => {
        if (res && res.ok && sameOrigin) { const c2 = res.clone(); caches.open(CACHE_NAME).then(c => c.put(req, c2)); }
        return res;
      }).catch(() => new Response('离线状态，请检查网络', { status: 503 }));
    })
  );
});
