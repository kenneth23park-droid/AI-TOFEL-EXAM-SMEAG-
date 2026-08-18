/* SMEAG StudyGround — book-schema.js : 교재 챕터 1장의 모양과 검산.
 *
 * 왜 있나
 *   교재("TOEFL Practice Book — B2 Level Up")는 한 챕터를 **한 번만** 집필하고
 *   거기서 학생용 PDF · 교사용 정답판 PDF · 응시 가능한 세트 · 리스닝 음원 · 색인을
 *   전부 뽑아낸다. 산출물마다 원고를 따로 두면 하루 만에 서로 어긋나므로, 원고는
 *   챕터 JSON 하나뿐이어야 한다. 그 하나가 어떤 모양인지를 여기서 못 박는다.
 *
 * 왜 기존 섹션 조각과 같은 모양인가
 *   config/_set9_fragments/{reading,listening,speaking,writing}.json 은 이미 시험 엔진이
 *   먹는 모양이다. 챕터를 그 **완전한 상위집합**(키를 더하기만 하고 하나도 빼지 않음)으로
 *   두면, 챕터를 그대로 섹션 자리에 끼워 넣어 시험으로 돌릴 수 있다. 교재 전용 포맷을
 *   새로 만들면 렌더러·채점기·동기화를 전부 두 벌로 유지해야 한다 — 그 길은 막는다.
 *
 * gate 모양은 set-import.js 와 **완전히 같다**: { level:'stop'|'warn', scope, message }.
 * 'stop' 은 저장 버튼을 잠근다(시험을 만들 수 없는 문제), 'warn' 은 사람이 봐야 하는 문제.
 * 두 파일이 다른 모양을 쓰면 관리자 화면이 gate 를 두 번 해석해야 한다.
 *
 * 문항 수의 정본은 config/blueprint.book.json 이다. 브라우저가 fetch 없이 검산해야 해서
 * 이 파일 안에 같은 표의 사본(SHAPE)을 둔다. 사본이 낡을 수 있으므로 blueprint 를 실제로
 * 읽은 호출자는 useBlueprint(json) 로 실어 준다 — 그러면 파일이 사본을 이긴다.
 *
 * 노출 전역: window.SG_BOOK_SCHEMA
 * ES5 문법만 쓴다(빌드 단계 없음).
 */
