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
// v9: 내부용 접근 게이트(gate.html · assets/gate.js) 추가. 모든 셸 HTML 의 <head> 가
//     바뀌었고, 오프라인에서도 게이트를 통과해야 하므로 두 파일을 프리캐시에 넣는다.
// v10: 관리자 오디오 설정(admin-audio.html · assets/audio-config.js) 추가.
//      오프라인에서도 출제자가 문항별 오디오를 지정/미리듣기 할 수 있어야 하므로 프리캐시.
// v11: SET 별 관리자 계층 추가 — 관리자 로그인(assets/admin-session.js), 오디오
//      정지/일시정지 트랜스포트와 플로팅 바(assets/admin-bar.js), 문항 교체
//      스토어(assets/question-config.js), 오디오 목록(assets/audio-index.js),
//      그리고 두 관리자 화면(admin-audio-files.html · admin-questions.html).
//      set9.html / exam-runtime.html / tests.html / admin-audio.html 의 <script>
//      목록이 바뀌었으므로 VERSION 을 올려 셸 캐시를 새로 채운다.
// v12: 문항 스크립트 → 음성 생성. 서버리스 함수 api/tts.js (키는 Vercel 환경변수)와
//      클라이언트 assets/tts-client.js 추가. /api/* 는 프리캐시·런타임 캐시 모두 제외한다.
// v13: 대본↔오디오 대조 화면(admin-audio-sync.html)과 그 데이터
//      (config/audio-check.set9.json) 추가. 여러 셸 HTML 의 네비가 바뀌었다.
const VERSION = 'sg-v13';
const SHELL = 'sg-shell-' + VERSION;
const MEDIA = 'sg-media-' + VERSION;

const SHELL_ASSETS = [
  'index.html', 'npz.html', 'tests.html', 'dashboard.html', 'learning.html',
  'community.html', 'tools.html', 'purchase.html', 'login.html', 'signup.html', 'exam.html',
  'set9.html', 'admin-audio.html', 'admin-audio-files.html', 'admin-questions.html',
  'admin-audio-sync.html', 'config/audio-check.set9.json',

  // 내부용 접근 게이트 — 오프라인 진입도 이 화면을 먼저 지난다.
  'gate.html', 'assets/gate.js', 'assets/audio-config.js',

  // SET 별 관리자 계층 — 오프라인 수업 중에도 정지/일시정지·교체가 되어야 한다.
  'assets/admin-session.js', 'assets/admin-bar.js', 'assets/tts-client.js',
  'assets/question-config.js', 'assets/audio-index.js',

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

  // 서버리스 함수(/api/*)는 캐시 대상이 아니다 — TTS 생성 결과가 굳어버리면 안 된다.
  if (url.pathname.startsWith('/api/') || url.pathname.endsWith('/api/tts')) return;

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
