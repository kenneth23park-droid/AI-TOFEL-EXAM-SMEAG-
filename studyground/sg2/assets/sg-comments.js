/* SMEAG · StudyGround 2.0 — 답안지 코멘트 (선생님 · AI). 의존성 없음.
 *
 * 선생님이 손으로 쓴 코멘트와 AI 가 만든 코멘트가 같은 표(sg_comments)에 함께 산다.
 * 학생 화면에서는 한자리에 나란히 보여야 하고, 출처는 source 로만 갈리기 때문이다.
 * 읽기는 답안지 주인과 선생님·관리자 둘 다, 손으로 쓰기는 선생님·관리자만 — 정본은 RLS 다.
 * AI 리뷰는 이 파일이 저장하지 않는다. 서버(/api/feedback)가 service_role 로 쓴다 —
 * 학생도 자기 리뷰를 부를 수 있어야 하는데, 학생 토큰으로는 이 표에 못 쓰기 때문이다.
 *
 * 대상(scope · question_id)
 *   { scope:'overall',  question_id:'' }        전체 총평
 *   { scope:'reading',  question_id:'' }        영역 총평
 *   { scope:'question', question_id:'R1-7' }    문항별
 *   { scope:'plan',     question_id:'' }        학습 계획 — 전문은 data 칸(jsonb)
 *
 * 노출 전역: window.SG_COMMENTS
 *   SG_COMMENTS.list(owner, session)   → Promise<[코멘트]>
 *   SG_COMMENTS.save(row)              → Promise<코멘트|null>  선생님이 손으로 쓴 것
 *   SG_COMMENTS.remove(id)             → Promise<boolean>
 *   SG_COMMENTS.providers()            → Promise<[{id,label,ready,why,models,default}]>
 *   SG_COMMENTS.generate(opts)         → Promise<{sections,questions,plan,saved,…}>
 *                                        AI 리뷰 한 벌. 서버가 쓰고 서버가 저장한다.
 *   SG_COMMENTS.questionsFor(detail)   서버에 보낼 문항 메타데이터(내 답은 빼고)
 */
window.SG_COMMENTS = (function () {
  'use strict';

  var BASE = 'id,owner,session,question_id,scope,source,author,author_name,model,lang,' +
             'body,strengths,improvements,created_at,updated_at';
  /* data 는 학습 계획이 사는 칸이다(supabase/ai_review_plan.sql). 아직 그 SQL 을
     돌리지 않은 DB 에서는 이 칸을 고르는 순간 PostgREST 가 400 을 내고 코멘트가
     통째로 사라진다 — 없으면 없는 대로 예전 칸만 읽는다. */
  var SELECT = BASE + ',data';
  var HAS_DATA = true;

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
    var tail = '&owner=eq.' + encodeURIComponent(owner) +
               '&session=eq.' + encodeURIComponent(session) +
               '&order=updated_at.desc';
    return rest('sg_comments?select=' + (HAS_DATA ? SELECT : BASE) + tail)
      .then(function (rows) {
        if (rows || !HAS_DATA) return rows || [];
        // data 칸이 없는 DB 였다. 한 번만 알아채고 그 뒤로는 묻지 않는다.
        HAS_DATA = false;
        return rest('sg_comments?select=' + BASE + tail)
          .then(function (again) { return again || []; });
      });
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

  /**
   * AI 리뷰 한 벌을 만든다. 점수·답안은 서버가 DB 에서 직접 읽고, 저장까지 서버가
   * 한다 — 여기서 넘기는 것은 "어느 응시인지"와 문항 메타데이터뿐이다.
   *
   * @param opts { session, questions, owner?, provider?, model?, lang?, force? }
   */
  function generate(opts) {
    opts = opts || {};
    return api('POST', {
      session: opts.session,
      owner: opts.owner || undefined,
      provider: opts.provider || undefined,
      model: opts.model || undefined,
      lang: opts.lang || undefined,
      force: !!opts.force,
      questions: opts.questions || []
    });
  }

  /* 서버에 보낼 문항 메타데이터. 여기서 나가는 것은 **문항 쪽 사실**이다 —
   * 어느 문항인지, 무엇을 물었는지, 정답이 무엇인지, 맞았는지. 학생이 무엇이라
   * 답했는지는 보내지 않는다: 서버가 sg_results.answers 에서 직접 읽는다(위조 방지).
   *
   * Build a Sentence 는 빼고 보낸다 — 정답표대로 어순을 맞추는 문항이라 리뷰 화면이
   * 이미 빈칸마다 맞고 틀림과 정답을 나란히 보여 준다. AI 가 여기에 덧붙일 말은
   * 정답을 다시 읽어 주는 것뿐이고, 채점(sg_task_scores)에서도 이미 빠져 있다.
   *
   * 맞은 문항도 보내지 않는다 — 할 말이 없고, 100문항이 프롬프트를 채울 뿐이다.
   *
   * 문항 쪽 사실에는 **원문(지문·대본)** 도 든다. 서버는 콘텐츠 팩을 모르기 때문에
   * 여기서 보내지 않으면 서버도 모델도 지문을 못 본다. 지문 없이 쓴 해설은 근거를
   * 지어내거나 하나 마나 한 말이 되고, 그건 리뷰가 아니라 소음이다. */
  function questionsFor(detail) {
    var out = [];
    ((detail && detail.rows) || []).forEach(function (r) {
      if (r.kind === 'build') return;
      if (r.ok !== false && r.ok !== null) return;      // 맞은 문항은 뺀다

      /* 객관식 정답은 팩 안에서 보기 번호다. 번호를 그대로 보내면 리뷰가 쓸 수 있는
         말은 "정답은 2번" 뿐이라, 여기서 보기 문장으로 펴서 보낸다. 보기 목록도 함께
         보낸다 — 학생이 고른 보기가 무엇이었는지는 서버가 이 목록으로 되짚는다. */
      var choices = (Object.prototype.toString.call(r.choices) === '[object Array]')
        ? r.choices.slice(0, 8).map(function (c) { return String(c).slice(0, 200); })
        : null;
      var key = r.key;
      if (choices && typeof key === 'number' && choices[key] != null) key = choices[key];

      var q = {
        question_id: r.qid, no: r.no, section: r.section, kind: r.kind,
        prompt: String(r.prompt || '').slice(0, 300),
        correct: String(key == null ? '' : key).slice(0, 200),
        ok: r.ok
      };
      if (choices) q.choices = choices;

      /* 문항이 딛고 선 원문(리딩 지문 · 리스닝 대본)도 함께 보낸다.
         이게 없으면 리뷰가 쓸 수 있는 말은 "정답은 B 입니다" 와 "지문을 다시 읽어
         보세요" 뿐이다 — 학생이 이미 아는 말이다. 원문이 있어야 "3문단의 이 문장이
         답을 정한다" 처럼 짚을 수 있고, 서버가 그 인용이 진짜인지 확인할 수도 있다.
         같은 지문을 여러 문항이 함께 쓰므로 서버가 한 벌로 묶어 모델에 보낸다. */
      if (r.src && r.src.text) {
        q.source = { kind: r.src.kind, title: r.src.title,
                     text: String(r.src.text).slice(0, 6000) };
      }
      out.push(q);
    });
    return out;
  }

  return {
    list: list, save: save, remove: remove,
    providers: providers, generate: generate, questionsFor: questionsFor
  };
})();
