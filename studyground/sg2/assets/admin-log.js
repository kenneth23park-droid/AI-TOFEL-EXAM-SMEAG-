/* SMEAG StudyGround — 관리자 변경 로그(감사 기록).
 *
 * 관리자가 무엇을 바꿨는지 개발자가 나중에 그대로 읽을 수 있어야 한다. 문항 교체·
 * 삭제(되돌리기)·신규 오버라이드, 오디오 URL/업로드 교체, 시간제한 변경이 모두
 * 여기 한 줄씩 쌓인다. 화면은 admin-log.html.
 *
 * 한 줄의 모양
 *   { t, iso, who, set, action, target, field, before, after, note }
 *     action  create | update | delete | import | reset | audio | login | logout
 *     before/after 는 큰 값이면 잘라서 담는다(로그가 콘텐츠 저장소가 되면 안 된다).
 *
 * 저장은 두 겹이다.
 *   1) localStorage['sg2_admin_log_v1'] — 이 기기의 링 버퍼(최근 MAX 개). 오프라인에서도
 *      끊기지 않게 항상 여기 먼저 쓴다.
 *   2) Supabase public.sg_admin_log — 여러 기기·여러 관리자의 합본(정본).
 *      선생님/관리자(sg_profiles.role)로 로그인돼 있을 때만 올라가며, RLS 로 staff 만
 *      넣고 읽을 수 있다. 감사 기록이라 수정·삭제 정책은 두지 않았다(service_role 전용).
 *
 * 한 줄마다 기기가 만든 uid 가 붙어, 재전송해도 서버에서 중복되지 않는다
 * (Prefer: resolution=ignore-duplicates). 못 올라간 줄은 sent=false 로 남아 다음
 * 기회에 다시 시도한다 — 네트워크가 없다고 기록이 사라지지 않는다.
 *
 * 노출 전역: window.SG_LOG
 */
