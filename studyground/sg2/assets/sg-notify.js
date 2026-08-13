/* SMEAG · StudyGround — sg-notify.js : 시험장에서 난 일을 메일로 흘려보낸다.
 *
 * 왜 있는가
 *   화면에 적는 것만으로는 아무도 모른다. 학생은 읽고 나가고, 감독 선생님은 그 PC
 *   앞에 없다. 2026-08-12 시험은 녹음 61건이 전부 거절당했는데 그날 저녁까지 아무도
 *   몰랐다. 같은 사실을 사람이 반드시 보는 자리(메일함)로도 보낸다.
 *
 * 계약 — 이 파일은 시험을 절대 멈추지 않는다(exam-cloud.js 와 같은 F12 약속).
 *   보내기는 전부 fire-and-forget 이다. 실패해도 던지지 않고, 로그인이 없거나
 *   회선이 없으면 localStorage 큐에 눌러 두었다가 다음 기회에 다시 보낸다.
 *   알림이 안 갔다고 화면이 달라지는 곳은 한 군데도 없다.
 *
 * 노출 전역: window.SG_NOTIFY
 *   SG_NOTIFY.issue(code, info)   무언가 어긋난 그 순간. 즉시 나간다.
 *   SG_NOTIFY.done(info)          한 응시가 끝난 자리에서 한 통(제출 + 점수 + 그날의 문제).
 *   SG_NOTIFY.flush()             큐에 남은 것을 다시 보낸다(페이지가 열릴 때·온라인이 될 때).
 *   SG_NOTIFY.watchCloud()        SG_CLOUD 에 붙어 회선 끊김·녹음 포기를 스스로 본다.
 *
 * 같은 사고를 두 번 보내지 않는다
 *   (session, kind, code) 하나당 한 번이다. 재시도가 열 통이 되면 그 메일함은
 *   곧 무시당하고, 무시당하는 알림은 없는 것과 같다. 서버(/api/notify)도 같은
 *   열쇠로 한 번 더 거른다 — 기기가 여러 대일 수 있어서다.
 */
