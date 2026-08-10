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
 * 저장: localStorage['sg2_admin_log_v1'] — 최근 MAX 개만 남는 링 버퍼.
 * 정적 사이트라 서버 로그가 없다. 기기에 쌓이는 기록이므로 내보내기(JSON/CSV)로
 * 넘겨받는 것을 전제로 한다.
 *
 * 노출 전역: window.SG_LOG
 */
(function () {
  'use strict';

  var KEY = 'sg2_admin_log_v1';
  var MAX = 800;
  var CLIP = 400;              // before/after 한 값의 최대 길이

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
    onChange: function (fn) { if (typeof fn === 'function') listeners.push(fn); }
  };

  window.SG_LOG = API;
})();
