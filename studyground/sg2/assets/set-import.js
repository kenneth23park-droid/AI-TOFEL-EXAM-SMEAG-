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
    var template = source.replace(/(\d{1,2})\s+([A-Za-z’']*)((?:\s*_)+)/g, function (all, no, hint) {
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

  function parseReadingModule(mod, moduleId) {
    var paras = mod.paras, blocks = [], i = 0;
    var pendingCloze = [];

    while (i < paras.length) {
      var p = paras[i], t = txt(p);

      if (CLOZE_HEAD.test(t)) { i++; continue; }

      /* cloze 지문은 'Questions a-b' 머리글보다 먼저 나온다 — 만나면 쌓아 둔다. */
      if (t && /\d\s*[A-Za-z’']*(\s*_){2,}/.test(t)) {
        var cz = parseCloze(t);
        if (cz) { pendingCloze.push(cz); i++; continue; }
      }

      var range = questionRange(t);
      if (range && pendingCloze.length) {
        var c = shiftCloze(pendingCloze.shift(), moduleId, range.from);
        blocks.push({
          kind: 'cloze',
          heading: t,
          instruction: 'Fill in the blank.',
          template: c.template,
          questions: c.questions
        });
        i++; continue;
      }

      if (PASSAGE_HEAD.test(t)) {
        var blk = { kind: 'passage', heading: t, instruction: '', title: '', paragraphs: [], questions: [] };
        var images = [];
        i++;
        /* 지문 본문: 'Questions a-b' 를 만날 때까지. */
        while (i < paras.length && !questionRange(txt(paras[i])) && !PASSAGE_HEAD.test(txt(paras[i]))) {
          var bp = paras[i];
          if (bp.images && bp.images.length) images = images.concat(bp.images);
          if (txt(bp)) blk.paragraphs.push(txt(bp));
          i++;
        }
        blk.title = blk.paragraphs.length ? blk.paragraphs[0] : '';
        if (blk.paragraphs.length) blk.paragraphs = blk.paragraphs.slice(1);
        if (images.length) blk.images = images;
        if (questionRange(txt(paras[i]))) { blk.heading = txt(paras[i]); i++; }

        /* 문항 + 선택지 */
        while (i < paras.length) {
          var q = numbered(txt(paras[i]));
          if (!q) {
            if (PASSAGE_HEAD.test(txt(paras[i])) || CLOZE_HEAD.test(txt(paras[i]))) break;
            if (questionRange(txt(paras[i]))) break;
            i++;
            if (i > paras.length) break;
            continue;
          }
          var got = collectChoices(paras, i + 1);
          var isInsert = /look at the (four )?letters|indicate where/i.test(q.text);
          var item = {
            id: moduleId + '-' + q.no,
            kind: isInsert ? 'insert' : 'mcq',
            no: q.no,
            prompt: q.text,
            choices: got.choices
          };
          /* 삽입 문항의 보기는 원본에 없다 — 지문 안의 마커 A~D 가 곧 보기다.
             여기서만 텍스트를 만들고, 만들었다는 사실을 팩에 남긴다. */
          if (isInsert && !item.choices.length) {
            item.choices = CHOICE_LETTERS.slice(0, 4).map(function (L) { return 'Position ' + L; });
            item.choicesOrigin = 'generated';
            item.choicesNote = 'The source docx had no choice list — insertion points A-D were generated.';
          }
          blk.questions.push(item);
          i = got.next;
        }
        blocks.push(blk);
        continue;
      }
      i++;
    }

    /* 짝을 못 찾은 cloze 지문도 버리지 않는다. */
    pendingCloze.forEach(function (raw) {
      var c = shiftCloze(raw, moduleId, 0);
      blocks.push({
        kind: 'cloze', heading: '', instruction: 'Fill in the blank.',
        template: c.template, questions: c.questions
      });
    });

    return blocks;
  }

  /* ------------------------------------------------------ 리스닝 파서 */

  var LISTEN_CUE = /^(listen to (a|an|the)\s|instructions?\s*:)/i;
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
      if (!cur) cur = { lines: [], images: [] };
      cur.lines.push(t);
      if (p.images && p.images.length) cur.images = cur.images.concat(p.images);
    }
    if (cur) groups.push(cur);
    return groups;
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

  function parseListeningModule(mod, moduleId, outOfRange) {
    var paras = mod.paras, blocks = [], i = 0;
    outOfRange = outOfRange || [];

    /* 'Questions a-b' 머리글 위치를 먼저 전부 찾는다. */
    var heads = [];
    paras.forEach(function (p, k) {
      var r = questionRange(txt(p));
      if (r) heads.push({ at: k, range: r, text: txt(p) });
    });

    for (i = 0; i < heads.length; i++) {
      var head = heads[i];
      var end = i + 1 < heads.length ? heads[i + 1].at : paras.length;
      var blk = { kind: 'audio-set', heading: head.text, instruction: '', questions: [] };
      var images = [];

      var groups = groupByBlankLine(paras, head.at + 1, end);
      var next = head.range.from;
      var pendingStem = null;   /* 문두와 보기 사이에 빈 줄이 있는 서식을 위해 */

      groups.forEach(function (g) {
        images = images.concat(g.images);

        var lines = pendingStem ? [pendingStem].concat(g.lines) : g.lines;
        pendingStem = null;

        var joined = lines.join(' ');
        var item = itemFromGroup(lines);
        if (!item) {
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

        var no = item.no != null ? item.no : next;
        /* 머리글의 범위가 실제 문항 번호와 어긋나는 경우가 있다(SET 9 L2 'Questions 8-10' 에
           11번이 들어 있다). 본문에 적힌 번호를 믿되 어긋난 사실은 남긴다. */
        if (item.no != null && (no < head.range.from || no > head.range.to)) {
          outOfRange.push(moduleId + '-' + no + ' (heading ' + head.range.from + '-' + head.range.to + ')');
        } else if (item.no == null && (no < head.range.from || no > head.range.to)) {
          return;
        }
        next = no + 1;

        blk.questions.push({
          id: moduleId + '-' + no,
          kind: 'mcq',
          no: no,
          prompt: item.prompt || SHORT_RESPONSE_PROMPT,
          choices: item.choices
        });
      });

      if (images.length) blk.images = images;

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

  function parseWriting(paras, codeSlug, startNo) {
    var modules = [], i = 0, no = startNo;

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
            var s1 = i + 1 < paras.length ? txt(paras[i + 1]) : '';
            if (/_{2,}/.test(s1)) {
              var t1 = i + 2 < paras.length ? txt(paras[i + 2]) : '';
              var built = parseBuildItem(s1, t1);
              qs.push({
                id: codeSlug + '-W1-q' + pad2(qs.length + 1),
                kind: 'build', no: no++,
                context: line, slots: built.slots, tiles: built.tiles
              });
              i += 3; continue;
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
        var em = { id: codeSlug + '-W2-email', kind: 'email', no: no++, to: '', subject: '', situationLabel: '', situation: '', requirements: [] };
        i++;
        var mode = '';
        while (i < paras.length && !DISC_HEAD.test(txt(paras[i]))) {
          var l = txt(paras[i]);
          if (/^to:/i.test(l)) { if (!em.to) em.to = l.replace(/^to:\s*/i, ''); mode = ''; }
          else if (/^subject:/i.test(l)) { if (!em.subject) em.subject = l.replace(/^subject:\s*/i, ''); mode = ''; }
          else if (/^situation/i.test(l)) { em.situationLabel = l; mode = 'sit'; }
          else if (/^your email should/i.test(l)) { mode = 'req'; }
          else if (l) {
            if (mode === 'sit' && !em.situation) em.situation = l;
            else if (mode === 'req' && em.requirements.indexOf(l) < 0) em.requirements.push(l);
          }
          i++;
        }
        modules.push({ id: 'W2', label: 'Write an Email', blocks: [{ kind: 'free-write', heading: t, questions: [em] }] });
        continue;
      }

      if (DISC_HEAD.test(t)) {
        var dc = { id: codeSlug + '-W3-disc', kind: 'discussion', no: no++, professor: '', prompt: '', posts: [] };
        i++;
        var cur = null, seen = {};
        while (i < paras.length) {
          var d = txt(paras[i]);
          if (d) {
            if (!dc.professor && /[–—-]/.test(d) && d.length < 70) dc.professor = d;
            else if (!dc.prompt && d.length > 80) dc.prompt = d;
            else if (d.length < 30 && !/[.?!]$/.test(d)) { cur = { author: d, text: '' }; }
            else if (cur && !cur.text) {
              cur.text = d;
              if (!seen[cur.author + '|' + cur.text]) { seen[cur.author + '|' + cur.text] = 1; dc.posts.push(cur); }
              cur = null;
            }
          }
          i++;
        }
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
    var section = 'listening', moduleNo = 1, cur = null;

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
      if (r) { open(r); return; }

      if (!cur) open(null);
      if (!cur.cue && LISTEN_CUE.test(t)) { cur.cue = t; return; }
      /* 'Interview' 같은 한 낱말 머리글은 대사가 아니다. */
      if (!cur.lines.length && t.length < 20 && !/[.?!:]$/.test(t)) { cur.label = t; return; }
      cur.lines.push(t);
    });

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

    var code = String(input.code || 'SET ?').trim();
    var codeSlug = slug(code) || 'set';
    var audioRel = 'media/audio/' + codeSlug + '/';
    var picsRel = 'media/pictures/' + codeSlug + '/';

    if (!input.questions || !input.questions.paragraphs) {
      gate('stop', 'upload', 'Could not read the question document.');
      return { pack: null, gates: gates, stats: {} };
    }

    var qParas = input.questions.paragraphs;
    var split = splitSections(qParas);

    /* ---- reading / listening ---- */
    var reading = { id: 'reading', label: 'Reading', labelKo: '리딩', timeLimitSec: 2100, modules: [] };
    splitModules(split.reading).forEach(function (mod, k) {
      var no = mod.no || (k + 1);
      var id = 'R' + no;
      reading.modules.push({ id: id, label: 'Reading Module ' + no, blocks: parseReadingModule(mod, id) });
    });

    var listening = { id: 'listening', label: 'Listening', labelKo: '리스닝', timeLimitSec: null, modules: [] };
    var outOfRange = [];
    splitModules(split.listening).forEach(function (mod, k) {
      var no = mod.no || (k + 1);
      var id = 'L' + no;
      listening.modules.push({ id: id, label: 'Listening Module ' + no, blocks: parseListeningModule(mod, id, outOfRange) });
    });
    if (outOfRange.length) {
      gate('warn', 'listening', 'Question numbers fall outside their "Questions a-b" heading range — the numbers printed in the body were used: ' + outOfRange.join(', '));
    }

    /* ---- writing / speaking ---- */
    var wModules = parseWriting(split.writing, codeSlug, 11);
    var writing = { id: 'writing', label: 'Writing', labelKo: '라이팅', timeLimitSec: null, modules: wModules };

    var scripts = input.script && input.script.paragraphs
      ? parseScript(input.script.paragraphs) : { listening: [], speaking: [] };

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
        var r = questionRange(blk.heading || '');
        if (!r) return;
        /* 파일명 규칙은 SET 9 에 이미 있는 것을 그대로 따른다(l1-q13-14.mp3, l1-q01.mp3) —
           tools/verify_audio.py 와 tts 매니페스트가 이 이름으로 서로를 찾는다.
           문항마다 음성이 따로 붙는 세트는 블록 음성이 없다(SET 9 도 없다). */
        if (!blk.perQuestionAudio) {
          /* 머리글이 아니라 실제로 들어 있는 문항 번호로 이름을 짓는다 — SET 9 의
             'Questions 8-10' 블록에는 11번까지 들어 있었고, 파일명이 내용과 어긋나면
             나중에 어느 음성이 어느 문항 것인지 아무도 알 수 없게 된다. */
          var nos = blk.questions.map(function (x) { return x.no; });
          var lo = Math.min.apply(null, nos.concat(r.from));
          var hi = Math.max.apply(null, nos.concat(r.from));
          blk.audio = audioRel + mod.id.toLowerCase() + '-q' + pad2(lo)
            + (hi !== lo ? '-' + pad2(hi) : '') + '.mp3';
        }

        var hit = null;
        for (var k = 0; k < groups.length; k++) {
          var g = groups[k];
          if (g.from == null || (g.from <= r.to && g.to >= r.from)) { hit = g; break; }
        }
        if (!hit) {
          gate('warn', 'listening', mod.label + ' ' + (blk.heading || '') + ' — no script found. It is left out of audio generation.');
          return;
        }
        if (hit.cue && !blk.instruction) blk.instruction = hit.cue;

        /* 대본 덩어리가 두 종류다. 'Listen to a conversation.' 같은 안내 대사가 앞에 붙어
           있으면 그 아래는 **들려줄 대사**이고, 안내 대사가 없으면 문항을 하나씩 읽어 주는
           **문항 낭독**이다(짧은 응답 드릴). 줄 수로 가르면 4문항짜리 강의 대본이
           문항 낭독으로 오해된다 — SET 9 의 l1-q25-28 이 정확히 그 경우였다. */
        var isTranscript = !!hit.cue;
        blk.scriptOrigin = 'script-docx';

        if (isTranscript) {
          blk.script = hit.text;
          return;
        }

        /* 문항 낭독 — 줄과 문항을 번호로 맞춘다. */
        blk.questions.forEach(function (q) {
          var line = hit.lines[q.no - hit.from];
          if (line) q.script = line;
        });
        if (blk.perQuestionAudio) {
          blk.questions.forEach(function (q) {
            q.audio = audioRel + mod.id.toLowerCase() + '-q' + pad2(q.no) + '.mp3';
          });
        } else {
          /* 문항 낭독만 있고 들려줄 대사가 없다 — 원본 문서에 그 대화·강의가 통째로
             빠져 있다는 뜻이다(SET 9 리스닝 Module 2 가 그랬다). 지어내지 않고 알린다. */
          delete blk.scriptOrigin;
          gate('warn', 'listening', mod.label + ' ' + (blk.heading || '')
            + ' — the questions are here, but the source script has no spoken lines for them. No audio will be made.');
        }
      });
    });

    /* ---- 정답 붙이기 ---- */
    var answers = input.answers && input.answers.paragraphs ? parseAnswerKey(input.answers.paragraphs) : null;
    var answerKey = {};
    var unmatched = [];

    if (!answers) {
      gate('warn', 'answers', 'No answer key was uploaded — the questions are built without automatic scoring.');
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
      buildQs.forEach(function (q, k) {
        if (k < wList.length && typeof wList[k] === 'string') {
          q.answerSentence = wList[k];
          answerKey[q.id] = wList[k];
        }
      });
      if (buildQs.length && wList.length && buildQs.length > wList.length) {
        gate('warn', 'writing', 'Only ' + wList.length + ' of ' + buildQs.length + ' sentence-building questions have an answer.');
      }
    }

    if (unmatched.length) {
      gate('warn', 'answers', unmatched.length + ' questions have no answer attached: ' + unmatched.slice(0, 8).join(', ') + (unmatched.length > 8 ? ' and more' : ''));
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
            if (answerKey[q.id] !== undefined) return;
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
            if (q.kind === 'mcq' && (!q.choices || q.choices.length < 3)) thin.push(q.id);
          });
        });
      });
    });
    if (thin.length) gate('warn', 'choices', thin.length + ' questions have fewer than 3 choices: ' + thin.slice(0, 8).join(', ') + (thin.length > 8 ? ' and more' : ''));

    /* ---- 그림 경로 정규화 ----
       파서마다 그림을 다른 모양으로 모은다(문서 내부 이름 'media/image7.png' 또는 파일명만).
       화면이 찾을 수 있는 경로는 하나뿐이므로 여기서 한 번에 맞춘다. */
    var picFiles = {};
    sections.forEach(function (sec) {
      sec.modules.forEach(function (mod) {
        mod.blocks.forEach(function (blk) {
          if (blk.images) {
            blk.images = blk.images.map(function (ref) {
              var name = picName(ref);
              picFiles[name] = 1;
              return picsRel + name;
            });
          }
          (blk.questions || []).forEach(function (q) {
            if (!q.image) return;
            var n = picName(q.image);
            picFiles[n] = 1;
            q.image = picsRel + n;
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

    var pack = {
      code: codeSlug.toUpperCase(),
      title: code,
      paths: { audio: audioRel, pics: picsRel },
      sections: sections,
      answerKey: answerKey,
      buildWarnings: gates.map(function (g) { return g.level + ': ' + g.message; }),
      gates: gates,
      summary: summary,
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

  return {
    build: build,
    finalize: finalize,       /* set-generate.js 가 같은 조립·검산을 타려고 부른다 */
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
