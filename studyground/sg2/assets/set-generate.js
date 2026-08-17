/* SMEAG StudyGround — set-generate.js : 청사진 + AI → 4섹션 콘텐츠 팩.
 *
 * set-import.js 와 짝이다. 저쪽은 docx 를 읽어 팩을 만들고, 이쪽은 문서가 없을 때
 * config/blueprint.toefl.json 의 빈 칸을 AI 로 채워 **같은 모양의 팩**을 만든다.
 * 조립의 뒷부분(정답표·검산·통계·팩 모양)은 SG_SET_IMPORT.finalize 를 그대로 부른다 —
 * 두 벌로 두면 한쪽에만 검산이 붙는 날이 온다.
 *
 * 이 파일이 지키는 세 가지
 *
 *   1. 모양은 AI 가 정하지 않는다. 문항 수·보기 수·모듈 구성은 청사진에서 오고,
 *      문항 번호는 여기서 매긴다. 모델에게 번호를 맡기면 어디선가 한 칸 밀린다.
 *
 *   2. 지어낸 것은 지어냈다고 적는다. summary.origin 에 프로바이더·모델·토큰이 남고,
 *      팩의 source 는 'set-generate' 다. 세트 목록이 업로드본과 구분해 보여 준다.
 *
 *   3. 근거 없는 정답은 통과시키지 않는다. 모든 객관식은 지문·대본에서 그대로 따온
 *      구절(evidence)을 함께 받고, 그 구절이 실제로 본문에 있는지 여기서 대조한다.
 *      없으면 stop 게이트다 — 모델이 지문에 없는 것을 근거랍시고 적었다는 뜻이고,
 *      그런 문항은 학생이 풀 수 없다.
 *
 * 계약
 *   SG_SET_GEN.providers(opts)              -> Promise<[{id,label,ready,why,models,default}]>
 *   SG_SET_GEN.plan(blueprint)              -> [{ref, task, spec, context}]  (호출 전 미리보기)
 *   SG_SET_GEN.generate(opts)               -> Promise<{pack, gates, stats, usage, topics}>
 *   SG_SET_GEN.fillScripts(pack, opts)      -> Promise<{pack, gates, usage, filled}>
 *   SG_SET_GEN.fillAnswers(pack, opts)      -> Promise<{pack, gates, usage, filled}>
 *   SG_SET_GEN.avoidTopics(packs)           -> [string]   이미 쓴 주제 — 겹치지 않게 하려고
 *
 *   opts: { code, blueprint, provider, model, token, endpoint?, concurrency?,
 *           avoid?, onProgress?(ev), fetch? }
 *
 * ES5 문법만 쓴다(빌드 단계 없음).
 */
