// Service worker mínimo para LivePlay (PWA instalable).
//
// A propósito NO cachea nada "de negocio": ni /api/*, ni los videos de los partidos
// (son archivos grandes y siempre tienen que venir del origen/CDN real para respetar el
// paywall y no quedar una copia vieja en el caché del usuario), ni las páginas de login/
// pago. Lo único que cachea es el "app shell" estático (JS/CSS hasheado por Next, íconos,
// manifest) para que la app instalada abra rápido y no quede en blanco si por un instante
// no hay red — y una página de fallback muy simple para cuando SÍ se corta la red del todo
// en medio de una navegación.
const CACHE_NAME = 'liveplay-shell-v1';
const OFFLINE_URL = '/offline.html';

const SHELL_ASSETS = [
  OFFLINE_URL,
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // nunca intercepta POST/PUT (pagos, login, etc.)

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // nunca intercepta terceros (Mercado Pago, etc.)
  if (url.pathname.startsWith('/api/')) return; // nunca cachea respuestas de la API

  // Navegación (cargar una página completa): red primero, y si falla (sin conexión),
  // cae a la página offline cacheada en vez de mostrar el error del navegador.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  // Assets estáticos de Next (JS/CSS con hash en el nombre, por lo tanto inmutables):
  // cache-first, y de paso los guarda para la próxima vez.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
  }
});
