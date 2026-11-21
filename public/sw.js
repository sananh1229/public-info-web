const CACHE_NAME = 'community-info-pwa-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/admin.html',
  '/style.css',
  '/manifest.json',
  '/icon.svg'
];

// ຕິດຕັ້ງ Service Worker ແລະ ເກັບໄຟລ໌ຫຼັກລົງ Cache
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// ລຶບ Cache ເກົ່າເມື່ອມີການອັບເດດເວີຊັນໃໝ່
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// ດຶງຂໍ້ມູນ: ຖ້າເປັນ /api/ ໃຫ້ດຶງຈາກເຊີບເວີສະເໝີ, ຖ້າເປັນໜ້າເວັບໃຫ້ໃຊ້ Network ກ່ອນແລ້ວສຳຮອງດ້ວຍ Cache
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const resClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});