(function (root, factory) {
  var api = factory();
  root.SG_SET_GEN = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var ENDPOINT = '/api/generate';

  /* insert 문항의 지시문과 보기는 서식이지 내용이 아니다. 모델에게 물으면 매번 조금씩
     다르게 적어 오고, 그러면 같은 문항인데 세트마다 지시가 달라진다. 여기 고정한다. */
  var INSERT_PROMPT = 'Look at the four letters (A, B, C, and D) in the passage that ' +
    'indicate where the following sentence could be added. Where would the sentence best fit?';
  var INSERT_CHOICES = ['Position A', 'Position B', 'Position C', 'Position D'];
  var DRILL_PROMPT = 'Listen to the question and select the best response.';

  /* ------------------------------------------------------------ 유틸 */

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function isArr(v) { return v instanceof Array; }
  function str(v) { return v == null ? '' : String(v); }

  /** 대조용 정규화 — 따옴표·대시·공백만 맞춘다. 낱말은 건드리지 않는다. */
  function norm(s) {
    return str(s)
      .replace(/[‘’ʼ]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[–—]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  /** 문자열 → 정수. 같은 문장은 늘 같은 타일 순서를 얻는다(다시 만들어도 안 흔들린다). */
  function hash(s) {
    var h = 2166136261, i;
    for (i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return h;
  }

  /** 씨앗을 받는 섞기 — 무작위지만 되풀이된다. */
  function shuffle(list, seed) {
    var a = list.slice(0), s = seed >>> 0, i, j, t;
    for (i = a.length - 1; i > 0; i--) {
      s = (s * 1664525 + 1013904223) >>> 0;
      j = s % (i + 1);
      t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function heading(lo, hi) { return 'Questions ' + lo + (hi !== lo ? '-' + hi : ''); }

  /* ------------------------------------------------------------ 계획 */

  /** 블록 청사진 하나 → 어떤 task 를 부를지. */
  function taskFor(sectionId, spec) {
    var k = spec.questionKinds || {};
    if (sectionId === 'reading') return spec.kind === 'cloze' ? 'reading-cloze' : 'reading-passage';
    if (sectionId === 'listening') return spec.perQuestionAudio ? 'listening-drill' : 'listening-set';
    if (sectionId === 'writing') {
      if (spec.kind === 'build-set') return 'writing-build';
      return k.discussion ? 'writing-discussion' : 'writing-email';
    }
    if (sectionId === 'speaking') return 'speaking-set';
    return null;
  }

  /**
   * 청사진 → 호출 목록. 문항 번호도 여기서 미리 매긴다.
   * 리딩·리스닝은 모듈 안에서 1번부터, 라이팅·스피킹은 섹션 안에서 1번부터 — set9.js 와 같다.
   */
  function plan(bp) {
    var jobs = [];
    (bp.sections || []).forEach(function (sec) {
      var perSection = (sec.id === 'writing' || sec.id === 'speaking');
      var sectionNo = 1;
      (sec.modules || []).forEach(function (mod) {
        var no = perSection ? sectionNo : 1;
        (mod.blocks || []).forEach(function (spec, bi) {
          var task = taskFor(sec.id, spec);
          var n = spec.questions || 0;
          jobs.push({
            ref: mod.id + '.b' + (bi + 1),
            section: sec.id,
            sectionLabel: sec.label,
            module: mod.id,
            moduleLabel: mod.label,
            blockIndex: bi,
            task: task,
            spec: spec,
            from: no,
            to: no + n - 1
          });
          no += n;
        });
        if (perSection) sectionNo = no;
      });
    });
    return jobs;
  }

  /* --------------------------------------------------- 이미 쓴 주제 모으기 */

  /**
   * 저장된 팩들에서 "무엇에 관한 글이었는지" 를 뽑는다. 정확한 주제 분류가 아니라
   * 모델에게 "이건 피해라" 로 건네줄 손잡이다. 제목과 첫 문장이면 충분하다 —
   * 지문 전체를 보내면 모델이 그걸 참고 삼아 비슷하게 쓴다.
   */
  function avoidTopics(packs) {
    var out = [], seen = {};
    function add(s) {
      /* 첫 문장만. 뒤돌아보기(lookbehind)를 쓰지 않는다 — 정규식 리터럴은 파일을 읽는
         순간 해석되므로, 지원하지 않는 브라우저에서는 이 파일 전체가 죽는다. */
      var t = str(s).split(/[.?!]\s/)[0];
      t = t.split(/\s+/).slice(0, 14).join(' ').trim();
      if (t.length < 12) return;
      var k = norm(t);
      if (seen[k]) return;
      seen[k] = 1; out.push(t);
    }
    (packs || []).forEach(function (pack) {
      if (!pack || !pack.sections) return;
      pack.sections.forEach(function (sec) {
        (sec.modules || []).forEach(function (mod) {
          (mod.blocks || []).forEach(function (blk) {
            if (blk.title) add(blk.title);
            if (isArr(blk.paragraphs) && blk.paragraphs.length) add(blk.paragraphs[0]);
            if (blk.template) add(blk.template);
            if (blk.script && blk.kind !== 'record-set') add(String(blk.script).replace(/^[MW]:\s*/gm, ''));
            (blk.questions || []).forEach(function (q) {
              if (q.kind === 'email' && q.subject) add(q.subject);
              if (q.kind === 'discussion' && q.prompt) add(q.prompt);
            });
          });
        });
      });
    });
    return out;
  }

  /* ------------------------------------------------------------ 호출 */

  function post(opts, body) {
    var f = opts.fetch || (typeof fetch !== 'undefined' ? fetch : null);
    if (!f) return Promise.reject(new Error('fetch is unavailable.'));
    var head = { 'Content-Type': 'application/json' };
    if (opts.token) head.Authorization = 'Bearer ' + opts.token;
    return f(opts.endpoint || ENDPOINT, { method: 'POST', headers: head, body: JSON.stringify(body) })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) throw new Error((j && j.error) || ('The generation request came back with ' + r.status + '.'));
          return j;
        });
      });
  }

  function providers(opts) {
    var o = opts || {};
    var f = o.fetch || (typeof fetch !== 'undefined' ? fetch : null);
    var head = {};
    if (o.token) head.Authorization = 'Bearer ' + o.token;
    return f(o.endpoint || ENDPOINT, { headers: head })
      .then(function (r) { return r.json(); })
      .then(function (j) { return (j && j.providers) || []; });
  }

  /** 한 번 실패하면 한 번 더 부른다 — 모델이 이따금 JSON 을 깨뜨린다. */
  function callTask(opts, task, spec, ctx) {
    var body = {
      provider: opts.provider || '', model: opts.model || '',
      task: task, spec: spec || {}, context: ctx || {}
    };
    return post(opts, body).catch(function (e) {
      if (opts.noRetry) throw e;
      return post(opts, body).catch(function () { throw e; });
    });
  }

  /** 동시에 n 개까지만 — 한꺼번에 25개를 던지면 프로바이더가 429 로 돌려보낸다. */
  function pool(items, n, worker) {
    var out = new Array(items.length), i = 0, active = 0, failed = null;
    return new Promise(function (resolve, reject) {
      function next() {
        if (failed) return;
        if (i >= items.length && active === 0) return resolve(out);
        while (active < n && i < items.length) {
          (function (k) {
            active++; i++;
            worker(items[k], k).then(function (v) {
              out[k] = v; active--; next();
            }, function (e) { failed = e; reject(e); });
          })(i);
        }
      }
      if (!items.length) return resolve(out);
      next();
    });
  }

  /* ------------------------------------------------------------ 조립 */

  /* 조립기는 모델 응답 하나를 블록 하나로 바꾼다. 여기서 하는 일은 번호 매기기·id 짓기·
     경로 짓기뿐이다 — 내용을 손보지 않는다. 모델이 잘못 준 것은 고치지 않고 verify 가
     게이트로 올린다. 조용히 고치면 무엇이 잘못됐는지 아무도 모르게 된다. */

  var ASSEMBLE = {

    'reading-cloze': function (job, d, ev, ctx) {
      var blanks = isArr(d.blanks) ? d.blanks : [];
      var qs = blanks.map(function (b, k) {
        return {
          id: job.module + '-' + (job.from + k), kind: 'blank', no: job.from + k,
          hint: str(b.hint), answer: str(b.answer)
        };
      });
      return {
        kind: 'cloze', heading: heading(job.from, job.to), instruction: job.spec.instruction || '',
        template: str(d.template), questions: qs
      };
    },

    'reading-passage': function (job, d, ev, ctx) {
      var paras = isArr(d.paragraphs) ? d.paragraphs.map(str) : [];
      var body = paras.join('\n');
      var qs = (isArr(d.questions) ? d.questions : []).map(function (q, k) {
        var no = job.from + k;
        var out = { id: job.module + '-' + no, kind: q.kind === 'insert' ? 'insert' : 'mcq', no: no };
        if (out.kind === 'insert') {
          out.prompt = INSERT_PROMPT;
          out.choices = INSERT_CHOICES.slice(0);
          out.sentence = str(q.sentence);
        } else {
          out.prompt = str(q.prompt);
          out.choices = (isArr(q.choices) ? q.choices : []).map(str);
        }
        out.answer = typeof q.answer === 'number' ? q.answer : -1;
        ev.push({ id: out.id, quote: str(q.evidence), source: body, scope: job.section });
        return out;
      });
      var blk = {
        kind: 'passage', heading: heading(job.from, job.to),
        instruction: job.spec.instruction || '', title: str(d.title),
        paragraphs: paras, questions: qs
      };
      if (qs.filter(function (q) { return q.kind === 'insert'; }).length) blk.markerOrigin = 'ai';
      return blk;
    },

    'listening-drill': function (job, d, ev, ctx) {
      var items = isArr(d.items) ? d.items : [];
      var qs = items.map(function (it, k) {
        var no = job.from + k;
        return {
          id: job.module + '-' + no, kind: 'mcq', no: no,
          prompt: DRILL_PROMPT,
          choices: (isArr(it.choices) ? it.choices : []).map(str),
          answer: typeof it.answer === 'number' ? it.answer : -1,
          script: str(it.script),
          audio: ctx.audioRel + job.module.toLowerCase() + '-q' + pad2(no) + '.mp3'
        };
      });
      return {
        kind: 'audio-set', heading: heading(job.from, job.to),
        instruction: job.spec.instruction || '', perQuestionAudio: true,
        scriptOrigin: 'ai', questions: qs
      };
    },

    'listening-set': function (job, d, ev, ctx) {
      var script = str(d.script);
      var qs = (isArr(d.questions) ? d.questions : []).map(function (q, k) {
        var no = job.from + k;
        ev.push({ id: job.module + '-' + no, quote: str(q.evidence), source: script, scope: job.section });
        return {
          id: job.module + '-' + no, kind: 'mcq', no: no,
          prompt: str(q.prompt),
          choices: (isArr(q.choices) ? q.choices : []).map(str),
          answer: typeof q.answer === 'number' ? q.answer : -1
        };
      });
      return {
        kind: 'audio-set', heading: heading(job.from, job.to),
        instruction: job.spec.instruction || '',
        audio: ctx.audioRel + job.module.toLowerCase() + '-q' + pad2(job.from) +
          (job.to !== job.from ? '-' + pad2(job.to) : '') + '.mp3',
        script: script, scriptOrigin: 'ai', questions: qs
      };
    },

    'writing-build': function (job, d, ev, ctx) {
      var items = isArr(d.items) ? d.items : [];
      var qs = items.map(function (it, k) {
        var chunks = isArr(it.chunks) ? it.chunks : [];
        var slots = chunks.map(function (c) {
          return c && c.fixed ? { t: 'f', text: str(c.text) } : { t: 'b', a: str(c && c.text) };
        });
        var answerTokens = slots.filter(function (s) { return s.t === 'b'; })
          .map(function (s) { return s.a; });
        return {
          id: ctx.codeSlug + '-' + job.module + '-q' + pad2(k + 1), kind: 'build', no: job.from + k,
          context: str(it.context),
          slots: slots,
          tiles: shuffle(answerTokens, hash(str(it.sentence))),
          trapTiles: [],
          sentence: str(it.sentence),
          answerTokens: answerTokens
        };
      });
      return {
        kind: 'build-set', heading: heading(job.from, job.to),
        instruction: job.spec.instruction || '', questions: qs
      };
    },

    'writing-email': function (job, d, ev, ctx) {
      var bullets = (isArr(d.bullets) ? d.bullets : []).map(str);
      var q = {
        id: ctx.codeSlug + '-' + job.module + '-email', kind: 'email', no: job.from,
        to: str(d.to), subject: str(d.subject),
        situationLabel: 'SITUATION', situation: str(d.situation),
        bulletsLabel: 'YOUR EMAIL SHOULD', bullets: bullets,
        /* prompt 는 채점(/api/score)이 읽는 자리다 — 상황과 요구사항을 합쳐 한 덩어리로
           둔다. 화면은 situation·bullets 를 따로 그리므로 둘 다 필요하다. */
        prompt: [str(d.situation)].concat(bullets).join(' '),
        minWords: job.spec.minWords || 80
      };
      return { kind: 'free-write', heading: 'WRITE AN EMAIL', questions: [q] };
    },

    'writing-discussion': function (job, d, ev, ctx) {
      var q = {
        id: ctx.codeSlug + '-' + job.module + '-disc', kind: 'discussion', no: job.from,
        professor: str(d.professor), prompt: str(d.prompt),
        posts: (isArr(d.posts) ? d.posts : []).map(function (p) {
          return { name: str(p && p.name), text: str(p && p.text) };
        }),
        minWords: job.spec.minWords || 100
      };
      return { kind: 'free-write', heading: 'WRITE for an ACADEMIC DISCUSSION', questions: [q] };
    },

    'speaking-set': function (job, d, ev, ctx) {
      var taskNo = +str(job.module).replace(/\D/g, '') || 1;
      var kinds = job.spec.questionKinds || {};
      var kind = kinds.interview ? 'interview' : 'repeat';
      var items = isArr(d.items) ? d.items : [];
      var qs = items.map(function (it, k) {
        return {
          id: ctx.codeSlug + '-S' + taskNo + '-q' + pad2(k + 1), kind: kind, no: job.from + k,
          audio: ctx.audioRel + 's' + taskNo + '-q' + (k + 1) + '.mp3',
          prepSec: job.spec.prepSec || 3,
          respondSec: job.spec.respondSec || (kind === 'repeat' ? 20 : 45),
          script: str(it.script)
        };
      });
      var intro = str(d.introScript);
      var blk = {
        kind: 'record-set', heading: 'Task ' + taskNo,
        instruction: job.spec.instruction || '',
        introAudio: ctx.audioRel + 's' + taskNo + '-instructions.mp3',
        perQuestionAudio: true,
        questions: qs
      };
      /* 안내문을 두 이름으로 둔다 — exam-compile.js 는 block.script 를 읽고
         set-import.js 는 introScript 에 넣는다. 한쪽만 채우면 안내 화면이 비거나
         음성 목록에서 빠진다. */
      if (intro) { blk.script = intro; blk.introScript = intro; }
      return blk;
    }
  };

  /* ------------------------------------------------------------ 검증 */

  /**
   * AI 가 만든 것에만 붙는 검사. 문서에서 온 세트는 여기 오지 않는다 —
   * 저쪽의 위험은 "원본을 잘못 읽었나" 이고, 이쪽의 위험은 "없는 것을 지어냈나" 라
   * 볼 것이 다르다.
   */
  function verify(pack, bp, evidence, gates) {
    function gate(level, scope, message) { gates.push({ level: level, scope: scope, message: message }); }

    /* --- 1. 근거 대조. 지문에 없는 구절을 근거라고 적었다면 그 문항은 못 쓴다. --- */
    var ghost = [], noQuote = [];
    (evidence || []).forEach(function (e) {
      if (!e.quote) { noQuote.push(e.id); return; }
      if (norm(e.source).indexOf(norm(e.quote)) < 0) ghost.push(e.id);
    });
    if (ghost.length) {
      gate('stop', 'evidence', ghost.length + ' questions cite evidence that is not in the passage or script — ' +
        'the AI leaned on something the text does not say: ' + ghost.slice(0, 8).join(', ') +
        (ghost.length > 8 ? ' and more' : ''));
    }
    if (noQuote.length) {
      gate('warn', 'evidence', noQuote.length + ' questions came back with no evidence for their answer: ' +
        noQuote.slice(0, 8).join(', ') + (noQuote.length > 8 ? ' and more' : ''));
    }

    /* --- 2. 청사진 대조. 문항 수가 어긋나면 시간 배분이 어긋난다. --- */
    var want = {}, got = {};
    (bp.sections || []).forEach(function (sec) {
      (sec.modules || []).forEach(function (mod) {
        var n = 0;
        (mod.blocks || []).forEach(function (b) { n += b.questions || 0; });
        want[mod.id] = n;
      });
    });
    (pack.sections || []).forEach(function (sec) {
      (sec.modules || []).forEach(function (mod) {
        var n = 0;
        (mod.blocks || []).forEach(function (b) { n += (b.questions || []).length; });
        got[mod.id] = n;
      });
    });
    Object.keys(want).forEach(function (id) {
      if ((got[id] || 0) !== want[id]) {
        gate('stop', 'blueprint', id + ' — the blueprint asks for ' + want[id] + ' questions but ' +
          (got[id] || 0) + ' were made.');
      }
    });

    /* --- 3. 문항 자체가 성립하는가 --- */
    var noAnswer = [], thinChoice = [], dupChoice = [], emptyPrompt = [];
    (pack.sections || []).forEach(function (sec) {
      (sec.modules || []).forEach(function (mod) {
        (mod.blocks || []).forEach(function (blk) {
          (blk.questions || []).forEach(function (q) {
            if (q.kind === 'mcq' || q.kind === 'insert') {
              var c = q.choices || [];
              if (typeof q.answer !== 'number' || q.answer < 0 || q.answer >= c.length) noAnswer.push(q.id);
              if (c.length < 3) thinChoice.push(q.id);
              var seen = {};
              c.forEach(function (x) { var k = norm(x); if (seen[k]) dupChoice.push(q.id); seen[k] = 1; });
              if (!str(q.prompt)) emptyPrompt.push(q.id);
            }
          });
        });
      });
    });
    if (noAnswer.length) gate('stop', 'answers', noAnswer.length + ' questions have an answer outside their choice range: ' + noAnswer.slice(0, 8).join(', '));
    if (thinChoice.length) gate('stop', 'choices', thinChoice.length + ' questions have fewer than 3 choices: ' + thinChoice.slice(0, 8).join(', '));
    if (dupChoice.length) gate('stop', 'choices', dupChoice.length + ' questions repeat the same choice twice: ' + dupChoice.slice(0, 8).join(', '));
    if (emptyPrompt.length) gate('stop', 'questions', emptyPrompt.length + ' questions have no prompt: ' + emptyPrompt.slice(0, 8).join(', '));

    /* --- 4. 정답 쏠림. 사람은 무작위를 못 만들고 모델은 B 를 좋아한다.
           보기 위치를 세어 보면 학생이 찍기로 점수를 얻을 수 있는지 알 수 있다. --- */
    (pack.sections || []).forEach(function (sec) {
      var counts = [0, 0, 0, 0, 0], total = 0;
      (sec.modules || []).forEach(function (mod) {
        (mod.blocks || []).forEach(function (blk) {
          (blk.questions || []).forEach(function (q) {
            if (q.kind !== 'mcq' && q.kind !== 'insert') return;
            if (typeof q.answer !== 'number' || q.answer < 0 || q.answer > 4) return;
            counts[q.answer]++; total++;
          });
        });
      });
      if (total < 8) return;
      var worst = 0, at = 0;
      counts.forEach(function (n, i) { if (n > worst) { worst = n; at = i; } });
      if (worst / total > 0.45) {
        gate('warn', sec.id, sec.label + ' — the answers pile up on ' + 'ABCDE'.charAt(at) + ' (' +
          worst + '/' + total + '). Guessing would pass this section.');
      }
    });

    /* --- 5. 클로즈: 자리 표시자와 힌트 --- */
    (pack.sections || []).forEach(function (sec) {
      (sec.modules || []).forEach(function (mod) {
        (mod.blocks || []).forEach(function (blk) {
          if (blk.kind !== 'cloze') return;
          var qs = blk.questions || [];
          var missing = [];
          qs.forEach(function (q, k) {
            if (str(blk.template).indexOf('{{' + (k + 1) + '}}') < 0) missing.push(k + 1);
            if (!q.answer) return;
            if (!q.hint || str(q.answer).toLowerCase().indexOf(str(q.hint).toLowerCase()) !== 0) {
              gate('stop', 'reading', q.id + ' — hint "' + q.hint + '" is not the opening of answer "' + q.answer +
                '".');
            }
            if (/\s/.test(str(q.answer))) {
              gate('stop', 'reading', q.id + ' — blank answer "' + q.answer + '" contains a space. It must be one word.');
            }
          });
          if (missing.length) {
            gate('stop', 'reading', mod.id + ' ' + blk.heading + ' — the text has no blank slot {{' +
              missing.join('}}, {{') + '}}.');
          }
        });
      });
    });

    /* --- 6. insert: A~D 자리가 지문에 실제로 심겼는가 --- */
    (pack.sections || []).forEach(function (sec) {
      (sec.modules || []).forEach(function (mod) {
        (mod.blocks || []).forEach(function (blk) {
          var ins = (blk.questions || []).filter(function (q) { return q.kind === 'insert'; });
          if (!ins.length) return;
          var body = (blk.paragraphs || []).join('\n');
          var gone = ['A', 'B', 'C', 'D'].filter(function (L) { return body.indexOf('{{' + L + '}}') < 0; });
          if (gone.length) {
            gate('stop', 'reading', ins[0].id + ' — the passage has no insertion slot {{' + gone.join('}}, {{') +
              '}}. The insert question does not hold together.');
          }
          if (!str(ins[0].sentence)) gate('stop', 'reading', ins[0].id + ' — there is no sentence to insert.');
        });
      });
    });

    /* --- 7. 문장 조립: 조각을 이으면 그 문장이 되는가 --- */
    (pack.sections || []).forEach(function (sec) {
      (sec.modules || []).forEach(function (mod) {
        (mod.blocks || []).forEach(function (blk) {
          (blk.questions || []).forEach(function (q) {
            if (q.kind !== 'build') return;
            var joined = (q.slots || []).map(function (s) { return s.t === 'f' ? s.text : s.a; })
              .join(' ').replace(/\s+([.,!?;:])/g, '$1');
            if (norm(joined) !== norm(q.sentence)) {
              gate('stop', 'writing', q.id + ' — joining the fragments does not produce the answer sentence.');
            }
            if ((q.answerTokens || []).length < 3) {
              gate('stop', 'writing', q.id + ' — fewer than 3 fragments are left for the student to place.');
            }
          });
        });
      });
    });

    /* --- 8. 그림은 AI 가 만들지 않는다 --- */
    var wantPics = 0;
    (bp.sections || []).forEach(function (sec) {
      (sec.modules || []).forEach(function (mod) {
        (mod.blocks || []).forEach(function (b) { if (b.image) wantPics++; });
      });
    });
    if (wantPics) {
      gate('warn', 'pictures', wantPics + ' blocks in the blueprint carry a picture. ' +
        'The AI does not draw, so upload them in the question editor.');
    }

    /* --- 9. 음성도 아직 없다 --- */
    gate('warn', 'audio', 'The scripts are written but there are no audio files yet. ' +
      'Save the set, then generate them with TTS on the audio screen.');

    return gates;
  }

  /* ------------------------------------------------------------ 생성 */

  /**
   * 세트 하나를 통째로 짓는다.
   *
   * 순서가 중요하다. 주제를 먼저 한 번에 배정하고(그래야 리딩 두 지문이 둘 다 같은
   * 이야기가 되지 않는다), 그 다음에 블록을 병렬로 채운다.
   */
  function generate(opts) {
    var bp = opts.blueprint;
    if (!bp || !bp.sections) return Promise.reject(new Error('There is no blueprint.'));
    if (!root_SG_SET_IMPORT()) return Promise.reject(new Error('set-import.js must be loaded first.'));

    var code = str(opts.code || 'SET ?').trim();
    var codeSlug = slug(code) || 'set';
    var ctx = { codeSlug: codeSlug, audioRel: 'media/audio/' + codeSlug + '/', picsRel: 'media/pictures/' + codeSlug + '/' };

    var jobs = plan(bp).filter(function (j) { return j.task; });
    var usage = { in: 0, out: 0, calls: 0 };
    var evidence = [];
    var gates = [];
    var done = 0;
    var total = jobs.length + 1;   /* +1 은 주제 배정 */

    function tick(label) {
      done++;
      if (opts.onProgress) opts.onProgress({ done: done, total: total, label: label, usage: usage });
    }
    function account(r) {
      usage.in += (r.usage && r.usage.in) || 0;
      usage.out += (r.usage && r.usage.out) || 0;
      usage.calls++;
    }

    /* --- 주제 배정 --- */
    var topicSlots = jobs.filter(function (j) {
      return j.task !== 'writing-build' && j.task !== 'speaking-set' && j.task !== 'listening-drill';
    });
    var topicCtx = {
      avoid: opts.avoid || [],
      slots: topicSlots.map(function (j) {
        return {
          ref: j.ref, section: j.section, module: j.module,
          instruction: j.spec.instruction || j.spec.kind,
          kind: j.spec.kind, questions: j.spec.questions || 0
        };
      })
    };

    return callTask(opts, 'topics', {}, topicCtx).then(function (r) {
      account(r);
      var byRef = {};
      ((r.data && r.data.topics) || []).forEach(function (t) { if (t && t.ref) byRef[t.ref] = t; });
      tick('Assigning topics');

      var missing = topicSlots.filter(function (j) { return !byRef[j.ref]; });
      if (missing.length) {
        gates.push({
          level: 'warn', scope: 'topics',
          message: missing.length + ' blocks were given no topic — the model picks one for them.'
        });
      }

      /* --- 블록별 생성 --- */
      return pool(jobs, opts.concurrency || 3, function (job) {
        var t = byRef[job.ref] || {};
        var jctx = {
          topic: t.topic || '', genre: t.genre || '', domain: t.domain || '',
          avoid: opts.avoid || []
        };
        if (job.task === 'speaking-set') {
          jctx.kind = (job.spec.questionKinds || {}).interview ? 'interview' : 'repeat';
        }
        return callTask(opts, job.task, job.spec, jctx).then(function (r) {
          account(r);
          tick(job.moduleLabel + ' · ' + (job.spec.instruction || job.spec.kind));
          return { job: job, data: r.data || {} };
        }, function (e) {
          /* 한 블록이 실패해도 나머지는 살린다 — 120문항을 다시 만들 이유가 없다.
             빈 블록으로 두면 청사진 대조가 stop 을 올리므로 조용히 넘어가지 않는다. */
          gates.push({ level: 'stop', scope: job.section, message: job.moduleLabel + ' ' + job.ref + ' — generation failed: ' + (e.message || e) });
          tick(job.moduleLabel + ' · failed');
          return { job: job, data: {}, failed: true };
        });
      });
    }).then(function (results) {
      /* --- 청사진 순서 그대로 섹션을 세운다 --- */
      var sections = (bp.sections || []).map(function (sec) {
        return {
          id: sec.id, label: sec.label, labelKo: sec.labelKo || '',
          timeLimitSec: sec.timeLimitSec == null ? null : sec.timeLimitSec,
          modules: (sec.modules || []).map(function (mod) {
            return { id: mod.id, label: mod.label, blocks: [] };
          })
        };
      });
      function findMod(secId, modId) {
        var s = sections.filter(function (x) { return x.id === secId; })[0];
        return s ? s.modules.filter(function (m) { return m.id === modId; })[0] : null;
      }

      results.forEach(function (r) {
        if (!r || r.failed) return;
        var mk = ASSEMBLE[r.job.task];
        if (!mk) return;
        var mod = findMod(r.job.section, r.job.module);
        if (mod) mod.blocks.push(mk(r.job, r.data, evidence, ctx));
      });

      verify({ sections: sections }, bp, evidence, gates);

      var out = root_SG_SET_IMPORT().finalize(sections, {
        code: code, codeSlug: codeSlug, gates: gates,
        source: 'set-generate',
        origin: {
          by: 'ai', provider: opts.provider || '', model: opts.model || '',
          blueprint: bp.derivedFrom || bp.id || '', usage: usage, reviewed: false
        }
      });
      out.usage = usage;
      out.evidence = evidence;
      return out;
    });
  }

  /* ---------------------------------------------- 슬롯별: 대본만 · 정답만 */

  /** script 가 비어 있는 리스닝 블록을 찾아, 이미 있는 문항에 맞는 대본을 쓴다. */
  function fillScripts(pack, opts) {
    var jobs = [];
    (pack.sections || []).forEach(function (sec) {
      if (sec.id !== 'listening') return;
      (sec.modules || []).forEach(function (mod) {
        (mod.blocks || []).forEach(function (blk) {
          if (blk.perQuestionAudio || blk.script) return;
          if (!(blk.questions || []).length) return;
          jobs.push({ mod: mod, blk: blk });
        });
      });
    });

    var usage = { in: 0, out: 0, calls: 0 }, gates = [], filled = 0, done = 0;
    if (!jobs.length) return Promise.resolve({ pack: pack, gates: gates, usage: usage, filled: 0 });

    return pool(jobs, opts.concurrency || 3, function (j) {
      var qs = (j.blk.questions || []).map(function (q) {
        var o = { prompt: q.prompt, choices: q.choices };
        if (typeof q.answer === 'number') o.correctChoiceIndex = q.answer;
        return o;
      });
      var spec = {
        instruction: j.blk.instruction || '',
        questions: qs.length,
        scriptWords: { min: 180 + qs.length * 40, max: 280 + qs.length * 70 }
      };
      return callTask(opts, 'listening-script-for', spec, { questions: qs }).then(function (r) {
        usage.in += (r.usage && r.usage.in) || 0;
        usage.out += (r.usage && r.usage.out) || 0;
        usage.calls++;
        var d = r.data || {};
        j.blk.script = str(d.script);
        j.blk.scriptOrigin = 'ai';
        (isArr(d.answers) ? d.answers : []).forEach(function (a, k) {
          var q = j.blk.questions[k];
          if (!q) return;
          if (typeof q.answer !== 'number' && typeof a.answer === 'number') q.answer = a.answer;
          if (typeof a.answer === 'number' && typeof q.answer === 'number' && a.answer !== q.answer) {
            gates.push({
              level: 'stop', scope: 'listening',
              message: q.id + ' — the answer key says ' + 'ABCDE'.charAt(q.answer) + ' but the AI script makes ' +
                'ABCDE'.charAt(a.answer) + ' the answer. The script does not match the question.'
            });
          }
          if (a.evidence && norm(str(d.script)).indexOf(norm(a.evidence)) < 0) {
            gates.push({ level: 'stop', scope: 'listening', message: q.id + ' — the evidence for the answer is not in the script.' });
          }
        });
        filled++;
        done++;
        if (opts.onProgress) opts.onProgress({ done: done, total: jobs.length, label: j.mod.label + ' ' + (j.blk.heading || ''), usage: usage });
        return true;
      }, function (e) {
        done++;
        gates.push({ level: 'warn', scope: 'listening', message: (j.blk.heading || '') + ' — script generation failed: ' + (e.message || e) });
        return false;
      });
    }).then(function () {
      return { pack: pack, gates: gates, usage: usage, filled: filled };
    });
  }

  /** 정답이 비어 있는 문항을, 그 블록의 지문·대본에서 풀어 채운다. */
  function fillAnswers(pack, opts) {
    var jobs = [];
    (pack.sections || []).forEach(function (sec) {
      (sec.modules || []).forEach(function (mod) {
        (mod.blocks || []).forEach(function (blk) {
          var open = (blk.questions || []).filter(function (q) {
            return (q.kind === 'mcq' || q.kind === 'insert' || q.kind === 'blank') &&
              (q.answer === undefined || q.answer === null || q.answer === '');
          });
          if (!open.length) return;
          var source = blk.template || (blk.paragraphs || []).join('\n') || blk.script || '';
          if (!source) {
            /* 풀 근거가 없으면 풀지 않는다. 근거 없이 매긴 정답은 채점을 오염시킨다. */
            jobs.push({ mod: mod, blk: blk, open: open, source: '', skip: true });
            return;
          }
          jobs.push({ mod: mod, blk: blk, open: open, source: source });
        });
      });
    });

    var usage = { in: 0, out: 0, calls: 0 }, gates = [], filled = 0, done = 0;
    var real = jobs.filter(function (j) { return !j.skip; });
    jobs.filter(function (j) { return j.skip; }).forEach(function (j) {
      gates.push({
        level: 'warn', scope: 'answers',
        message: j.mod.label + ' ' + (j.blk.heading || '') + ' — no passage and no script, so the answers cannot be solved (' + j.open.length + ' questions).'
      });
    });
    if (!real.length) return Promise.resolve({ pack: pack, gates: gates, usage: usage, filled: 0 });

    return pool(real, opts.concurrency || 3, function (j) {
      var qs = j.open.map(function (q) {
        return q.kind === 'blank'
          ? { type: 'fill in the blank', placeholder: '{{' + q.no + '}}', hint: q.hint }
          : { prompt: q.prompt, choices: q.choices };
      });
      return callTask(opts, 'solve', { questions: qs.length }, { source: j.source, questions: qs })
        .then(function (r) {
          usage.in += (r.usage && r.usage.in) || 0;
          usage.out += (r.usage && r.usage.out) || 0;
          usage.calls++;
          (isArr(r.data && r.data.answers) ? r.data.answers : []).forEach(function (a, k) {
            var q = j.open[k];
            if (!q || a == null) return;
            if (a.evidence && norm(j.source).indexOf(norm(a.evidence)) < 0) {
              gates.push({ level: 'stop', scope: 'answers', message: q.id + ' — the evidence the AI gave is not in the text. This answer cannot be trusted.' });
              return;
            }
            if (a.confidence === 'low') {
              gates.push({ level: 'warn', scope: 'answers', message: q.id + ' — the AI was not confident. A human should check this.' });
            }
            q.answer = a.answer;
            q.answerOrigin = 'ai';
            filled++;
          });
          done++;
          if (opts.onProgress) opts.onProgress({ done: done, total: real.length, label: j.mod.label + ' ' + (j.blk.heading || ''), usage: usage });
          return true;
        }, function (e) {
          done++;
          gates.push({ level: 'warn', scope: 'answers', message: (j.blk.heading || '') + ' — answer solving failed: ' + (e.message || e) });
          return false;
        });
    }).then(function () {
      /* 정답이 바뀌었으니 정답표도 다시 걷는다 — 팩과 정답표가 어긋나면 채점이 어긋난다. */
      pack.answerKey = {};
      (pack.sections || []).forEach(function (sec) {
        (sec.modules || []).forEach(function (mod) {
          (mod.blocks || []).forEach(function (blk) {
            (blk.questions || []).forEach(function (q) {
              if (q.answer !== undefined && q.answer !== null && q.answer !== '') pack.answerKey[q.id] = q.answer;
              else if (q.answerSentence) pack.answerKey[q.id] = q.answerSentence;
            });
          });
        });
      });
      return { pack: pack, gates: gates, usage: usage, filled: filled };
    });
  }

  /* set-import 를 전역에서 늦게 찾는다 — 로드 순서에 기대지 않기 위해서다. */
  function root_SG_SET_IMPORT() {
    if (typeof globalThis !== 'undefined' && globalThis.SG_SET_IMPORT) return globalThis.SG_SET_IMPORT;
    if (typeof require === 'function') { try { return require('./set-import.js'); } catch (e) {} }
    return null;
  }

  return {
    providers: providers,
    plan: plan,
    generate: generate,
    fillScripts: fillScripts,
    fillAnswers: fillAnswers,
    avoidTopics: avoidTopics,
    verify: verify,
    /* 테스트용 */
    _assemble: ASSEMBLE,
    _norm: norm,
    _shuffle: shuffle,
    _pool: pool
  };
});
