/* SMEAG StudyGround — set-import.js : docx 3종 → 4섹션 콘텐츠 팩.
 *
 * 무엇을 대체하는가
 *   tools/extract_set9_{reading,listening,writing_speaking}.py + tools/build_set9.py.
 *   그 스크립트들은 SET 9 서식에 맞춰 하드코딩돼 있고 터미널에서만 돈다. 여기서는
 *   같은 일을 브라우저에서, 세트 코드만 바꿔 끼우면 되도록 다시 짰다.
 *
 * 원칙 (build_set9.py 에서 그대로 가져온다)
 *   · 원본에 있는 문항 텍스트를 한 글자도 새로 만들지 않는다.
 *   · 짝이 맞지 않으면 조용히 넘어가지 않고 gate 로 올린다. 시험을 못 만드는 문제는
 *     level:'stop', 만들 수는 있지만 사람이 봐야 하는 문제는 level:'warn'.
 *
 * 계약
 *   SG_SET_IMPORT.build({
 *     code: 'SET 10',
 *     questions: <SG_DOCX.read 결과>,      // 필수
 *     script:    <SG_DOCX.read 결과>|null, // 리스닝/스피킹 대본
 *     answers:   <SG_DOCX.read 결과>|null  // 정답지
 *   }) -> { pack, gates:[{level,scope,message}], stats }
 *
 *   SG_SET_IMPORT.finalize(sections, opt) -> 같은 것
 *   조립의 뒷부분(정답표 수확·검산·통계·팩 모양)만 따로 부를 수 있다. AI 로 지은 세트
 *   (set-generate.js)가 문서에서 온 세트와 **같은 팩·같은 검산**을 타게 하려고 뗐다.
 *
 * 정답지는 자동 번호 목록이라 번호가 본문에 없다 — 순서가 곧 번호다.
 * ES5 문법만 쓴다(빌드 단계 없음).
 */
