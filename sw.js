// Service worker minimal : cache l'app shell (fichiers statiques) pour un chargement
// rapide/installabilité. Ne met JAMAIS en cache les appels Supabase (API/Storage) —
// l'app reste online-only pour cette tranche, la donnée doit toujours venir du réseau.
const CACHE_NAME = 'intellifleet-shell-v1';
const SHELL_FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './api.js',
  './supabase-client.js',
  './km-consistency.js',
  './manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.hostname.endsWith('.supabase.co') || url.hostname.endsWith('esm.sh')) return;

  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
