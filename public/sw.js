/* global self, caches, fetch, URL, Response */
const CACHE_VERSION = 'v2';
const APP_SHELL_CACHE = `bookish-shell-${CACHE_VERSION}`;
const STATIC_CACHE = `bookish-static-${CACHE_VERSION}`;
const FONT_CACHE = `bookish-fonts-${CACHE_VERSION}`;
const COVER_CACHE = `bookish-covers-${CACHE_VERSION}`;

const ACTIVE_CACHES = [APP_SHELL_CACHE, STATIC_CACHE, FONT_CACHE, COVER_CACHE];

const CORE_SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon.png',
];
const MAX_COVER_CACHE_ENTRIES = 500;

async function trimCache(cacheName, maxItems) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length > maxItems) {
      const excess = keys.length - maxItems;
      for (let i = 0; i < excess; i++) {
        await cache.delete(keys[i]);
      }
    }
  } catch {
    // Ignore storage quota or eviction errors
  }
}

self.addEventListener('install', event => {
  event.waitUntil(
    (async () => {
      try {
        const shellCache = await caches.open(APP_SHELL_CACHE);
        await Promise.allSettled(
          CORE_SHELL_URLS.map(url =>
            fetch(url, {cache: 'no-cache'}).then(res => {
              if (res && res.ok) {
                return shellCache.put(url, res);
              }
              return undefined;
            }),
          ),
        );
      } catch {
        // Ignore offline install errors
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(
          keys.map(key => {
            if (!ACTIVE_CACHES.includes(key)) {
              return caches.delete(key);
            }
            return Promise.resolve(false);
          }),
        );
      } catch {
        // Ignore cleanup errors
      }
      await self.clients.claim();
    })(),
  );
});

function isBypassedExternalService(url) {
  const host = url.hostname.toLowerCase();
  return (
    host.includes('identitytoolkit.googleapis.com') ||
    host.includes('securetoken.googleapis.com') ||
    host.includes('firestore.googleapis.com') ||
    host.includes('maps.googleapis.com') ||
    host.includes('maps.gstatic.com') ||
    host.includes('khms0.googleapis.com') ||
    host.includes('khms1.googleapis.com')
  );
}

function isCoverOrExternalImage(url, request) {
  if (isBypassedExternalService(url)) {
    return false;
  }
  if (request.destination === 'image') {
    return true;
  }
  const host = url.hostname.toLowerCase();
  return (
    host.includes('books.google.com') ||
    host.includes('googleusercontent.com') ||
    host.includes('covers.openlibrary.org') ||
    host.includes('openlibrary.org') ||
    host.includes('firebasestorage.googleapis.com')
  );
}

self.addEventListener('fetch', event => {
  const {request} = event;
  if (request.method !== 'GET') {
    return;
  }

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return;
  }

  if (isBypassedExternalService(url)) {
    return;
  }

  // Never intercept API, tRPC, SSE streams, or Vite dev/HMR endpoints
  if (
    url.pathname.startsWith('/trpc') ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/src/') ||
    url.pathname.startsWith('/node_modules/') ||
    url.pathname.startsWith('/@') ||
    url.pathname.startsWith('/__vite')
  ) {
    return;
  }

  // 1. HTML Navigation Requests: Network-First with Offline App-Shell Fallback
  if (
    request.mode === 'navigate' ||
    request.destination === 'document' ||
    (request.headers.get('accept') || '').includes('text/html')
  ) {
    event.respondWith(
      (async () => {
        try {
          const networkResponse = await fetch(request);
          const contentType = (
            networkResponse.headers.get('content-type') || ''
          ).toLowerCase();
          if (networkResponse.ok && contentType.includes('text/html')) {
            const htmlPreview = await networkResponse
              .clone()
              .text()
              .catch(() => '');
            if (htmlPreview.includes('id="root"')) {
              const shellCache = await caches.open(APP_SHELL_CACHE);
              await shellCache.put('/', networkResponse.clone());
              await shellCache.put('/index.html', networkResponse.clone());
              return networkResponse;
            }
            const shellCache = await caches.open(APP_SHELL_CACHE);
            const cachedRoot =
              (await shellCache.match('/')) ||
              (await shellCache.match('/index.html'));
            if (cachedRoot) {
              return cachedRoot;
            }
          }
          return networkResponse;
        } catch {
          const shellCache = await caches.open(APP_SHELL_CACHE);
          const cachedRoot =
            (await shellCache.match('/')) ||
            (await shellCache.match('/index.html')) ||
            (await caches.match('/')) ||
            (await caches.match('/index.html'));
          if (cachedRoot) {
            return cachedRoot;
          }
          return new Response(
            '<!doctype html><html><body><h1>Offline</h1><p>Please connect to the internet once to initialize the book(ish) offline archive.</p></body></html>',
            {
              status: 503,
              headers: {'Content-Type': 'text/html; charset=utf-8'},
            },
          );
        }
      })(),
    );
    return;
  }

  // 2. Google Fonts: Cache-First
  if (
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com' ||
    request.destination === 'font'
  ) {
    event.respondWith(
      (async () => {
        const fontCache = await caches.open(FONT_CACHE);
        const cached = await fontCache.match(request);
        if (cached) {
          return cached;
        }
        try {
          const response = await fetch(request);
          if (response && (response.ok || response.type === 'opaque')) {
            await fontCache.put(request, response.clone());
          }
          return response;
        } catch {
          return new Response('', {status: 504, statusText: 'Offline'});
        }
      })(),
    );
    return;
  }

  // 3. Book Covers & Images: Stale-While-Revalidate (bounded to 500 entries)
  if (isCoverOrExternalImage(url, request)) {
    event.respondWith(
      (async () => {
        const coverCache = await caches.open(COVER_CACHE);
        const cached = await coverCache.match(request);
        const fetchPromise = fetch(request)
          .then(async response => {
            if (response && (response.ok || response.type === 'opaque')) {
              await coverCache.put(request, response.clone());
              void trimCache(COVER_CACHE, MAX_COVER_CACHE_ENTRIES);
            }
            return response;
          })
          .catch(() => null);

        if (cached) {
          return cached;
        }
        const liveResponse = await fetchPromise;
        if (liveResponse) {
          return liveResponse;
        }
        return new Response('', {status: 504, statusText: 'Offline'});
      })(),
    );
    return;
  }

  // 4. Same-origin Static Bundles & Scripts (/assets/*, /src/*, /node_modules/*, workers, manifest)
  if (url.origin === self.location.origin) {
    const isHashedProdAsset = url.pathname.startsWith('/assets/');
    event.respondWith(
      (async () => {
        const staticCache = await caches.open(STATIC_CACHE);
        if (isHashedProdAsset) {
          const cached = await staticCache.match(request);
          if (cached) {
            return cached;
          }
        }
        try {
          const response = await fetch(request);
          if (response && response.ok) {
            await staticCache.put(request, response.clone());
          }
          return response;
        } catch {
          const cached =
            (await staticCache.match(request)) ||
            (await staticCache.match(url.pathname));
          if (cached) {
            return cached;
          }
          return new Response('', {status: 504, statusText: 'Offline'});
        }
      })(),
    );
  }
});
