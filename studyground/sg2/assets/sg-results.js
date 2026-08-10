/* SMEAG · StudyGround 2.0 — 응시 결과 (채점 · 목록 · 동기화). 의존성 없음.
 *
 * 원본은 언제나 기기의 로컬 응시 기록(SG_STORE / localStorage)이다. 시험은 무네트워크
 * 현장에서도 끝나야 하기 때문이다. 로그인해 있고 네트워크가 살아 있으면 그 사본을
 * Supabase(sg_results)로 올려, 다른 기기와 선생님 화면에서도 보이게 한다.
 *
 * 노출 전역: window.SG_RESULTS
 *   SG_RESULTS.pack(setCode)          내려받아 둔 문제 팩(window.SMEAG_SET9 등)
 *   SG_RESULTS.score(pack, answers)   → { score, total, percent, bySection, rows }
 *   SG_RESULTS.local()                → 제출된 로컬 응시 [{ session, setCode, ... }]
 *   SG_RESULTS.list()                 → Promise<[결과]>  로컬 + 서버 병합(세션 기준 중복 제거)
 *   SG_RESULTS.get(session)           → Promise<결과|null>
 *   SG_RESULTS.push()                 → Promise<{ sent, failed }>  안 올라간 것만 올린다
 *   SG_RESULTS.listFor(ownerId)       → Promise<[결과]>  관리자/선생님 전용
 *   SG_RESULTS.listAll(opts)          → Promise<[결과+student]>  선생님/관리자 전용
 *   SG_RESULTS.detail(row)            → { score, total, percent, bySection, rows }  문항별 리뷰
 */
