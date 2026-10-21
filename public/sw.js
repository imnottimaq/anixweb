const scopeUrl = new URL(self.registration.scope);
const scopePath = scopeUrl.pathname.endsWith('/') ? scopeUrl.pathname : `${scopeUrl.pathname}/`;

// Replaced by the production build with a content version and all emitted assets.
const BUILD_VERSION = '__BUILD_VERSION__';
const BUILD_ASSETS = [];
const OPTIONAL_ASSETS = [];
const CACHE_PREFIX = `anixweb-v3-${encodeURIComponent(self.registration.scope)}-`;
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_VERSION}`;
const LEGACY_CACHE_NAME = `anixweb-v2-${encodeURIComponent(self.registration.scope)}`;
const STATIC_ASSETS = [
  `${scopePath}index.html`,
  `${scopePath}manifest.webmanifest`,
  `${scopePath}icons/icon.svg`,
  `${scopePath}icons/icon-192.png`,
  `${scopePath}icons/icon-512.png`,
  `${scopePath}icons/icon-maskable-512.png`,
  `${scopePath}icons/apple-touch-icon.png`,
  ...BUILD_ASSETS.map(path => `${scopePath}${path}`),
];
const staticPaths = new Set(STATIC_ASSETS);
const optionalPaths = new Set(OPTIONAL_ASSETS.map(path => `${scopePath}${path}`));

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(STATIC_ASSETS);
    } catch (error) {
      await caches.delete(CACHE_NAME);
      throw error;
    }
  })());
  // Let an existing version finish using its matching HTML and lazy chunks.
  // The new worker activates when the old version's tabs have closed.
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key =>
      (key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME) || key === LEGACY_CACHE_NAME,
    ).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== scopeUrl.origin || !url.pathname.startsWith(scopePath)) return;

  // Never cache API, session or proxy responses, even on a shared origin.
  const relativePath = url.pathname.slice(scopePath.length);
  if (/^(?:api\/|corsproxy(?:\/|$)|agentproxy(?:\/|$))/.test(relativePath)) return;

  if (request.mode === 'navigate') {
    // Keep HTML and its hashed assets on the same build, including offline routes.
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      return await cache.match(`${scopePath}index.html`) || fetch(request);
    })());
    return;
  }

  if (optionalPaths.has(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })());
    return;
  }

  if (!staticPaths.has(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    return await cache.match(url.pathname) || fetch(request);
  })());
});
