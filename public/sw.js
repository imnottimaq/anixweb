const scopeUrl = new URL(self.registration.scope);
const scopePath = scopeUrl.pathname.endsWith('/') ? scopeUrl.pathname : `${scopeUrl.pathname}/`;

const CACHE_PREFIX = 'anixweb-';
const CACHE_NAME = `anixweb-v2-${encodeURIComponent(self.registration.scope)}`;

const STATIC_ASSETS = [
  scopePath,
  `${scopePath}index.html`,
  `${scopePath}manifest.webmanifest`,
  `${scopePath}icons/icon.svg`,
  `${scopePath}icons/icon-192.png`,
  `${scopePath}icons/icon-512.png`,
  `${scopePath}icons/icon-maskable-512.png`,
  `${scopePath}icons/apple-touch-icon.png`
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('Failed to cache some static assets during install:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          // Only delete caches belonging to this app's prefix; NEVER delete another site's or other app's caches.
          if (key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // NEVER cache account, session, proxy, or external API responses
  if (
    url.pathname.includes('/api/v2/user') ||
    url.pathname.includes('/api/v2/session') ||
    url.pathname.includes('/corsproxy') ||
    url.pathname.includes('/agentproxy') ||
    url.pathname.startsWith('/api/')
  ) {
    return;
  }

  // Skip streaming video, websockets, dev-server, and external domains
  if (
    url.pathname.endsWith('.m3u8') ||
    url.pathname.endsWith('.ts') ||
    url.pathname.endsWith('.mp4') ||
    url.protocol.startsWith('ws') ||
    url.hostname.includes('anixsekai.com') ||
    url.hostname.includes('shikimori') ||
    url.hostname.includes('kodik') ||
    url.pathname.startsWith('/@') ||
    url.pathname.startsWith('/src/') ||
    url.pathname.includes('node_modules')
  ) {
    return;
  }

  // HTML navigation: Network first, fallback to cache
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          return caches.match(`${scopePath}index.html`).then((cached) => cached || caches.match(scopePath));
        })
    );
    return;
  }

  // Same-origin static assets: Cache first with stale-while-revalidate
  if (url.origin === self.location.origin) {
    if (!url.pathname.startsWith(scopePath)) {
      return;
    }

    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          fetch(request)
            .then((networkResponse) => {
              if (networkResponse && networkResponse.status === 200) {
                caches.open(CACHE_NAME).then((cache) => cache.put(request, networkResponse));
              }
            })
            .catch(() => {});
          return cachedResponse;
        }

        return fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return networkResponse;
        });
      })
    );
  }
});