window.SG_RESULTS = (function () {
  'use strict';

  var SECTION = { R: 'reading', L: 'listening', S: 'speaking', W: 'writing' };
  var LABEL = {
    reading: ['Reading', '리딩'], listening: ['Listening', '리스닝'],
    speaking: ['Speaking', '스피킹'], writing: ['Writing', '라이팅'], other: ['Other', '기타']
  };

  /* 문항 id 만 보고 영역을 가른다. SET 1 처럼 'R1-1' 로 시작하는 팩에서만 맞는다. */
  function sectionOf(qid) {
    return SECTION[String(qid).charAt(0).toUpperCase()] || 'other';
  }

  /* 실제 영역은 팩의 구조가 알고 있다 — SET 9 의 라이팅·스피킹 문항은
   * 'set9-W1-q01' 처럼 세트 이름으로 시작해서 id 첫 글자로는 가릴 수 없다.
   * 팩이 알려주면 그 값을 쓰고, 없을 때만 id 로 추측한다. */
  var KNOWN = { reading: 1, listening: 1, speaking: 1, writing: 1 };
  function sectionEntry(entry, qid) {
    var name = entry && entry.section && (entry.section.id || entry.section.name);
    name = String(name || '').toLowerCase();
    return KNOWN[name] ? name : sectionOf(qid);
  }

  function pack(setCode) {
    var code = String(setCode || '').toUpperCase().replace(/[^0-9]/g, '');
    return window['SMEAG_SET' + code] || window.SMEAG_SET9 || window.SMEAG_SET1 || null;
  }

  /* 채점 비교. 대소문자·앞뒤 공백·중복 공백·끝의 마침표는 무시한다.
   * 정답이 배열이면 그중 하나만 맞으면 된다(복수 정답 허용 문항). */
  function norm(v) {
    return String(v == null ? '' : v).trim().toLowerCase()
      .replace(/\s+/g, ' ').replace(/[.]$/, '');
  }
  function hit(given, key) {
    if (key == null) return null;                       // 채점 기준 없음 = 주관식
    var list = Object.prototype.toString.call(key) === '[object Array]' ? key : [key];
    for (var i = 0; i < list.length; i++) if (norm(given) === norm(list[i])) return true;
    return false;
  }

  /** answers: SG_STORE.answers() 모양 { qid: { v: ... } } 또는 { qid: value }. */
  function valueOf(a, qid) {
    var rec = a && a[qid];
    if (rec == null) return '';
    return (typeof rec === 'object' && rec !== null && 'v' in rec) ? rec.v : rec;
  }

  function score(p, answers) {
    var rows = [], bySection = {}, sc = 0, total = 0;
    if (!p) return { score: 0, total: 0, percent: 0, bySection: bySection, rows: rows };

    var all = typeof p.allQuestions === 'function' ? p.allQuestions() : [];
    var keys = p.answerKey || {};

    for (var i = 0; i < all.length; i++) {
      var q = all[i].q || all[i];
      var qid = q.id;
      var key = keys.hasOwnProperty(qid) ? keys[qid] : q.answer;
      var given = valueOf(answers, qid);
      var ok = hit(given, key);
      var sec = sectionEntry(all[i], qid);

      bySection[sec] = bySection[sec] || { score: 0, total: 0 };
      if (ok !== null) {                    // 객관 채점 가능한 문항만 점수에 넣는다
        total += 1; bySection[sec].total += 1;
        if (ok) { sc += 1; bySection[sec].score += 1; }
      }
      rows.push({
        qid: qid, no: q.no, section: sec, kind: q.kind,
        prompt: q.prompt || q.text || q.question || '',
        given: given, key: key, ok: ok
      });
    }
    return {
      score: sc, total: total,
      percent: total ? Math.round(sc / total * 1000) / 10 : 0,
      bySection: bySection, rows: rows
    };
  }

  /* ── 로컬 응시 기록 ─────────────────────────────────────── */

  function lsKeys() {
    var out = [];
    try { for (var i = 0; i < localStorage.length; i++) out.push(localStorage.key(i)); } catch (e) {}
    return out;
  }
  function readJSON(k, dflt) {
    try { var v = localStorage.getItem(k); return v == null ? dflt : JSON.parse(v); } catch (e) { return dflt; }
  }

  /** 제출이 끝난 로컬 응시만 돌려준다 — 진행 중인 시험은 성적표에 낄 자리가 아니다. */
  function local() {
    var out = [], keys = lsKeys(), i, m;
    for (i = 0; i < keys.length; i++) {
      m = /^sg2_attempt::(.+)::meta$/.exec(keys[i]);
      if (!m) continue;
      var session = m[1];
      var meta = readJSON(keys[i], {}) || {};
      if (!meta.submittedAt) continue;
      var answers = readJSON('sg2_attempt::' + session + '::answers', {}) || {};
      var p = pack(meta.setCode || meta.set || '');
      var s = score(p, answers);
      out.push({
        session: session,
        // 화면·필터가 한 가지 표기만 보게 대문자로 굳힌다('set9' 와 'SET9' 는 같은 세트다).
        set_code: String(meta.setCode || meta.set || (p && p.code) || '').toUpperCase(),
        mode: meta.mode || '',
        started_at: meta.startedAt ? new Date(meta.startedAt).toISOString() : null,
        submitted_at: new Date(meta.submittedAt).toISOString(),
        score: s.score, total: s.total, percent: s.percent,
        by_section: s.bySection,
        answers: answers,
        _rows: s.rows, _local: true
      });
    }
    out.sort(function (a, b) { return (a.submitted_at < b.submitted_at) ? 1 : -1; });
    return out;
  }

  /* ── 서버 사본 ──────────────────────────────────────────── */

  function merge() {
    var out = {}, i, k;
    for (i = 0; i < arguments.length; i++) {
      var src = arguments[i] || {};
      for (k in src) { if (src.hasOwnProperty(k)) out[k] = src[k]; }
    }
    return out;
  }

  function rest(path, init) {
    if (!window.SG_AUTH) return Promise.resolve(null);
    return SG_AUTH.token().then(function (tok) {
      if (!tok) return null;                       // 비로그인 = 로컬만 본다
      return fetch(SG_AUTH.url + '/rest/v1/' + path, merge(init, {
        headers: merge({
          apikey: SG_AUTH.anonKey,
          Authorization: 'Bearer ' + tok,
          'Content-Type': 'application/json'
        }, (init && init.headers) || {})
      })).then(function (r) { return r.ok ? r.json().catch(function () { return null; }) : null; });
    }).catch(function () { return null; });        // 오프라인이면 조용히 로컬만
  }

  var SELECT = 'id,owner,session,set_code,mode,started_at,submitted_at,score,total,percent,by_section,answers';

  function remote() {
    var u = window.SG_AUTH && SG_AUTH.user();
    if (!u) return Promise.resolve([]);
    return rest('sg_results?select=' + SELECT + '&owner=eq.' + u.id + '&order=submitted_at.desc')
      .then(function (rows) { return rows || []; });
  }

  function listFor(ownerId) {
    return rest('sg_results?select=' + SELECT + '&owner=eq.' + encodeURIComponent(ownerId) +
                '&order=submitted_at.desc').then(function (rows) { return rows || []; });
  }

  /* 선생님·관리자 화면용 전체 목록. RLS(sg_is_staff) 가 실제 권한을 쥐고 있으므로
   * 학생이 이걸 불러도 자기 것만 돌아온다 — 화면에서 막는 건 안내일 뿐 방어선이 아니다.
   *
   * sg_results.owner 의 외래키는 auth.users 라서 PostgREST 임베딩으로 이름을 붙일 수
   * 없다. 결과를 받은 뒤 등장한 owner 만 모아 프로필을 한 번 더 읽어 이어 붙인다. */
  function listAll(opts) {
    opts = opts || {};
    var q = 'sg_results?select=' + SELECT + '&order=submitted_at.desc&limit=' + (opts.limit || 500);
    if (opts.setCode) q += '&set_code=eq.' + encodeURIComponent(opts.setCode);
    return rest(q).then(function (rows) {
      rows = rows || [];
      var ids = [], seen = {};
      rows.forEach(function (r) { if (r.owner && !seen[r.owner]) { seen[r.owner] = true; ids.push(r.owner); } });
      if (!ids.length) return rows;
      return rest('sg_profiles?select=id,name,student_id,email,role&id=in.(' + ids.join(',') + ')')
        .then(function (people) {
          var by = {};
          (people || []).forEach(function (p) { by[p.id] = p; });
          rows.forEach(function (r) { r.student = by[r.owner] || null; });
          return rows;
        });
    });
  }

  /** 저장된 응시 한 건을 문항별 리뷰로 편다. 로컬 기록이면 채점 결과를 그대로 쓴다. */
  function detail(row) {
    if (!row) return null;
    if (row._rows) {
      return { score: row.score, total: row.total, percent: row.percent,
               bySection: row.by_section || {}, rows: row._rows };
    }
    return score(pack(row.set_code), row.answers || {});
  }

  /** 아직 서버에 없는 로컬 응시를 올린다. 로그인 + 네트워크가 있을 때만 실제로 돈다. */
  function push() {
    var u = window.SG_AUTH && SG_AUTH.user();
    var mine = local();
    if (!u || !mine.length) return Promise.resolve({ sent: 0, failed: 0 });

    return remote().then(function (rows) {
      var have = {};
      (rows || []).forEach(function (r) { have[r.session] = true; });
      var todo = mine.filter(function (r) { return !have[r.session]; });
      if (!todo.length) return { sent: 0, failed: 0 };

      var body = todo.map(function (r) {
        return {
          owner: u.id, session: r.session, set_code: r.set_code, mode: r.mode,
          started_at: r.started_at, submitted_at: r.submitted_at,
          score: r.score, total: r.total, percent: r.percent,
          by_section: r.by_section, answers: r.answers
        };
      });
      return rest('sg_results?on_conflict=owner,session', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(body)
      }).then(function (res) {
        return res === null ? { sent: 0, failed: todo.length } : { sent: todo.length, failed: 0 };
      });
    });
  }

  /** 로컬이 이기는 병합 — 같은 session 이면 로컬 사본을 쓴다(가장 최신이므로). */
  function list() {
    var mine = local();
    return remote().then(function (rows) {
      var seen = {};
      mine.forEach(function (r) { seen[r.session] = true; });
      return mine.concat((rows || []).filter(function (r) { return !seen[r.session]; }))
        .sort(function (a, b) { return (a.submitted_at < b.submitted_at) ? 1 : -1; });
    });
  }

  /** ownerId 를 주면 그 사람의 응시를 서버에서 바로 읽는다(선생님·관리자 리뷰). */
  function get(session, ownerId) {
    var me = window.SG_AUTH && SG_AUTH.user();
    if (ownerId && (!me || me.id !== ownerId)) {
      return rest('sg_results?select=' + SELECT +
                  '&owner=eq.' + encodeURIComponent(ownerId) +
                  '&session=eq.' + encodeURIComponent(session))
        .then(function (rows) { return (rows && rows[0]) || null; });
    }
    return list().then(function (rows) {
      for (var i = 0; i < rows.length; i++) if (rows[i].session === session) return rows[i];
      return null;
    });
  }

  return {
    sectionOf: sectionOf, label: LABEL, pack: pack, score: score, detail: detail,
    local: local, remote: remote, list: list, get: get, push: push,
    listFor: listFor, listAll: listAll
  };
})();
