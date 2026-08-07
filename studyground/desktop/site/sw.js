/* SMEAG StudyGround — service worker for full offline operation.
 *
 * Strategy:
 *   • App shell (HTML/CSS/JS/icons/data) is precached on install → instant offline.
 *   • Media (audio/images) is cached lazily on first play/view (cache-first), so
 *     the 12 MB of audio doesn't block install but is available offline once heard.
 *   • Navigation falls back to the cached page, then to index.html.
 */
const VERSION = 'sg-v1';
const SHELL = 'sg-shell-' + VERSION;
const MEDIA = 'sg-media-' + VERSION;

const SHELL_ASSETS = [
  'index.html', 'npz.html', 'tests.html', 'dashboard.html', 'learning.html',
  'community.html', 'tools.html', 'purchase.html', 'login.html', 'signup.html', 'exam.html',
  'assets/app.css', 'assets/app.js', 'assets/set1.js', 'assets/set9.js',
  'assets/icon-192.png', 'assets/icon-512.png', 'assets/favicon.svg',
  'manifest.webmanifest'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL).then((c) => c.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== SHELL && k !== MEDIA).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

function isMedia(url) {
  return url.pathname.includes('/media/');
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Media: cache-first, then network, then store for next time (supports range requests).
  if (isMedia(url)) {
    e.respondWith(
      caches.open(MEDIA).then((cache) =>
        cache.match(req).then((hit) =>
          hit || fetch(req).then((res) => {
            if (res.ok && res.status === 200) cache.put(req, res.clone());
            return res;
          }).catch(() => hit)
        )
      )
    );
    return;
  }

  // Navigation & shell: cache-first with network refresh, fallback to index.
  e.respondWith(
    caches.match(req).then((hit) =>
      hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(SHELL).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() =>
        req.mode === 'navigate' ? caches.match('index.html') : undefined
      )
    )
  );
});
