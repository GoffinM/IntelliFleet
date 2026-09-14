// Service worker minimal : cache l'app shell (fichiers statiques) pour un chargement
// rapide/installabilité. Ne met JAMAIS en cache les appels Supabase (API/Storage) —
// l'app reste online-only pour cette tranche, la donnée doit toujours venir du réseau.
//
// IMPORTANT (leçon apprise sur Amajambo, reproduite ici) : un cache-first sur app.js
// combiné au fait que les navigateurs ne revérifient le contenu de sw.js que
// périodiquement (jusqu'à 24h par défaut) peut bloquer un appareil sur une très
// ancienne version pendant toute une session de debug actif, sans erreur visible.
// Tant qu'on est en phase de debugging intensif : app.js est exclu du cache (toujours
// réseau), et CACHE_NAME doit être incrémenté à chaque déploiement significatif pour
// invalider le reste du cache dès qu'une nouvelle version de sw.js est enfin détectée.
const CACHE_NAME = 'intellifleet-shell-v2';
const SHELL_FILES = [
  './',
  './index.html',
  './style.css',
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

  // app.js : toujours depuis le réseau, jamais servi depuis le cache pendant cette
  // phase de debugging actif — c'est le fichier qui change à chaque itération.
  if (url.pathname.endsWith('/app.js')) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