(function () {
  'use strict';

  var KEY = 'sg2_admin_log_v1';
  var DEV_KEY = 'sg2_device_id';
  var MAX = 800;
  var CLIP = 400;              // before/after 한 값의 최대 길이

  /* assets/sg-auth.js 와 같은 프로젝트. supabase-js 를 붙이지 않고 REST 를 직접 친다
     (sg2 는 무네트워크 로컬 모드로도 돌아야 해서 외부 스크립트를 못 쓴다). */
  var SB_URL = 'https://qrmidnmlethqvdbmnyun.supabase.co';
  var SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFybWlkbm1sZXRocXZkYm1ueXVuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU3Mzg3NzQsImV4cCI6MjEwMTMxNDc3NH0.U2cprYXkpIS_1tSAiEjCFuHAztZRwIIK6DYCCowgxg4';
  var TABLE = SB_URL + '/rest/v1/sg_admin_log';

  /* 기기 구분용 임의 id. 개인정보가 아니라 "어느 브라우저에서 났는지"만 가른다. */
  var device = '';
  try {
    device = localStorage.getItem(DEV_KEY) || '';
    if (!device) {
      device = 'dev-' + Math.random().toString(36).slice(2, 10);
      localStorage.setItem(DEV_KEY, device);
    }
  } catch (e) { device = 'dev-tmp'; }

  var seq = 0;
  function uid(t) { return device + '-' + t + '-' + (++seq); }

  var rows = [];
  var listeners = [];

  try { rows = JSON.parse(localStorage.getItem(KEY) || '[]') || []; } catch (e) { rows = []; }
  if (!Array.isArray(rows)) rows = [];

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(rows)); } catch (e) { /* quota/private */ }
  }
  function emit() { listeners.forEach(function (fn) { try { fn(); } catch (e) {} }); }

  function clip(v) {
    if (v === undefined || v === null) return null;
    var s = typeof v === 'string' ? v : JSON.stringify(v);
    if (s === undefined) return null;
    return s.length > CLIP ? s.slice(0, CLIP) + '…(+' + (s.length - CLIP) + ')' : s;
  }
  function who() {
    var s = window.SG_ADMIN && window.SG_ADMIN.current();
    return s ? s.id : 'anonymous';
  }

  var API = {
    /** 한 줄 남긴다. 실패해도 절대 던지지 않는다 — 로그가 작업을 막으면 안 된다. */
    add: function (entry) {
      try {
        var e = entry || {};
        var t = Date.now();
        rows.push({
          uid: uid(t), sent: false, device: device,
          t: t, iso: new Date(t).toISOString(),
          who: e.who || who(),
          set: e.set || '',
          action: e.action || 'update',
          target: e.target || '',
          field: e.field || '',
          before: clip(e.before),
          after: clip(e.after),
          note: e.note || '',
          page: (location.pathname.split('/').pop() || '')
        });
        if (rows.length > MAX) rows.splice(0, rows.length - MAX);
        save(); emit();
        scheduleSync();
      } catch (err) { /* 무시 */ }
    },
    /** 필드별로 한 줄씩 — before/after 를 비교해 바뀐 것만 남긴다. */
    diff: function (opts) {
      var before = opts.before || {}, after = opts.after || {}, n = 0;
      (opts.fields || Object.keys(after)).forEach(function (f) {
        var b = before[f], a = after[f];
        if (JSON.stringify(b) === JSON.stringify(a)) return;
        n++;
        API.add({ set: opts.set, action: opts.action || 'update', target: opts.target,
                  field: f, before: b, after: a, note: opts.note });
      });
      if (!n && opts.always) API.add({ set: opts.set, action: opts.action, target: opts.target, note: opts.note });
      return n;
    },
    list: function (filter) {
      filter = filter || {};
      return rows.filter(function (r) {
        if (filter.set && r.set !== filter.set) return false;
        if (filter.action && r.action !== filter.action) return false;
        if (filter.q) {
          var hay = (r.who + ' ' + r.set + ' ' + r.action + ' ' + r.target + ' ' + r.field + ' ' +
                     (r.before || '') + ' ' + (r.after || '') + ' ' + r.note).toLowerCase();
          if (hay.indexOf(String(filter.q).toLowerCase()) < 0) return false;
        }
        return true;
      }).slice().reverse();          // 최신이 위
    },
    count: function () { return rows.length; },
    clear: function () { rows = []; save(); emit(); },
    exportJson: function () { return JSON.stringify({ version: 1, rows: rows }, null, 2); },
    exportCsv: function () {
      var head = ['iso', 'who', 'set', 'action', 'target', 'field', 'before', 'after', 'note', 'page'];
      var esc = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
      return [head.join(',')].concat(rows.map(function (r) {
        return head.map(function (h) { return esc(r[h]); }).join(',');
      })).join('\n');
    },
    onChange: function (fn) { if (typeof fn === 'function') listeners.push(fn); },

    /* ── Supabase 합본 ────────────────────────────────────────
       올리는 사람은 반드시 로그인한 staff 다. 학생 토큰이나 비로그인은 RLS 에서
       막히므로, 여기서도 미리 상태를 보고 조용히 건너뛴다(작업을 막지 않는다). */

    device: function () { return device; },
    pending: function () { return rows.filter(function (r) { return !r.sent; }).length; },

    /** {ok, reason} — 지금 서버에 올릴 수 있는 상태인가. */
    syncStatus: function () {
      if (!window.fetch) return { ok: false, reason: 'no-fetch' };
      if (!window.SG_AUTH) return { ok: false, reason: 'no-auth-script' };
      if (!SG_AUTH.user()) return { ok: false, reason: 'signed-out' };
      return { ok: true, reason: '' };
    },

    /** 아직 못 올린 줄을 올린다. 성공한 줄만 sent 로 바꾼다. */
    sync: function () {
      var st = API.syncStatus();
      if (!st.ok) return Promise.resolve({ sent: 0, skipped: st.reason });
      var batch = rows.filter(function (r) { return !r.sent; }).slice(0, 200);
      if (!batch.length) return Promise.resolve({ sent: 0 });
      if (syncing) return syncing;
      syncing = SG_AUTH.token().then(function (tok) {
        if (!tok) return { sent: 0, skipped: 'no-token' };
        return fetch(TABLE, {
          method: 'POST',
          headers: {
            apikey: SB_ANON,
            Authorization: 'Bearer ' + tok,
            'Content-Type': 'application/json',
            // 같은 줄을 다시 보내도 서버에서 조용히 무시된다(uid unique).
            Prefer: 'resolution=ignore-duplicates,return=minimal'
          },
          body: JSON.stringify(batch.map(toRemote))
        }).then(function (r) {
          if (!r.ok) return r.text().then(function (t) {
            var msg = t.slice(0, 200);
            // 403 = staff 가 아님. 조용히 남겨 두었다가 권한이 생기면 다시 시도한다.
            return { sent: 0, skipped: r.status === 401 || r.status === 403 ? 'not-staff' : msg };
          });
          batch.forEach(function (r2) { r2.sent = true; });
          save(); emit();
          return { sent: batch.length };
        });
      }).catch(function (e) {
        return { sent: 0, skipped: String(e && e.message || e) };
      }).then(function (res) { syncing = null; return res; });
      return syncing;
    },

    /** 서버 합본 읽기(staff 전용). 이 기기에 없는 다른 사람의 기록까지 본다. */
    remote: function (filter) {
      filter = filter || {};
      var st = API.syncStatus();
      if (!st.ok) return Promise.reject(new Error(st.reason));
      return SG_AUTH.token().then(function (tok) {
        if (!tok) throw new Error('no-token');
        var qs = ['select=*', 'order=at.desc', 'limit=' + (filter.limit || 500)];
        if (filter.set) qs.push('set_id=eq.' + encodeURIComponent(filter.set));
        if (filter.action) qs.push('action=eq.' + encodeURIComponent(filter.action));
        return fetch(TABLE + '?' + qs.join('&'), {
          headers: { apikey: SB_ANON, Authorization: 'Bearer ' + tok }
        }).then(function (r) {
          if (!r.ok) return r.text().then(function (t) { throw new Error(r.status + ' ' + t.slice(0, 160)); });
          return r.json();
        }).then(function (list) { return (list || []).map(fromRemote); });
      });
    }
  };

  /* 로컬 한 줄 ↔ 서버 한 행. 이름이 다른 곳만 바꾼다(before/after 는 예약어를 피해 _val). */
  function toRemote(r) {
    return {
      uid: r.uid, client_at: r.iso, who: r.who, set_id: r.set || null,
      action: r.action, target: r.target || null, field: r.field || null,
      before_val: r.before, after_val: r.after, note: r.note || null,
      page: r.page || null, device: r.device || device
    };
  }
  function fromRemote(x) {
    return {
      uid: x.uid, sent: true, remote: true, device: x.device,
      t: Date.parse(x.client_at || x.at) || 0,
      iso: x.client_at || x.at,
      who: x.who || '', set: x.set_id || '', action: x.action,
      target: x.target || '', field: x.field || '',
      before: x.before_val, after: x.after_val,
      note: x.note || '', page: x.page || ''
    };
  }

  var syncing = null, syncTimer = null;
  function scheduleSync() {
    if (syncTimer) return;
    // 한 번의 저장이 여러 줄을 만든다(필드별 diff). 몰아서 한 번에 올린다.
    syncTimer = setTimeout(function () { syncTimer = null; API.sync(); }, 1500);
  }

  window.SG_LOG = API;

  // 로그인 상태가 되면 밀린 줄을 올린다. 페이지 진입 때도 한 번.
  if (window.SG_AUTH && SG_AUTH.onChange) SG_AUTH.onChange(function () { API.sync(); });
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('load', function () { setTimeout(function () { API.sync(); }, 1200); });
  }
})();
