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
 *   SG_RESULTS.push(opts)             → Promise<{ sent, failed, scored, media }>  안 올라간 것만 올린다
 *                                       media = { sent, failed, error } — 스피킹 녹음 쪽 결과
 *                                       opts.waitScore  AI 채점까지 기다린다(제출 직후 화면)
 *                                       opts.onProgress (done, total) 채점 진행
 *   SG_RESULTS.listFor(ownerId)       → Promise<[결과]>  관리자/선생님 전용
 *   SG_RESULTS.listAll(opts)          → Promise<[결과+student]>  선생님/관리자 전용
 *                                       opts.includeHidden  가려 둔 응시까지 본다
 *   SG_RESULTS.archives(opts)         → Promise<[백업본]>  되감기·다시시작 직전의 한 벌
 *   SG_RESULTS.setHidden(row, on, 사유) 응시를 가린다(지우지 않는다)
 *   SG_RESULTS.detail(row)            → { score, total, percent, bySection, rows }  문항별 리뷰
 *   SG_RESULTS.tasks(session, owner)  → Promise<[sg_task_scores 행]>  W·S 채점
 *   SG_RESULTS.productive(row)        → [{question_id, skill, task_kind, prompt, …}]
 *   SG_RESULTS.uploadRecordings(row)  → Promise<{sent,failed}>  녹음 → 비공개 버킷
 *   SG_RESULTS.aiScore(row, opts)     → Promise<채점 결과|null>  /api/score 호출
 *                                       opts.onProgress(done, total) 로 진행을 알린다
 *                                       .expired 면 세션이 끊긴 것(로그인부터 다시)
 *   SG_RESULTS.unscored(row, 채점행)  → [아직 점수가 없는 과제]  "아직 채점 전" 의 정체
 *   SG_RESULTS.scoreMissing(row,opts) → Promise<{missing, scored, skipped}>  못 매긴 것만 다시 의뢰
 *                                       opts.auto 면 응시당 횟수·간격 고삐를 쓴다
 *   SG_RESULTS.bandOf(row)            → Promise<SG_BAND.of(...)>  밴드까지 한 번에
 *
 * 점수 두 벌에 대하여
 *   객관식(R·L)은 이 파일이 브라우저에서 채점한다 — 시험은 무네트워크에서도 끝나야
 *   하기 때문이다. 산출형(W·S)은 채점 기준이 글의 질이라 규칙으로 매길 수 없어서
 *   서버(/api/score)가 ETS 루브릭으로 0~5 를 매기고 sg_task_scores 에 남긴다.
 *   두 벌을 1~6 밴드라는 한 눈금으로 합치는 일은 sg-band.js 가 한다.
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
    /* DB 결과는 SET10, SET 010, T-010처럼 서로 다른 표기로 남을 수 있다.
     * 숫자 부분을 정수로 정규화해 모두 SMEAG_SET10을 가리키게 한다. 다른 SET으로
     * 떨어지면 학생 답을 엉뚱한 정답지와 비교하므로, 없는 팩은 반드시 null이다. */
    var digits = String(setCode || '').replace(/\D/g, '');
    var code = digits ? String(Number(digits)) : '';
    return code ? (window['SMEAG_SET' + code] || null) : null;
  }

  /* SET10처럼 importer가 만든 팩은 helper보다 먼저 리뷰 화면에 실릴 수 있다.
   * 그 경우에도 원본 sections 구조에서 문항을 직접 펼쳐 Review·Scoring을 만든다. */
  function allQuestions(p) {
    if (!p) return [];
    if (typeof p.allQuestions === 'function') return p.allQuestions();
    var out = [];
    (p.sections || []).forEach(function (sec) {
      (sec.modules || []).forEach(function (mod) {
        (mod.blocks || []).forEach(function (block) {
          (block.questions || []).forEach(function (q) {
            out.push({ q: q, block: block, module: mod, section: sec });
          });
        });
      });
    });
    return out;
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

  function isArray(v) { return Object.prototype.toString.call(v) === '[object Array]'; }

  /* Build a Sentence(W1)의 정답은 '토큰 한 줄'이 아니라 '빈칸에 들어갈 토큰의 순서'다.
   * 정답표(ANSWER_KEY)에는 이 문항이 아예 없고 슬롯 정의가 정본이라 거기서 꺼낸다.
   * 이걸 안 하면 key 가 null 이 되어 주관식으로 빠지고, SET 9 는 만점을 맞아도
   * 107 이 아니라 97 만 채점된다(라이팅이 통째로 0/0 이 되던 자리다). */
  function blankTokens(q) {
    if (!q || !isArray(q.slots)) return null;
    var out = [], i;
    for (i = 0; i < q.slots.length; i++) {
      if (q.slots[i] && q.slots[i].t === 'b') out.push(q.slots[i].a);
    }
    return out.length ? out : null;
  }

  /* 빈칸을 하나라도 비웠거나 순서가 다르면 오답이다 — 부분점수는 없다.
   * 비교는 norm() 이라 대소문자·앞뒤 공백만 무시한다(타일 'why' vs 슬롯 'Why'). */
  function hitSequence(given, tokens) {
    if (!isArray(given) || given.length !== tokens.length) return false;
    for (var i = 0; i < tokens.length; i++) {
      if (norm(given[i]) !== norm(tokens[i])) return false;
    }
    return true;
  }

  /** answers: SG_STORE.answers() 모양 { qid: { v: ... } } 또는 { qid: value }. */
  function valueOf(a, qid) {
    var rec = a && a[qid];
    if (rec == null) return '';
    return (typeof rec === 'object' && rec !== null && 'v' in rec) ? rec.v : rec;
  }

  /* 문항이 딛고 선 원문 — 리딩은 지문, 리스닝은 대본. AI 리뷰가 "왜 그 답인가" 를
   * 쓰려면 이게 있어야 한다. 없으면 모델이 기댈 것은 문제문 한 줄뿐이고, 그러면
   * 지문에 있지도 않은 근거를 지어내거나 "다시 읽어 보라" 는 말만 남는다.
   * 화면은 이 값을 쓰지 않는다 — 지문은 이미 리뷰 화면이 따로 그린다. */
  function sourceOf(entry) {
    var blk = (entry && entry.block) || {};
    var q = (entry && entry.q) || {};
    if (isArray(blk.paragraphs) && blk.paragraphs.length) {
      return { kind: 'passage', title: String(blk.title || blk.heading || ''),
               text: blk.paragraphs.join('\n\n') };
    }
    if (blk.script) {
      return { kind: 'script', title: String(blk.title || blk.heading || ''), text: String(blk.script) };
    }
    /* 문항마다 음원이 따로 붙는 리스닝(짧은 응답)에는 블록 대본이 없다. 그 한 줄은
       대본 인덱스에만 있는데, 그게 곧 학생이 들은 전부다 — 없으면 리뷰는 "다시 들어
       보세요" 밖에 못 쓴다. 인덱스가 아직 안 실렸으면 조용히 없는 대로 간다
       (부르는 쪽이 SG_SCRIPT_CHECK.load 를 먼저 기다린다). */
    if (window.SG_SCRIPT_CHECK && window.SG_SCRIPT_CHECK.forPath) {
      /* 문항 제 음원이 먼저다. 없으면 블록이 함께 쓰는 클립(Questions 13-14 처럼
         한 대화에 문항 둘)의 대본을 쓴다. */
      var rec = (q.audio && window.SG_SCRIPT_CHECK.forPath(q.audio)) ||
                (blk.audio && window.SG_SCRIPT_CHECK.forPath(blk.audio));
      if (rec && rec.text) {
        return { kind: 'script', title: String(blk.heading || ''), text: String(rec.text) };
      }
    }
    if (blk.text) {
      return { kind: 'passage', title: String(blk.title || blk.heading || ''), text: String(blk.text) };
    }
    return null;
  }

  function score(p, answers) {
    var rows = [], bySection = {}, sc = 0, total = 0;
    if (!p) return { score: 0, total: 0, percent: 0, bySection: bySection, rows: rows };

    var all = allQuestions(p);
    var keys = p.answerKey || {};

    for (var i = 0; i < all.length; i++) {
      var q = all[i].q || all[i];
      var qid = q.id;
      var key = keys.hasOwnProperty(qid) ? keys[qid] : q.answer;
      var given = valueOf(answers, qid);
      var ok, seq = (key == null && q.kind === 'build') ? blankTokens(q) : null;
      if (seq) {
        ok = hitSequence(given, seq);
        // 리뷰 화면의 '정답' 칸에는 빈칸 토막이 아니라 완성 문장을 보여 준다.
        key = q.sentence || seq;
      } else {
        ok = hit(given, key);
      }
      var sec = sectionEntry(all[i], qid);

      bySection[sec] = bySection[sec] || { score: 0, total: 0 };
      if (ok !== null) {                    // 객관 채점 가능한 문항만 점수에 넣는다
        total += 1; bySection[sec].total += 1;
        if (ok) { sc += 1; bySection[sec].score += 1; }
      }
      rows.push({
        qid: qid, no: q.no, section: sec, kind: q.kind,
        prompt: q.prompt || q.text || q.question || '',
        /* 보기 — 객관식의 정답은 팩 안에서 번호다. 번호만 들고 다니면 리뷰에
           "정답은 2번" 밖에 못 쓴다. 보기 문장을 함께 들고 다닌다. */
        choices: isArray(q.choices) ? q.choices : null,
        given: given, key: key, ok: ok,
        src: sourceOf(all[i])
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
      })).then(function (r) {
        /* null 은 **실패**를 뜻한다(push() 가 이 값으로 올렸는지를 가른다). 쓰기는
         * Prefer: return=minimal 로 보내므로 성공해도 본문이 비어 있다 — 그 자리에서
         * json() 이 터져 null 이 되면, 잘 올라간 응시가 "안 올라갔다" 로 남아 제출
         * 직후 채점이 통째로 건너뛰어진다. 빈 본문은 true(성공)로 돌린다. */
        if (!r.ok) return null;
        return r.text().then(function (t) {
          if (!t) return true;
          try { return JSON.parse(t); } catch (e) { return true; }
        })['catch'](function () { return true; });
      });
    }).catch(function () { return null; });        // 오프라인이면 조용히 로컬만
  }

  var SELECT = 'id,owner,session,set_code,mode,started_at,submitted_at,score,total,percent,' +
               'by_section,answers,scale,attempt_no,hidden,hidden_reason';

  /* 숨긴 응시(hidden)는 기본으로 빠진다 — 지우지는 않았지만 성적으로 세어서는
     안 되는 것들이다(기기를 공유하다 잘못 붙은 응시, 리허설 기록).
     관리자 화면이 opts.includeHidden 으로 켤 수 있다. */
  function visibility(opts) {
    return (opts && opts.includeHidden) ? '' : '&hidden=is.false';
  }

  function remote(opts) {
    var u = window.SG_AUTH && SG_AUTH.user();
    if (!u) return Promise.resolve([]);
    return rest('sg_results?select=' + SELECT + '&owner=eq.' + u.id + visibility(opts) +
                '&order=submitted_at.desc')
      .then(function (rows) { return rows || []; });
  }

  function listFor(ownerId, opts) {
    return rest('sg_results?select=' + SELECT + '&owner=eq.' + encodeURIComponent(ownerId) +
                visibility(opts) + '&order=submitted_at.desc')
      .then(function (rows) { return rows || []; });
  }

  /* 되감기·다시 시작 직전의 백업본(sg_archives). 학생은 자기 것만, 선생님·관리자는
     맡은 학생의 것까지 — 실제 경계는 RLS(sg_can_see)가 쥔다. */
  function archives(opts) {
    opts = opts || {};
    var q = 'sg_archives?select=id,owner,session,set_code,reason,step,client_ts,answers,clocks,cursor,meta,created_at' +
            '&order=created_at.desc&limit=' + (opts.limit || 200);
    if (opts.owner) q += '&owner=eq.' + encodeURIComponent(opts.owner);
    if (opts.session) q += '&session=eq.' + encodeURIComponent(opts.session);
    return rest(q).then(function (rows) { return rows || []; });
  }

  /* 선생님·관리자 화면용 전체 목록. RLS(sg_is_staff) 가 실제 권한을 쥐고 있으므로
   * 학생이 이걸 불러도 자기 것만 돌아온다 — 화면에서 막는 건 안내일 뿐 방어선이 아니다.
   *
   * sg_results.owner 의 외래키는 auth.users 라서 PostgREST 임베딩으로 이름을 붙일 수
   * 없다. 결과를 받은 뒤 등장한 owner 만 모아 프로필을 한 번 더 읽어 이어 붙인다. */
  function listAll(opts) {
    opts = opts || {};
    var q = 'sg_results?select=' + SELECT + visibility(opts) +
            '&order=submitted_at.desc&limit=' + (opts.limit || 500);
    if (opts.setCode) q += '&set_code=eq.' + encodeURIComponent(opts.setCode);
    return rest(q).then(function (rows) {
      rows = rows || [];
      var ids = [], seen = {};
      rows.forEach(function (r) { if (r.owner && !seen[r.owner]) { seen[r.owner] = true; ids.push(r.owner); } });
      if (!ids.length) return rows;
      return rest('sg_profiles?select=id,name,student_id,email,role,teacher_id&id=in.(' + ids.join(',') + ')')
        .then(function (people) {
          var by = {};
          (people || []).forEach(function (p) { by[p.id] = p; });
          rows.forEach(function (r) { r.student = by[r.owner] || null; });
          return rows;
        });
    });
  }

  /* ── 산출형(Writing·Speaking) 채점 ──────────────────────────
   *
   * 객관식과 갈라지는 지점이다. 여기서 다루는 문항은 정답표로 O/X 를 낼 수 없어서
   * ETS 루브릭으로 0~5 를 매겨야 하고, 그 판단은 서버(/api/score)가 한다.
   */

  /* AI 채점 대상인 과제 종류. 팩의 kind 를 그대로 쓴다.
   * 'build'(Build a Sentence)는 여기 없다 — 정답표가 있는 자동채점 문항이다. */
  var PRODUCTIVE = {
    email: 'writing', discussion: 'writing',
    repeat: 'speaking', interview: 'speaking'
  };

  /**
   * 이 응시에서 AI 가 채점해야 할 과제 목록.
   *
   * 스피킹도 그대로 목록에 오른다. 전사문은 여기서 만들지 않는다 — 녹음을 버킷에
   * 올려 두면 서버가 내려받아 옮겨 적는다(uploadRecordings → /api/score).
   * 녹음이 없거나 서버에 STT 키가 없으면 서버가 'no_transcript' 로 건너뛴다.
   */
  function productive(row) {
    var p = pack(row && row.set_code), out = [];
    if (!p) return out;
    var all = allQuestions(p);
    for (var i = 0; i < all.length; i++) {
      var q = all[i].q || all[i];
      var skill = PRODUCTIVE[q.kind];
      if (!skill) continue;
      out.push({
        question_id: q.id,
        skill: skill,
        task_kind: q.kind,
        // 문제문은 채점 근거가 아니라 맥락이다. 서버는 답안을 DB 에서 직접 읽는다.
        prompt: String(q.prompt || q.situation || q.subject || ''),
        reference: String(q.reference || q.script || '')
      });
    }
    return out;
  }

  /**
   * W·S 채점 행. session 을 주면 그 응시만, 비우면 (RLS 가 허락하는) 전부.
   * 목록 화면이 응시마다 한 번씩 묻지 않도록 "전부" 를 허용한다 — 대시보드에서
   * 응시 20건이면 요청도 20번이 되던 자리다.
   */
  function tasks(session, ownerId) {
    var q = 'sg_task_scores?select=session,question_id,skill,task_kind,ai_score,ai_rubric,' +
            'ai_model,ai_error,transcript,transcript_model,media_path,' +
            'teacher_score,teacher_note,confirmed_at&order=question_id';
    if (session) q += '&session=eq.' + encodeURIComponent(session);
    if (ownerId) q += '&owner=eq.' + encodeURIComponent(ownerId);
    return rest(q).then(function (rows) { return rows || []; });
  }

  /** 이 과제에 이미 점수가 있는가. 교사 확정 > 교사 점수 > AI 초안 순으로 본다.
   *  ai_error 만 있고 ai_score 가 null 인 행은 **점수가 없는 것**이다 — 채점을
   *  걸었다가 모델이 실패한 자리이고, 그런 행이야말로 다시 의뢰해야 한다. */
  function hasScore(t) {
    if (!t) return false;
    if (t.confirmed_at) return true;
    if (t.teacher_score !== null && t.teacher_score !== undefined) return true;
    return t.ai_score !== null && t.ai_score !== undefined;
  }

  /**
   * 이 응시에서 **아직 점수가 없는** 산출형 과제. "아직 채점 전" 이라고 적힌 자리의
   * 정체가 이것이다 — 화면이 그 문구를 띄우는 조건과 다시 의뢰하는 조건이 같아야
   * 한다. 그렇지 않으면 버튼을 눌러도 아무 일도 일어나지 않는 화면이 생긴다.
   */
  /* skill 을 주면 그 영역만 센다. 라이팅과 스피킹은 매기는 값이 다르다 — 라이팅은
     글만 있으면 그 자리에서 매겨지지만, 스피킹은 녹음이 버킷에 닿아야 시작조차 된다.
     그래서 화면도 둘을 따로 걸 수 있어야 한다: 라이팅이 끝난 자리에서 스피킹만 다시
     걸면, 이미 끝난 쪽을 건드리지 않고 남은 관문만 두드린다. */
  function unscored(row, taskRows, skill) {
    var by = {};
    (taskRows || []).forEach(function (t) { if (t && t.question_id) by[t.question_id] = t; });
    var want = String(skill || '').toLowerCase();
    return productive(row).filter(function (t) {
      if (want && String(t.skill || '').toLowerCase() !== want) return false;
      return !hasScore(by[t.question_id]);
    });
  }

  /* 자동 재의뢰의 고삐.
   *
   * 점수가 없는 이유가 늘 "아직" 인 것은 아니다. 녹음이 이 기기를 떠나기 전에
   * 올라가지 못했다면 서버는 언제 물어도 no_transcript 로 돌려보내고, 그때마다
   * 전사·채점을 다시 시도하면 대시보드를 열 때마다 돈만 나간다. 그래서 자동으로
   * 거는 재의뢰는 응시당 몇 번, 몇 분 간격으로만 허락한다. 사람이 버튼을 누른
   * 경우는 이 고삐를 지나친다 — 선생님이 지금 고쳐 놓고 다시 거는 자리다. */
  var AUTO_MAX = 4;                      // 응시 하나에 자동 재의뢰는 네 번까지
  var AUTO_GAP = 10 * 60 * 1000;         // 그리고 10분에 한 번까지
  function autoKey(session) { return 'sg2_score_auto::' + session; }
  function autoState(session) { return readJSON(autoKey(session), null) || { n: 0, at: 0 }; }
  function autoAllowed(session) {
    var st = autoState(session);
    if (st.n >= AUTO_MAX) return false;
    return (Date.now() - (st.at || 0)) >= AUTO_GAP;
  }
  function autoMark(session, progressed) {
    /* 한 과제라도 새로 매겨졌으면 시도 횟수를 되돌린다. 서버리스 상한에 걸려
       한 묶음만 채점되고 끊긴 경우가 여기다 — 진전이 있는 한 계속 이어 간다. */
    var st = autoState(session);
    var next = { n: progressed ? 0 : (st.n || 0) + 1, at: Date.now() };
    try { localStorage.setItem(autoKey(session), JSON.stringify(next)); } catch (e) {}
  }

  /**
   * 점수가 없는 과제만 골라 채점을 다시 의뢰한다.
   *
   * force 가 아니다 — 이미 매겨진 과제는 애초에 보내지 않고(돈), 서버도
   * already_scored 로 거른다(안전). 교사가 확정한 행은 어느 쪽에서도 건드리지 않는다.
   * 결과는 서버가 sg_task_scores 에 직접 쓴다: 이 함수가 돌아온 뒤 화면이
   * 다시 읽으면 점수가 그 자리에 있다.
   *
   * @param opts.owner      staff 가 남의 응시를 채점할 때만(학생은 늘 자기 것)
   * @param opts.taskRows   이미 읽어 둔 sg_task_scores 행(다시 묻지 않기 위해)
   * @param opts.auto       사람이 누른 것이 아니라 화면이 스스로 건 것 → 고삐를 쓴다
   * @param opts.skill      'writing' | 'speaking' — 한 영역만 건다(비우면 둘 다)
   * @returns Promise<{ missing, scored, skipped, throttled?, error?, expired? }>
   *          expired 면 세션이 서버에서 끊긴 것이다 — 다시 걸어 봐야 소용없고,
   *          화면은 재시도 대신 로그인 문을 세워야 한다.
   */
  function scoreMissing(row, opts) {
    opts = opts || {};
    if (!row || !row.session || !window.SG_AUTH || !SG_AUTH.user()) {
      return Promise.resolve(null);
    }
    var known = opts.taskRows
      ? Promise.resolve(opts.taskRows)
      : tasks(row.session, opts.owner || undefined)['catch'](function () { return []; });

    return known.then(function (rows) {
      var todo = unscored(row, rows, opts.skill);
      var base = { session: row.session, missing: todo.length, scored: [], skipped: [] };
      if (!todo.length) return base;
      if (opts.auto && !autoAllowed(row.session)) {
        base.throttled = true;
        return base;
      }
      return aiScore(row, {
        owner: opts.owner, tasks: todo, lang: opts.lang, onProgress: opts.onProgress
      }).then(function (out) {
        var got = (out && out.scored) || [];
        if (opts.auto) autoMark(row.session, got.length > 0);
        if (!out) return base;
        out.missing = todo.length;
        return out;
      });
    });
  }

  /** session → 채점 행[] 로 묶는다. 목록 화면이 한 번만 묻고 나눠 쓰기 위한 것. */
  function tasksBySession(rows) {
    var by = {};
    (rows || []).forEach(function (r) {
      if (!r || !r.session) return;
      (by[r.session] = by[r.session] || []).push(r);
    });
    return by;
  }

  /* ── 스피킹 녹음 올리기 ────────────────────────────────────
   *
   * 녹음은 응시 기기의 IndexedDB 에만 있다. 그 상태로는 스피킹을 채점할 수 없고
   * (서버가 음성을 볼 수 없다) 다른 기기에서 다시 들을 수도 없다. 제출이 끝나면
   * 비공개 버킷 toefl-recordings 로 올린다 — 경로는
   *   {user_id}/{session}/{question_id}.{ext}
   * 이고, 버킷 정책이 첫 칸(user_id)을 auth.uid() 와 대조해 남의 자리에 못 쓰게 막는다.
   * 원본은 90일 뒤 지운다(운영 결정) — 그때까지 서버가 전사문을 떠 두면 채점 근거는 남는다.
   */
  var BUCKET = 'toefl-recordings';

  /* MediaRecorder 가 내놓는 타입은 'audio/webm;codecs=opus' 다 — 코덱까지 붙는다.
   * 버킷의 allowed_mime_types 는 'audio/webm' 처럼 파라미터 없는 이름만 알고 있어,
   * 그대로 Content-Type 에 실으면 Storage 가 400(InvalidMimeType)으로 되돌린다.
   * 2026-08-12 시험의 녹음 61건이 전부 이 400 이었다: 파일은 한 장도 올라가지 않았고,
   * 학생 화면에는 "계정에 저장되었습니다" 만 떴다. 그래서 보내기 전에 코덱을 뗀다. */
  function baseMime(mime) {
    var m = String(mime || '').split(';')[0].trim().toLowerCase();
    return m || 'audio/webm';
  }

  function extOf(mime) {
    var m = String(mime || '').toLowerCase();
    if (m.indexOf('webm') >= 0) return 'webm';
    if (m.indexOf('ogg') >= 0) return 'ogg';
    if (m.indexOf('mp4') >= 0 || m.indexOf('m4a') >= 0 || m.indexOf('aac') >= 0) return 'm4a';
    if (m.indexOf('wav') >= 0) return 'wav';
    if (m.indexOf('mpeg') >= 0 || m.indexOf('mp3') >= 0) return 'mp3';
    return 'webm';
  }

  /* 이미 올린 문항. 다시 올려도 x-upsert 로 덮일 뿐이지만, 응시 하나에 스피킹이
   * 15문항이라 대시보드를 열 때마다 15번씩 다시 올리는 건 그냥 낭비다. */
  function upKey(session) { return 'sg2_media_up::' + session; }
  function uploaded(session) { return readJSON(upKey(session), []) || []; }
  function markUploaded(session, qid) {
    var list = uploaded(session);
    if (list.indexOf(qid) < 0) list.push(qid);
    try { localStorage.setItem(upKey(session), JSON.stringify(list)); } catch (e) {}
  }

  /** answers 에서 이 기기에 녹음이 남아 있는 문항 id. */
  function recordedQids(answers) {
    var out = [], k;
    for (k in answers) {
      if (!answers.hasOwnProperty(k)) continue;
      var rec = answers[k];
      var media = rec && typeof rec === 'object' ? (rec.media || rec.v) : rec;
      if (typeof media === 'string' && media.indexOf('idb:') === 0) out.push(k);
    }
    return out;
  }

  function mediaOf(qid) {
    return new Promise(function (resolve) {
      if (!window.SG_STORE || typeof SG_STORE.getMedia !== 'function') { resolve(null); return; }
      SG_STORE.getMedia(qid, function (err, rec) {
        if (err || !rec) { resolve(null); return; }
        // 저장 형식은 {questionKey, blob, mime, …} 다. 아주 옛 기록은 Blob 자체였다.
        resolve(rec.blob ? rec : { blob: rec, mime: (rec && rec.type) || '' });
      });
    });
  }

  /**
   * 한 응시의 녹음을 올린다. 실패해도 시험 기록은 기기에 그대로 남으므로 조용하다.
   * @returns Promise<{sent:number, failed:number}>
   */
  function uploadRecordings(row) {
    var u = window.SG_AUTH && SG_AUTH.user();
    if (!u || !row || !row.session || !window.SG_STORE) return Promise.resolve({ sent: 0, failed: 0 });

    var done = uploaded(row.session);
    var todo = recordedQids(row.answers || {}).filter(function (q) { return done.indexOf(q) < 0; });
    if (!todo.length) return Promise.resolve({ sent: 0, failed: 0 });

    /* 다른 세션의 녹음을 읽으려면 스토어를 그 세션으로 열어야 한다. 열어 둔 세션이
     * 있으면 끝나고 되돌린다 — 대시보드에서 이걸 부른 뒤 진행 중인 시험의 스토어가
     * 엉뚱한 세션을 가리키면 안 된다. makeActive:false 로 '활성 세션' 표시는 건드리지 않는다. */
    var was = typeof SG_STORE.current === 'function' ? SG_STORE.current() : null;
    try { SG_STORE.open(row.session, false); } catch (e) { return Promise.resolve({ sent: 0, failed: 0 }); }

    return SG_AUTH.token().then(function (tok) {
      if (!tok) return { sent: 0, failed: todo.length };
      var sent = 0, failed = 0, why = '';

      /* 왜 거절당했는지 한 줄이라도 들고 나간다. 이 값이 없었기 때문에 400 이
         61번 반복되는 동안 화면에도 로그에도 아무 말이 남지 않았다. */
      function note(msg) { if (!why) why = String(msg || '').slice(0, 200); }

      function one(i) {
        if (i >= todo.length) return Promise.resolve();
        var qid = todo[i];
        return mediaOf(qid).then(function (rec) {
          if (!rec || !rec.blob || !rec.blob.size) return null;   // 녹음 실패 문항(NOT SUBMIT)
          var mime = baseMime(rec.mime || rec.blob.type);
          var path = [u.id, row.session, qid + '.' + extOf(mime)]
            .map(encodeURIComponent).join('/');
          return fetch(SG_AUTH.url + '/storage/v1/object/' + BUCKET + '/' + path, {
            method: 'POST',
            headers: {
              apikey: SG_AUTH.anonKey,
              Authorization: 'Bearer ' + tok,
              'Content-Type': mime,
              'x-upsert': 'true'
            },
            body: rec.blob
          }).then(function (r) {
            if (r.ok) { sent += 1; markUploaded(row.session, qid); return null; }
            failed += 1;
            return r.text()['catch'](function () { return ''; }).then(function (t) {
              note('HTTP ' + r.status + ' ' + t);
            });
          })['catch'](function (e) { failed += 1; note((e && e.message) || e); });
        })['catch'](function (e) { failed += 1; note((e && e.message) || e); })
          .then(function () { return one(i + 1); });   // 한 번에 하나씩 — 시험장 회선을 막지 않는다
      }

      return one(0).then(function () {
        if (failed) {
          try { console.warn('[sg2] recordings failed to upload: ' + failed + ' — ' + why); } catch (e) {}
        }
        return { sent: sent, failed: failed, error: why };
      });
    })['catch'](function (e) {
      return { sent: 0, failed: todo.length, error: String((e && e.message) || e) };
    }).then(function (out) {
      if (was && was !== row.session) { try { SG_STORE.open(was, false); } catch (e) {} }
      return out;
    });
  }

  /**
   * 서버에 AI 채점을 요청한다. 실패는 조용히 null 이다 — 채점이 안 됐다고 해서
   * 학생의 성적 화면이 멈추거나 에러를 띄울 이유는 없다(선생님이 확정하면 그만이다).
   */
  /* 한 요청에 담는 과제 수. 서버는 과제마다 (스피킹이면 전사 + ) 모델 호출을 하고,
   * 서버리스 함수에는 실행시간 상한이 있다. SET 9 는 W 3 + S 15 = 18 과제라 한 번에
   * 보내면 상한을 넘겨 통째로 날아간다 — 나눠 보내면 앞의 묶음은 이미 저장돼 있고
   * 뒤에서 끊겨도 다음 방문 때 못 매긴 것만 이어서 매긴다(서버가 already_scored 로 거른다). */
  var SCORE_BATCH = 3;
  /* API 함수보다 야간 너꺼ᄇ게 잡는다. 응답이 아예 꽈나지 않는 요청이
   * 이 시간이 지나도로 무한 대기 화면을 막는다. */
  var SCORE_TIMEOUT_MS = 70000;

  /* 세션이 죽었을 때 화면에 세울 말. 서버의 'Sign-in is required.' 를 그대로 옮기면
   * 로그인해 있는 사람에게는 거짓말로 읽힌다 — 문제는 로그인을 안 한 게 아니라
   * 들고 있던 세션이 서버에서 끊긴 것이다. */
  var SESSION_GONE = 'your session has expired — log in again and try once more.';

  function aiScore(row, opts) {
    opts = opts || {};
    var list = opts.tasks || productive(row);
    if (!list.length || !window.SG_AUTH) return Promise.resolve(null);

    /* 제출 직후 화면은 "몇 개 중 몇 개" 를 보여 준다. 채점은 묶음마다 수십 초라
     * 진행이 보이지 않으면 멈춘 화면과 구분되지 않는다. */
    function tell(done) {
      if (typeof opts.onProgress !== 'function') return;
      try { opts.onProgress(Math.min(done, list.length), list.length); } catch (e) {}
    }
    tell(0);

    return SG_AUTH.token().then(function (tok) {
      if (!tok) return null;

      var merged = null;

      /* 토큰은 묶음마다 새로 받는다. 한 번 집어 둔 토큰으로 네 묶음(묶음마다 수십 초)을
       * 다 보내면 중간에 만료된 자리부터 뒤가 통째로 401 로 날아간다 — 앞의 결과만
       * 남고 나머지는 "아직 채점 전" 으로 되돌아온다.
       *
       * 401 은 그 자리에서 한 번만 강제 갱신해 다시 보낸다. 만료 시각이 멀쩡해 보여도
       * 서버가 거절하는 경우가 있다: 기기 시계가 어긋났거나, 같은 계정을 쓰는 다른
       * 기기에서 로그아웃해 세션이 서버에서 끊긴 자리다. 갱신하고도 401 이면 세션이
       * 정말 죽은 것이라 SG_AUTH 를 비운다 — 헤더의 이름표도 함께 내려간다. */
      function post(i, retried) {
        return SG_AUTH.token(retried === true).then(function (tok2) {
          if (!tok2) {
            SG_AUTH.invalidate();
            return { _fail: SESSION_GONE, _status: 401, _expired: true };
          }
          var ctl = window.AbortController ? new window.AbortController() : null;
          var timer = null;
          var request = fetch('/api/score', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + tok2, 'Content-Type': 'application/json' },
            signal: ctl ? ctl.signal : undefined,
            body: JSON.stringify({
              session: row.session,
              owner: opts.owner || undefined,
              provider: opts.provider || undefined,
              model: opts.model || undefined,
              lang: opts.lang || undefined,
              force: !!opts.force,
              tasks: list.slice(i, i + SCORE_BATCH)
            })
          });
          var raced = request;
          if (ctl && window.setTimeout && window.clearTimeout) {
            var timeout = new Promise(function (_, reject) {
              timer = window.setTimeout(function () {
                ctl.abort();
                reject(new Error('AI scoring request timed out. Please open My results to retry.'));
              }, SCORE_TIMEOUT_MS);
            });
            raced = Promise.race([request, timeout]);
          }
          return raced.then(function (r) {
            if (timer && window.clearTimeout) window.clearTimeout(timer);
            if (r.ok) return r.json();
            if (r.status === 401 && !retried) return post(i, true);
            /* 서버가 왜 거절했는지는 본문에 있다(키 미설정 503, 권한 401, …).
               이걸 버리면 화면에는 "채점 중" 만 남고, 아무도 설정이 빠졌다는 걸 모른다. */
            return r.json()['catch'](function () { return null; }).then(function (j) {
              var fail = { _fail: (j && j.error) || ('HTTP ' + r.status), _status: r.status };
              if (r.status === 401) {
                SG_AUTH.invalidate();
                fail._fail = SESSION_GONE;
                fail._expired = true;
              }
              return fail;
            });
          }, function (err) {
            if (timer && window.clearTimeout) window.clearTimeout(timer);
            throw err;
          });
        });
      }

      function send(i) {
        if (i >= list.length) return Promise.resolve(merged);
        return post(i, false)
          .then(function (out) {
            if (out && out._fail) {
              // 같은 이유로 남은 묶음도 다 거절당한다. 더 보내지 않고 이유를 들고 돌아간다.
              if (!merged) merged = { session: row.session, scored: [], skipped: [] };
              merged.error = out._fail;
              merged.status = out._status;
              merged.expired = !!out._expired;
              return merged;
            }
            if (out) {
              if (!merged) merged = { session: row.session, scored: [], skipped: [] };
              merged.scored = merged.scored.concat(out.scored || []);
              merged.skipped = merged.skipped.concat(out.skipped || []);
              merged.provider = out.provider; merged.model = out.model; merged.owner = out.owner;
            }
            tell(i + SCORE_BATCH);
            return send(i + SCORE_BATCH);
          })['catch'](function (e) {           // 한 묶음이 끊겨도 앞의 결과는 남는다
            if (!merged) merged = { session: row.session, scored: [], skipped: [] };
            if (!merged.error) merged.error = String((e && e.message) || e);
            return merged;
          });
      }

      return send(0);
    }).catch(function () { return null; });
  }

  /** 응시 한 건 → 밴드까지 계산된 화면용 객체. SG_BAND 가 없으면 null. */
  function bandOf(row, ownerId) {
    if (!row || !window.SG_BAND) return Promise.resolve(null);
    return tasks(row.session, ownerId || row.owner)
      .then(function (rows) { return SG_BAND.of(row, rows); })
      .catch(function () { return SG_BAND.of(row, []); });
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

  /** 아직 서버에 없는 로컬 응시를 올린다. 로그인 + 네트워크가 있을 때만 실제로 돈다.
   *
   * 순서가 중요하다: 응시 행 → 녹음 → 채점.
   *   - 응시 행이 먼저다. 서버는 sg_results.answers 에서 채점할 글을 직접 읽는다.
   *   - 녹음이 그다음이다. 버킷에 음성이 없으면 스피킹은 'no_transcript' 로 빠진다.
   *   - 채점이 마지막이다. 앞의 둘이 끝나야 W·S 가 한 번에 채점된다.
   *
   * 녹음 업로드는 "아직 안 올라간 응시"뿐 아니라 **이미 올라간 응시**도 훑는다.
   * 시험장에서 회선이 끊겼던 응시는 결과 행만 올라가고 음성이 남았을 수 있고,
   * 그 경우 학생이 나중에 대시보드를 열기만 해도 밀린 녹음이 따라 올라가야 한다. */
  function push(opts) {
    opts = opts || {};
    var u = window.SG_AUTH && SG_AUTH.user();
    var mine = local();
    if (!u || !mine.length) return Promise.resolve({ sent: 0, failed: 0, scored: null });

    /* 숨긴 응시까지 본다 — 여기서 빼면 "서버에 없다"고 판단해 다시 올리고,
       가려 둔 응시가 성적 목록으로 되돌아온다. */
    return remote({ includeHidden: true }).then(function (rows) {
      var have = {};
      (rows || []).forEach(function (r) { have[r.session] = true; });
      var todo = mine.filter(function (r) { return !have[r.session]; });

      var wrote = todo.length
        ? rest('sg_results?on_conflict=owner,session', {
            method: 'POST',
            headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify(todo.map(function (r) {
              return {
                owner: u.id, session: r.session, set_code: r.set_code, mode: r.mode,
                started_at: r.started_at, submitted_at: r.submitted_at,
                score: r.score, total: r.total, percent: r.percent,
                by_section: r.by_section, answers: r.answers
              };
            }))
          })
        : Promise.resolve(true);

      return wrote.then(function (res) {
        var pushed = (res === null) ? [] : todo;
        // 서버에 행이 있는 응시만 채점 대상이다 — 없는 응시를 채점하면 404 다.
        var landed = mine.filter(function (r) {
          return have[r.session] || pushed.indexOf(r) >= 0;
        });

        /* 녹음을 올린 뒤에 채점한다.
         *
         * 목록 화면(대시보드)은 채점을 기다리지 않는다 — 몇십 초 걸리는 일이고,
         * 결과는 sg_task_scores 에 쌓여 다음 조회 때 밴드로 나타난다.
         * 제출 직후 화면만 waitScore 로 끝까지 기다린다: 학생이 "제출했습니다" 만
         * 보고 나가 버리면 채점을 건 탭이 닫혀 요청이 중간에 끊긴다. 그 자리에서
         * 점수까지 보여 주려면 어차피 기다려야 하고, 기다리는 김에 끊기지도 않는다.
         * 실패해도 조용하다: 선생님이 확정하면 그만이고, 자동 채점은 그 초안일 뿐이다. */
        var out = null;
        var media = { sent: 0, failed: 0, error: '' };

        /* 이미 매겨진 과제가 무엇인지는 여기서 한 번만 읽는다. 응시마다 물으면
           대시보드 한 번에 스무 번이 된다 — 목록 화면이 tasks() 를 한 번만 부르는
           것과 같은 이유다. 새 응시만 있으면 물을 것도 없다. */
        var older = landed.filter(function (r) { return pushed.indexOf(r) < 0; });
        var known = older.length
          ? tasks().then(tasksBySession)['catch'](function () { return {}; })
          : Promise.resolve({});

        return known.then(function (byS) {
        var jobs = landed.map(function (r) {
          return uploadRecordings(r).then(function (up) {
            media.sent += up.sent; media.failed += up.failed;
            if (up.error && !media.error) media.error = up.error;
            var isNew = pushed.indexOf(r) >= 0;
            /* 새 응시는 통째로 채점한다(아직 아무 점수도 없다).
             *
             * 예전 응시는 "아직 점수가 없는 과제" 만 다시 의뢰한다. 예전에는 밀렸던
             * 녹음이 방금 올라간 경우에만 채점을 걸었는데, 그러면 제출 당시 채점이
             * 끊기거나(서버리스 상한) 거절당한(키 미설정) 응시는 영원히 "아직 채점 전"
             * 으로 남았다 — 고칠 사람은 그 사실조차 몰랐다. 이제는 대시보드를 여는
             * 것만으로 못 매긴 과제가 다시 의뢰되고, 결과는 Supabase 로 올라간다.
             * 녹음이 방금 올라간 응시는 새 재료가 생긴 것이니 고삐 없이 바로 건다. */
            var job = isNew
              ? aiScore(r, { onProgress: opts.onProgress })
              : scoreMissing(r, {
                  auto: !up.sent,
                  taskRows: byS[r.session] || [],
                  onProgress: opts.onProgress
                });
            job = job['catch'](function () { return null; });
            if (!opts.waitScore) return null;
            return job.then(function (res) { if (res && !out) out = res; });
          })['catch'](function () {});
        });

        return Promise.all(jobs).then(function () {
          /* media 를 같이 돌려준다 — 답안이 올라갔다는 사실만으로 "다 저장됐다"고
             말하면, 녹음이 통째로 실패한 날에도 아무도 그 사실을 모른다. */
          return { sent: pushed.length, failed: todo.length - pushed.length, scored: out, media: media };
        });
        });
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

  /* 응시를 가리거나 되돌린다. 선생님·관리자만 남의 응시를 만질 수 있다(RLS).
     지우는 길은 여기 없다 — 잘못 붙은 응시도 기록으로는 남아야 한다. */
  function setHidden(row, hidden, reason) {
    if (!row || !row.id) return Promise.resolve(null);
    return rest('sg_results?id=eq.' + encodeURIComponent(row.id), {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        hidden: !!hidden,
        hidden_reason: hidden ? String(reason || '') : '',
        attempt_no: hidden ? 0 : (row.attempt_no || 1)
      })
    });
  }

  return {
    sectionOf: sectionOf, label: LABEL, pack: pack, score: score, detail: detail,
    local: local, remote: remote, list: list, get: get, push: push,
    listFor: listFor, listAll: listAll, archives: archives, setHidden: setHidden,
    productive: productive, tasks: tasks, tasksBySession: tasksBySession,
    unscored: unscored, hasTaskScore: hasScore, scoreMissing: scoreMissing,
    aiScore: aiScore, bandOf: bandOf,
    uploadRecordings: uploadRecordings, recordedQids: recordedQids, extOf: extOf
  };
})();
