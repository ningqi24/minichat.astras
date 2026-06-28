const CACHE_NAME = 'minichat-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js',
  // 如果有其他静态资源（如 CSS 背景图、字体等），可在此添加
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

// 拦截请求，优先使用缓存，网络失败时回退
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // 如果缓存命中，直接返回
        if (response) return response;
        // 否则发起网络请求
        return fetch(event.request)
          .then(networkResponse => {
            // 可选：将成功的响应缓存起来（仅对同源资源）
            if (event.request.url.startsWith(self.location.origin)) {
              const clone = networkResponse.clone();
              caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
            }
            return networkResponse;
          })
          .catch(() => {
            // 网络失败时，可返回一个离线页面（可选）
            // 这里简单返回一个提示
            return new Response('离线状态，请检查网络', { status: 503 });
          });
      })
  );
});
