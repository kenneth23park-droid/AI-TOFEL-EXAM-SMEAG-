/* SMEAG · StudyGround — 오프라인 사전 다운로드.
 *
 * 문제. 서비스워커는 셸(HTML·CSS·JS·문항 데이터)만 install 시점에 프리캐시하고,
 * 미디어는 재생 요청이 올 때 넣는다(sw.js 의 cache-first 미디어 분기). 12 MB 이던
 * 시절에는 맞는 절충이었지만, 학생은 시험 전에 리스닝 mp3 를 들어볼 이유가 없다.
 * 그래서 "학원 와이파이에서 설치 → 시험장에서 무음"이 된다.
 *
 * 해법. 페이지가 열리는 순간, 이 SET 이 쓰는 미디어(config/offline.<set>.json,
 * 91개 25 MB)가 캐시에 다 있는지 보고 없으면 알아서 받는다. 학생이 누를 버튼은 없다.
 *
 * 캐시 이름은 서비스워커에게 물어본다. sw.js 의 VERSION 은 문항이 바뀔 때마다 오르고
 * 옛 미디어 캐시는 activate 에서 지워지므로, 여기서 이름을 짐작해 쓰면 판올림 직후
 * 엉뚱한(이미 버려진) 캐시를 채우게 된다.
 *
 * 내려받기는 페이지 쪽에서 cache.put 으로 직접 넣는다. 서비스워커를 통과시키는(fetch)
 * 방식은 첫 방문처럼 아직 controller 가 없는 상태에서 조용히 캐시를 건너뛴다.
 */