(function (root, factory) {
  var api = factory();
  root.SG_BOOK_SCHEMA = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var SCHEMA_VERSION = '1.0.0';
  var CEFR = 'B2';
  var BOOKS = ['reading', 'listening', 'speaking', 'writing'];

  /* 팩 안에서의 섹션 배열 순서. set-import.js 의 SECTION_ORDER 와 같은 값이어야 한다 —
     응시 순서(리딩→리스닝→라이팅→스피킹)가 여기서 갈리면 시험 흐름이 달라진다. */
  var SECTION_ORDER = ['reading', 'listening', 'writing', 'speaking'];

  /* 자동 채점되는 문항 종류. 여기 속하면 answer 가 비어 있는 것은 'stop' 이다.
     free-write / repeat / interview 는 사람이 채점하므로 answer 가 없어도 정상이다. */
  var AUTO_SCORED = ['blank', 'mcq', 'insert', 'build'];

  /* ------------------------------------------------------------------ 사본 표
   * config/blueprint.book.json 의 books[] 를 검산에 필요한 만큼만 옮겨 적은 것.
   * 문구(instruction)까지 옮기지 않는 이유: 문구는 편집으로 바뀔 수 있고, 문구가 달라졌다고
   * 저장을 막으면 편집자가 검산을 꺼 버린다. 여기서 잠그는 것은 '구조'뿐이다 —
   * 모듈 id·순서, 블록 kind·순서, 블록별 문항 수, 문항 종류 구성.
   */
  var SHAPE = {
    reading: {
      label: 'Reading', labelKo: '리딩', timeLimitSec: 1050, questions: 30,
      audio: false, modelAnswers: 'none',
      modules: [
        { id: 'R1', label: 'Reading Practice 1', timeLimitSec: 600, blocks: [
          { kind: 'cloze', instruction: 'Fill in the blank.', questions: 10, questionKinds: { blank: 10 } },
          { kind: 'passage', instruction: 'Read a webpage.', questions: 2, questionKinds: { mcq: 2 }, choices: 4 },
          { kind: 'passage', instruction: 'Read a passage.', questions: 3, questionKinds: { mcq: 3 }, choices: 4 }
        ] },
        { id: 'R2', label: 'Reading Practice 2', timeLimitSec: 450, blocks: [
          { kind: 'cloze', instruction: 'Fill in the blank.', questions: 10, questionKinds: { blank: 10 } },
          { kind: 'passage', instruction: 'Read a passage.', questions: 5, questionKinds: { mcq: 4, insert: 1 }, choices: 4 }
        ] }
      ]
    },
    listening: {
      label: 'Listening', labelKo: '리스닝', timeLimitSec: null, questions: 22,
      audio: true, modelAnswers: 'none',
      modules: [
        { id: 'L1', label: 'Listening Practice 1', timeLimitSec: null, blocks: [
          { kind: 'audio-set', instruction: 'Listen to the question and select the best response from the choices.', questions: 6, questionKinds: { mcq: 6 }, perQuestionAudio: true, choices: 4 },
          { kind: 'audio-set', instruction: 'Listen to a conversation.', questions: 2, questionKinds: { mcq: 2 }, choices: 4 },
          { kind: 'audio-set', instruction: 'Listen to an announcement.', questions: 2, questionKinds: { mcq: 2 }, choices: 4 },
          { kind: 'audio-set', instruction: 'Listen to a talk.', questions: 4, questionKinds: { mcq: 4 }, choices: 4 }
        ] },
        { id: 'L2', label: 'Listening Practice 2', timeLimitSec: null, blocks: [
          { kind: 'audio-set', instruction: 'Listen to the question and select the best response from the choices.', questions: 2, questionKinds: { mcq: 2 }, perQuestionAudio: true, choices: 4 },
          { kind: 'audio-set', instruction: 'Listen to a conversation.', questions: 2, questionKinds: { mcq: 2 }, choices: 4 },
          { kind: 'audio-set', instruction: 'Listen to a talk.', questions: 4, questionKinds: { mcq: 4 }, choices: 4 }
        ] }
      ]
    },
    speaking: {
      label: 'Speaking', labelKo: '스피킹', timeLimitSec: null, questions: 11,
      audio: false, modelAnswers: 'interview',
      modules: [
        { id: 'S1', label: 'Task 1 · Listen and Repeat', timeLimitSec: 600, blocks: [
          { kind: 'record-set', instruction: 'Listen and Repeat', questions: 7, questionKinds: { repeat: 7 }, perQuestionAudio: true, introScript: true, prepSec: 3, respondSec: 20 }
        ] },
        { id: 'S2', label: 'Task 2 · Interview', timeLimitSec: 600, blocks: [
          { kind: 'record-set', instruction: 'Answer the interviewer’s questions.', questions: 4, questionKinds: { interview: 4 }, perQuestionAudio: true, introScript: true, prepSec: 3, respondSec: 45 }
        ] }
      ]
    },
    writing: {
      label: 'Writing', labelKo: '라이팅', timeLimitSec: null, questions: 12,
      audio: false, modelAnswers: 'free-write',
      modules: [
        { id: 'W1', label: 'Build a Sentence', timeLimitSec: 600, blocks: [
          { kind: 'build-set', instruction: 'Make an appropriate sentence.', questions: 10, questionKinds: { build: 10 } }
        ] },
        { id: 'W2', label: 'Write an Email', timeLimitSec: 600, blocks: [
          { kind: 'free-write', instruction: '', questions: 1, questionKinds: { email: 1 } }
        ] },
        { id: 'W3', label: 'Write for an Academic Discussion', timeLimitSec: 600, blocks: [
          { kind: 'free-write', instruction: '', questions: 1, questionKinds: { discussion: 1 } }
        ] }
      ]
    }
  };

  /* useBlueprint 로 실어 준 정본. null 이면 SHAPE 사본을 쓴다. */
  var loadedShape = null;

  /* ------------------------------------------------------------------ 유틸 */

  function isArr(v) { return Object.prototype.toString.call(v) === '[object Array]'; }
  function str(v) { return v === null || v === undefined ? '' : String(v); }
  function trimmed(v) { return str(v).replace(/^\s+|\s+$/g, ''); }
  function has(v) { return trimmed(v) !== ''; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /** 얕은 복사 — 챕터를 섹션 자리에 끼울 때 원본을 건드리지 않으려고 쓴다. */
  function shallow(o) {
    var out = {}, k;
    for (k in o) if (Object.prototype.hasOwnProperty.call(o, k)) out[k] = o[k];
    return out;
  }

  /** 'reading' + 3 -> 'reading-03'. 저장 키·파일명·문항 id 가 전부 이 값에서 갈라진다. */
  function slugOf(book, chapterNo) {
    return str(book) + '-' + pad2(Number(chapterNo) || 0);
  }

  /** '{slug}-{moduleId}-q{NN}'. no 는 챕터 전체에서 연속이라 문항 id 도 챕터 안에서 유일하다. */
  function questionId(slug, moduleId, no) {
    return slug + '-' + moduleId + '-q' + pad2(Number(no) || 0);
  }

  /** 'listening-03-L1-07-08' — 블록 하나가 쓰는 음원 한 개의 이름. */
  function trackId(slug, moduleId, from, to) {
    return slug + '-' + moduleId + '-' + pad2(from) + '-' + pad2(to);
  }

  /** 이 챕터가 따라야 할 구조표. useBlueprint 로 실은 정본이 있으면 그쪽이 이긴다. */
  function shapeOf(book) {
    if (loadedShape && loadedShape[book]) return loadedShape[book];
    return SHAPE[book] || null;
  }

  /**
   * config/blueprint.book.json 을 통째로 넘겨 정본으로 삼는다.
   * 사본(SHAPE)과 정본이 어긋난 날 조용히 사본을 믿는 사고를 막으려고 둔 문이다.
   */
  function useBlueprint(json) {
    if (!json || !isArr(json.books)) { loadedShape = null; return false; }
    var map = {};
    json.books.forEach(function (b) { if (b && b.id) map[b.id] = b; });
    loadedShape = map;
    return true;
  }

  function countQuestions(chapter) {
    var n = 0;
    if (!chapter || !isArr(chapter.modules)) return 0;
    chapter.modules.forEach(function (mod) {
      (mod.blocks || []).forEach(function (blk) { n += (blk.questions || []).length; });
    });
    return n;
  }

  /** 챕터 안의 모든 문항을 문서 순서대로 편다. 검산·PDF·색인이 전부 이걸 쓴다. */
  function walk(chapter) {
    var out = [];
    if (!chapter || !isArr(chapter.modules)) return out;
    chapter.modules.forEach(function (mod, mi) {
      (mod.blocks || []).forEach(function (blk, bi) {
        (blk.questions || []).forEach(function (q, qi) {
          out.push({ q: q, block: blk, module: mod, mi: mi, bi: bi, qi: qi });
        });
      });
    });
    return out;
  }

  /* ------------------------------------------------------------------ 빈 챕터 */

  /** blueprint 의 블록 정의에서 문항 종류를 선언 순서대로 편다: {mcq:4, insert:1} -> [mcq x4, insert]. */
  function kindList(blk) {
    var kinds = blk.questionKinds || {}, out = [], k, i;
    for (k in kinds) {
      if (!Object.prototype.hasOwnProperty.call(kinds, k)) continue;
      for (i = 0; i < kinds[k]; i++) out.push(k);
    }
    if (!out.length) for (i = 0; i < (blk.questions || 0); i++) out.push('mcq');
    return out;
  }

  function blankQuestion(kind, id, no, blk) {
    var q = { id: id, kind: kind, no: no };
    if (kind === 'blank') { q.hint = ''; q.answer = ''; }
    else if (kind === 'mcq' || kind === 'insert') {
      q.prompt = '';
      q.choices = [];
      var n = blk.choices || 4, i;
      for (i = 0; i < n; i++) q.choices.push('');
      q.answer = null;
    }
    else if (kind === 'repeat' || kind === 'interview') {
      q.audioRef = ''; q.script = '';
      q.prepSec = blk.prepSec || 3;
      q.respondSec = blk.respondSec || 20;
    }
    else if (kind === 'build') {
      q.context = ''; q.slots = []; q.tiles = []; q.trapTiles = [];
      q.sentence = ''; q.answerTokens = []; q.answer = '';
    }
    else if (kind === 'email') {
      q.to = ''; q.subject = '';
      q.situationLabel = 'SITUATION'; q.situation = '';
      q.bulletsLabel = 'YOUR EMAIL SHOULD'; q.bullets = [];
      q.prompt = '';
    }
    else if (kind === 'discussion') {
      q.professor = ''; q.prompt = ''; q.posts = [];
    }
    return q;
  }

  function blankBlock(blk, slug, moduleId, from, to) {
    var out = {
      kind: blk.kind,
      heading: 'Questions ' + from + '-' + to,
      instruction: str(blk.instruction)
    };
    if (blk.kind === 'cloze') out.template = '';
    if (blk.kind === 'passage') { out.title = ''; out.paragraphs = []; }
    if (blk.kind === 'audio-set') {
      if (blk.perQuestionAudio) out.perQuestionAudio = true;
      else out.audioRef = trackId(slug, moduleId, from, to);
    }
    if (blk.kind === 'record-set') {
      out.introAudioRef = slug + '-' + moduleId + '-intro';
      out.introScript = '';
      out.perQuestionAudio = true;
    }
    out.questions = [];
    return out;
  }

  /**
   * blankChapter(book, chapterNo) -> 챕터 뼈대.
   * 구조는 blueprint 가 정하고 내용은 전부 빈 문자열이다 — 생성기(api/generate.js)가
   * 채우는 것은 '빈 칸'이지 '구조'가 아니라는 원칙을 이 함수가 물리적으로 강제한다.
   */
  function blankChapter(book, chapterNo) {
    var shape = shapeOf(book);
    if (!shape) throw new Error('unknown book: ' + book);
    var no = Number(chapterNo) || 0;
    var slug = slugOf(book, no);
    var running = 0;

    var modules = (shape.modules || []).map(function (m) {
      var blocks = (m.blocks || []).map(function (b) {
        var kinds = kindList(b);
        var from = running + 1, to = running + kinds.length;
        var out = blankBlock(b, slug, m.id, from, to);
        kinds.forEach(function (k) {
          running++;
          out.questions.push(blankQuestion(k, questionId(slug, m.id, running), running, b));
        });
        return out;
      });
      var mod = { id: m.id, label: m.label, blocks: blocks };
      if (m.timeLimitSec !== undefined) mod.timeLimitSec = m.timeLimitSec;
      return mod;
    });

    var chapter = {
      /* --- 섹션 조각과 같은 키. 시험 엔진은 여기까지만 본다. --- */
      id: book,
      label: shape.label,
      labelKo: shape.labelKo,
      timeLimitSec: shape.timeLimitSec === undefined ? null : shape.timeLimitSec,
      modules: modules,

      /* --- 교재가 더하는 키. 엔진은 무시하고 PDF·색인·교사판이 읽는다. --- */
      schemaVersion: SCHEMA_VERSION,
      book: book,
      chapterNo: no,
      slug: slug,
      title: '',
      cefr: CEFR,
      edition: 1,
      targetSkills: [],
      teaching: { objective: '', strategy: [], commonErrors: [] },
      glossary: [],
      indexTerms: [],
      provenance: {
        authoredBy: '',
        authoredAt: null,
        reviewedBy: '',
        reviewedAt: null,
        level: 'assumed',
        gateResults: []
      }
    };

    if (shape.audio) chapter.audio = { tracks: [] };
    if (shape.modelAnswers && shape.modelAnswers !== 'none') chapter.modelAnswers = [];
    return chapter;
  }

  /* ------------------------------------------------------------------ 검산 */

  /**
   * validate(chapter, opt) -> { ok, gates:[{level,scope,message}] }
   *
   * ok 는 'stop 이 하나도 없다'는 뜻이다. warn 만 있으면 ok:true 이고 저장은 되지만
   * 관리자 화면이 경고를 띄운다 — set-import.js 와 똑같은 규칙이다.
   * opt.blueprint 를 주면 그 파일이 사본 대신 구조의 정본이 된다.
   *
   * 메시지는 화면에 그대로 뜨므로 영어다(집 규칙: UI 문구는 영어).
   */
  function validate(chapter, opt) {
    opt = opt || {};
    if (opt.blueprint) useBlueprint(opt.blueprint);

    var gates = [];
    function gate(level, scope, message) { gates.push({ level: level, scope: scope, message: message }); }
    function done() {
      var stop = 0;
      gates.forEach(function (g) { if (g.level === 'stop') stop++; });
      return { ok: stop === 0, gates: gates };
    }

    if (!chapter || typeof chapter !== 'object') {
      gate('stop', 'chapter', 'Chapter is empty or not an object.');
      return done();
    }

    /* ---- 정체성 ----
       book / chapterNo 가 틀리면 슬러그·문항 id·저장 키가 전부 남의 자리로 간다.
       한 챕터가 다른 챕터를 덮어쓰는 사고가 여기서 시작되므로 무조건 stop 이다. */
    var book = str(chapter.book);
    if (BOOKS.indexOf(book) < 0) {
      gate('stop', 'book', 'Field "book" must be one of reading, listening, speaking, writing (got "' + book + '").');
      return done();
    }
    var shape = shapeOf(book);
    if (!shape) { gate('stop', 'book', 'No blueprint found for book "' + book + '".'); return done(); }

    var chNo = Number(chapter.chapterNo);
    if (!(chNo >= 1 && chNo <= 10) || chNo !== Math.floor(chNo)) {
      gate('stop', 'chapter', 'Field "chapterNo" must be a whole number from 1 to 10 (got "' + str(chapter.chapterNo) + '").');
    }
    if (chapter.id !== book) {
      gate('stop', 'chapter', 'Field "id" must equal the book id "' + book + '" so the exam engine can place this chapter in its section slot (got "' + str(chapter.id) + '").');
    }
    var wantSlug = slugOf(book, chNo);
    if (str(chapter.slug) !== wantSlug) {
      gate('warn', 'chapter', 'Field "slug" should be "' + wantSlug + '" (got "' + str(chapter.slug) + '"). The storage key and every question id are derived from it.');
    }
    if (!has(chapter.title)) gate('stop', 'chapter', 'Field "title" is empty — every chapter needs an English title for the opener page, the running head and the table of contents.');
    if (str(chapter.cefr) !== CEFR) gate('warn', 'chapter', 'Field "cefr" should be "' + CEFR + '" for this book series (got "' + str(chapter.cefr) + '").');
    if (!isArr(chapter.targetSkills) || !chapter.targetSkills.length) {
      gate('warn', 'teaching', 'Field "targetSkills" is empty — the chapter opener has nothing to promise the student.');
    }

    /* ---- 구조 ----
       모듈·블록의 개수와 종류는 blueprint 가 정한다. 여기서 어긋난 챕터는
       "책의 3장은 어느 책이든 같은 모양"이라는 약속을 깨뜨려 PDF 조판이 무너진다. */
    var wantModules = shape.modules || [];
    var gotModules = isArr(chapter.modules) ? chapter.modules : [];
    if (gotModules.length !== wantModules.length) {
      gate('stop', 'structure', 'Chapter must have exactly ' + wantModules.length + ' modules (found ' + gotModules.length + ').');
    }

    var structureOk = true;
    wantModules.forEach(function (wm, mi) {
      var gm = gotModules[mi];
      if (!gm) { structureOk = false; return; }
      if (str(gm.id) !== wm.id) {
        gate('stop', 'structure', 'Module ' + (mi + 1) + ' must have id "' + wm.id + '" (found "' + str(gm.id) + '").');
        structureOk = false;
      }
      var wantBlocks = wm.blocks || [];
      var gotBlocks = isArr(gm.blocks) ? gm.blocks : [];
      if (gotBlocks.length !== wantBlocks.length) {
        gate('stop', 'structure', 'Module ' + wm.id + ' must have exactly ' + wantBlocks.length + ' blocks (found ' + gotBlocks.length + ').');
        structureOk = false;
      }
      wantBlocks.forEach(function (wb, bi) {
        var gb = gotBlocks[bi];
        if (!gb) { structureOk = false; return; }
        if (str(gb.kind) !== wb.kind) {
          gate('stop', 'structure', 'Module ' + wm.id + ' block ' + (bi + 1) + ' must be of kind "' + wb.kind + '" (found "' + str(gb.kind) + '").');
          structureOk = false;
        }
        var gq = isArr(gb.questions) ? gb.questions : [];
        if (gq.length !== wb.questions) {
          gate('stop', 'count', 'Module ' + wm.id + ' block ' + (bi + 1) + ' must have exactly ' + wb.questions + ' questions (found ' + gq.length + ').');
        }
        /* 문항 종류 구성도 blueprint 가 정한다. mcq 자리에 insert 가 들어가면
           정답 모양(색인 vs 문자열)이 달라져 채점기가 조용히 오답 처리한다. */
        var wantKinds = {}, gotKinds = {}, k;
        var wk = wb.questionKinds || {};
        for (k in wk) if (Object.prototype.hasOwnProperty.call(wk, k)) wantKinds[k] = wk[k];
        gq.forEach(function (q) {
          var kk = str(q.kind) || '?';
          gotKinds[kk] = (gotKinds[kk] || 0) + 1;
        });
        for (k in wantKinds) {
          if (!Object.prototype.hasOwnProperty.call(wantKinds, k)) continue;
          if ((gotKinds[k] || 0) !== wantKinds[k]) {
            gate('stop', 'count', 'Module ' + wm.id + ' block ' + (bi + 1) + ' must have ' + wantKinds[k] + ' "' + k + '" questions (found ' + (gotKinds[k] || 0) + ').');
          }
        }
        if (!has(gb.heading)) gate('warn', 'structure', 'Module ' + wm.id + ' block ' + (bi + 1) + ' has no heading — printed pages need a "Questions n-m" label.');
      });
    });

    var total = countQuestions(chapter);
    if (total !== shape.questions) {
      gate('stop', 'count', 'Chapter must contain exactly ' + shape.questions + ' questions (found ' + total + ').');
    }

    /* ---- 문항 낱개 검산 ---- */
    var seenIds = {}, seenNos = {}, dupIds = [], dupNos = [];
    var flat = walk(chapter);

    flat.forEach(function (e) {
      var q = e.q, blk = e.block, mod = e.module;
      var where = str(mod.id) + ' / ' + (str(q.id) || 'question #' + (e.qi + 1));

      /* id 가 겹치면 답안 저장이 서로를 덮어쓴다. 학생 답이 사라지는 사고라 stop. */
      if (!has(q.id)) gate('stop', 'ids', 'A question in module ' + str(mod.id) + ' has no id.');
      else if (seenIds[q.id]) { if (dupIds.indexOf(q.id) < 0) dupIds.push(q.id); }
      else seenIds[q.id] = 1;

      if (q.no === undefined || q.no === null) gate('warn', 'ids', where + ': field "no" is missing — printed question numbering comes from it.');
      else if (seenNos[q.no]) { if (dupNos.indexOf(q.no) < 0) dupNos.push(q.no); }
      else seenNos[q.no] = 1;

      /* 정답 없는 자동채점 문항 — 채점 시점에 전원 오답이 된다. */
      if (AUTO_SCORED.indexOf(str(q.kind)) >= 0) {
        var a = q.answer;
        var missing = (a === undefined || a === null || a === '');
        if (missing && str(q.kind) === 'build') missing = !(isArr(q.answerTokens) && q.answerTokens.length) && !has(q.sentence);
        if (missing) gate('stop', 'answer', where + ': no answer. Auto-scored questions cannot be saved without one.');
      }

      /* 클로즈: 힌트는 정답의 앞글자여야 한다. 어긋나면 학생 화면의 힌트가
         정답이 아닌 다른 낱말을 가리키게 되고, 정답을 쓴 학생이 틀린다. */
      if (str(q.kind) === 'blank') {
        var hint = trimmed(q.hint), ans = trimmed(q.answer);
        if (!hint) gate('warn', 'cloze', where + ': no hint letters. Cloze items in this series always show the opening letters.');
        else if (ans && ans.toLowerCase().indexOf(hint.toLowerCase()) !== 0) {
          gate('stop', 'cloze', where + ': hint "' + hint + '" is not the beginning of the answer "' + ans + '".');
        } else if (ans && hint.length >= ans.length) {
          gate('warn', 'cloze', where + ': hint "' + hint + '" gives away the whole answer "' + ans + '".');
        }
      }

      /* 선택지 3개 미만은 문항이 아니다. 정답 색인이 범위를 벗어나면 정답이 없는 것과 같다. */
      if (str(q.kind) === 'mcq' || str(q.kind) === 'insert') {
        var ch = isArr(q.choices) ? q.choices : [];
        if (ch.length < 3) gate('stop', 'choices', where + ': only ' + ch.length + ' choices. A multiple-choice question needs at least 3.');
        var wantCh = blk.choices || (shapeBlockChoices(shape, mod.id, e.bi));
        if (wantCh && ch.length && ch.length !== wantCh) {
          gate('warn', 'choices', where + ': has ' + ch.length + ' choices but this block is laid out for ' + wantCh + '.');
        }
        var blank = [];
        ch.forEach(function (c, i) { if (!has(c)) blank.push(i + 1); });
        if (blank.length) gate('stop', 'choices', where + ': choice ' + blank.join(', ') + ' is empty.');
        if (typeof q.answer === 'number' && (q.answer < 0 || q.answer >= ch.length)) {
          gate('stop', 'answer', where + ': answer index ' + q.answer + ' is outside the ' + ch.length + ' choices.');
        }
        if (!has(q.prompt)) gate('stop', 'questions', where + ': the question prompt is empty.');
      }
    });

    if (dupIds.length) gate('stop', 'ids', 'Duplicate question ids: ' + dupIds.slice(0, 8).join(', ') + (dupIds.length > 8 ? ' and more' : '') + '. Answers would overwrite each other.');
    if (dupNos.length) gate('warn', 'ids', 'Duplicate question numbers: ' + dupNos.slice(0, 8).join(', ') + (dupNos.length > 8 ? ' and more' : '') + '. Question numbering runs 1 to ' + shape.questions + ' across the whole chapter.');

    /* ---- 블록 본문 ---- */
    (isArr(chapter.modules) ? chapter.modules : []).forEach(function (mod) {
      (mod.blocks || []).forEach(function (blk, bi) {
        var where = str(mod.id) + ' block ' + (bi + 1);
        if (blk.kind === 'cloze') {
          var tpl = str(blk.template);
          if (!has(tpl)) gate('stop', 'questions', where + ': the cloze template text is empty.');
          else (blk.questions || []).forEach(function (q) {
            if (tpl.indexOf('{{' + q.no + '}}') < 0) {
              gate('stop', 'cloze', where + ': the template has no {{' + q.no + '}} placeholder for question ' + q.no + '.');
            }
          });
        }
        if (blk.kind === 'passage') {
          if (!isArr(blk.paragraphs) || !blk.paragraphs.length) gate('stop', 'questions', where + ': the passage has no paragraphs.');
          if (!has(blk.title)) gate('warn', 'questions', where + ': the passage has no title.');
        }
        if (blk.kind === 'free-write') {
          (blk.questions || []).forEach(function (q) {
            if (str(q.kind) === 'email' && (!isArr(q.bullets) || q.bullets.length < 2)) {
              gate('stop', 'questions', where + ': the email task needs at least 2 bullet requirements.');
            }
            if (str(q.kind) === 'discussion' && (!isArr(q.posts) || q.posts.length < 2)) {
              gate('stop', 'questions', where + ': the academic discussion needs at least 2 student posts.');
            }
            if (!has(q.prompt)) gate('stop', 'questions', where + ': the writing prompt is empty.');
          });
        }
        if (blk.kind === 'build-set') {
          (blk.questions || []).forEach(function (q) {
            if (!isArr(q.tiles) || q.tiles.length < 3) gate('stop', 'questions', str(q.id) + ': a Build a Sentence item needs at least 3 tiles.');
            if (!has(q.sentence)) gate('stop', 'answer', str(q.id) + ': the target sentence is empty.');
          });
        }
      });
    });

    /* ---- 리스닝 음원 ----
       대본이 없는 트랙은 소리를 만들 수 없고(TTS 입력이 대본이다), 소리가 없으면
       그 블록의 문항은 응시 화면에서 답할 수 없다. 그래서 stop 이다. */
    if (shape.audio) {
      var tracks = (chapter.audio && isArr(chapter.audio.tracks)) ? chapter.audio.tracks : null;
      if (!tracks || !tracks.length) {
        gate('stop', 'audio', 'A listening chapter must declare audio.tracks[] — without scripts there is nothing to synthesize.');
        tracks = [];
      }
      var byId = {};
      tracks.forEach(function (t) {
        if (!t || !has(t.id)) { gate('stop', 'audio', 'An audio track has no id.'); return; }
        if (byId[t.id]) gate('stop', 'audio', 'Duplicate audio track id "' + t.id + '".');
        byId[t.id] = t;
        if (!has(t.scriptRef) && !has(t.script)) {
          gate('stop', 'audio', 'Audio track "' + t.id + '" has no script and no scriptRef — the recording cannot be produced.');
        }
        if (!isArr(t.voiceCast) || !t.voiceCast.length) {
          gate('warn', 'audio', 'Audio track "' + t.id + '" has no voiceCast — every speaker must be assigned a voice before synthesis.');
        }
      });
      (isArr(chapter.modules) ? chapter.modules : []).forEach(function (mod) {
        (mod.blocks || []).forEach(function (blk, bi) {
          if (blk.kind !== 'audio-set') return;
          var where = str(mod.id) + ' block ' + (bi + 1);
          if (blk.perQuestionAudio) {
            (blk.questions || []).forEach(function (q) {
              var ref = str(q.audioRef);
              if (!ref && !has(q.audio)) gate('stop', 'audio', str(q.id) + ': no audioRef. Every question in a per-question audio block needs its own recording.');
              else if (ref && !byId[ref]) gate('stop', 'audio', str(q.id) + ': audioRef "' + ref + '" is not declared in audio.tracks[].');
            });
            return;
          }
          var bref = str(blk.audioRef);
          if (!bref && !has(blk.audio)) gate('stop', 'audio', where + ': no audioRef. An audio-set block must name the recording its questions are about.');
          else if (bref && !byId[bref]) gate('stop', 'audio', where + ': audioRef "' + bref + '" is not declared in audio.tracks[].');
        });
      });
    }

    /* ---- 스피킹 대본 ----
       스피킹 음원은 챕터 밖(TTS 파이프라인)에서 만들어지지만, 대본이 비면 만들 것이 없다. */
    if (book === 'speaking') {
      flat.forEach(function (e) {
        if (str(e.block.kind) !== 'record-set') return;
        if (!has(e.q.script) && !has(e.q.audioRef) && !has(e.q.audio)) {
          gate('stop', 'audio', str(e.q.id) + ': no script and no audio. A prompt the student cannot hear is not a question.');
        }
      });
    }

    /* ---- 교사판 재료 ----
       여기는 전부 warn 이다. 시험은 돌아가지만 교사용 PDF 가 빈 페이지로 나온다. */
    var t = chapter.teaching || {};
    if (!has(t.objective)) gate('warn', 'teaching', 'teaching.objective is empty — the chapter opener and the teacher edition both print it.');
    if (!isArr(t.strategy) || t.strategy.length < 2) gate('warn', 'teaching', 'teaching.strategy[] needs at least 2 entries.');
    if (!isArr(t.commonErrors) || t.commonErrors.length < 2) gate('warn', 'teaching', 'teaching.commonErrors[] needs at least 2 entries.');

    if (!isArr(chapter.glossary) || !chapter.glossary.length) gate('warn', 'glossary', 'glossary[] is empty — the chapter has no vocabulary page.');
    else chapter.glossary.forEach(function (g) {
      if (!g || !has(g.term) || !has(g.gloss)) gate('warn', 'glossary', 'A glossary entry is missing its term or gloss.');
    });
    if (!isArr(chapter.indexTerms) || !chapter.indexTerms.length) gate('warn', 'glossary', 'indexTerms[] is empty — this chapter will not appear in the back-of-book index.');

    /* ---- 모범답안 ----
       사람이 채점하는 과제는 채점 기준을 글로 쓴 것만으로는 부족하다. 교사가 견줄
       실제 응답이 있어야 점수가 교사마다 달라지지 않는다. */
    var wantModel = shape.modelAnswers || 'none';
    if (wantModel !== 'none') {
      var models = isArr(chapter.modelAnswers) ? chapter.modelAnswers : [];
      var byQ = {};
      models.forEach(function (m) {
        if (!m || !has(m.questionId)) { gate('warn', 'model', 'A model answer has no questionId.'); return; }
        if (!has(m.text)) gate('warn', 'model', 'Model answer for ' + str(m.questionId) + ' has no text.');
        byQ[m.questionId] = byQ[m.questionId] || {};
        byQ[m.questionId][str(m.band)] = 1;
      });
      flat.forEach(function (e) {
        var needs = (wantModel === 'free-write' && str(e.block.kind) === 'free-write') ||
                    (wantModel === 'interview' && str(e.q.kind) === 'interview');
        if (!needs) return;
        if (!byQ[e.q.id] || !byQ[e.q.id].high) {
          gate('warn', 'model', str(e.q.id) + ': no band "high" model answer. Teachers have nothing to grade against.');
        }
      });
    }

    /* ---- 출처 ---- */
    var p = chapter.provenance || {};
    if (!has(p.authoredBy)) gate('warn', 'provenance', 'provenance.authoredBy is empty — record who (or which model) wrote this chapter.');
    if (!p.reviewedAt) gate('warn', 'provenance', 'provenance.reviewedAt is null — this chapter has not been reviewed by a human yet.');

    if (!structureOk) gate('warn', 'structure', 'Structure checks stopped early; fix the errors above and validate again.');

    return done();
  }

  /** blueprint 에서 그 블록이 몇 개짜리 선택지로 설계됐는지 되찾는다(없으면 null). */
  function shapeBlockChoices(shape, moduleId, blockIndex) {
    var hit = null;
    (shape.modules || []).forEach(function (m) {
      if (m.id !== moduleId) return;
      var b = (m.blocks || [])[blockIndex];
      if (b && b.choices) hit = b.choices;
    });
    return hit;
  }

  /* ------------------------------------------------------------------ 팩 변환 */

  /**
   * toPack(chapters, opt) -> set9.js 와 같은 모양의 콘텐츠 팩.
   *
   * 챕터 하나를 그대로 시험으로 돌려 보는 것이 이 함수의 존재 이유다. 교재 원고가
   * 진짜 시험으로 돌아가는지 확인하지 않으면, 인쇄한 뒤에야 문항이 렌더링되지 않는 걸 안다.
   *
   * 같은 책의 챕터를 여러 장 넘기면 섹션 id 가 겹치므로(둘 다 'reading') 그때만
   * 섹션 id 를 슬러그로 바꾼다. 한 장만 넘기면 id 는 'reading' 그대로라서
   * config/timing.toefl.json 의 섹션별 시간 배정이 손대지 않고 그대로 맞는다.
   */
  function toPack(chapters, opt) {
    opt = opt || {};
    var list = isArr(chapters) ? chapters.filter(Boolean) : (chapters ? [chapters] : []);
    var code = str(opt.code || (list.length === 1 ? list[0].slug : 'book')).toUpperCase();
    var codeSlug = str(opt.codeSlug || (list.length === 1 ? list[0].slug : 'book'));
    var audioRel = 'media/audio/' + codeSlug + '/';
    var picsRel = 'media/pictures/' + codeSlug + '/';

    /* 같은 책이 두 번 이상 나오면 섹션 id 를 슬러그로 밀어 낸다. */
    var seenBook = {}, clash = {};
    list.forEach(function (c) {
      var b = str(c.book);
      if (seenBook[b]) clash[b] = 1;
      seenBook[b] = 1;
    });

    var sections = list.map(function (c) {
      var sec = shallow(c);
      sec.id = clash[str(c.book)] ? str(c.slug) : str(c.book);
      sec.book = str(c.book);
      sec.chapterNo = c.chapterNo;
      sec.slug = str(c.slug);
      sec.label = has(c.title) ? (str(c.label) + ' — ' + str(c.title)) : str(c.label);
      sec.modules = (c.modules || []).map(function (mod) {
        var m = shallow(mod);
        m.blocks = (mod.blocks || []).map(function (blk) {
          var b = shallow(blk);
          /* audioRef 는 교재 쪽 이름이고 엔진은 경로만 안다. 여기서 경로로 편다. */
          if (!b.audio && has(b.audioRef)) b.audio = audioRel + str(b.audioRef) + '.mp3';
          if (!b.introAudio && has(b.introAudioRef)) b.introAudio = audioRel + str(b.introAudioRef) + '.mp3';
          b.questions = (blk.questions || []).map(function (q) {
            var qq = shallow(q);
            if (!qq.audio && has(qq.audioRef)) qq.audio = audioRel + str(qq.audioRef) + '.mp3';
            if (qq.image && str(qq.image).indexOf('/') < 0) qq.image = picsRel + str(qq.image);
            return qq;
          });
          return b;
        });
        return m;
      });
      return sec;
    });

    sections.sort(function (a, b) {
      var ia = SECTION_ORDER.indexOf(str(a.book)), ib = SECTION_ORDER.indexOf(str(b.book));
      if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      return (Number(a.chapterNo) || 0) - (Number(b.chapterNo) || 0);
    });

    /* 정답표는 문항에 붙어 있는 answer 만 걷는다 — set-import.js finalize() 와 같은 원칙.
       정답을 두 곳에 두면 언젠가 한쪽만 고쳐지고, 그날 학생이 맞고도 틀린다. */
    var answerKey = {};
    sections.forEach(function (sec) {
      (sec.modules || []).forEach(function (mod) {
        (mod.blocks || []).forEach(function (blk) {
          (blk.questions || []).forEach(function (q) {
            if (answerKey[q.id] !== undefined) return;
            if (q.answer !== undefined && q.answer !== null && q.answer !== '') answerKey[q.id] = q.answer;
            else if (q.answerSentence) answerKey[q.id] = q.answerSentence;
            else if (q.sentence) answerKey[q.id] = q.sentence;
          });
        });
      });
    });

    var gates = [];
    list.forEach(function (c) {
      var r = validate(c);
      r.gates.forEach(function (g) {
        gates.push({ level: g.level, scope: str(c.slug) + ':' + g.scope, message: g.message });
      });
    });

    var stats = { total: 0, bySection: {} };
    sections.forEach(function (sec) {
      var n = 0;
      (sec.modules || []).forEach(function (mod) {
        (mod.blocks || []).forEach(function (b) { n += (b.questions || []).length; });
      });
      stats.bySection[sec.id] = n;
      stats.total += n;
    });

    var pack = {
      code: code,
      title: str(opt.title || (list.length === 1 ? (str(list[0].label) + ' — ' + str(list[0].title)) : 'Practice Book')),
      paths: { audio: audioRel, pics: picsRel },
      sections: sections,
      answerKey: answerKey,
      buildWarnings: gates.map(function (g) { return g.level + ': ' + g.message; }),
      gates: gates,
      summary: {
        questions: stats.total,
        bySection: stats.bySection,
        autoScored: Object.keys(answerKey).length,
        humanScored: stats.total - Object.keys(answerKey).length,
        chapters: list.map(function (c) {
          return { book: str(c.book), chapterNo: c.chapterNo, slug: str(c.slug), title: str(c.title), questions: countQuestions(c) };
        }),
        gates: {
          stop: gates.filter(function (g) { return g.level === 'stop'; }).length,
          warn: gates.filter(function (g) { return g.level === 'warn'; }).length
        }
      },
      importedAt: null,
      source: 'book-schema'
    };

    /* exam-shell 이 기대하는 helper — set-import.js withHelpers() 와 같은 시그니처. */
    pack.allQuestions = function () {
      var out = [];
      this.sections.forEach(function (sec) {
        (sec.modules || []).forEach(function (mod) {
          (mod.blocks || []).forEach(function (blk) {
            (blk.questions || []).forEach(function (q) {
              out.push({ q: q, block: blk, module: mod, section: sec });
            });
          });
        });
      });
      return out;
    };
    pack.findQuestion = function (id) {
      var hit = null;
      this.allQuestions().forEach(function (e) { if (e.q.id === id) hit = e; });
      return hit;
    };
    return pack;
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    BOOKS: BOOKS,
    SECTION_ORDER: SECTION_ORDER,
    CEFR: CEFR,

    validate: validate,
    blankChapter: blankChapter,
    toPack: toPack,
    countQuestions: countQuestions,

    useBlueprint: useBlueprint,
    shapeOf: shapeOf,
    slugOf: slugOf,
    questionId: questionId,
    trackId: trackId,
    walk: walk
  };
});