(function (root) {
  'use strict';

  var ENDPOINT = '/api/notify';
  var QUEUE_KEY = 'sg2_notify_queue_v1';
  var SENT_KEY = 'sg2_notify_sent_v1';
  var MAX_QUEUE = 40;
  var RETRY_MS = 20000;
  var OFFLINE_MS = 90000;       // 이만큼 계속 끊겨 있으면 "회선이 끊겼다"고 본다

  var ctx = { session: '', setCode: '', mode: '' };
  var retryTimer = null;

  function ls(k) { try { return root.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { root.localStorage.setItem(k, v); } catch (e) {} }
  function readJSON(k, def) {
    try { var v = JSON.parse(ls(k) || ''); return v || def; } catch (e) { return def; }
  }

  function online() {
    var nav = root.navigator;
    return !nav || nav.onLine === undefined ? true : !!nav.onLine;
  }

  /* ── 한 번만 보내기 ──────────────────────────────────────── */

  function keyOf(msg) {
    return [msg.session || '', msg.kind || '', msg.code || ''].join('|');
  }

  /** 이미 보낸 열쇠인가. 목록은 최근 200개만 남긴다(기기 저장소가 로그 창고가 되면 안 된다). */
  function already(k) {
    var list = readJSON(SENT_KEY, []);
    if (list.indexOf(k) >= 0) return true;
    list.push(k);
    if (list.length > 200) list = list.slice(list.length - 200);
    lsSet(SENT_KEY, JSON.stringify(list));
    return false;
  }

  /* ── 큐 ──────────────────────────────────────────────────── */

  function queue() { return readJSON(QUEUE_KEY, []); }
  function saveQueue(list) {
    lsSet(QUEUE_KEY, JSON.stringify(list.slice(Math.max(0, list.length - MAX_QUEUE))));
  }

  function enqueue(msg) {
    var list = queue();
    list.push(msg);
    saveQueue(list);
    scheduleRetry(RETRY_MS);
  }

  function scheduleRetry(ms) {
    if (retryTimer !== null) return;
    retryTimer = root.setTimeout(function () { retryTimer = null; flush(); }, ms);
  }

  /* ── 보내기 ──────────────────────────────────────────────── */

  function token() {
    var A = root.SG_AUTH;
    if (!A || typeof A.token !== 'function') return Promise.resolve(null);
    try {
      var p = A.token();
      return (p && typeof p.then === 'function')
        ? p.then(function (t) { return t || null; }, function () { return null; })
        : Promise.resolve(p || null);
    } catch (e) { return Promise.resolve(null); }
  }

  /** 한 통. 보냈으면 true, 나중에 다시 보내야 하면 false. 절대 던지지 않는다. */
  function post(msg) {
    if (!root.fetch || !online()) return Promise.resolve(false);
    return token().then(function (t) {
      if (!t) return false;                       // 로그인 전 — 큐에 남겨 둔다
      return root.fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
        body: JSON.stringify(msg),
        keepalive: true                           // 탭이 닫히는 중에도 나간다
      }).then(function (r) {
        /* 4xx 는 다시 보내도 같은 답이다 — 큐에서 버린다. 서버는 "설정이 없다·
           중복이다" 같은 사정을 200 으로 돌려주므로, 여기 걸리는 것은 진짜 잘못된
           요청뿐이다. 5xx·네트워크만 다시 시도한다. */
        if (r.ok || (r.status >= 400 && r.status < 500)) return true;
        return false;
      }, function () { return false; });
    }, function () { return false; });
  }

  function flush() {
    var list = queue();
    if (!list.length) return Promise.resolve();
    var msg = list[0];
    return post(msg).then(function (ok) {
      var rest = queue();
      if (ok) { rest.shift(); saveQueue(rest); scheduleRetry(200); }
      else scheduleRetry(RETRY_MS);
    });
  }

  /** 보낸다. 큐가 비어 있으면 곧장, 아니면 순서를 지켜 뒤에 붙는다. */
  function send(msg) {
    var k = keyOf(msg);
    if (already(k)) return Promise.resolve(false);
    if (queue().length) { enqueue(msg); return Promise.resolve(false); }
    return post(msg).then(function (ok) {
      if (!ok) enqueue(msg);
      return ok;
    });
  }

  /* ── 바깥으로 내는 두 가지 ───────────────────────────────── */

  function base(info) {
    var o = info || {};
    return {
      session: o.session || ctx.session || '',
      set_code: o.setCode || ctx.setCode || '',
      mode: o.mode || ctx.mode || ''
    };
  }

  /** 무언가 어긋났다. code 는 서버가 사람 말로 옮긴다(api/notify.js 의 ISSUE_LABEL). */
  function issue(code, info) {
    var o = info || {};
    var msg = base(o);
    msg.kind = 'issue';
    msg.code = String(code || 'unknown');
    if (o.message) msg.message = String(o.message).slice(0, 1200);
    if (o.detail) msg.detail = o.detail;
    return send(msg);
  }

  /** 한 응시가 끝났다. 점수가 있으면 같이 싣는다. 없으면 없는 대로 보낸다. */
  function done(info) {
    var o = info || {};
    var msg = base(o);
    msg.kind = 'done';
    msg.code = '';
    if (o.message) msg.message = String(o.message).slice(0, 1200);
    if (o.bands) msg.bands = o.bands;
    if (o.detail) msg.detail = o.detail;
    return send(msg);
  }

  /** 이 페이지가 무슨 응시인지 한 번 일러 두면 매번 넘기지 않아도 된다. */
  function setContext(o) {
    if (!o) return;
    if (o.session) ctx.session = o.session;
    if (o.setCode) ctx.setCode = o.setCode;
    if (o.mode) ctx.mode = o.mode;
  }

  /* ── SG_CLOUD 지켜보기 ───────────────────────────────────── */

  /* 실시간 저장이 오래 막혀 있으면 그 자체가 사고다 — 답안이 학생 기기에만 쌓이고
   * 있다는 뜻이기 때문이다. 한 번 끊긴 것으로는 보내지 않는다(엘리베이터·와이파이
   * 전환에도 끊긴다). OFFLINE_MS 넘게 회복하지 못했을 때 한 번만 보낸다. */
  var offlineSince = 0;
  var offlineTimer = null;

  var watching = false;

  function watchCloud() {
    var C = root.SG_CLOUD;
    // 전체 다시 시작이면 startCloud 가 한 번 더 부른다 — 두 번 듣지 않는다.
    if (!C || typeof C.on !== 'function' || watching) return;
    watching = true;
    C.on(function (ev) {
      if (!ev) return;
      if (ev.type === 'offline') {
        if (!offlineSince) offlineSince = Date.now();
        if (offlineTimer === null) {
          offlineTimer = root.setTimeout(function () {
            offlineTimer = null;
            if (!offlineSince) return;
            issue('offline', {
              message: '실시간 저장이 ' + Math.round((Date.now() - offlineSince) / 1000) +
                       '초 넘게 막혀 있습니다. 답안은 기기에 쌓이는 중입니다.',
              detail: { queued: ev.stats && ev.stats.queued, last_error: ev.data && ev.data.error }
            });
          }, OFFLINE_MS);
        }
      } else if (ev.type === 'sent' || ev.type === 'ready' || ev.type === 'online') {
        offlineSince = 0;
        if (offlineTimer !== null) { root.clearTimeout(offlineTimer); offlineTimer = null; }
      } else if (ev.type === 'dropped') {
        /* 한 응시에 여러 건이 떨어져도 메일은 한 통이다 — 문항마다 보내면 스피킹
           15문항짜리 사고 하나가 메일 15통이 되고, 그런 알림은 곧 무시당한다.
           총계는 제출 뒤의 완료 메일이 싣는다. */
        issue('media_dropped', {
          message: '녹음을 끝내 올리지 못했습니다(첫 건만 알립니다 — 총계는 완료 메일에).',
          detail: { question: ev.data && ev.data.qid, error: ev.data && ev.data.error }
        });
      }
    });
  }

  /* ── 생명주기 ────────────────────────────────────────────── */

  if (root.addEventListener) {
    root.addEventListener('online', function () { scheduleRetry(500); });
    root.addEventListener('load', function () { scheduleRetry(3000); });
  }

  root.SG_NOTIFY = {
    issue: issue, done: done, flush: flush,
    setContext: setContext, watchCloud: watchCloud,
    // 테스트 훅
    _queue: queue, _key: keyOf
  };
})(typeof window !== 'undefined' ? window : this);
