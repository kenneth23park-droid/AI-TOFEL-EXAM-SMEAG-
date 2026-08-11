/* SMEAG StudyGround — 시험장 좌석(컴퓨터) 설정 저장소.
 *
 * 강의실 PC 한 대 = 좌석 하나. 좌석마다 연결 모드·코스·배정 세트·출제 문항·
 * 오디오 배속·재생 횟수·화면 언어·시험 전용 모드를 담는다. 관리자는
 * admin-seats.html 에서 이 값을 쓰고, 각 PC 의 로그인·시험 화면은 자기 좌석
 * 번호로 읽어 간다.
 *
 * 지금은 이 기기 localStorage 가 원본이다(로컬 모드). 인터넷 모드에서는
 * 같은 스키마를 Supabase seats 테이블에서 읽어 오도록 load/save 만 갈아
 * 끼우면 되고, 화면 코드는 손대지 않는다 — 그래서 읽기 함수를 하나로 묶어 둔다.
 *
 * 노출 전역: window.SG_SEATS
 */
(function () {
  'use strict';

  var KEY = 'sg2_seats';        // 좌석 30개 설정(관리자가 쓴다)
  var MINE = 'sg2_seat';        // 이 PC 가 몇 번 좌석인지(각인)
  var COUNT = 30;

  var COURSES = [
    { id: 'toefl', label: 'TOEFL', labelKo: 'TOEFL' },
    { id: 'ielts', label: 'IELTS', labelKo: 'IELTS' }
  ];
  var MODULES = [
    { id: 'full',      label: 'All 4 sections', labelKo: '전체 4섹션' },
    { id: 'reading',   label: 'Reading only',   labelKo: '리딩만' },
    { id: 'listening', label: 'Listening only', labelKo: '리스닝만' },
    { id: 'writing',   label: 'Writing only',   labelKo: '라이팅만' },
    { id: 'speaking',  label: 'Speaking only',  labelKo: '스피킹만' }
  ];
  var RATES = [0.75, 1, 1.25, 1.5];
  var REPLAYS = [1, 2, 0];      // 0 = 무제한

  /* 세트 목록은 admin-session.js 가 아는 것을 그대로 쓴다(있으면). */
  function sets() {
    var S = (window.SG_ADMIN && window.SG_ADMIN.SETS) || [];
    return S.map(function (s) { return { id: s.id, label: s.label }; });
  }

  function blank(no) {
    return {
      no: no, label: '',
      mode: 'local', course: 'toefl',
      setId: '', module: 'full', items: '',
      audioRate: 1, audioReplays: 1,
      kiosk: true,
      status: 'unbound', deviceId: '', updatedAt: ''
    };
  }

  function defaults() {
    var out = [];
    for (var i = 1; i <= COUNT; i++) out.push(blank(i));
    return out;
  }

  /* 저장된 값에 빠진 필드가 있어도(옛 저장본) 기본값으로 채워 돌려준다. */
  function normalize(row, no) {
    var b = blank(no), out = {}, k;
    for (k in b) if (Object.prototype.hasOwnProperty.call(b, k)) {
      out[k] = (row && row[k] !== undefined && row[k] !== null) ? row[k] : b[k];
    }
    out.no = no;
    out.audioRate = Number(out.audioRate) || 1;
    out.audioReplays = Number(out.audioReplays) || 0;
    out.kiosk = !!out.kiosk;
    return out;
  }

  var rows = null, listeners = [];

  function load() {
    if (rows) return rows;
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { raw = null; }
    var byNo = {};
    if (raw && raw.seats && raw.seats.length) {
      raw.seats.forEach(function (s) { if (s && s.no) byNo[s.no] = s; });
    }
    rows = [];
    for (var i = 1; i <= COUNT; i++) rows.push(normalize(byNo[i], i));
    return rows;
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ version: 1, savedAt: new Date().toISOString(), seats: rows }));
    } catch (e) { /* quota/private */ }
    listeners.forEach(function (fn) { try { fn(rows); } catch (e2) {} });
  }

  /* 변경을 관리자 로그에도 한 줄씩 남긴다 — 누가 몇 번 좌석을 어떻게 바꿨는지. */
  function log(seat, before, after) {
    var L = window.SG_LOG;
    if (!L) return;
    L.diff({
      before: before, after: after,
      fields: ['mode', 'course', 'setId', 'module', 'items', 'audioRate', 'audioReplays', 'kiosk'],
      action: 'update', target: 'seat ' + seat, set: after.setId || before.setId || '',
      note: 'seat config'
    });
  }

  var API = {
    KEY: KEY, COUNT: COUNT,
    COURSES: COURSES, MODULES: MODULES, RATES: RATES, REPLAYS: REPLAYS,
    sets: sets,

    /** 좌석 전체(1~30). 항상 COUNT 개, 순서 고정. */
    all: function () { return load().map(function (r) { var c = {}; for (var k in r) c[k] = r[k]; return c; }); },

    /** 좌석 하나. 없는 번호면 null. */
    get: function (no) {
      no = Number(no);
      if (!(no >= 1 && no <= COUNT)) return null;
      var r = load()[no - 1], c = {};
      for (var k in r) c[k] = r[k];
      return c;
    },

    /** 좌석 여러 개에 같은 값을 적용한다. patch 에 담긴 필드만 바뀐다. */
    set: function (nos, patch) {
      var list = load(), stamp = new Date().toISOString();
      (Array.isArray(nos) ? nos : [nos]).forEach(function (no) {
        var i = Number(no) - 1;
        if (!list[i]) return;
        var before = {}, k;
        for (k in list[i]) before[k] = list[i][k];
        for (k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) list[i][k] = patch[k];
        if (list[i].status === 'unbound' && (list[i].setId || patch.mode)) list[i].status = 'ready';
        list[i].updatedAt = stamp;
        log(list[i].no, before, list[i]);
      });
      save();
      return API.all();
    },

    /** 좌석을 비운다 — 각인과 배정을 모두 지우고 처음 상태로. */
    reset: function (nos) {
      var list = load();
      (Array.isArray(nos) ? nos : [nos]).forEach(function (no) {
        var i = Number(no) - 1;
        if (!list[i]) return;
        var before = {}, k;
        for (k in list[i]) before[k] = list[i][k];
        list[i] = blank(Number(no));
        if (window.SG_LOG) window.SG_LOG.add({ action: 'reset', target: 'seat ' + no, note: 'seat cleared',
                                               before: before.setId || '', after: null });
      });
      save();
      return API.all();
    },

    /** 이 PC 에 각인된 좌석 번호(없으면 0). */
    mine: function () {
      try { return Number(localStorage.getItem(MINE) || 0) || 0; } catch (e) { return 0; }
    },
    /** 이 PC 의 좌석 번호를 각인하거나(1~30) 지운다(0). */
    bind: function (no) {
      no = Number(no) || 0;
      try {
        if (no >= 1 && no <= COUNT) localStorage.setItem(MINE, String(no));
        else localStorage.removeItem(MINE);
      } catch (e) {}
      return API.mine();
    },
    /** 이 PC 에 적용될 설정. 각인 전이면 null — 화면은 각인 안내를 띄우면 된다. */
    forThisDevice: function () {
      var n = API.mine();
      return n ? API.get(n) : null;
    },

    exportJson: function () {
      return JSON.stringify({ version: 1, savedAt: new Date().toISOString(), seats: load() }, null, 2);
    },
    /** 내보낸 JSON 을 되돌린다. 형식이 틀리면 던진다 — 조용히 덮어쓰지 않는다. */
    importJson: function (text) {
      var data = JSON.parse(text);
      if (!data || !data.seats || !data.seats.length) throw new Error('seats[] not found');
      var byNo = {};
      data.seats.forEach(function (s) { if (s && s.no) byNo[s.no] = s; });
      rows = [];
      for (var i = 1; i <= COUNT; i++) rows.push(normalize(byNo[i], i));
      save();
      if (window.SG_LOG) window.SG_LOG.add({ action: 'import', target: 'seats', note: 'imported ' + data.seats.length + ' seats' });
      return API.all();
    },

    onChange: function (fn) { if (typeof fn === 'function') listeners.push(fn); }
  };

  window.SG_SEATS = API;
})();
