/* SMEAG StudyGround — service worker for full offline operation.
 *
 * Strategy:
 *   • App shell (HTML/CSS/JS/icons/data) is precached on install → instant offline.
 *   • Media (audio/images) is cached lazily on first play/view (cache-first), so
 *     the 12 MB of audio doesn't block install but is available offline once heard.
 *   • Navigation falls back to the cached page, then to index.html.
 */
// v4: SET 9 Listening M2 Q4-15 authored passages revised to rev3 and the four
//     set9-L2-*.mp3 regenerated at the SAME urls. The media cache is cache-first,
//     so without a version bump a returning device would keep serving the rev2
//     audio against rev3-corrected items. Bumping VERSION drops sg-media-sg-v3
//     in the activate handler and forces a re-fetch.
// v6: 시험 런타임 UI 를 녹화 프레임(docs/reference/screens/*) 기준으로 다시 맞췄다 —
//     exam.css / exam-runtime.html / exam-render-{instruction,listening,reading,writing,
//     speaking}.js 가 전부 바뀌었다. 이 파일들은 전부 SHELL_ASSETS(cache-first)라서
//     VERSION 을 올리지 않으면 재방문 기기가 옛 UI(빨간 중앙 pill 등)를 계속 본다.
const VERSION = 'sg-v7';   // v7: exam-shell.js 와 /en/test-nt/ 라우트 페이지를 프리캐시에 추가
const SHELL = 'sg-shell-' + VERSION;
const MEDIA = 'sg-media-' + VERSION;

const SHELL_ASSETS = [
  'index.html', 'npz.html', 'tests.html', 'dashboard.html', 'learning.html',
  'community.html', 'tools.html', 'purchase.html', 'login.html', 'signup.html', 'exam.html',
  'set9.html',
  'assets/app.css', 'assets/app.js', 'assets/set1.js', 'assets/set9.js', 'assets/set9-audio.js',
  'assets/icon-192.png', 'assets/icon-512.png', 'assets/favicon.svg',
  'manifest.webmanifest',

  // Exam runtime (Epic 1–2). The shell must be fully precached: a test that starts
  // online and loses the network mid-section still has to reach the submit screen.
  'exam-runtime.html', 'assets/exam.css',
  'assets/exam-types.js', 'assets/exam-media.js', 'assets/exam-timing.js',
  'assets/exam-compile.js', 'assets/exam-clock.js', 'assets/exam-store.js',
  'assets/exam-render.js', 'assets/exam-engine.js', 'assets/exam-recorder.js',
  'assets/exam-render-instruction.js', 'assets/exam-render-listening.js',
  'assets/exam-render-reading.js', 'assets/exam-render-writing.js',
  'assets/exam-render-speaking.js', 'assets/exam-sync.js',

  // Timing profiles — exam-timing.js falls back to an inline default if these are
  // missing, but precaching them keeps offline timings identical to online ones.
  'config/timing.toefl.json', 'config/timing.ielts.json',

  // 시험 셸 스크립트 — exam-runtime.html 과 라우트 페이지가 공유한다.
  'assets/exam-shell.js',

  // /en/test-nt/{section} 라우트 페이지 (tools/build_routes.py 가 생성).
  // 응시자가 이 주소로 진입할 수 있으므로 오프라인에서도 열려야 한다.
  'en/test-nt/reading/index.html', 'en/test-nt/listening/index.html',
  'en/test-nt/speaking/index.html', 'en/test-nt/writing/index.html'
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
