/* SMEAG · StudyGround 2.0 — 답안지 코멘트 (선생님 · AI). 의존성 없음.
 *
 * 선생님이 손으로 쓴 코멘트와 AI 가 만든 코멘트가 같은 표(sg_comments)에 함께 산다.
 * 학생 화면에서는 한자리에 나란히 보여야 하고, 출처는 source 로만 갈리기 때문이다.
 * 읽기는 답안지 주인과 선생님·관리자 둘 다, 쓰기는 선생님·관리자만 — 정본은 RLS 다.
 *
 * 대상(scope · question_id)
 *   { scope:'overall',  question_id:'' }        전체 총평
 *   { scope:'reading',  question_id:'' }        영역 총평
 *   { scope:'question', question_id:'R1-7' }    문항별
 *
 * 노출 전역: window.SG_COMMENTS
 *   SG_COMMENTS.list(owner, session)   → Promise<[코멘트]>
 *   SG_COMMENTS.save(row)              → Promise<코멘트|null>  같은 대상이면 덮어쓴다
 *   SG_COMMENTS.remove(id)             → Promise<boolean>
 *   SG_COMMENTS.providers()            → Promise<[{id,label,ready,why,models,default}]>
 *   SG_COMMENTS.generate(payload)      → Promise<{sections,questions,provider,model}>
 *   SG_COMMENTS.attemptFor(result, detail)  AI 에 보낼 채점 요약을 만든다(신원은 빼고)
 */
window.SG_COMMENTS = (function () {
  'use strict';

  var SELECT = 'id,owner,session,question_id,scope,source,author,author_name,model,lang,' +
               'body,strengths,improvements,created_at,updated_at';

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
      if (!tok) return null;                       // 비로그인 = 코멘트도 없다
      return fetch(SG_AUTH.url + '/rest/v1/' + path, merge(init, {
        headers: merge({
          apikey: SG_AUTH.anonKey,
          Authorization: 'Bearer ' + tok,
          'Content-Type': 'application/json'
        }, (init && init.headers) || {})
      })).then(function (r) {
        if (!r.ok) return null;
        return r.json().catch(function () { return null; });
      });
    }).catch(function () { return null; });        // 오프라인이면 조용히 없는 셈 친다
  }

  function list(owner, session) {
    if (!owner || !session) return Promise.resolve([]);
    return rest('sg_comments?select=' + SELECT +
                '&owner=eq.' + encodeURIComponent(owner) +
                '&session=eq.' + encodeURIComponent(session) +
                '&order=updated_at.desc')
      .then(function (rows) { return rows || []; });
  }

  /** 같은 대상(owner·session·source·scope·question_id)이면 덮어쓴다. */
  function save(row) {
    var body = {
      owner: row.owner, session: row.session,
      question_id: row.question_id || '',
      scope: row.scope || 'question',
      source: row.source || 'teacher',
      author: row.author || null,
      author_name: row.author_name || '',
      model: row.model || '',
      lang: row.lang || 'en',
      body: row.body || '',
      strengths: row.strengths || [],
      improvements: row.improvements || []
    };
    return rest('sg_comments?on_conflict=owner,session,source,scope,question_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify([body])
    }).then(function (rows) { return (rows && rows[0]) || null; });
  }

  function remove(id) {
    return rest('sg_comments?id=eq.' + encodeURIComponent(id), {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' }
    }).then(function () { return true; }).catch(function () { return false; });
  }

  /* ── AI (/api/feedback) ─────────────────────────────────────
   * 키는 서버(Vercel 환경변수)에만 있다. 이 함수는 로그인 토큰만 넘기고,
   * 선생님·관리자인지는 서버가 다시 확인한다. */
  function api(method, body) {
    if (!window.SG_AUTH) return Promise.reject(new Error('Not signed in.'));
    return SG_AUTH.token().then(function (tok) {
      if (!tok) throw new Error('Not signed in.');
      return fetch('/api/feedback', {
        method: method,
        headers: merge({ Authorization: 'Bearer ' + tok },
                       body ? { 'Content-Type': 'application/json' } : {}),
        body: body ? JSON.stringify(body) : undefined
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
          return j;
        });
      });
    });
  }

  function providers() {
    return api('GET', null).then(function (j) { return (j && j.providers) || []; })
      .catch(function () { return []; });
  }

  function generate(payload) { return api('POST', payload); }

  /* AI 에게 보낼 채점 요약. 이름·학번·이메일은 넣지 않는다 — 코멘트를 쓰는 데
   * 필요 없고, 필요 없는 것을 밖으로 내보내지 않는 게 기본이다.
   * 틀린 문항과 서술형 답안만 실어 보낸다(맞은 문항 90개는 할 말이 없다).
   *
   * Build a Sentence 는 빼고 보낸다 — 정답표대로 어순을 맞추는 문항이라 리뷰 화면이
   * 이미 빈칸마다 맞고 틀림과 정답을 나란히 보여 준다. AI 가 여기에 덧붙일 말은
   * 정답을 다시 읽어 주는 것뿐이고, 채점(sg_task_scores)에서도 이미 빠져 있다. */
  function attemptFor(result, detail) {
    var wrong = [], open = [];
    (detail.rows || []).forEach(function (r) {
      if (r.kind === 'build') return;
      if (r.ok === false && wrong.length < 40) {
        wrong.push({
          question_id: r.qid, no: r.no, section: r.section, kind: r.kind,
          prompt: String(r.prompt || '').slice(0, 200),
          given: String(r.given == null ? '' : r.given).slice(0, 200),
          correct: String(r.key == null ? '' : r.key).slice(0, 200)
        });
      } else if (r.ok === null && typeof r.given === 'string' &&
                 r.given && r.given.indexOf('idb:') !== 0 && open.length < 10) {
        open.push({
          question_id: r.qid, section: r.section, kind: r.kind,
          prompt: String(r.prompt || '').slice(0, 300),
          answer: r.given.slice(0, 3000)
        });
      }
    });
    return {
      set_code: result.set_code || '',
      submitted_at: result.submitted_at || '',
      score: detail.score, total: detail.total,
      percent: detail.total ? Math.round(detail.score / detail.total * 1000) / 10 : 0,
      by_section: detail.bySection || {},
      note: 'writing and speaking are not auto-scored; comment on the submitted answers themselves',
      wrong_questions: wrong,
      open_answers: open
    };
  }

  return {
    list: list, save: save, remove: remove,
    providers: providers, generate: generate, attemptFor: attemptFor
  };
})();