(function (root, factory) {
  var api = factory();
  root.SG_SET_IMPORT = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var SECTION_ORDER = ['reading', 'listening', 'writing', 'speaking'];
  var CHOICE_LETTERS = ['A', 'B', 'C', 'D', 'E'];

  /* ------------------------------------------------------------ 유틸 */

  function txt(p) { return p && p.text ? p.text : ''; }
  /* 칸을 접기 전의 글. 타일 줄은 여러 칸으로 조각을 가르므로 이걸 봐야 한다. */
  function txtRaw(p) { return p && p.textRaw ? p.textRaw : txt(p); }
  /* 문장 만들기의 빈칸 줄. 빈칸은 보통 '__' 로 적혀 오지만, 밑줄만 그은 칸으로 오기도
     한다(SET 2) — 그 모양은 docx-read.js 가 textU 에 '__' 로 적어 둔다. 두 읽기 중
     빈칸을 더 많이 찾은 쪽을 쓴다: 밑줄로 그은 빈칸도 빈칸이다. 같으면 글자 그대로(text). */
  function blankCount(s) { return (String(s || '').match(/_{2,}/g) || []).length; }
  function slotText(p) {
    var t = txt(p);
    return p && p.textU && blankCount(p.textU) > blankCount(t) ? p.textU : t;
  }
  function isBlank(p) { return !txt(p) && (!p || !p.images || !p.images.length); }

  /** 'Questions 13-14' → {from:13,to:14}. 아니면 null. */
  function questionRange(s) {
    var m = /^questions?\s+(\d+)\s*[-–—]\s*(\d+)/i.exec(s);
    if (m) return { from: +m[1], to: +m[2] };
    m = /^questions?\s+(\d+)\s*$/i.exec(s);
    return m ? { from: +m[1], to: +m[1] } : null;
  }

  /** '21. When does…' → {no:21, text:'When does…'}. 아니면 null. */
  function numbered(s) {
    var m = /^(\d{1,3})\s*[.)]\s*(.*)$/.exec(s);
    return m ? { no: +m[1], text: m[2].trim() } : null;
  }

  /* 한 문단 안에 줄바꿈(w:br)으로 여러 줄이 들어 있는 문서가 있다 — SET 10 은 보기 A~D 를
     한 문단에 줄바꿈으로 넣었고, 이메일 과제의 To:/Subject: 도 한 문단이다. 그대로 두면
     "A. …" 로 시작하는 줄 하나로만 보여 보기 3개가 통째로 사라진다. 문단을 줄 단위로
     펴서 넘긴다 — 그림은 첫 줄이 들고 간다(원본 문단의 위치가 그림의 위치다). */
  function explodeLines(paras) {
    var out = [];
    (paras || []).forEach(function (p) {
      var t = txt(p);
      if (t.indexOf('\n') < 0) { out.push(p); return; }
      var parts = t.split('\n');
      var first = true;
      parts.forEach(function (line) {
        var s = line.replace(/[ \t]+/g, ' ').trim();
        if (!s && !first) return;
        var q = {};
        for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k)) q[k] = p[k];
        q.text = s;
        q.textU = '';   /* 문단 전체의 밑줄 빈칸 표시라 줄 하나에는 맞지 않는다 */
        if (!first) q.images = [];
        out.push(q);
        first = false;
      });
    });
    return out;
  }

  /** 'B. It’s on the second floor' → {letter:1, text:'It’s on…'}. 아니면 null. */
  function lettered(s) {
    var m = /^([A-E])\s*[.)]\s*(.*)$/.exec(s);
    return m ? { letter: CHOICE_LETTERS.indexOf(m[1]), text: m[2].trim() } : null;
  }

  /** 정답지 한 줄 → 비교 가능한 값. 'B.' → 1(인덱스), 'populations' → 문자열. */
  function answerValue(raw) {
    var s = String(raw || '').trim();
    var m = /^([A-E])\s*[.)]?\s*$/.exec(s);
    if (m) return CHOICE_LETTERS.indexOf(m[1]);
    return s.replace(/\s+/g, ' ');
  }

  function slug(code) {
    return String(code || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /* docx 안의 그림은 'media/image7.png' 처럼 문서 내부 이름으로 나온다.
     팩에는 세트 폴더 기준 경로로 적어야 화면이 찾을 수 있다 — 파일명만 떼어 쓴다.
     실제 그림 바이트는 저장할 때 assets/set-media.js 가 같은 이름으로 넣는다. */
  function picName(ref) {
    return String(ref || '').split('/').pop();
  }

  /* ------------------------------------------------- 섹션 경계 나누기 */

  var SECTION_HEAD = [
    { id: 'listening', re: /^listening(\s+section)?$/i },
    { id: 'writing', re: /^writing(\s+section)?$/i },
    { id: 'speaking', re: /^speaking(\s+section)?$/i },
    { id: 'reading', re: /^reading(\s+section)?$/i }
  ];

  /** 문단 배열을 섹션별 구간으로 자른다. 앞머리는 reading 으로 본다. */
  function splitSections(paras) {
    var marks = [];
    paras.forEach(function (p, i) {
      var t = txt(p);
      if (!t || t.length > 24) return;
      for (var k = 0; k < SECTION_HEAD.length; k++) {
        if (SECTION_HEAD[k].re.test(t)) {
          /* 'Reading' 은 모듈 머리글로도 쓰인다 — 이미 그 섹션에 들어와 있으면 무시. */
          if (marks.length && marks[marks.length - 1].id === SECTION_HEAD[k].id) return;
          marks.push({ id: SECTION_HEAD[k].id, at: i });
          return;
        }
      }
    });

    var out = { reading: [], listening: [], writing: [], speaking: [] };
    if (!marks.length) { out.reading = paras.slice(); return out; }

    /* 첫 마크 앞부분은 그 마크가 reading 이면 흡수, 아니면 reading 구간으로 둔다. */
    var first = marks[0];
    if (first.at > 0) out.reading = paras.slice(0, first.at);

    for (var i = 0; i < marks.length; i++) {
      var to = i + 1 < marks.length ? marks[i + 1].at : paras.length;
      out[marks[i].id] = out[marks[i].id].concat(paras.slice(marks[i].at, to));
    }
    return out;
  }

  /** 'Module 2' / 'MODULE 2' 로 다시 자른다. 없으면 모듈 하나로 본다. */
  function splitModules(paras) {
    var starts = [];
    paras.forEach(function (p, i) {
      var m = /^module\s+(\d+)\s*$/i.exec(txt(p));
      if (m) starts.push({ no: +m[1], at: i });
    });
    if (!starts.length) return [{ no: 1, paras: paras }];
    var out = [];
    if (starts[0].at > 0) {
      var head = paras.slice(0, starts[0].at);
      /* 모듈 머리글 앞의 내용이 실질적이면 1번 모듈로 붙인다. */
      if (head.some(function (p) { return !isBlank(p); }) && starts[0].no !== 1) {
        out.push({ no: 0, paras: head });
      }
    }
    starts.forEach(function (s, i) {
      var to = i + 1 < starts.length ? starts[i + 1].at : paras.length;
      out.push({ no: s.no, paras: paras.slice(s.at, to) });
    });
    return out;
  }

  /* ---------------------------------------------- 선택지 모으기 (공통) */

  /**
   * i 번째 문단부터 이어지는 선택지들을 모은다.
   * 두 가지 서식을 모두 받는다 — 자동번호 목록(리딩)과 'A.' 접두(리스닝).
   * @return {{choices:string[], next:number, lettered:boolean}}
   */
  function collectChoices(paras, i) {
    var choices = [], sawLetter = false, blanks = 0;
    while (i < paras.length) {
      var p = paras[i], t = txt(p);
      if (!t) {
        if (p.images && p.images.length) { i++; continue; }
        if (++blanks > 2 || choices.length) break;
        i++; continue;
      }
      var L = lettered(t);
      if (L && L.letter >= 0) { choices.push(L.text); sawLetter = true; i++; blanks = 0; continue; }
      if (!sawLetter && p.listed && choices.length < 5 && !numbered(t) && !questionRange(t)) {
        choices.push(t); i++; blanks = 0; continue;
      }
      break;
    }
    return { choices: choices, next: i, lettered: sawLetter };
  }

  /* -------------------------------------------------------- 리딩 파서 */

  var CLOZE_HEAD = /^fill in the blank/i;
  var PASSAGE_HEAD = /^(read in daily life|academic passage|reading passage)/i;

  /**
   * 'Immigrant 1 popul_ _ _ have 2 exper_ _ _' → {template, questions[]}
   * 지문 안의 번호는 지문마다 1번부터 다시 시작한다 — 모듈 전체 번호는 호출하는 쪽에서
   * 'Questions a-b' 머리글을 보고 옮긴다(shiftCloze).
   */
  function parseCloze(source) {
    var questions = [];
    /* 번호와 힌트 글자 사이의 공백은 세트마다 다르다 — SET 9 는 '1 popul_ _ _',
       SET 10 은 '1S_ _' 처럼 붙여 쓴다. 공백을 요구하면 SET 10 은 35문항 중 2개만
       잡힌다. 밑줄이 뒤따르는 것만 빈칸으로 보므로 공백 없이도 안전하다. */
    var template = source.replace(/(\d{1,2})\s*([A-Za-z’']*)((?:\s*_)+)/g, function (all, no, hint) {
      questions.push({ kind: 'blank', local: +no, hint: hint });
      return '{{' + no + '}}';
    });
    /* 빈칸을 하나도 못 찾았으면 cloze 지문이 아니다. */
    if (!questions.length) return null;
    return { template: template.replace(/\s{2,}/g, ' ').trim(), questions: questions };
  }

  /** 지문 로컬 번호(1..n) → 모듈 번호(from..). 템플릿의 자리표시자도 같이 옮긴다. */
  function shiftCloze(cz, idPrefix, from) {
    var min = cz.questions.reduce(function (a, q) { return Math.min(a, q.local); }, Infinity);
    var offset = (from || min) - min;
    /* replace 는 치환 결과를 다시 훑지 않으므로 한 번에 옮겨도 번호가 서로 겹치지 않는다. */
    cz.template = cz.template.replace(/\{\{(\d+)\}\}/g, function (m, n) { return '{{' + (+n + offset) + '}}'; });
    cz.questions.forEach(function (q) {
      q.no = q.local + offset;
      q.id = idPrefix + '-' + q.no;
      delete q.local;
    });
    return cz;
  }

  /** 빈칸 지문인가 — 번호 뒤에 밑줄이 이어지는 줄. */
  function isClozeLine(t) { return !!t && /\d\s*[A-Za-z’']*(\s*_){2,}/.test(t); }

  /* 지문 앞에 붙는 안내 줄. 세트마다 문구가 달라 목록으로 둔다 — 지문 본문이 아니므로
     제목으로 올라가면 안 된다. */
  var READ_HEAD = /^(read (a|an|the|in daily life)|academic passage|reading passage)/i;

  /**
   * 머리글이 말하는 번호와 본문에 찍힌 번호가 어긋나는 세트가 있다. 어느 쪽을 믿을지는
   * "앞 블록에서 이어지는가"로 가른다 —
   *   · 머리글이 앞 블록 다음 번호에서 시작하고 개수도 맞으면 머리글이 옳다
   *     (SET 10 리딩 'Questions 21-22' 안의 번호는 22·23 으로 하나씩 밀려 있다).
   *   · 그렇지 않으면 본문 번호가 옳다
   *     (SET 10 리스닝은 머리글 'Questions 15-16' 이 세 번 되풀이되고 본문만 맞다).
   * 어느 쪽으로 갔든 어긋난 사실은 남겨 사람이 보게 한다.
   * @param {Array<number|null>} bodyNos 본문에 찍힌 번호(없으면 null)
   * @return {number[]} 문항별 최종 번호
   */
  function reconcileNumbers(bodyNos, range, expected, mismatch, moduleId) {
    var span = range.to - range.from + 1;
    var n = bodyNos.length, out = [], k;
    var headingWins = (span === n && range.from === expected);

    if (headingWins) {
      for (k = 0; k < n; k++) out.push(range.from + k);
    } else {
      var next = expected || range.from;
      for (k = 0; k < n; k++) {
        var no = bodyNos[k];
        if (no == null || no < next) no = next;
        out.push(no);
        next = no + 1;
      }
    }
    for (k = 0; k < n; k++) {
      if (bodyNos[k] != null && bodyNos[k] !== out[k]) {
        mismatch.push(moduleId + '-' + out[k] + ' (printed ' + bodyNos[k]
          + ' under heading ' + range.from + '-' + range.to + ')');
      }
    }
    if (n && (out[0] !== range.from || out[n - 1] !== range.to)) {
      mismatch.push(moduleId + ' heading "Questions ' + range.from + '-' + range.to
        + '" holds ' + out[0] + '-' + out[n - 1]);
    }
    return out;
  }

  /**
   * 리딩 모듈 하나 → 블록 배열.
   *
   * 블록의 경계는 'Questions a-b' 머리글이고, 지문은 머리글 **어느 쪽에도** 놓일 수 있다 —
   * SET 9 는 지문을 머리글 위에, SET 10 은 아래에 둔다. 그래서 한 블록의 본문은
   * "앞 블록의 문항이 끝난 자리 ~ 머리글" 과 "머리글 ~ 첫 문항 번호" 를 합친 구간이다.
   * 지문 앞의 'Read a passage.' 같은 안내 줄에 기대지 않는 이유도 같다 — SET 10 리딩
   * Module 2 에는 그 줄이 아예 없고, 그것에 기대면 15문항이 통째로 사라진다.
   */
  function parseReadingModule(mod, moduleId, mismatch) {
    var paras = mod.paras, blocks = [];
    mismatch = mismatch || [];

    var heads = [];
    paras.forEach(function (p, k) {
      var r = questionRange(txt(p));
      if (r) heads.push({ at: k, range: r, text: txt(p) });
    });
    if (!heads.length) return blocks;

    var prevEnd = 0;
    var expected = heads[0].range.from;

    for (var i = 0; i < heads.length; i++) {
      var head = heads[i];
      var bodyEnd = i + 1 < heads.length ? heads[i + 1].at : paras.length;

      /* 문항이 시작되는 자리 = 머리글 아래 첫 번호 줄. */
      var qStart = bodyEnd;
      for (var k = head.at + 1; k < bodyEnd; k++) {
        if (numbered(txt(paras[k]))) { qStart = k; break; }
      }

      /* 본문 구간의 원본 인덱스 — 어디까지 썼는지 다음 블록에 정확히 넘겨야 한다.
         빈칸 지문 두 개가 나란히 놓인 SET 9 리딩 Module 1 에서, 첫 블록이 두 번째
         지문까지 삼켜 버리면 11-20 이 통째로 빈다. */
      var at = [], k2;
      for (k2 = prevEnd; k2 < head.at; k2++) at.push(k2);
      for (k2 = head.at + 1; k2 < qStart; k2++) at.push(k2);
      var content = at.map(function (x) { return paras[x]; });

      var images = [];
      if (paras[head.at].images) images = images.concat(paras[head.at].images);
      content.forEach(function (p) { if (p.images && p.images.length) images = images.concat(p.images); });

      /* ---- 빈칸 지문 ---- */
      var clozeSrc = null, clozeAt = -1;
      at.forEach(function (x) {
        if (clozeSrc === null && isClozeLine(txt(paras[x]))) { clozeSrc = txt(paras[x]); clozeAt = x; }
      });
      prevEnd = clozeSrc !== null ? clozeAt + 1 : bodyEnd;
      if (clozeSrc) {
        var cz = parseCloze(clozeSrc);
        if (cz) {
          var c = shiftCloze(cz, moduleId, head.range.from);
          blocks.push({
            kind: 'cloze', heading: head.text, instruction: 'Fill in the blank.',
            template: c.template, questions: c.questions
          });
          expected = head.range.from + c.questions.length;
          continue;
        }
      }

      /* ---- 지문 + 객관식 ---- */
      var lines = [];
      content.forEach(function (p) {
        var t = txt(p);
        if (!t) return;
        if (CLOZE_HEAD.test(t) || READ_HEAD.test(t)) return;
        if (/^module\s+\d+\s*$/i.test(t)) return;
        var isSection = false;
        SECTION_HEAD.forEach(function (h) { if (h.re.test(t)) isSection = true; });
        if (isSection) return;
        lines.push(t);
      });

      var items = [], j = qStart, questionEnd = qStart;
      while (j < bodyEnd) {
        var q = numbered(txt(paras[j]));
        if (!q) { j++; continue; }
        var got = collectChoices(paras, j + 1);
        var isInsert = /look at the (four )?letters|indicate where/i.test(q.text);
        var item = {
          bodyNo: q.no,
          kind: isInsert ? 'insert' : 'mcq',
          prompt: q.text,
          choices: got.choices
        };
        if (isInsert) {
          var insertSentence = '', insertChoices = [], sawInsertLabel = false, iz = j + 1, insertNext = iz;
          while (iz < bodyEnd) {
            var ip = paras[iz], it = txt(ip);
            if (numbered(it)) break;
            var iLetter = lettered(it);
            if (iLetter && iLetter.letter >= 0) insertChoices.push(iLetter.text);
            else if (ip.listed && /^position\s+[A-D]$/i.test(it)) insertChoices.push(it);
            var im = /^sentence to insert\s*:\s*(.*)$/i.exec(it);
            if (im) {
              sawInsertLabel = true;
              if (im[1]) insertSentence = im[1].trim();
            } else if (sawInsertLabel && !insertSentence && it && !lettered(it)
                       && !(ip.listed && /^position\s+[A-D]$/i.test(it))) {
              insertSentence = it;
            } else if (!insertSentence && it && !iLetter
                       && !(ip.listed && /^position\s+[A-D]$/i.test(it))) {
              /* Some source documents (SET 11) place the quoted sentence directly
                 below the question, without a "Sentence to insert:" label. */
              insertSentence = it;
            }
            iz++; insertNext = iz;
          }
          item.sentence = insertSentence;
          if (insertChoices.length === 4) item.choices = insertChoices;
          if (insertNext > got.next) got.next = insertNext;
        }
        /* 삽입 문항의 보기는 원본에 없다 — 지문 안의 마커 A~D 가 곧 보기다.
           여기서만 텍스트를 만들고, 만들었다는 사실을 팩에 남긴다. */
        if (isInsert && !item.choices.length) {
          item.choices = CHOICE_LETTERS.slice(0, 4).map(function (L) { return 'Position ' + L; });
          item.choicesOrigin = 'generated';
          item.choicesNote = 'The source docx had no choice list — insertion points A-D were generated.';
        }
        items.push(item);
        j = got.next > j ? got.next : j + 1;
        questionEnd = j;
      }

      /* 마지막 문항의 선택지 뒤부터 다음 머리글 앞까지는 다음 블록의 선행 지문이다.
         bodyEnd 로 넘기면 SET 10의 Twin Stars처럼 머리글 위 지문이 이미 소비되어 사라진다. */
      prevEnd = questionEnd;

      if (!items.length && !lines.length && !images.length) continue;

      var nos = reconcileNumbers(items.map(function (x) { return x.bodyNo; }),
        head.range, expected, mismatch, moduleId);

      /* 렌더러가 클릭할 수 있는 삽입 자리라고 {{A}}…{{D}} 마커만 버튼을 누른다.
         삽입 문항이 있는 지문 블록에서만 원본의 (A)…(D)를 그 형식으로 바꾼다. */
      if (items.some(function (x) { return x.kind === 'insert'; })) {
        lines = lines.map(function (line) { return line.replace(/\(([A-D])\)/g, '{{$1}}'); });
      }

      var blk = {
        kind: 'passage', heading: head.text, instruction: '',
        title: lines.length ? lines[0] : '',
        paragraphs: lines.slice(1),
        questions: []
      };
      if (images.length) blk.images = images;
      items.forEach(function (x, n) {
        x.no = nos[n];
        x.id = moduleId + '-' + nos[n];
        delete x.bodyNo;
        blk.questions.push(x);
      });
      blocks.push(blk);
      if (nos.length) expected = nos[nos.length - 1] + 1;
    }

    return blocks;
  }

  /* ------------------------------------------------------ 리스닝 파서 */

  /* 대본과 문항 문서가 쓰는 안내 문구가 세트마다 다르다 — SET 9 는 'Listen to a…',
     SET 10 은 안내 방송 대본에 'Read an announcement' 라고 적는다. 이 줄을 못 알아보면
     그 아래 대사를 '문항 낭독'으로 오해해 음성이 만들어지지 않는다. */
  var LISTEN_CUE = /^(listen to\s|read (a|an|the)\s|instructions?\s*:)/i;
  var SHORT_RESPONSE_PROMPT = 'Listen to the question and select the best response.';

  /**
   * 리스닝 문항은 번호도 'A.' 접두도 없을 수 있다 — SET 9 Module 1 의 Q13-32 가 그렇다.
   * 유일하게 믿을 수 있는 구분자가 빈 줄이라, 빈 줄로 덩어리를 나눈 뒤 덩어리 안에서
   * 문두와 보기를 가른다.
   * @return {Array<{lines:string[], images:string[]}>}
   */
  function groupByBlankLine(paras, from, to) {
    var groups = [], cur = null;
    for (var i = from; i < to; i++) {
      var p = paras[i], t = txt(p);
      if (!t) {
        if (p.images && p.images.length && cur) cur.images = cur.images.concat(p.images);
        if (cur) { groups.push(cur); cur = null; }
        continue;
      }
      if (!cur) cur = { lines: [], listed: [], images: [] };
      cur.lines.push(t);
      cur.listed.push(!!p.listed);
      if (p.images && p.images.length) cur.images = cur.images.concat(p.images);
    }
    if (cur) groups.push(cur);
    return groups;
  }

  /* '2. A. In the main auditorium' — 번호와 첫 보기가 한 줄에 붙어 있는 서식(SET 10
     리스닝 짧은 응답). 번호 줄과 보기 줄 둘로 펴서 아래 로직이 그대로 보게 한다. */
  function splitNumberedChoice(lines) {
    var out = [];
    lines.forEach(function (line) {
      var m = /^(\d{1,3})\s*[.)]\s*([A-E]\s*[.)]\s.*)$/.exec(line);
      if (m) { out.push(m[1] + '.'); out.push(m[2]); return; }
      out.push(line);
    });
    return out;
  }

  /** 덩어리 하나 → {prompt, choices} 또는 null(문항이 아님). */
  function itemFromGroup(lines) {
    var firstLetter = -1;
    for (var i = 0; i < lines.length; i++) {
      var L = lettered(lines[i]);
      if (L && L.letter >= 0) { firstLetter = i; break; }
    }

    var stemLines, choiceLines;
    if (firstLetter >= 0) {
      stemLines = lines.slice(0, firstLetter);
      choiceLines = lines.slice(firstLetter).map(function (s) {
        var L = lettered(s);
        return L ? L.text : s;
      });
    } else {
      if (lines.length < 4) return null;      /* 문두 1 + 보기 3 미만이면 문항이 아니다 */
      stemLines = lines.slice(0, 1);
      choiceLines = lines.slice(1);
    }
    if (choiceLines.length < 3) return null;

    var stem = stemLines.join(' ').trim();
    var n = numbered(stem);
    return {
      no: n ? n.no : null,
      prompt: n ? n.text : stem,
      choices: choiceLines
    };
  }

  /**
   * 덩어리 하나 → 문항 여러 개.
   *
   * 문항 사이에 빈 줄이 없는 세트가 있다(SET 10 은 13번 보기 D 다음 줄이 바로 14번이다).
   * 빈 줄만 믿으면 그런 블록은 문항 하나에 보기 8개로 뭉개진다. 보기를 한 번이라도 본
   * 뒤에 번호 줄이 나오면 거기서 새 문항이 시작된 것으로 본다.
   */
  function itemsFromGroup(rawLines) {
    var lines = splitNumberedChoice(rawLines);
    var segs = [], cur = [], sawChoice = false;

    lines.forEach(function (line) {
      var L = lettered(line);
      if (numbered(line) && cur.length && (sawChoice || cur.length >= 4)) {
        segs.push(cur); cur = []; sawChoice = false;
      }
      if (L && L.letter >= 0) sawChoice = true;
      cur.push(line);
    });
    if (cur.length) segs.push(cur);

    var out = [];
    segs.forEach(function (seg) {
      var item = itemFromGroup(seg);
      if (item) out.push(item);
    });
    /* 쪼개서 아무것도 못 얻으면 통짜로 한 번 더 본다(번호 없는 SET 9 서식). */
    if (!out.length) {
      var one = itemFromGroup(lines);
      if (one) out.push(one);
    }
    return out;
  }

  function parseListeningModule(mod, moduleId, mismatch) {
    var paras = mod.paras, blocks = [], i = 0;
    mismatch = mismatch || [];

    /* 'Questions a-b' 머리글 위치를 먼저 전부 찾는다. */
    var heads = [];
    paras.forEach(function (p, k) {
      var r = questionRange(txt(p));
      if (r) heads.push({ at: k, range: r, text: txt(p) });
    });
    if (!heads.length) return blocks;

    /* 첫 머리글 앞에 이미 문항이 있는 세트가 있다 — SET 10 리스닝 Module 2 는
       'Questions 1-3' 머리글이 통째로 빠져 있다. 없는 머리글을 지어 넣지 않으면
       3문항이 사라지고, 그러면 정답지와 개수가 어긋나 시험이 만들어지지 않는다. */
    var firstItem = -1;
    for (i = 0; i < heads[0].at; i++) {
      if (lettered(txt(paras[i])) || numbered(txt(paras[i]))) { firstItem = i; break; }
    }
    if (firstItem >= 0 && heads[0].range.from > 1) {
      heads.unshift({
        at: firstItem - 1 >= 0 ? firstItem - 1 : 0,
        range: { from: 1, to: heads[0].range.from - 1 },
        text: 'Questions 1-' + (heads[0].range.from - 1),
        headingOrigin: 'generated'
      });
    }

    var expected = heads[0].range.from;

    for (i = 0; i < heads.length; i++) {
      var head = heads[i];
      var end = i + 1 < heads.length ? heads[i + 1].at : paras.length;
      var blk = { kind: 'audio-set', heading: head.text, instruction: '', questions: [] };
      if (head.headingOrigin) {
        blk.headingOrigin = 'generated';
        blk.headingNote = 'The source docx had no "Questions a-b" heading here — the range was read from the answer key order.';
      }
      var images = [];
      var items = [];

      var groups = groupByBlankLine(paras, head.at + 1, end);
      var pendingStem = null;   /* 문두와 보기 사이에 빈 줄이 있는 서식을 위해 */
      var trailingNumberMarkers = false;

      groups.forEach(function (g) {
        images = images.concat(g.images);

        var hadPendingStem = !!pendingStem;
        var lines = pendingStem ? [pendingStem].concat(g.lines) : g.lines;
        var listed = pendingStem ? [false].concat(g.listed || []) : (g.listed || []);
        pendingStem = null;

        /* 'Listen to a conversation.' 이 첫 문항과 같은 덩어리에 있는 세트가 있다
           (SET 10 은 그 사이에 빈 줄이 없다). 먼저 떼지 않으면 그 줄이 15번 문두 앞에
           붙어 "Listen to a conversation. 15. What are the speakers…" 가 화면에 뜬다.
           안내 줄은 블록 전체의 것이지 문항의 것이 아니다. */
        while (lines.length > 1 && !numbered(lines[0]) && !lettered(lines[0])
               && (LISTEN_CUE.test(lines[0]) || /select the best response/i.test(lines[0]))) {
          if (!blk.instruction) blk.instruction = lines[0];
          lines = lines.slice(1);
          listed = listed.slice(1);
        }

        if (lines.length > 1) {
          var lastNo = numbered(lines[lines.length - 1]);
          var markerAfterListedChoices = lastNo && !lastNo.text
            && listed.length === lines.length
            && listed.slice(0, -1).every(function (x) { return x; });
          if (trailingNumberMarkers && lastNo && !lastNo.text || markerAfterListedChoices) {
            lines = lines.slice(0, -1);
            listed = listed.slice(0, -1);
          }
        }
        var joined = lines.join(' ');
        /* SET 11's short-response auto-number marker is serialized after its
           four choices. It labels the item already collected, not the next one. */
        if (trailingNumberMarkers && lines.length === 1) {
          var trailingNo = numbered(lines[0]);
          if (trailingNo && !trailingNo.text) return;
        }
        /* SET 11 short-response blocks put the four listed choices first and the
           auto-number paragraph after them.  With no visible stem, all four listed
           lines are choices; treating the first as a stem drops one choice and one
           question from the module. */
        var allListedChoices = !hadPendingStem && lines.length >= 3 && lines.length <= 5
          && listed.length === lines.length && listed.every(function (x) { return x; })
          && !lines.some(function (line) { return numbered(line) || lettered(line); });
        var got = allListedChoices
          ? [{ no: null, prompt: '', choices: lines.slice() }]
          : itemsFromGroup(lines);
        if (allListedChoices) trailingNumberMarkers = true;
        if (!got.length) {
          /* 한 줄짜리 문두는 버리지 않고 다음 덩어리(보기)에 붙인다. */
          if (lines.length === 1 && (numbered(lines[0]) || /[?？]$/.test(lines[0]))) {
            pendingStem = lines[0];
            return;
          }
          if (LISTEN_CUE.test(joined) || /select the best response/i.test(joined)) {
            if (!blk.instruction) blk.instruction = joined;
          }
          return;
        }
        items = items.concat(got);
      });

      if (images.length) blk.images = images;

      var nos = reconcileNumbers(items.map(function (x) { return x.no; }),
        head.range, expected, mismatch, moduleId);
      if (nos.length) expected = nos[nos.length - 1] + 1;

      /* 원본 머리글이 복사 실수로 틀려도 응시 화면에는 실제 문항 범위룰 보여 준다.
         잘못된 원문은 mismatch 경고와 note 에 남는다. */
      if (nos.length && (nos[0] !== head.range.from || nos[nos.length - 1] !== head.range.to)) {
        blk.headingOrigin = 'corrected-from-source';
        blk.headingNote = 'The source heading was "' + head.text + '"; the displayed range follows the questions in this block.';
        blk.heading = 'Questions ' + nos[0] + '-' + nos[nos.length - 1];
      }

      items.forEach(function (x, k) {
        var prompt = x.prompt || SHORT_RESPONSE_PROMPT;
        var choices = x.choices;
        if (head.range.from === 1 && choices && choices.length === 3
            && x.prompt && !/[?？]$/.test(x.prompt)) {
          choices = [x.prompt].concat(choices);
          prompt = SHORT_RESPONSE_PROMPT;
        }
        blk.questions.push({
          id: moduleId + '-' + nos[k],
          kind: 'mcq',
          no: nos[k],
          prompt: prompt,
          choices: choices
        });
      });

      /* 문두 없이 보기만 있는 세트 = 문항마다 음성이 따로 붙는다. */
      var stemless = blk.questions.filter(function (q) { return q.prompt === SHORT_RESPONSE_PROMPT; });
      if (blk.questions.length && stemless.length === blk.questions.length) blk.perQuestionAudio = true;

      if (blk.questions.length) blocks.push(blk);
    }

    return blocks;
  }

  /* -------------------------------------------------------- 라이팅 파서 */

  var BUILD_HEAD = /^build a sentence/i;
  var EMAIL_HEAD = /^write an email/i;
  var DISC_HEAD = /^write for an academic discussion/i;

  /** '______ ______ out of stock ______.' + 타일 줄 → slots/tiles */
  function parseBuildItem(slotLine, tileLine) {
    var tiles = String(tileLine || '').split(/\s{2,}|\t/).map(function (s) { return s.trim(); })
      .filter(function (s) { return s; });
    if (tiles.length < 2) tiles = String(tileLine || '').trim().split(/\s+/).filter(Boolean);

    var slots = [];
    var re = /(_{2,})|([^_]+)/g, m;
    while ((m = re.exec(slotLine || ''))) {
      if (m[1]) slots.push({ t: 'b' });
      else {
        var fixed = m[2].trim();
        if (fixed) slots.push({ t: 'f', text: fixed });
      }
    }
    return { slots: slots, tiles: tiles };
  }


  /* 문항 id 로 고정되는 뒤섞기. Math.random 을 쓰면 같은 docx 를 두 번 올릴 때 타일 순서가
     달라져 문항이 달라진 것처럼 보인다. */
  function seededShuffle(list, seed) {
    var arr = list.slice(), h = 0, i;
    for (i = 0; i < String(seed).length; i++) h = (h * 31 + String(seed).charCodeAt(i)) >>> 0;
    for (i = arr.length - 1; i > 0; i--) {
      h = (h * 1103515245 + 12345) >>> 0;
      var j = h % (i + 1), t = arr[i];
      arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /**
   * 타일 줄이 없는 세트를 위해 정답 문장에서 타일을 만든다.
   *
   * 만들지 않으면 학생 화면에 끌어다 놓을 낱말이 하나도 없어 문항이 성립하지 않는다.
   * 낱말은 정답지에 적힌 그대로이고(새로 짓지 않는다) 순서만 뒤섞는다 — 만들었다는 사실은
   * tilesOrigin 으로 팩에 남긴다. 앞뒤에만 고정 글이 있는 단순한 모양에서만 손댄다.
   * @return {boolean} 만들었으면 true
   */
  function deriveTiles(q) {
    var sentence = String(q.answerSentence || '').trim();
    if (!sentence || (q.tiles && q.tiles.length)) return false;

    var slots = q.slots || [];
    var head = slots.length && slots[0].t === 'f' ? slots[0].text : '';
    var tail = slots.length && slots[slots.length - 1].t === 'f' ? slots[slots.length - 1].text : '';
    /* 가운데 낀 고정 글이 있으면(SET 9 '____ out of stock ____') 어느 자리에 무엇이 들어갈지
       정답 문장만으로 가를 수 없다 — 손대지 않는다. 다만 쉼표처럼 문장부호뿐인 조각은
       정답 문장의 낱말이 이미 달고 있으므로 그냥 흘려 보낸다. */
    var mid = slots.slice(1, Math.max(1, slots.length - 1));
    for (var i = 0; i < mid.length; i++) {
      if (mid[i].t === 'f' && !/^[,.;:!?…—–-]+$/.test(String(mid[i].text || '').trim())) return false;
    }

    var body = sentence;
    if (head && body.toLowerCase().indexOf(head.toLowerCase()) === 0) body = body.slice(head.length);
    if (tail && /[.?!]$/.test(tail)) body = body.replace(/[.?!]+\s*$/, '');
    var words = body.split(/\s+/).filter(function (w) { return w; });
    if (words.length < 2) return false;

    var out = [];
    if (head) out.push({ t: 'f', text: head });
    for (i = 0; i < words.length; i++) out.push({ t: 'b', a: words[i] });
    if (tail) out.push({ t: 'f', text: tail });

    q.slots = out;
    /* Build-a-Sentence review and autoscore use slots[].a as the canonical key.
       Keep the companion fields in sync so every runtime sees the same answer. */
    q.answerTokens = words.slice();
    q.sentence = sentence;
    q.tiles = seededShuffle(words, q.id);
    q.tilesOrigin = 'derived-from-answer';
    q.tilesNote = 'The source docx had no word tiles — the words of the answer sentence were used, in scrambled order.';
    return true;
  }

  /**
   * 세트에는 두되 점수에서 빼는 문항. 세트는 부족해도 항상 짓는다(2026-09-15) — 대신
   * 성립하지 않는 정답으로 채점하지 않는다. 채점기(sg-results.js · sg-review-writing.js)는
   * q.unscored 를 보고 이 문항을 합계에서 뺀다. 무엇을 왜 뺐는지는 pack.report 에 남는다.
   */
  function unscore(q, reason) {
    (q.slots || []).forEach(function (s) { if (s && s.t === 'b') delete s.a; });
    delete q.answerTokens;
    q.unscored = true;
    q.unscoredReason = reason;
  }

  /* 정답 문장을 견주기 위한 꼴. 대소문자와 굽은 따옴표만 맞춘다 — 낱말은 그대로 둔다. */
  function cmpText(s) {
    return String(s || '').toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
  }

  /**
   * 타일을 정답 문장에 순서대로 맞춰 빈칸마다 slots[].a 를 채운다.
   *
   * 이게 없으면 팩은 지어지되 라이팅 1교시가 채점되지 않는다: 자동채점(sg-review-writing.js)과
   * 성적표(sg-results.js)는 빈칸의 .a 만 정답으로 보는데, 타일 줄에서 온 문항에는 그 칸이
   * 비어 있었다. 맞추지 못하면 false — 그건 타일과 정답지가 서로 다른 문장이라는 뜻이다.
   * @return {boolean} 맞췄으면 true
   */
  function alignBuildAnswer(q) {
    var sentence = String(q.answerSentence || '').trim();
    var slots = q.slots || [], tiles = (q.tiles || []).slice();
    if (!sentence || !slots.length || !tiles.length) return false;

    var rest = cmpText(sentence), used = [], tokens = [], i, k;
    /* 긴 타일부터 본다. 'the last chapter' 가 있는데 'the' 를 먼저 집으면 그 뒤가 어긋난다. */
    var order = tiles.map(function (t, ix) { return ix; }).sort(function (a, b) {
      return cmpText(tiles[b]).length - cmpText(tiles[a]).length;
    });

    function takes(want) {
      if (!want || rest.indexOf(want) !== 0) return false;
      var next = rest.charAt(want.length);
      return next === '' || !/[a-z0-9']/.test(next);   /* 낱말 한가운데를 물지 않는다 */
    }
    function eat(want) { rest = rest.slice(want.length).replace(/^\s+/, ''); }

    for (i = 0; i < slots.length; i++) {
      if (slots[i].t === 'f') {
        var fixed = cmpText(slots[i].text);
        /* 정답지가 마침표를 빠뜨린 문장이 있다(SET 9 q03). 마지막 고정 조각이 문장부호뿐이면
           없어도 넘어간다 — 학생이 놓을 조각이 아니라 화면에 이미 찍혀 있는 글자다. */
        if (!rest && /^[,.;:!?…—–-]+$/.test(fixed)) continue;
        /* 문제지의 끝 부호와 정답지의 끝 부호가 다른 경우가 있다(SET 12 W1-q06: 문제지는
           '?', 정답 문장은 '.'). 여기까지 왔다는 건 타일과 고정 글이 정답 문장에 남김없이
           맞아떨어졌다는 뜻이므로 정답지가 밀린 것이 아니다 — 부호는 화면에 이미 찍혀 있는
           글자이지 학생이 놓을 조각이 아니다. 넘기되 어느 문항이었는지 남긴다. */
        if (!takes(fixed) && i === slots.length - 1
            && /^[,.;:!?…—–-]+$/.test(fixed) && /^[.?!…]+$/.test(rest)) {
          q.endPunctNote = 'The question document ends this sentence with "' + String(slots[i].text).trim()
            + '" but the answer key ends it with "' + rest + '".';
          rest = '';
          continue;
        }
        if (!takes(fixed)) return false;
        eat(fixed);
        continue;
      }
      var pick = -1;
      for (k = 0; k < order.length; k++) {
        if (used[order[k]]) continue;
        if (takes(cmpText(tiles[order[k]]))) { pick = order[k]; break; }
      }
      if (pick < 0) return false;
      used[pick] = true;
      eat(cmpText(tiles[pick]));
      slots[i].a = tiles[pick];
      tokens.push(tiles[pick]);
    }
    if (rest) return false;

    q.answerTokens = tokens;
    q.sentence = sentence;
    /* 남은 타일 = 함정. 학생 화면에는 같이 깔리지만 어느 칸에도 들어가지 않는다. */
    q.trapTiles = tiles.filter(function (t, ix) { return !used[ix]; });
    return true;
  }

  function parseWriting(paras, codeSlug, startNo) {
    var modules = [], i = 0, no = startNo;

    /* 어떤 DOCX는 이메일 카드(SITUATION / YOUR EMAIL SHOULD)를
       "Write an email" 머리글보다 앞에 둔다(SET 10). 주 루프가 그 앞 구간을 W1의 꼬리로
       지나가므로, 먼저 문서 전체에서 카드 내용을 모아 둔다. */
    var emailLead = { to: '', subject: '', situationLabel: '', situation: '', bullets: [] };
    var emailAt = -1, leadMode = '';
    for (var ep = 0; ep < paras.length; ep++) {
      if (EMAIL_HEAD.test(txt(paras[ep]))) { emailAt = ep; break; }
    }
    if (emailAt >= 0) {
      for (ep = 0; ep < emailAt; ep++) {
        var eline = txt(paras[ep]);
        if (/^to:/i.test(eline)) {
          emailLead.to = eline.replace(/^to:\s*/i, '');
          leadMode = '';
        } else if (/^subject:/i.test(eline)) {
          emailLead.subject = eline.replace(/^subject:\s*/i, '');
          leadMode = '';
        } else if (/^situation\b/i.test(eline)) {
          emailLead.situationLabel = eline;
          leadMode = 'sit';
        } else if (/^your email should\b/i.test(eline)) {
          leadMode = 'req';
        } else if (eline && leadMode === 'sit') {
          emailLead.situation += (emailLead.situation ? ' ' : '') + eline;
        } else if (eline && leadMode === 'req') {
          emailLead.bullets.push(eline.replace(/^\d+\s*[.)]\s*/, ''));
        }
      }
    }

    while (i < paras.length) {
      var t = txt(paras[i]);

      if (BUILD_HEAD.test(t)) {
        var qs = [], head = t, instruction = '';
        i++;
        var rng = null;
        while (i < paras.length && !EMAIL_HEAD.test(txt(paras[i])) && !DISC_HEAD.test(txt(paras[i]))) {
          var line = txt(paras[i]);
          var r = questionRange(line);
          if (r) { rng = r; i++; continue; }
          if (/^make an appropriate sentence/i.test(line)) { instruction = line; i++; continue; }
          if (!line) { i++; continue; }
          /* context / slot / tiles 3줄 묶음. slot 줄은 밑줄이 2개 이상. */
          var slotAt = -1;
          if (/_{2,}/.test(line)) slotAt = i;
          if (slotAt < 0) {
            /* context 줄 — 다음 두 줄이 slot/tiles 인지 본다. */
            var s1 = i + 1 < paras.length ? slotText(paras[i + 1]) : '';
            if (/_{2,}/.test(s1)) {
              /* 타일 줄이 아예 없는 세트가 있다(SET 10). 타일 줄은 '자동번호 목록이 아니고
                 밑줄도 없는 줄' 이다 — 다음 문항의 context 줄은 자동번호 목록이라 구분된다.
                 이 검사 없이 3줄로 밀면 다음 문항의 지문을 타일로 먹어 10문항이 5문항이 된다. */
              var p2 = i + 2 < paras.length ? paras[i + 2] : null;
              var t2 = p2 ? txt(p2) : '';
              var t1 = p2 && !p2.listed && !numbered(t2) && !/_{2,}/.test(slotText(p2)) ? txtRaw(p2) : '';
              var built = parseBuildItem(s1, t1);
              qs.push({
                id: codeSlug + '-W1-q' + pad2(qs.length + 1),
                kind: 'build', no: no++,
                context: line, slots: built.slots, tiles: built.tiles
              });
              i += t1 ? 3 : 2; continue;
            }
          }
          i++;
        }
        modules.push({
          id: 'W1', label: 'Build a Sentence',
          blocks: [{ kind: 'build-set', heading: rng ? 'Questions ' + rng.from + '-' + rng.to : head, instruction: instruction, questions: qs }]
        });
        continue;
      }

      if (EMAIL_HEAD.test(t)) {
        var em = { id: codeSlug + '-W2-email', kind: 'email', no: no++,
          to: emailLead.to, subject: emailLead.subject,
          situationLabel: emailLead.situationLabel, situation: emailLead.situation,
          bulletsLabel: 'YOUR EMAIL SHOULD', bullets: emailLead.bullets.slice(), minWords: 80 };
        i++;
        var mode = '';
        while (i < paras.length && !DISC_HEAD.test(txt(paras[i]))) {
          var l = txt(paras[i]);
          if (/^to:/i.test(l)) { if (!em.to) em.to = l.replace(/^to:\s*/i, ''); mode = ''; }
          else if (/^subject:/i.test(l)) { if (!em.subject) em.subject = l.replace(/^subject:\s*/i, ''); mode = ''; }
          else if (/^situation/i.test(l)) { em.situationLabel = l; mode = 'sit'; }
          else if (/^your email should/i.test(l)) { em.bulletsLabel = l; mode = 'req'; }
          else if (l) {
            if (mode === 'sit' && !em.situation) em.situation = l;
            else if (mode === 'req') {
              l = l.replace(/^\d+\s*[.)]\s*/, '');
              if (em.bullets.indexOf(l) < 0) em.bullets.push(l);
            }
          }
          i++;
        }
        em.prompt = [em.situation].concat(em.bullets).filter(function (x) { return x; }).join(' ');
        modules.push({ id: 'W2', label: 'Write an Email', blocks: [{ kind: 'free-write', heading: t, questions: [em] }] });
        continue;
      }

      if (DISC_HEAD.test(t)) {
        var dc = { id: codeSlug + '-W3-disc', kind: 'discussion', no: no++, professor: '', prompt: '',
          posts: [], minWords: 100 };
        i++;
        var cur = null, seen = {};
        while (i < paras.length) {
          var d = txt(paras[i]);
          if (d) {
            if (!dc.professor && /[–—-]/.test(d) && d.length < 70) dc.professor = d;
            else if (!dc.prompt && d.length > 80) dc.prompt = d;
            else if (/^&\s*\S+/.test(d) || (d.length < 30 && !/[.?!]$/.test(d))) {
              if (cur && cur.text && !seen[cur.name + '|' + cur.text]) {
                seen[cur.name + '|' + cur.text] = 1; dc.posts.push(cur);
              }
              cur = { name: d.replace(/^&\s*/, '').trim(), text: '' };
            } else if (cur) {
              /* 장문이 여러 줄로 나눠도 다음 문단의 전이 아니다.
                 다음 화자 이름이 나올 때까지 글을 누적한다. */
              cur.text += (cur.text ? ' ' : '') + d;
            }
          }
          i++;
        }
        if (cur && cur.text && !seen[cur.name + '|' + cur.text]) dc.posts.push(cur);
        modules.push({ id: 'W3', label: 'Write for an Academic Discussion', blocks: [{ kind: 'free-write', heading: t, questions: [dc] }] });
        continue;
      }
      i++;
    }
    return modules;
  }

  /* ------------------------------------------------------ 스피킹 파서 */

  var TASK_HEAD = /^task\s+(\d+)/i;

  /**
   * 스피킹은 문항 문서에 문항 텍스트가 없다 — 그림과 Task 머리글뿐이고, 실제로 몇 문항인지는
   * 대본이 정한다(Task 1 은 따라 읽을 문장 7개, Task 2 는 면접 질문 4개). 그래서 개수의
   * 근거를 대본에 두고, 그림은 있는 만큼만 붙인다.
   * @param {Array} scriptGroups parseScript(...).speaking — Task 순서대로
   */
  function parseSpeaking(paras, codeSlug, picsRel, audioRel, startNo, scriptGroups) {
    var modules = [], i = 0, no = startNo, taskIndex = 0;
    scriptGroups = scriptGroups || [];

    while (i < paras.length) {
      var m = TASK_HEAD.exec(txt(paras[i]));
      if (!m) { i++; continue; }
      var taskNo = +m[1];
      var label = '', images = [], prompts = [];
      i++;
      while (i < paras.length && !TASK_HEAD.test(txt(paras[i]))) {
        var p = paras[i], t = txt(p);
        if (t && !label) label = t;
        else if (t) prompts.push(t);
        if (p.images && p.images.length) images = images.concat(p.images);
        i++;
      }

      var group = scriptGroups[taskIndex++] || null;
      var lines = group ? group.lines : [];
      var isRepeat = /repeat/i.test(label) || /repeat/i.test((group && group.label) || '');
      var kind = isRepeat ? 'repeat' : 'interview';
      var count = lines.length || images.length;

      var qs = [];
      for (var k = 0; k < count; k++) {
        var q = {
          id: codeSlug + '-S' + taskNo + '-q' + pad2(k + 1),
          kind: kind, no: no + k,
          audio: audioRel + 's' + taskNo + '-q' + (k + 1) + '.mp3',
          prepSec: 3, respondSec: isRepeat ? 20 : 45
        };
        if (lines[k]) q.script = lines[k];
        /* 그림이 문항 수만큼 있으면 하나씩, 하나뿐이면 전 문항이 함께 쓴다. */
        if (images.length === count) q.image = images[k];
        else if (images.length === 1) q.image = images[0];
        qs.push(q);
      }
      no += qs.length;

      /* 각 Task 는 문항 앞에 안내 음성이 하나 붙는다 — 컴파일러는 introAudio 가 있어야
         안내 화면을 만든다(set9.js S1/S2 와 같은 모양). 안내문은 대본의 'Instructions:' 줄. */
      var intro = (group && group.cue) || prompts[0] || '';
      var blk = {
        kind: 'record-set',
        heading: 'Task ' + taskNo,
        instruction: intro || label,
        introAudio: audioRel + 's' + taskNo + '-instructions.mp3',
        perQuestionAudio: true,
        questions: qs
      };
      if (intro) blk.introScript = intro;

      modules.push({
        id: 'S' + taskNo,
        label: 'Task ' + taskNo + ' · ' + (label || (isRepeat ? 'Listen and Repeat' : 'Interview')),
        blocks: [blk]
      });
    }
    return modules;
  }

  /* ------------------------------------------------------ 정답지 파서 */

  /**
   * 정답지는 섹션/모듈 머리글 + 자동번호 목록이다. 번호가 본문에 없으므로 순서가 번호다.
   * 목록이 이어지는 도중에 'Writing' 같은 섹션 이름이 목록 항목으로 들어오는 경우가 있어
   * (SET 9 LISTENING MODULE 2), 목록 항목도 머리글 후보로 본다.
   * @return {{ reading:{1:[…],2:[…]}, listening:{…}, writing:[…], speaking:[…] }}
   */
  function parseAnswerKey(paras) {
    var out = { reading: {}, listening: {}, writing: {}, speaking: {} };
    var section = null, moduleNo = 1;

    function bucket() {
      if (!section) return null;
      if (!out[section][moduleNo]) out[section][moduleNo] = [];
      return out[section][moduleNo];
    }

    paras.forEach(function (p) {
      var t = txt(p);
      if (!t) return;

      for (var k = 0; k < SECTION_HEAD.length; k++) {
        if (SECTION_HEAD[k].re.test(t)) { section = SECTION_HEAD[k].id; moduleNo = 1; return; }
      }
      var mm = /^module\s+(\d+)\s*$/i.exec(t);
      if (mm) { moduleNo = +mm[1]; return; }
      if (/^answer key/i.test(t)) return;

      var b = bucket();
      if (b) b.push(answerValue(t));
    });

    return out;
  }

  /* -------------------------------------------------------- 대본 파서 */

  /**
   * 대본은 'Questions a-b' 아래에 대사 줄이 이어진다. 다만 문항 문서와 구간이 1:1 이 아니다 —
   * SET 9 리스닝 Module 2 는 문항 문서가 1-3 / 4-5 / 6-7 … 로 쪼개 놓은 것을 대본에서는
   * 'Questions 1-15' 한 덩어리로 싣는다. 그래서 정확히 같은 키를 찾지 않고 **구간이 겹치는지**
   * 로 잇는다. 스피킹 Task 1 처럼 머리글 없이 시작하는 덩어리도 버리지 않는다.
   *
   * @return {{ listening:Array<Group>, speaking:Array<Group> }}
   *         Group = {module, from, to, cue, lines[], text}
   */
  function parseScript(paras) {
    var out = { listening: [], speaking: [] };
    var section = 'listening', moduleNo = 1, cur = null, pendingCue = '';

    function holdBack() {
      if (!cur.cue) cur.cue = pendingCue; else cur.lines.push(pendingCue);
      pendingCue = '';
    }

    function open(range) {
      cur = {
        module: moduleNo,
        from: range ? range.from : null,
        to: range ? range.to : null,
        cue: '', lines: []
      };
      out[section].push(cur);
    }

    paras.forEach(function (p) {
      var t = txt(p);
      if (!t) return;

      for (var k = 0; k < SECTION_HEAD.length; k++) {
        if (SECTION_HEAD[k].re.test(t)) {
          if (SECTION_HEAD[k].id === 'listening' || SECTION_HEAD[k].id === 'speaking') {
            section = SECTION_HEAD[k].id; moduleNo = 1; cur = null;
          }
          return;
        }
      }
      var mm = /^module\s+(\d+)\s*$/i.exec(t);
      if (mm) { moduleNo = +mm[1]; cur = null; return; }
      if (/^script$/i.test(t)) return;

      var r = questionRange(t);
      if (r) {
        open(r);
        if (pendingCue) { cur.cue = pendingCue; pendingCue = ''; }
        return;
      }

      if (!cur) open(null);
      /* 머리글이 오지 않았다 — 붙들어 둔 안내 줄은 예전처럼 앞 덩어리에 둔다. */
      if (pendingCue) { holdBack(); }
      /* 대사가 이미 찬 덩어리 뒤에 오는 안내 줄('Listen to a conversation.')은 다음 머리글의
         것이다 — SET 2 대본은 안내를 머리글 앞에 적는다. 앞 덩어리에 붙이면 문항 낭독(1-12)이
         대사로 오해돼 문항마다 음성이 만들어지지 않는다(SET 2 에서 그랬다). */
      if (section === 'listening' && cur.lines.length && LISTEN_CUE.test(t)) { pendingCue = t; return; }
      if (!cur.cue && LISTEN_CUE.test(t)) { cur.cue = t; return; }

      /* 'Interview' 같은 한 낱말 머리글은 대사가 아니다. 스피킹에서는 그 줄이 곧 다음
         Task 의 시작이기도 하다 — SET 10 대본은 Task 2 앞에 'Questions a-b' 머리글이
         없고 'Interview' 한 줄뿐이라, 여기서 끊지 않으면 두 Task 가 한 덩어리가 된다. */
      var isLabel = t.length < 20 && !/[.?!:]$/.test(t);
      if (isLabel && section === 'speaking' && cur.lines.length) { open(null); }
      if (isLabel && !cur.lines.length) { cur.label = t; return; }

      /* 딱지 바로 뒤의 첫 줄은 들려줄 대사가 아니라 안내문이다(SET 9 는 'Instructions:' 로
         적었고, SET 10 은 아무 표시 없이 적는다). */
      if (section === 'speaking' && cur.label && !cur.cue && !cur.lines.length) { cur.cue = t; return; }

      /* 대본에 번호가 찍힌 세트가 있다 — 음성이 '일, 감사합니다' 로 읽히지 않게 뗀다. */
      if (section === 'speaking') t = t.replace(/^\d{1,2}\s*[.)]\s*/, '');
      cur.lines.push(t);
    });
    if (pendingCue && cur) holdBack();

    ['listening', 'speaking'].forEach(function (sec) {
      out[sec] = out[sec].filter(function (g) { return g.lines.length; });
      out[sec].forEach(function (g) { g.text = g.lines.join('\n'); });
    });
    return out;
  }

  /* ------------------------------------------------------------ 조립 */

  function build(input) {
    var gates = [];
    function gate(level, scope, message) { gates.push({ level: level, scope: scope, message: message }); }
    var strictSource = !!input.strictSource;

    var code = String(input.code || 'SET ?').trim();
    var codeSlug = slug(code) || 'set';
    var audioRel = 'media/audio/' + codeSlug + '/';
    var picsRel = 'media/pictures/' + codeSlug + '/';

    if (!input.questions || !input.questions.paragraphs) {
      gate('stop', 'upload', 'Could not read the question document.');
      return { pack: null, gates: gates, stats: {} };
    }
    if (strictSource && (!input.script || !input.script.paragraphs)) {
      gate('stop', 'upload', 'Strict source mode requires the source script document. Nothing may be inferred or filled later.');
    }
    if (strictSource && (!input.answers || !input.answers.paragraphs)) {
      gate('stop', 'upload', 'Strict source mode requires the source answer key. Nothing may be inferred or solved later.');
    }

    var qParas = explodeLines(input.questions.paragraphs);
    var split = splitSections(qParas);

    /* ---- reading / listening ---- */
    var reading = { id: 'reading', label: 'Reading', labelKo: '리딩', timeLimitSec: 2100, modules: [] };
    var rMismatch = [];
    splitModules(split.reading).forEach(function (mod, k) {
      var no = mod.no || (k + 1);
      var id = 'R' + no;
      reading.modules.push({ id: id, label: 'Reading Module ' + no, blocks: parseReadingModule(mod, id, rMismatch) });
    });
    if (rMismatch.length) {
      gate('warn', 'reading', 'The numbers printed on these questions disagree with their "Questions a-b" heading — the numbering that keeps the module in order was used: ' + rMismatch.join(', '));
    }

    var listening = { id: 'listening', label: 'Listening', labelKo: '리스닝', timeLimitSec: null, modules: [] };
    var outOfRange = [];
    splitModules(split.listening).forEach(function (mod, k) {
      var no = mod.no || (k + 1);
      var id = 'L' + no;
      listening.modules.push({ id: id, label: 'Listening Module ' + no, blocks: parseListeningModule(mod, id, outOfRange) });
    });
    /* Speaker illustrations can live outside the source DOCX. Accept a verified,
       explicit voice-casting map so exam and review render the same image. */
    var listeningImages = input.listeningImages || {};
    listening.modules.forEach(function (mod) {
      mod.blocks.forEach(function (blk) {
        var first = blk.questions && blk.questions[0];
        if (blk.perQuestionAudio) {
          (blk.questions || []).forEach(function (q) {
            if (listeningImages.questions && listeningImages.questions[q.id]) q.image = listeningImages.questions[q.id];
          });
        } else if (first && listeningImages.blocks && listeningImages.blocks[first.id]) {
          blk.image = listeningImages.blocks[first.id];
        }
      });
    });
    if (outOfRange.length) {
      gate('warn', 'listening', 'The numbers printed on these questions disagree with their "Questions a-b" heading — the numbering that keeps the module in order was used: ' + outOfRange.join(', '));
    }

    /* ---- writing / speaking ---- */
    var wModules = parseWriting(split.writing, codeSlug, 11);
    /* 학술 토론(W3)의 얼굴 사진 — 듣기 사진과 같은 이유로 원본 문서 밖에 산다.
       { professor: '...', posts: { 'Brandon': '...' } } 를 받아 이름으로 붙인다. */
    var discImages = input.discussionImages || {};
    wModules.forEach(function (mod) {
      if (mod.id !== 'W3') return;
      (mod.blocks || []).forEach(function (blk) {
        (blk.questions || []).forEach(function (q) {
          if (q.kind !== 'discussion') return;
          if (discImages.professor) q.professorImage = discImages.professor;
          (q.posts || []).forEach(function (post) {
            var src = discImages.posts && discImages.posts[post.name];
            if (src) post.image = src;
          });
        });
      });
    });
    var writing = { id: 'writing', label: 'Writing', labelKo: '라이팅', timeLimitSec: null, modules: wModules };

    var scripts = input.script && input.script.paragraphs
      ? parseScript(explodeLines(input.script.paragraphs)) : { listening: [], speaking: [] };

    var sModules = parseSpeaking(split.speaking, codeSlug, picsRel, audioRel, 1, scripts.speaking);
    var speaking = { id: 'speaking', label: 'Speaking', labelKo: '스피킹', timeLimitSec: null, modules: sModules };

    var sections = [reading, listening, writing, speaking];

    sections.forEach(function (sec) {
      if (!sec.modules.length) gate('stop', sec.id, sec.label + ' section not found — check that the document has a "' + sec.label.toUpperCase() + ' SECTION" heading.');
    });

    /* ---- 대본 붙이기 ----
       대본 구간과 문항 구간이 1:1 이 아니다. 겹치는 구간을 찾고, 그 구간의 줄 수가
       문항 수와 같으면 문항마다 한 줄씩(짧은 응답), 아니면 블록 전체의 대사로 본다. */
    listening.modules.forEach(function (mod) {
      var modNo = +String(mod.id).replace(/\D/g, '') || 1;
      var groups = scripts.listening.filter(function (g) { return g.module === modNo; });

      mod.blocks.forEach(function (blk) {
        /* 머리글이 아니라 블록이 실제로 담고 있는 번호로 대본을 찾는다 — SET 10 리스닝
           Module 1 은 머리글 'Questions 15-16' 이 세 번 되풀이돼 있어, 머리글을 믿으면
           19-20·25-28 의 대본이 15-16 것으로 잘못 붙는다. */
        var qnos = blk.questions.map(function (x) { return x.no; });
        if (!qnos.length) return;
        var r = { from: Math.min.apply(null, qnos), to: Math.max.apply(null, qnos) };
        /* 파일명 규칙은 SET 9 에 이미 있는 것을 그대로 따른다(l1-q13-14.mp3, l1-q01.mp3) —
           tools/verify_audio.py 와 tts 매니페스트가 이 이름으로 서로를 찾는다.
           문항마다 음성이 따로 붙는 세트는 블록 음성이 없다(SET 9 도 없다). */
        if (!blk.perQuestionAudio) {
          /* 머리글이 아니라 실제로 들어 있는 문항 번호로 이름을 짓는다 — SET 9 의
             'Questions 8-10' 블록에는 11번까지 들어 있었고, 파일명이 내용과 어긋나면
             나중에 어느 음성이 어느 문항 것인지 아무도 알 수 없게 된다. */
          blk.audio = audioRel + mod.id.toLowerCase() + '-q' + pad2(r.from)
            + (r.to !== r.from ? '-' + pad2(r.to) : '') + '.mp3';
        }

        var hit = null;
        for (var k = 0; k < groups.length; k++) {
          var g = groups[k];
          if (g.from == null || (g.from <= r.to && g.to >= r.from)) { hit = g; break; }
        }
        if (!hit) {
          gate(strictSource ? 'stop' : 'warn', 'listening', mod.label + ' ' + (blk.heading || '') + ' — no script found in the source script document. Strict source mode will not create or infer it.');
          return;
        }
        if (hit.cue && !blk.instruction) blk.instruction = hit.cue;

        /* 대본 덩어리가 두 종류다 — 들려줄 **대사**(대화·강의)와, 문항을 하나씩 읽어 주는
           **문항 낭독**(짧은 응답 드릴). 셋을 차례로 본다.
             1) 'Listen to a conversation.' / 'Read an announcement' 안내가 앞에 붙어 있으면 대사다.
             2) 문두 없이 보기만 있는 블록(perQuestionAudio)은 문항 낭독이다.
             3) 남은 것은 줄 수로 가른다 — 덩어리가 덮는 문항 수와 줄 수가 똑같으면
                문항마다 한 줄씩이라는 뜻이고(SET 9 리스닝 Module 2 는 1-15 를 15줄로 싣는다),
                다르면 대사다. 줄 수만으로 가르면 4문항짜리 강의가 낭독으로 오해되므로
                (SET 9 l1-q25-28) 반드시 1·2 를 먼저 본다. */
        var span = (hit.to != null && hit.from != null) ? (hit.to - hit.from + 1) : blk.questions.length;
        var isTranscript = !!hit.cue || !blk.perQuestionAudio;
        blk.scriptOrigin = 'script-docx';

        if (isTranscript) {
          blk.script = hit.text;
          return;
        }

        /* 문항 낭독 — 줄과 문항을 번호로 맞춘다. */
        blk.questions.forEach(function (q) {
          var line = hit.lines[q.no - hit.from];
          /* 손으로 찍은 번호('9. Have you decided…')는 대사가 아니다 — 음성이 '나인' 으로
             읽지 않게 뗀다(SET 2 는 1-8 만 자동번호이고 9-12 는 번호를 글자로 적었다). */
          if (line) q.script = line.replace(/^\d{1,2}\s*[.)]\s*/, '');
        });
        if (blk.perQuestionAudio) {
          blk.questions.forEach(function (q) {
            q.audio = audioRel + mod.id.toLowerCase() + '-q' + pad2(q.no) + '.mp3';
          });
        } else {
          /* 문항 낭독만 있고 들려줄 대사가 없다 — 원본 문서에 그 대화·강의가 통째로
             빠져 있다는 뜻이다(SET 9 리스닝 Module 2 가 그랬다). 지어내지 않고 알린다. */
          delete blk.scriptOrigin;
          gate(strictSource ? 'stop' : 'warn', 'listening', mod.label + ' ' + (blk.heading || '')
            + ' — the questions are here, but the source script has no spoken lines for them. Strict source mode will not create or infer them.');
        }
      });
    });

    /* ---- 정답 붙이기 ---- */
    var answers = input.answers && input.answers.paragraphs ? parseAnswerKey(explodeLines(input.answers.paragraphs)) : null;
    var answerKey = {};
    var unmatched = [];

    if (!answers) {
      gate(strictSource ? 'stop' : 'warn', 'answers', 'No answer key was uploaded — strict source mode will not infer answers.');
    } else {
      [reading, listening].forEach(function (sec) {
        sec.modules.forEach(function (mod) {
          var modNo = +String(mod.id).replace(/\D/g, '') || 1;
          var list = (answers[sec.id] && answers[sec.id][modNo]) || [];
          var qs = [];
          mod.blocks.forEach(function (b) { qs = qs.concat(b.questions || []); });

          if (list.length && list.length !== qs.length) {
            gate('stop', sec.id,
              mod.label + ' — ' + qs.length + ' questions but ' + list.length + ' answers. The answer key and the question document are numbered differently.');
          }
          /* 정답지는 모듈 안에서 1번부터 순서대로다 — 배열 위치가 아니라 문항 번호로 잇는다.
             블록 순서가 문서 순서와 어긋나도 정답이 밀리지 않는다. */
          qs.forEach(function (q) {
            var v = list[q.no - 1];
            if (v === undefined) { unmatched.push(q.id); return; }
            if (q.kind === 'blank') {
              q.answer = typeof v === 'number' ? CHOICE_LETTERS[v] : v;
              /* 빈칸의 힌트 글자와 정답의 첫 글자가 다르면 정답지가 밀렸거나 잘못 적힌 것이다
                 (SET 9 R1-7 은 정답지에 'correct' 라고 적혀 있지만 힌트는 'th' 였다). */
              if (q.hint && String(q.answer).toLowerCase().indexOf(String(q.hint).toLowerCase()) !== 0) {
                q.answerKeyRaw = q.answer;
                gate('warn', sec.id, q.id + ' — hint "' + q.hint + '" does not match answer "' + q.answer + '". Check the answer key.');
              }
            } else if (typeof v === 'number') {
              q.answer = v;
            } else {
              /* 정답지가 보기 글자 대신 보기 본문을 적어 놓은 경우가 있다(SET 9 R2-11). */
              var idx = -1;
              (q.choices || []).forEach(function (c, ci) {
                if (String(c).trim().toLowerCase() === String(v).trim().toLowerCase()) idx = ci;
              });
              if (idx >= 0) q.answer = idx;
              else { q.answer = v; gate('warn', sec.id, q.id + ' — answer "' + v + '" could not be read as one of the choices.'); }
            }
            answerKey[q.id] = q.answer;
          });
          if (!list.length && qs.length) {
            gate('warn', sec.id, mod.label + ' — this module was not found in the answer key.');
          }
        });
      });

      /* 라이팅 문장 조립 정답 */
      var wList = [];
      Object.keys(answers.writing || {}).forEach(function (k) { wList = wList.concat(answers.writing[k]); });
      var buildQs = [];
      writing.modules.forEach(function (m) {
        m.blocks.forEach(function (b) {
          (b.questions || []).forEach(function (q) { if (q.kind === 'build') buildQs.push(q); });
        });
      });
      var derived = [], unaligned = [], endPunct = [];
      buildQs.forEach(function (q, k) {
        if (k < wList.length && typeof wList[k] === 'string') {
          q.answerSentence = wList[k];
          answerKey[q.id] = wList[k];
          if (deriveTiles(q)) derived.push(q.id);
          else if (!alignBuildAnswer(q)) {
            unaligned.push(q.id);
            unscore(q, 'The word tiles and blanks in the question document cannot build the answer-key sentence "' + wList[k] + '".');
            delete answerKey[q.id];
          }
          else if (q.endPunctNote) endPunct.push(q.id + ' — ' + q.endPunctNote);
        }
      });
      if (endPunct.length) {
        gate('warn', 'writing',
          endPunct.length + ' sentence-building questions end with a different punctuation mark in the two documents. '
            + 'The words all match, so the answer is scored — but the mark the student sees comes from the question document ('
            + endPunct.slice(0, 4).join('; ') + (endPunct.length > 4 ? '; and more' : '') + ').');
      }
      if (unaligned.length) {
        gate(strictSource ? 'stop' : 'warn', 'writing',
          unaligned.length + ' sentence-building questions do not cross-check: the word tiles in the question document cannot build the answer-key sentence, in that order ('
            + unaligned.slice(0, 8).join(', ') + (unaligned.length > 8 ? ' and more' : '')
            + '). They stay in the set but are not scored until the two documents match.');
      }
      if (derived.length) {
        gate(strictSource ? 'stop' : 'warn', 'writing', derived.length + ' sentence-building questions had no word tiles in the docx — the words were taken from the answer key and scrambled (' + derived.slice(0, 3).join(', ') + (derived.length > 3 ? ' and more' : '') + '). ' +
          (strictSource ? 'Strict source mode does not allow this derived tile set.' : 'Add a tile line, with decoys, if you want traps.'));
      }
      if (buildQs.length && wList.length && buildQs.length > wList.length) {
        gate('warn', 'writing', 'Only ' + wList.length + ' of ' + buildQs.length + ' sentence-building questions have an answer.');
      }
    }

    if (unmatched.length) {
      gate(strictSource ? 'stop' : 'warn', 'answers', unmatched.length + ' questions have no answer attached in the source answer key: ' + unmatched.slice(0, 8).join(', ') + (unmatched.length > 8 ? ' and more' : ''));
    }

    /* ---- 정답지 ↔ 문제지 크로스체크 ----
       정답을 붙이는 것과, 붙은 정답이 문제지의 그 문항에 실제로 성립하는지는 다른 일이다.
       정답지가 한 줄 밀리거나 보기 개수가 다르면 여기서만 드러난다. 세트 하나에 대해
       "문항마다 정답이 하나, 그 정답이 그 문항의 보기 안에 있다" 를 전수로 확인한다. */
    var crossBad = crossCheckAnswers([reading, listening], unmatched);
    /* 걸린 문항은 세트에 두되 점수에서 뺀다 — 밀린 정답지로 채점하면 맞힌 학생이 틀린다. */
    var byId = {};
    [reading, listening].forEach(function (sec) {
      sec.modules.forEach(function (m) {
        m.blocks.forEach(function (b) { (b.questions || []).forEach(function (q) { byId[q.id] = q; }); });
      });
    });
    crossBad.forEach(function (line) {
      var q = byId[String(line).split(' ')[0]];
      if (!q) return;
      if (q.answer !== undefined) q.answerKeyRaw = q.answer;
      delete q.answer;
      delete answerKey[q.id];
      unscore(q, 'The answer key does not fit this question ' + String(line).slice(q.id.length + 1) + '.');
    });
    unmatched.forEach(function (id) {
      if (byId[id]) unscore(byId[id], 'The answer key has no answer for this question.');
    });
    if (crossBad.length) {
      gate(strictSource ? 'stop' : 'warn', 'answers',
        crossBad.length + ' questions do not cross-check against the answer key: '
          + crossBad.slice(0, 8).join(', ') + (crossBad.length > 8 ? ' and more' : ''));
    }

    /* 원본 대조 — 표식(origin)이 아니라 결과물의 문장을 원본과 맞대 본다.
       origin 표식은 파서가 스스로 신고한 것이라, 신고 없이 문장이 달라지는 길은
       여기서만 걸린다. strict source mode 에서는 한 문장만 어긋나도 저장이 막힌다. */
    var gaps = verbatimGaps(sections, input);
    if (gaps.length) {
      gate(strictSource ? 'stop' : 'warn', 'source',
        gaps.length + ' sentences are not in the source documents word for word — the pack must quote the docx exactly: '
          + gaps.slice(0, 5).map(function (g) { return g.where + ' "' + g.text.slice(0, 80) + '"'; }).join(' · ')
          + (gaps.length > 5 ? ' and ' + (gaps.length - 5) + ' more' : ''));
    }

    if (strictSource) {
      sections.forEach(function (sec) {
        sec.modules.forEach(function (mod) {
          mod.blocks.forEach(function (blk) {
            if (blk.headingOrigin === 'generated') {
              gate('stop', sec.id, mod.label + ' — a missing heading was generated. Strict source mode requires the heading to exist in the question document.');
            }
            if (blk.headingOrigin === 'corrected-from-source') {
              gate('stop', sec.id, mod.label + ' ' + (blk.heading || '') + ' — a source heading was corrected. Strict source mode does not allow changing source wording.');
            }
            (blk.questions || []).forEach(function (q) {
              if (q.choicesOrigin === 'generated') {
                gate('stop', sec.id, q.id + ' — choices were generated because the source document did not list them. Strict source mode requires source choices.');
              }
              if (q.tilesOrigin === 'derived-from-answer') {
                gate('stop', sec.id, q.id + ' — word tiles were derived from the answer key. Strict source mode requires tiles in the question document.');
              }
              if (q.scriptOrigin === 'ai' || q.answerOrigin === 'ai') {
                gate('stop', sec.id, q.id + ' — AI-filled content is not allowed in strict source mode.');
              }
            });
          });
        });
      });
    }

    return finalize(sections, {
      code: code,
      codeSlug: codeSlug,
      gates: gates,
      answerKey: answerKey,
      sources: input.sources || null,
      mediaCount: input.questions.media ? Object.keys(input.questions.media).length : 0,
      source: 'set-import'
    });
  }

  /* ------------------------------------------------------------ 마무리
   *
   * 조립의 뒷부분 — 정답표 수확 · 검산 · 그림 경로 · 통계 · 요약 · 팩 모양 — 을 따로
   * 뗀 것은 **문서에서 온 세트와 AI 가 지은 세트가 같은 팩이어야 하기 때문**이다.
   * 두 벌로 두면 한쪽에만 검산이 붙는 날이 오고, 그때 두 세트는 겉보기에만 같아진다.
   * 앞부분(무엇을 읽어 문항을 만드나)만 서로 다르다.
   *
   *   finalize(sections, { code, codeSlug, gates, answerKey?, sources?, mediaCount?, source })
   *     -> { pack, gates, stats }
   *
   * answerKey 를 넘기지 않아도 된다 — 문항에 이미 붙어 있는 answer 를 여기서 걷는다.
   */
  function finalize(sections, opt) {
    var code = String(opt.code || 'SET ?').trim();
    var codeSlug = opt.codeSlug || slug(code) || 'set';
    var audioRel = 'media/audio/' + codeSlug + '/';
    var picsRel = 'media/pictures/' + codeSlug + '/';
    var gates = opt.gates || [];
    function gate(level, scope, message) { gates.push({ level: level, scope: scope, message: message }); }

    /* ---- 정답표 수확 ----
       문서 경로는 정답지를 붙이며 이미 채워 두었고, AI 경로는 문항에 정답이 처음부터
       박혀 있다. 어느 쪽이든 "문항에 붙어 있는 것"이 정답표의 유일한 출처다 —
       팩과 정답표가 어긋나는 길을 아예 막는다. */
    var answerKey = opt.answerKey || {};
    sections.forEach(function (sec) {
      sec.modules.forEach(function (mod) {
        mod.blocks.forEach(function (blk) {
          (blk.questions || []).forEach(function (q) {
            if (answerKey[q.id] !== undefined || q.unscored) return;   /* 점수에서 뺀 문항은 정답표에도 없다 */
            if (q.answer !== undefined && q.answer !== null && q.answer !== '') answerKey[q.id] = q.answer;
            else if (q.answerSentence) answerKey[q.id] = q.answerSentence;
          });
        });
      });
    });

    /* ---- 선택지 개수 검산 ---- */
    var thin = [];
    sections.forEach(function (sec) {
      sec.modules.forEach(function (mod) {
        mod.blocks.forEach(function (blk) {
          (blk.questions || []).forEach(function (q) {
            if (q.kind === 'mcq' && !/^click on the sentence/i.test(q.prompt || '')
                && (!q.choices || q.choices.length < 3)) thin.push(q.id);
          });
        });
      });
    });
    if (thin.length) gate('warn', 'choices', thin.length + ' questions have fewer than 3 choices: ' + thin.slice(0, 8).join(', ') + (thin.length > 8 ? ' and more' : ''));

    var emptyInsertSentences = [];
    sections.forEach(function (sec) {
      sec.modules.forEach(function (mod) {
        mod.blocks.forEach(function (blk) {
          (blk.questions || []).forEach(function (q) {
            if (q.kind === 'insert' && !String(q.sentence || '').trim()) emptyInsertSentences.push(q.id);
          });
        });
      });
    });
    if (emptyInsertSentences.length) gate('stop', 'reading-content',
      'Sentence-insertion questions have no sentence to insert: ' + emptyInsertSentences.join(', '));

    /* ---- 리딩 본문 존재 검산 ----
       문항과 선택지만 있으면 시험 화면 오른쪽은 정상처럼 보여도 왼쪽 지문이 빈다.
       passage는 텍스트 또는 이미지, chat은 메시지가 반드시 있어야 한다. */
    var emptyReading = [];
    sections.forEach(function (sec) {
      if (sec.id !== 'reading') return;
      sec.modules.forEach(function (mod) {
        mod.blocks.forEach(function (blk) {
          var hasQuestions = !!(blk.questions && blk.questions.length);
          var hasPassage = !!(blk.passage || (blk.paragraphs && blk.paragraphs.length)
            || (blk.images && blk.images.length));
          var hasChat = !!(blk.messages && blk.messages.length);
          if (hasQuestions && ((blk.kind === 'passage' && !hasPassage)
            || (blk.kind === 'chat' && !hasChat))) {
            emptyReading.push(mod.id + ' ' + (blk.heading || blk.questions[0].id));
          }
        });
      });
    });
    if (emptyReading.length) gate('stop', 'reading-content',
      'Reading blocks have questions but no passage, image, or messages: ' + emptyReading.join(', '));

    /* ---- 그림 경로 정규화 ----
       파서마다 그림을 다른 모양으로 모은다(문서 내부 이름 'media/image7.png' 또는 파일명만).
       화면이 찾을 수 있는 경로는 하나뿐이므로 여기서 한 번에 맞춘다. */
    var picFiles = {};
    function normalizedPic(ref) {
      var s = String(ref || '');
      var name = picName(s);
      picFiles[name] = 1;
      return /^media\/pictures\//.test(s) ? s : picsRel + name;
    }
    sections.forEach(function (sec) {
      sec.modules.forEach(function (mod) {
        mod.blocks.forEach(function (blk) {
          if (blk.images) {
            blk.images = blk.images.map(function (ref) {
              return normalizedPic(ref);
            });
          }
          if (blk.image) blk.image = normalizedPic(blk.image);
          (blk.questions || []).forEach(function (q) {
            if (!q.image) return;
            q.image = normalizedPic(q.image);
          });
        });
      });
    });

    /* ---- 통계 ---- */
    var stats = { total: 0, bySection: {} };
    sections.forEach(function (sec) {
      var n = 0;
      sec.modules.forEach(function (mod) {
        mod.blocks.forEach(function (b) { n += (b.questions || []).length; });
      });
      stats.bySection[sec.id] = n;
      stats.total += n;
    });
    stats.answered = Object.keys(answerKey).length;
    stats.media = opt.mediaCount || 0;

    if (!stats.total) gate('stop', 'questions', 'No questions were found — the document formatting is not what the parser expects.');

    /* ---- 세트 특징 ----
       관리자 화면이 세트를 한눈에 설명할 수 있도록, 팩을 다시 훑지 않아도 되는 요약을
       팩 안에 넣어 둔다. 저장된 세트 목록은 이 값만 읽는다. */
    var clips = [], withScript = 0, scriptChars = 0;
    sections.forEach(function (sec) {
      sec.modules.forEach(function (mod) {
        mod.blocks.forEach(function (blk) {
          function note(path, script) {
            if (!path) return;
            clips.push(path);
            if (script) { withScript++; scriptChars += String(script).length; }
          }
          note(blk.introAudio, blk.introScript);
          note(blk.audio, blk.script);
          (blk.questions || []).forEach(function (q) { note(q.audio, q.script); });
        });
      });
    });

    var summary = {
      questions: stats.total,
      bySection: stats.bySection,
      autoScored: stats.answered,
      humanScored: stats.total - stats.answered,
      pictures: Object.keys(picFiles).length,
      audioClips: clips.length,
      audioWithScript: withScript,
      scriptChars: scriptChars,
      modules: sections.map(function (s) {
        return { id: s.id, label: s.label, modules: s.modules.length, questions: stats.bySection[s.id] || 0 };
      }),
      gates: {
        stop: gates.filter(function (g) { return g.level === 'stop'; }).length,
        warn: gates.filter(function (g) { return g.level === 'warn'; }).length
      },
      sources: opt.sources || null
    };
    if (opt.origin) summary.origin = opt.origin;

    /* ---- 리포트 ----
       세트는 부족해도 짓는다(2026-09-15). 막는 대신, 안 된 것을 한자리에 모아 팩과 함께
       보낸다 — problem(=stop 급) · check(=warn) · 점수에서 뺀 문항. */
    var unscored = [];
    sections.forEach(function (sec) {
      sec.modules.forEach(function (mod) {
        mod.blocks.forEach(function (blk) {
          (blk.questions || []).forEach(function (q) {
            if (q.unscored) unscored.push({ id: q.id, reason: q.unscoredReason || '' });
          });
        });
      });
    });
    summary.unscored = unscored.length;
    var report = {
      problems: gates.filter(function (g) { return g.level === 'stop'; }).map(function (g) { return g.scope + ': ' + g.message; }),
      checks: gates.filter(function (g) { return g.level === 'warn'; }).map(function (g) { return g.scope + ': ' + g.message; }),
      unscored: unscored
    };

    var pack = {
      code: codeSlug.toUpperCase(),
      title: code,
      paths: { audio: audioRel, pics: picsRel },
      sections: sections,
      answerKey: answerKey,
      buildWarnings: gates.map(function (g) { return g.level + ': ' + g.message; }),
      gates: gates,
      summary: summary,
      report: report,
      importedAt: null,
      source: opt.source || 'set-import'
    };

    return { pack: pack, gates: gates, stats: stats };
  }

  /* ------------------------------------------ 팩 → 실행 가능한 전역 */

  /** exam-shell 이 기대하는 helper 를 붙인다(set9.js 와 같은 시그니처). */
  function withHelpers(pack) {
    pack.allQuestions = function () {
      var out = [];
      this.sections.forEach(function (sec) {
        sec.modules.forEach(function (mod) {
          mod.blocks.forEach(function (blk) {
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

  /* ------------------------------------------ 원본 대조 (첫 관문의 마지막 그물)
   *
   * headingOrigin·choicesOrigin 같은 표식은 **파서가 스스로 신고한 것**이다. 신고하지
   * 않고 문장을 다듬는 길(줄을 잇다 한 낱말이 빠지거나, 손으로 고친 팩을 다시 커밋하거나)
   * 은 그 표식으로 잡히지 않는다. 그래서 결과물 쪽에서 한 번 더 본다 —
   * **팩에 적힌 모든 문장이 원본 문서에 그대로 있는가.**
   *
   * 문장 단위로 보는 이유: 팩은 원본의 여러 문단을 한 필드로 잇는다(W2 이메일의 상황문 +
   * 요구사항, 표의 칸). 통째로 찾으면 이어 붙였다는 이유만으로 전부 걸린다. 문장 하나가
   * 원본에 그대로 있는지만 보면, 순서를 바꿔 잇는 것은 지나가고 낱말을 고치는 것은 걸린다.
   */

  /** 원본과 팩을 같은 잣대로 눕힌다 — 따옴표·대시·공백·표 구분자·대소문자만 지운다. */
  function flattenText(t) {
    return String(t == null ? '' : t)
      .replace(/[‘’ʼ]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[–—]/g, '-')
      .replace(/…/g, '...')
      .replace(/[ ​]/g, ' ')
      .replace(/\|/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  /** 문장으로 자른다. lookbehind 없이 — ES5 규칙을 지킨다. */
  function splitSentences(t) {
    var out = [];
    var buf = '';
    String(t == null ? '' : t).split(/(\s+)/).forEach(function (piece) {
      if (/^\s+$/.test(piece)) {
        if (/[.!?][)"'”’]?$/.test(buf)) { out.push(buf); buf = ''; }
        else buf += ' ';
        return;
      }
      buf += piece;
    });
    if (buf) out.push(buf);
    return out;
  }

  /** 원본 문서 셋의 모든 문단을 한 줄로 눕힌 건초더미. */
  function sourceHaystack(input) {
    var parts = [];
    ['questions', 'script', 'answers'].forEach(function (k) {
      var doc = input && input[k];
      ((doc && doc.paragraphs) || []).forEach(function (p) {
        parts.push(typeof p === 'string' ? p : (p && p.text) || '');
      });
    });
    return flattenText(parts.join(' '));
  }

  /* 원본 문서에 없는 것이 정상인 화면 문구 — 여기서 짓는 것이라 여기에만 적는다.
     이 목록이 길어지면 그만큼 "원본 그대로"가 아닌 것이니, 늘리기 전에 다시 생각한다. */
  var GENERATED_UI_TEXT = ['Fill in the blank.', SHORT_RESPONSE_PROMPT];

  /* 원본에서 온 글이 담기는 자리. 여기 없는 필드는 검사하지 않으므로,
     새 필드를 만들면 여기에도 적는다(tests/test_verbatim_gate.js 가 고정한다). */
  var VERBATIM_BLOCK_FIELDS = ['heading', 'title', 'instruction', 'template', 'script', 'introScript'];
  var VERBATIM_Q_FIELDS = ['prompt', 'context', 'sentence', 'answerSentence', 'situation', 'subject',
    'to', 'professor', 'script', 'hint'];
  var VERBATIM_Q_LISTS = ['choices', 'tiles', 'trapTiles', 'bullets'];

  /**
   * 팩의 문장 중 원본 문서에 그대로 있지 않은 것을 모은다.
   * @param {Array} sections
   * @param {Object} input  build 가 받은 것과 같은 { questions, script, answers }
   * @return {Array<{where:string, text:string}>}
   */
  function verbatimGaps(sections, input) {
    var hay = sourceHaystack(input);
    var gaps = [];
    var allowed = GENERATED_UI_TEXT.map(flattenText);
    function look(where, val) {
      if (val == null || typeof val === 'object') return;
      /* {{1}} · {{B}} 는 빈칸/삽입 자리 표시라 원본에 없다 — 사이의 글만 본다. */
      String(val).split(/\{\{[^}]*\}\}/).forEach(function (part) {
        splitSentences(part).forEach(function (sent) {
          var n = flattenText(sent);
          if (n.length < 4) return;              /* 'a' · 'so' 같은 힌트 조각 */
          if (allowed.indexOf(n) >= 0) return;
          if (hay.indexOf(n) < 0) gaps.push({ where: where, text: sent.trim() });
        });
      });
    }
    function lookList(where, list) {
      (list || []).forEach(function (v, i) { look(where + '[' + (i + 1) + ']', v); });
    }
    (sections || []).forEach(function (sec) {
      (sec.modules || []).forEach(function (mod) {
        (mod.blocks || []).forEach(function (blk) {
          VERBATIM_BLOCK_FIELDS.forEach(function (k) { look(mod.id + ' ' + k, blk[k]); });
          lookList(mod.id + ' passage', blk.paragraphs);
          (blk.questions || []).forEach(function (q) {
            VERBATIM_Q_FIELDS.forEach(function (k) { look(q.id + ' ' + k, q[k]); });
            VERBATIM_Q_LISTS.forEach(function (k) { lookList(q.id + ' ' + k, q[k]); });
            (q.posts || []).forEach(function (p, i) {
              look(q.id + ' post' + (i + 1), p && p.name);
              look(q.id + ' post' + (i + 1), p && p.text);
            });
          });
        });
      });
    });
    return gaps;
  }

  /**
   * 정답지 ↔ 문제지 크로스체크. 정답을 붙이는 것과, 붙은 정답이 그 문항에서 성립하는지는
   * 다른 일이다 — 정답지가 한 줄 밀리거나 보기 개수가 다르면 여기서만 드러난다.
   * "문항마다 정답이 하나, 그 정답이 그 문항의 보기 안에 있다" 를 전수로 확인한다.
   * @param {Array} sections  reading·listening 처럼 modules 를 가진 섹션들
   * @param {string[]} [skip] 이미 다른 gate 로 올린 문항 id (정답 없음 등)
   * @return {string[]} 사람이 읽을 수 있는 어긋남 목록
   */
  function crossCheckAnswers(sections, skip) {
    var bad = [];
    skip = skip || [];
    (sections || []).forEach(function (sec) {
      (sec.modules || []).forEach(function (mod) {
        (mod.blocks || []).forEach(function (blk) {
          (blk.questions || []).forEach(function (q) {
            if (skip.indexOf(q.id) >= 0) return;
            var a = q.answer;
            if (q.kind === 'blank') {
              if (typeof a !== 'string' || !a.trim()) bad.push(q.id + ' (the blank has no answer)');
              return;
            }
            /* "Click on the sentence …" 은 보기 목록이 아니라 지문 문장을 고르는 문항이라
               보기가 없는 것이 정상이다(finalize 의 빈 보기 판정과 같은 규칙). */
            if (/^click on the sentence/i.test(q.prompt || '')) {
              if (a === undefined || a === null || a === '') bad.push(q.id + ' (the answer is empty)');
              return;
            }
            var n = (q.choices || []).length;
            if (!n) { bad.push(q.id + ' (no choices)'); return; }
            if (typeof a !== 'number') { bad.push(q.id + ' (answer "' + a + '" matches none of the choices)'); return; }
            if (a < 0 || a >= n) bad.push(q.id + ' (answer is choice ' + (a + 1) + ' but there are only ' + n + ' choices)');
          });
        });
      });
    });
    return bad;
  }

  return {
    build: build,
    finalize: finalize,       /* set-generate.js 가 같은 조립·검산을 타려고 부른다 */
    crossCheckAnswers: crossCheckAnswers,
    verbatimGaps: verbatimGaps,
    withHelpers: withHelpers,
    SECTION_ORDER: SECTION_ORDER,
    /* 테스트용 */
    _splitSections: splitSections,
    _splitModules: splitModules,
    _parseAnswerKey: parseAnswerKey,
    _parseScript: parseScript,
    _parseCloze: parseCloze
  };
});
