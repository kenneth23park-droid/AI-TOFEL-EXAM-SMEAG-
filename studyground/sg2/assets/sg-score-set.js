/* SMEAG · StudyGround — 성적 세트(여러 회차에서 영역별로 하나씩 고른 한 벌).
 *
 * 왜 있는가
 *   학생은 선생님의 동의를 받아 시험을 다시 친다. 영역만 따로 다시 치기도 한다.
 *   그러면 응시(sg_results)는 여러 줄이 되는데 성적표는 한 장이어야 한다 —
 *   8월 3일의 리딩과 8월 9일의 스피킹을 한 줄에 적을 자리가 이것이다.
 *
 *   smeag.com 의 「내 최고 점수」와 헷갈리지 말 것. 그쪽은 영역별 최고를 기계가
 *   집는 참고값이고, 이쪽은 사람이 고른 성적이다. 고르는 사람은 관리자이고,
 *   다시 치는 것을 허락한 선생님의 동의가 함께 적힌다(approved_by / approved_name).
 *
 * 점수를 복사하지 않는다
 *   picks 는 "어느 응시의 어느 영역" 만 가리킨다. 그래서 나중에 선생님이 라이팅
 *   점수를 고치면 성적 세트도 같이 고쳐진다 — 성적표가 옛 점수를 들고 굳는 일이 없다.
 *   확정하던 순간의 값은 snapshot 에 따로 남아 감사용으로만 쓰인다.
 *
 * 노출 전역: window.SG_SCORE_SET (node 에서는 module.exports)
 *   SG_SCORE_SET.SKILLS                     ['reading','listening','writing','speaking']
 *   SG_SCORE_SET.supplies(row, tasks)       이 응시가 채울 수 있는 영역 { skill: band|null }
 *   SG_SCORE_SET.compose(picks, sources)    → { view, sections, missing, setCode }
 *   SG_SCORE_SET.snapshotOf(view)           확정 순간의 밴드 한 줄
 *   SG_SCORE_SET.list(ownerId)              → Promise<[성적 세트]>      (브라우저)
 *   SG_SCORE_SET.save(payload)              → Promise<행|null>          (관리자)
 *   SG_SCORE_SET.voidSet(id, 사유)          → Promise<...>              (관리자)
 */
