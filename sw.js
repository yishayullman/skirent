// Service Worker - מאפשר התקנת אפליקציה (PWA) + מטמון תמונות לטעינה מהירה.
// שים לב: HTML ו-JS לא נשמרים במטמון, כדי שגרסאות חדשות של האתר יגיעו מיד לכולם.

const IMG_CACHE = 'skirent-img-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // מנקה מטמונים ישנים מגרסאות קודמות
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== IMG_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isLocalImage = url.origin === self.location.origin && /\.(png|jpe?g|webp|svg|gif)$/i.test(url.pathname);

  if (isLocalImage) {
    // תמונות: מציגים מהמטמון מיד ומעדכנים ברקע (stale-while-revalidate)
    event.respondWith(
      caches.open(IMG_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        const fetched = fetch(req).then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        }).catch(() => cached);
        return cached || fetched;
      })
    );
    return;
  }

  // כל השאר עובר לרשת כרגיל, בלי caching
  event.respondWith(fetch(req));
});
