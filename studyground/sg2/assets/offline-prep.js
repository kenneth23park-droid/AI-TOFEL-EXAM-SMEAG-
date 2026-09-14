/* SMEAG · StudyGround — 오프라인 사전 다운로드 · 자동 업데이트.
 *
 * 문제 하나. 서비스워커는 셸(HTML·CSS·JS·문항 데이터)만 install 시점에 프리캐시하고,
 * 미디어는 재생 요청이 올 때 넣는다(sw.js 의 cache-first 미디어 분기). 학생은 시험 전에
 * 리스닝 mp3 를 들어볼 이유가 없으니, "학원 와이파이에서 설치 → 시험장에서 무음"이 된다.
 *
 * 문제 둘. 오디오는 같은 주소에 새 파일로 덮이는 일이 잦다 — 음성을 다시 생성해도 url 은
 * 그대로다. 캐시는 cache-first 라 주소만 봐서는 바뀐 줄을 모르고, 기기에는 옛 음성이
 * 그대로 남는다. 출제자가 고친 오디오가 학생 귀에 닿지 않는다.
 *
 * 그래서 목록(config/offline.<set>.json)에 파일마다 내용 해시를 담고, 페이지가 열릴 때마다
 * 온라인이면 목록을 새로 읽어 기기가 가진 것과 맞춰 본다.
 *   · 없는 파일   → 받는다
 *   · 해시가 다른 파일 → 그것만 다시 받는다 (전체 25 MB 가 아니라)
 *   · 목록에서 빠진 파일 → 캐시에서 지운다
 * 학생이 누를 버튼은 없다.
 *
 * 캐시 이름은 서비스워커에게 물어본다. 넣는 것도 페이지가 직접 cache.put 으로 한다 —
 * 서비스워커를 통과시키는(fetch) 방식은 첫 방문처럼 아직 controller 가 없는 상태에서
 * 조용히 캐시를 건너뛴다.
 */