(function (root, factory) {
  var band = (typeof require === 'function' && typeof module === 'object' && module.exports)
    ? require('./sg-band.js')
    : (root && root.SG_BAND);
  var api = factory(band);
  if (typeof module === 'object' && module.exports) module.exports = api;   // node 테스트
  if (root) root.SG_SCORE_SET = api;
})(typeof window !== 'undefined' ? window : null, function (BAND) {
  'use strict';

  var SKILLS = ['reading', 'listening', 'writing', 'speaking'];
  var AUTO = { reading: 1, listening: 1 };          // 자동채점 영역(by_section 에서 온다)

  function sessionOf(pick) {
    if (!pick) return '';
    return String(typeof pick === 'string' ? pick : (pick.session || ''));
  }

  /**
   * 이 응시가 어느 영역을 채울 수 있는가. 값은 그 영역의 밴드(없으면 null).
   * 채점 대기 중인 영역은 고를 수 없다 — 고르면 성적 세트에 빈칸이 남는다.
   */
  function supplies(row, tasks) {
    var v = BAND.of(row || {}, tasks || []);
    var out = {};
    for (var i = 0; i < SKILLS.length; i++) {
      out[SKILLS[i]] = v.sections[SKILLS[i]].band;
    }
    return out;
  }

  /**
   * 고른 회차들을 한 벌로 합친다.
   *
   * @param picks    { skill: session } 또는 { skill: {session, ...} }
   * @param sources  { session: { row, tasks } }  — 응시 행과 그 응시의 W·S 채점 행
   * @returns {
   *   view      SG_BAND.of() 와 같은 모양(sections · overall · cefr · pending)
   *   sections  { skill: {session, set_code, attempt_no, band} }  고른 자리의 출처
   *   missing   아직 고르지 않았거나 점수가 없는 영역 []
   *   setCode   'SET 9' 또는 'SET 9 + SET 8'
   * }
   */
  function compose(picks, sources) {
    picks = picks || {};
    sources = sources || {};

    var row = { by_section: {}, scale: 'toefl6' };
    var tasks = [];
    var from = {};
    var codes = [];

    for (var i = 0; i < SKILLS.length; i++) {
      var skill = SKILLS[i];
      var sess = sessionOf(picks[skill]);
      if (!sess) continue;
      var src = sources[sess];
      if (!src || !src.row) continue;

      if (AUTO[skill]) {
        var v = (src.row.by_section || {})[skill];
        if (v) row.by_section[skill] = v;
      } else {
        /* 산출형은 과제 행이 곧 점수다. 고른 회차의 그 영역 과제만 담는다 —
           라이팅을 8월 9일에서 가져오면 8월 3일의 라이팅 과제는 한 줄도 오지 않는다. */
        var list = src.tasks || [];
        for (var j = 0; j < list.length; j++) {
          if (String((list[j] || {}).skill || '').toLowerCase() === skill) tasks.push(list[j]);
        }
      }

      from[skill] = {
        session: sess,
        set_code: src.row.set_code || '',
        attempt_no: src.row.attempt_no || 1,
        submitted_at: src.row.submitted_at || null,
        band: null
      };
      if (src.row.set_code && codes.indexOf(src.row.set_code) < 0) codes.push(src.row.set_code);
    }

    var view = BAND.of(row, tasks);
    var missing = [];
    for (var k = 0; k < SKILLS.length; k++) {
      var s = SKILLS[k];
      var b = view.sections[s].band;
      if (from[s]) from[s].band = b;
      if (b === null) missing.push(s);
    }

    return { view: view, sections: from, missing: missing, setCode: codes.join(' + ') };
  }

  /** 확정 순간의 밴드. 나중에 채점이 바뀌어도 이 값은 그대로 남는다. */
  function snapshotOf(view) {
    var out = { sections: {}, overall: null, cefr: '' };
    if (!view) return out;
    for (var i = 0; i < SKILLS.length; i++) {
      out.sections[SKILLS[i]] = view.sections[SKILLS[i]].band;
    }
    out.overall = view.overall;
    out.cefr = view.cefr;
    return out;
  }

  /* ── 서버 ────────────────────────────────────────────────────────
     브라우저에서만 돈다. 권한의 정본은 RLS 다(읽기 sg_can_see · 쓰기 sg_is_admin). */

  var SELECT = 'id,owner,label,set_code,picks,snapshot,approved_by,approved_name,approved_note,' +
               'created_by,created_at,updated_at,voided_at,voided_reason';

  function rest(path, init) {
    var A = typeof window !== 'undefined' && window.SG_AUTH;
    if (!A) return Promise.resolve(null);
    return A.token().then(function (tok) {
      if (!tok) return null;
      var head = {
        apikey: A.anonKey, Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json'
      };
      var opt = { headers: head };
      if (init) {
        opt.method = init.method;
        opt.body = init.body;
        if (init.headers) for (var k in init.headers) { head[k] = init.headers[k]; }
      }
      return fetch(A.url + '/rest/v1/' + path, opt).then(function (r) {
        if (!r.ok) {
          return r.text()['catch'](function () { return ''; }).then(function (t) {
            var e = new Error(t || ('HTTP ' + r.status));
            e.status = r.status;
            throw e;
          });
        }
        return r.text().then(function (t) {
          if (!t) return true;
          try { return JSON.parse(t); } catch (e) { return true; }
        });
      });
    });
  }

  /** 무효로 돌린 것까지 다 준다 — 관리자 화면이 "이건 무효였다"를 보여야 하기 때문이다. */
  function list(ownerId) {
    var q = 'sg_score_sets?select=' + SELECT + '&order=created_at.desc';
    if (ownerId) q += '&owner=eq.' + encodeURIComponent(ownerId);
    return rest(q).then(function (rows) { return rows || []; });
  }

  function save(payload) {
    return rest('sg_score_sets', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(payload)
    }).then(function (rows) { return (rows && rows[0]) || null; });
  }

  function voidSet(id, reason) {
    return rest('sg_score_sets?id=eq.' + encodeURIComponent(id), {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ voided_at: new Date().toISOString(), voided_reason: String(reason || '') })
    });
  }

  return {
    SKILLS: SKILLS,
    sessionOf: sessionOf,
    supplies: supplies,
    compose: compose,
    snapshotOf: snapshotOf,
    list: list, save: save, voidSet: voidSet
  };
});