(function () {
  'use strict';

  // 시험 화면은 예외다. 응시 중에 25 MB 를 끌어오면 지금 재생돼야 할 오디오와 회선을
  // 다툰다. 그쪽에서는 <script ... data-mode="check"> 로 불러 확인과 경고만 시킨다.
  var MODE = (document.currentScript && document.currentScript.dataset.mode) || 'auto';

  var MANIFEST = 'config/offline.set9.json';
  var CONCURRENCY = 4;          // 학원 회선을 다 먹지 않으면서 25 MB 를 몇 분 안에 끝내는 선.
  var DONE_KEY = 'sg2_offline_done';

  var state = {
    manifest: null,
    total: 0, have: 0,
    bytes: 0, haveBytes: 0,
    running: false, done: false, failed: 0,
  };

  // ── 서비스워커에게 캐시 이름 묻기 ──────────────────────────────
  function mediaCacheName() {
    if (!('serviceWorker' in navigator)) return Promise.resolve(null);
    return navigator.serviceWorker.ready.then(function (reg) {
      var sw = reg.active;
      if (!sw) return null;
      return new Promise(function (resolve) {
        var ch = new MessageChannel();
        var settled = false;
        ch.port1.onmessage = function (e) {
          settled = true;
          resolve((e.data && e.data.media) || null);
        };
        sw.postMessage({ type: 'sg-cache-names' }, [ch.port2]);
        // 옛 서비스워커는 이 메시지를 모른다 — 답이 없으면 그냥 포기한다.
        setTimeout(function () { if (!settled) resolve(null); }, 1500);
      });
    }).catch(function () { return null; });
  }

  function absolute(url) {
    // /en/test-nt/* 라우트 페이지는 <base href="../../../"> 를 두고 있다.
    return new URL(url, document.baseURI).href;
  }

  // ── 현황 ────────────────────────────────────────────────────
  function load() {
    if (state.manifest) return Promise.resolve(state.manifest);
    return fetch(absolute(MANIFEST), { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('manifest ' + r.status); return r.json(); })
      .then(function (m) {
        state.manifest = m;
        state.total = m.files.length;
        state.bytes = m.bytes;
        return m;
      });
  }

  function status() {
    return load().then(function (m) {
      return mediaCacheName().then(function (name) {
        if (!name) return { supported: false, ready: false, have: 0, total: m.files.length };
        return caches.open(name).then(function (cache) {
          return Promise.all(m.files.map(function (f) {
            return cache.match(absolute(f.u)).then(function (hit) { return hit ? f.b : 0; });
          })).then(function (sizes) {
            var have = 0, haveBytes = 0;
            sizes.forEach(function (b) { if (b) { have++; haveBytes += b; } });
            state.have = have;
            state.haveBytes = haveBytes;
            state.done = have === m.files.length;
            return {
              supported: true, ready: state.done,
              have: have, total: m.files.length,
              haveBytes: haveBytes, bytes: m.bytes,
              label: m.label,
            };
          });
        });
      });
    });
  }

  // ── 내려받기 ────────────────────────────────────────────────
  function download(onProgress) {
    if (state.running) return Promise.resolve(null);
    state.running = true;
    state.failed = 0;

    return load().then(function (m) {
      return mediaCacheName().then(function (name) {
        if (!name) throw new Error('no-sw');
        return caches.open(name).then(function (cache) {
          // 이미 있는 건 건너뛴다 — 중간에 끊겼다 다시 열어도 이어받는 효과가 난다.
          return Promise.all(m.files.map(function (f) {
            return cache.match(absolute(f.u)).then(function (hit) { return hit ? null : f; });
          })).then(function (checked) {
            var queue = checked.filter(Boolean);
            state.have = m.files.length - queue.length;
            state.haveBytes = m.bytes - queue.reduce(function (s, f) { return s + f.b; }, 0);
            emit(onProgress);

            var next = 0;
            function worker() {
              if (next >= queue.length) return Promise.resolve();
              var f = queue[next++];
              return fetch(absolute(f.u), { cache: 'no-store' })
                .then(function (res) {
                  if (!res.ok || res.status !== 200) throw new Error(res.status);
                  return cache.put(absolute(f.u), res);
                })
                .then(function () {
                  state.have++; state.haveBytes += f.b; emit(onProgress);
                })
                .catch(function () {
                  state.failed++; emit(onProgress);
                })
                .then(worker);
            }

            var workers = [];
            for (var i = 0; i < Math.min(CONCURRENCY, queue.length); i++) workers.push(worker());
            return Promise.all(workers);
          });
        });
      });
    }).then(function () {
      state.running = false;
      state.done = state.failed === 0 && state.have === state.total;
      if (state.done) { try { localStorage.setItem(DONE_KEY, String(state.total)); } catch (e) {} }
      emit(onProgress);
      return state;
    }).catch(function (err) {
      state.running = false;
      emit(onProgress, err);
      throw err;
    });
  }

  function emit(cb, err) {
    if (cb) cb({
      have: state.have, total: state.total,
      haveBytes: state.haveBytes, bytes: state.bytes,
      running: state.running, done: state.done, failed: state.failed,
      error: err || null,
    });
  }

  // ── 진행 표시 ───────────────────────────────────────────────
  // 조용한 물건이다. 받는 동안만 구석에 떠 있고, 끝나면 스스로 사라진다.
  var el = null;

  function ui() {
    if (el) return el;
    el = document.createElement('div');
    el.className = 'sg-prep';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML =
      '<div class="sg-prep-row">' +
        '<span class="sg-prep-dot"></span>' +
        '<b class="sg-prep-title"></b>' +
        '<button type="button" class="sg-prep-x" aria-label="Hide">&times;</button>' +
      '</div>' +
      '<div class="sg-prep-track"><i></i></div>' +
      '<div class="sg-prep-sub"></div>' +
      '<button type="button" class="sg-prep-go" hidden></button>';
    el.querySelector('.sg-prep-x').addEventListener('click', function () { hide(); });
    document.body.appendChild(el);
    return el;
  }

  function mb(n) { return (n / 1e6).toFixed(1) + ' MB'; }

  function paint(p) {
    var box = ui();
    var pct = p.bytes ? Math.round((p.haveBytes / p.bytes) * 100) : 0;
    box.classList.add('on');
    box.classList.toggle('ok', !!p.done);
    box.querySelector('.sg-prep-track i').style.width = pct + '%';

    var title = box.querySelector('.sg-prep-title');
    var sub = box.querySelector('.sg-prep-sub');
    var go = box.querySelector('.sg-prep-go');

    if (p.done) {
      title.innerHTML = '<span data-en>Ready for offline</span><span data-ko>오프라인 준비 완료</span>';
      sub.innerHTML = '<span data-en>All ' + p.total + ' audio files are on this device. Wi-Fi is no longer needed.</span>' +
                      '<span data-ko>오디오 ' + p.total + '개가 이 기기에 있습니다. 이제 와이파이가 없어도 됩니다.</span>';
      go.hidden = true;
      setTimeout(hide, 4000);
      return;
    }
    if (p.running) {
      title.innerHTML = '<span data-en>Preparing for offline</span><span data-ko>오프라인 준비 중</span>';
      sub.innerHTML = '<span data-en>' + p.have + ' of ' + p.total + ' audio files · ' + mb(p.haveBytes) + ' of ' + mb(p.bytes) + '</span>' +
                      '<span data-ko>오디오 ' + p.have + ' / ' + p.total + '개 · ' + mb(p.haveBytes) + ' / ' + mb(p.bytes) + '</span>';
      go.hidden = true;
      return;
    }
    // 멈춰 있다 — 오프라인이거나, 데이터 절약 중이거나, 실패했다.
    title.innerHTML = '<span data-en>Offline files not ready</span><span data-ko>오프라인 파일 미완료</span>';
    sub.innerHTML = '<span data-en>' + (p.total - p.have) + ' audio files are missing. Listening will be silent without Wi-Fi.</span>' +
                    '<span data-ko>오디오 ' + (p.total - p.have) + '개가 없습니다. 와이파이 없이는 리스닝이 무음입니다.</span>';
    go.hidden = false;
    go.innerHTML = '<span data-en>Download now (' + mb(p.bytes - p.haveBytes) + ')</span>' +
                   '<span data-ko>지금 받기 (' + mb(p.bytes - p.haveBytes) + ')</span>';
    go.onclick = function () { download(paint).catch(function () {}); };
  }

  function hide() { if (el) el.classList.remove('on'); }

  // ── 자동 실행 ───────────────────────────────────────────────
  // 주소를 열면 그만이다. 없으면 받고, 있으면 아무 일도 일어나지 않는다.
  function auto() {
    status().then(function (s) {
      if (!s.supported) return;      // 서비스워커가 없으면 오프라인 자체가 성립하지 않는다.
      if (s.ready) return;           // 이미 다 있다 — 화면에 아무것도 띄우지 않는다.

      // 시험 화면 — 받지는 않고, 무엇이 빠졌는지만 알린다. 감독관이 보고 판단할 몫이다.
      if (MODE === 'check') { paint(snapshot()); return; }

      var conn = navigator.connection || {};
      if (!navigator.onLine) { paint(snapshot()); return; }
      // 데이터 절약 모드·종량제 회선에서 25 MB 를 말없이 당기지 않는다. 버튼만 보여준다.
      if (conn.saveData) { paint(snapshot()); return; }

      download(paint).catch(function () { paint(snapshot()); });
    }).catch(function () { /* 목록을 못 읽으면 조용히 넘어간다 */ });
  }

  function snapshot() {
    return {
      have: state.have, total: state.total,
      haveBytes: state.haveBytes, bytes: state.bytes,
      running: state.running, done: state.done, failed: state.failed,
    };
  }

  window.SG_OFFLINE = {
    status: status,
    download: function () { return download(paint); },
    show: function () { return status().then(function () { paint(snapshot()); }); },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', auto);
  } else {
    auto();
  }
})();