(function () {
  'use strict';

  // 시험 화면은 예외다. 응시 중에 파일을 끌어오면 지금 재생돼야 할 오디오와 회선을
  // 다툰다. 그쪽에서는 <script ... data-mode="check"> 로 불러 확인과 경고만 시킨다.
  var MODE = (document.currentScript && document.currentScript.dataset.mode) || 'auto';

  /* 어느 세트의 목록을 볼 것인가.
   *
   * 여기 'config/offline.set9.json' 이 박혀 있던 동안, SET 10·11 의 mp3 는 단 한 번도
   * 미리 받아지지 않았다 — 시험장에서 클립마다 회선을 탔고, 한 번 끊기면 그 블록의
   * 문항이 통째로 날아갔다(2026-09-02 SET 11 Listening L2 12-15). 그래서 목록은
   * 세트를 따라간다.
   *   · 응시 화면(?set= / ?testId=)  → 그 세트 하나만 본다. 경고도 그 세트 것이어야 한다.
   *   · 목록 화면(index·tests·dashboard) → config/offline.sets.json 의 세트를 전부 받는다.
   *     어느 세트를 칠지 모르는 자리라, 하나만 받아 두면 나머지는 여전히 회선에 기댄다. */
  var SET_LIST = 'config/offline.sets.json';
  var FALLBACK_SETS = ['set9'];
  var CONCURRENCY = 4;          // 학원 회선을 다 먹지 않으면서 25 MB 를 몇 분 안에 끝내는 선.
  var REC_KEY = 'sg2_offline_have';   // { rev, have: { url: hash } }

  function query(name) {
    var loc = window.location || {};
    var m = new RegExp('[?&]' + name + '=([^&]*)').exec(String(loc.search || ''));
    return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
  }

  /* exam-shell.js currentSetId() 와 같은 규칙이다 — 두 곳이 다른 세트를 가리키면
     "준비 완료"라고 말해 놓고 다른 세트의 음성을 트는 일이 생긴다. */
  function urlSetId() {
    var explicit = query('set').toLowerCase();
    if (/^[a-z0-9]+$/.test(explicit)) return explicit;
    var t = String(query('testId') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!t) return '';
    if (/(^|[A-Z])0*12$/.test(t) || t === 'SET12') return 'set12';
    if (/(^|[A-Z])0*11$/.test(t) || t === 'SET11') return 'set11';
    if (/(^|[A-Z])0*10$/.test(t) || t === 'SET10') return 'set10';
    if (/(^|[A-Z])0*9$/.test(t) || t === 'SET9') return 'set9';
    if (/(^|[A-Z])0*2$/.test(t) || t === 'SET2') return 'set2';
    return 'set1';
  }

  function manifestUrl(setId) { return 'config/offline.' + setId + '.json'; }

  /* 볼 목록들. 세트가 지목돼 있으면 그것 하나, 아니면 sets.json 전부. */
  var partialView = false;   // 세트 하나만 보고 있다 — 다른 세트의 캐시를 건드리면 안 된다.

  function manifestUrls() {
    var one = urlSetId();
    partialView = !!one;
    if (one) return Promise.resolve([manifestUrl(one)]);
    return fetch(absolute(SET_LIST), { cache: 'no-store' })
      .catch(function () { return fetch(absolute(SET_LIST)); })
      .then(function (r) { if (!r.ok) throw new Error('sets ' + r.status); return r.json(); })
      .then(function (j) {
        var list = (j && j.sets && j.sets.length) ? j.sets : FALLBACK_SETS;
        return list.map(manifestUrl);
      })
      .catch(function () { return FALLBACK_SETS.map(manifestUrl); });
  }

  /* 여러 세트를 한 목록처럼 다룬다. 같은 파일을 두 세트가 참조하면 한 번만 센다 —
     아니면 진행률의 분모가 실제로 받아야 할 양보다 커진다. */
  function merge(parts) {
    if (parts.length === 1) return parts[0];
    var files = [], seen = {}, labels = [], i, j;
    for (i = 0; i < parts.length; i++) {
      labels.push(parts[i].label || parts[i].set || '');
      var fs = parts[i].files || [];
      for (j = 0; j < fs.length; j++) {
        if (seen[fs[j].u]) continue;
        seen[fs[j].u] = true;
        files.push(fs[j]);
      }
    }
    files.sort(function (a, b) { return a.u < b.u ? -1 : (a.u > b.u ? 1 : 0); });
    var rev = '', bytes = 0;
    for (i = 0; i < files.length; i++) { rev += files[i].u + ':' + files[i].h + '|'; bytes += files[i].b; }
    return {
      set: parts.map(function (p) { return p.set; }).join('+'),
      label: labels.join(' · '),
      /* rev 는 "받을 것이 있는가"를 한 번에 가르는 지문일 뿐이라 해시 함수까지 갈 것 없다.
         목록이 한 글자라도 다르면 다른 문자열이 된다. */
      rev: rev.length + ':' + files.length,
      count: files.length,
      bytes: bytes,
      files: files
    };
  }

  var state = {
    manifest: null,
    total: 0, have: 0, bytes: 0, haveBytes: 0,
    fresh: 0, stale: 0,          // 새로 받을 것 / 바뀌어서 다시 받을 것
    running: false, done: false, failed: 0,
    update: false,               // 이번 작업이 "첫 준비"가 아니라 "업데이트"인가
  };

  // ── 기기가 무엇을 가지고 있는지에 대한 기록 ──────────────────
  // 캐시는 "있다/없다"만 답한다. 무엇을 받았는지(어느 판본인지)는 여기 적어 둔다.
  function record() {
    try { return JSON.parse(localStorage.getItem(REC_KEY) || '{}') || {}; }
    catch (e) { return {}; }
  }
  function remember(rev, have) {
    try { localStorage.setItem(REC_KEY, JSON.stringify({ rev: rev, have: have })); }
    catch (e) {}
  }

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

  // ── 목록 읽기 ───────────────────────────────────────────────
  // 온라인이면 언제나 서버 것을 새로 읽는다. 이 한 번의 20 KB 요청이 "업데이트가
  // 있는가"를 가른다. 오프라인이면 셸 캐시에 프리캐시된 판본으로 되돌아간다.
  function loadOne(url) {
    return fetch(absolute(url), { cache: 'no-store' })
      .catch(function () { return fetch(absolute(url)); })   // 오프라인 → 캐시본
      .then(function (r) { if (!r.ok) throw new Error('manifest ' + r.status); return r.json(); });
  }

  function load(force) {
    if (state.manifest && !force) return Promise.resolve(state.manifest);
    return manifestUrls().then(function (urls) {
      return Promise.all(urls.map(loadOne));
    }).then(function (parts) {
      var m = merge(parts);
      state.manifest = m;
      state.total = m.files.length;
      state.bytes = m.bytes;
      return m;
    });
  }

  // ── 무엇이 없고 무엇이 바뀌었는지 ───────────────────────────
  function survey() {
    return load(true).then(function (m) {
      return mediaCacheName().then(function (name) {
        if (!name) {
          return { supported: false, ready: false, have: 0, total: m.files.length,
                   fresh: m.files.length, stale: 0, todo: [], prune: [], manifest: m, cache: null };
        }
        var rec = record();
        var known = rec.have || {};
        return caches.open(name).then(function (cache) {
          return cache.keys().then(function (keys) {
            var inCache = {};
            keys.forEach(function (req) { inCache[req.url] = true; });

            var todo = [], have = 0, haveBytes = 0, fresh = 0, stale = 0;
            var wanted = {};
            m.files.forEach(function (f) {
              var url = absolute(f.u);
              wanted[url] = true;
              if (!inCache[url]) { todo.push(f); fresh++; return; }
              if (known[f.u] !== f.h) {
                // 주소는 같은데 내용이 바뀌었다 — 캐시에 있는 건 옛 음성이다.
                todo.push(f); stale++; return;
              }
              have++; haveBytes += f.b;
            });

            /* 목록에서 빠진 파일 — 문항이 교체되면 옛 오디오가 캐시에 남는다.
               단, 세트 하나만 보고 있을 때는 지우지 않는다. 그 목록에 없는 파일은
               "버려진 파일"이 아니라 그냥 다른 세트의 파일이다. */
            var prune = partialView ? [] : keys.filter(function (req) {
              return !wanted[req.url] && req.url.indexOf('/media/') !== -1;
            });

            state.have = have; state.haveBytes = haveBytes;
            state.fresh = fresh; state.stale = stale;
            state.done = todo.length === 0;
            state.update = stale > 0 || (rec.rev && rec.rev !== m.rev && fresh < m.files.length);

            return {
              supported: true, ready: todo.length === 0,
              have: have, total: m.files.length,
              haveBytes: haveBytes, bytes: m.bytes,
              fresh: fresh, stale: stale, prune: prune.length,
              update: state.update, rev: m.rev, knownRev: rec.rev || null,
              label: m.label,
              todo: todo, _prune: prune, manifest: m, cache: cache,
            };
          });
        });
      });
    });
  }

  function status() {
    return survey().then(function (s) {
      // 내부용 필드는 밖으로 내보내지 않는다.
      return {
        supported: s.supported, ready: s.ready, update: s.update,
        have: s.have, total: s.total, haveBytes: s.haveBytes, bytes: s.bytes,
        fresh: s.fresh, stale: s.stale, prune: s.prune,
        rev: s.rev, knownRev: s.knownRev, label: s.label,
      };
    });
  }

  // ── 내려받기 ────────────────────────────────────────────────
  function sync(onProgress) {
    if (state.running) return Promise.resolve(null);
    state.running = true;
    state.failed = 0;

    return survey().then(function (s) {
      if (!s.supported) throw new Error('no-sw');
      var cache = s.cache, m = s.manifest;
      var rec = record();
      var have = rec.have || {};

      // 목록에서 빠진 것부터 지운다 — 자리를 먼저 비워야 용량이 늘지 않는다.
      return Promise.all(s._prune.map(function (req) {
        return cache.delete(req).then(function () {
          Object.keys(have).forEach(function (u) { if (absolute(u) === req.url) delete have[u]; });
        });
      })).then(function () {
        var queue = s.todo.slice();
        emit(onProgress);

        var next = 0;
        function worker() {
          if (next >= queue.length) return Promise.resolve();
          var f = queue[next++];
          // x-sg-refresh — 서비스워커의 미디어 cache-first 를 비켜 가라는 표식.
          // 없으면 갱신하러 보낸 요청이 캐시의 옛 파일로 되돌아와, 옛 것을 제자리에
          // 도로 넣게 된다(받기는 받았는데 내용은 그대로다).
          return fetch(absolute(f.u), { cache: 'no-store', headers: { 'x-sg-refresh': '1' } })
            .then(function (res) {
              if (!res.ok || res.status !== 200) throw new Error(res.status);
              return cache.put(absolute(f.u), res);
            })
            .then(function () {
              have[f.u] = f.h;                       // 이 판본을 가졌다고 적는다
              state.have++; state.haveBytes += f.b;
              emit(onProgress);
            })
            .catch(function () {
              state.failed++; emit(onProgress);
            })
            .then(worker);
        }

        var workers = [];
        for (var i = 0; i < Math.min(CONCURRENCY, queue.length); i++) workers.push(worker());
        return Promise.all(workers).then(function () {
          state.done = state.failed === 0 && state.have === state.total;
          // 전부 받았을 때만 rev 를 기록한다 — 반쪽짜리를 최신으로 적으면
          // 다음 방문이 "받을 것 없음"으로 지나간다.
          remember(state.done ? m.rev : (rec.rev || null), have);
        });
      });
    }).then(function () {
      state.running = false;
      emit(onProgress);
      return state;
    }).catch(function (err) {
      state.running = false;
      emit(onProgress, err);
      throw err;
    });
  }

  function emit(cb, err) {
    if (cb) cb(snapshot(err));
  }

  function snapshot(err) {
    return {
      have: state.have, total: state.total,
      haveBytes: state.haveBytes, bytes: state.bytes,
      fresh: state.fresh, stale: state.stale,
      running: state.running, done: state.done, failed: state.failed,
      update: state.update, error: err || null,
    };
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
  function bi(en, ko) { return '<span data-en>' + en + '</span><span data-ko>' + ko + '</span>'; }

  function paint(p) {
    var box = ui();
    var pct = p.bytes ? Math.round((p.haveBytes / p.bytes) * 100) : 0;
    box.classList.add('on');
    box.classList.toggle('ok', !!p.done);
    box.querySelector('.sg-prep-track i').style.width = pct + '%';

    var title = box.querySelector('.sg-prep-title');
    var sub = box.querySelector('.sg-prep-sub');
    var go = box.querySelector('.sg-prep-go');
    var left = p.total - p.have;

    if (p.done) {
      title.innerHTML = p.update
        ? bi('Updated for offline', '오프라인 자료 업데이트 완료')
        : bi('Ready for offline', '오프라인 준비 완료');
      sub.innerHTML = bi(
        'All ' + p.total + ' audio files are current on this device. Wi-Fi is no longer needed.',
        '오디오 ' + p.total + '개가 최신 상태로 이 기기에 있습니다. 이제 와이파이가 없어도 됩니다.');
      go.hidden = true;
      setTimeout(hide, 4000);
      return;
    }
    if (p.running) {
      title.innerHTML = p.update
        ? bi('Updating offline files', '오프라인 자료 업데이트 중')
        : bi('Preparing for offline', '오프라인 준비 중');
      sub.innerHTML = bi(
        p.have + ' of ' + p.total + ' audio files · ' + mb(p.haveBytes) + ' of ' + mb(p.bytes),
        '오디오 ' + p.have + ' / ' + p.total + '개 · ' + mb(p.haveBytes) + ' / ' + mb(p.bytes));
      go.hidden = true;
      return;
    }

    // 멈춰 있다 — 오프라인이거나, 데이터 절약 중이거나, 시험 화면이거나, 실패했다.
    if (p.stale && !p.fresh) {
      title.innerHTML = bi('Updated audio available', '수정된 오디오가 있습니다');
      sub.innerHTML = bi(
        p.stale + ' file' + (p.stale > 1 ? 's have' : ' has') + ' changed on the server. This device still has the old version.',
        '서버에서 ' + p.stale + '개가 바뀌었습니다. 이 기기에는 아직 옛 파일이 있습니다.');
    } else {
      title.innerHTML = bi('Offline files not ready', '오프라인 파일 미완료');
      sub.innerHTML = bi(
        left + ' audio files are missing. Listening will be silent without Wi-Fi.',
        '오디오 ' + left + '개가 없습니다. 와이파이 없이는 리스닝이 무음입니다.');
    }
    go.hidden = false;
    go.innerHTML = bi('Download now (' + mb(p.bytes - p.haveBytes) + ')',
                      '지금 받기 (' + mb(p.bytes - p.haveBytes) + ')');
    go.onclick = function () { sync(paint).catch(function () {}); };
  }

  function hide() { if (el) el.classList.remove('on'); }

  // ── 자동 실행 ───────────────────────────────────────────────
  // 주소를 열면 그만이다. 없으면 받고, 바뀌었으면 바뀐 것만 받고, 최신이면 아무 일도
  // 일어나지 않는다.
  function auto() {
    survey().then(function (s) {
      if (!s.supported) return;      // 서비스워커가 없으면 오프라인 자체가 성립하지 않는다.
      if (s.ready && !s.prune) return;   // 최신이다 — 화면에 아무것도 띄우지 않는다.

      // 시험 화면 — 받지는 않고, 무엇이 빠졌는지만 알린다. 감독관이 보고 판단할 몫이다.
      if (MODE === 'check') { paint(snapshot()); return; }
      if (!navigator.onLine) { paint(snapshot()); return; }
      // 데이터 절약 모드·종량제 회선에서 말없이 당기지 않는다. 버튼만 보여준다.
      if ((navigator.connection || {}).saveData) { paint(snapshot()); return; }

      sync(paint).catch(function () { paint(snapshot()); });
    }).catch(function () { /* 목록을 못 읽으면 조용히 넘어간다 */ });
  }

  // 회선이 돌아오면 다시 본다 — 오프라인으로 열었다가 와이파이에 붙는 흔한 경우.
  window.addEventListener('online', function () {
    if (MODE === 'check' || state.running) return;
    auto();
  });

  window.SG_OFFLINE = {
    status: status,
    download: function () { return sync(paint); },
    check: function () { return status(); },
    show: function () { return survey().then(function () { paint(snapshot()); }); },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', auto);
  } else {
    auto();
  }
})();
