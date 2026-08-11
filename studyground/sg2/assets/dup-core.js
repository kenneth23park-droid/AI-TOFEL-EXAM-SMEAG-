/* SMEAG StudyGround — dup-core.js : 문항·지문 겹침(중복) 판정.
 *
 * 판정 기준이 사는 유일한 곳이다. 세 군데가 이 파일 하나를 쓴다.
 *   · admin-set-import.html  — 세트를 만드는 순간 (검산 gate 로 올라가고 stop 이면 저장 잠금)
 *   · admin-dup.html         — 결과 확인 화면
 *   · tools/dup_check.js     — 터미널·CI (커밋된 팩 전체를 훑는다)
 * 임계값을 여기 말고 다른 데 또 적으면 판정이 두 벌로 갈린다. 적지 말 것.
 *
 * ── 무엇을 잡는가 ──────────────────────────────────────────────────────────
 * 육안 검수를 통과해 버리는 재활용 수법들. 함정 팩으로 실측해 전부 high 가 나온다.
 *   1) 문항을 글자 그대로 복사
 *   2) 발문만 다시 쓰고 선택지 4개는 그대로
 *   3) 선택지 4개 중 3개만 재사용
 *   4) 지문 문단을 통째로 옮기고 앞뒤만 바꿈
 *   5) 지문 한 대목을 가볍게 바꿔 쓴 패러프레이즈  (← containment 만 남는다. TH 주석 참조)
 *
 * ── 등급 ───────────────────────────────────────────────────────────────────
 *   high  — 겹침으로 본다. 세트 저장을 막고 CI 를 실패시킨다.
 *   watch — 사람이 봐야 한다. 막지는 않는다.
 *   info  — 정형문으로 강등됐거나 사람이 보고 허용한 것.
 *
 * ES5 문법만 쓴다(빌드 단계 없음). set-import.js 와 같은 UMD 껍데기.
 */
(function (root, factory) {
  var api = factory();
  root.SG_DUP = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ══════════════ 0. 판정 상수 ═════════════════════════════════════════════ */
  var K = 4;                       // shingle 크기(토큰). 문항이 짧아 5 보다 4 가 맞다.

  var TH = {
    shingleK: K,
    jaccardHigh: 0.55,             // 절반 이상이 같은 4-gram → 다시 쓴 티가 안 나는 재활용
    jaccardWatch: 0.28,
    containmentHigh: 0.80,         // 짧은 쪽이 긴 쪽에 통째로 들어 있음
    /* containmentWatch 0.25 는 함정 팩 실측으로 고른 값이다. SET9 L2-B2 지문(257단어)의
     * 한 대목을 44단어로 가볍게 바꿔 쓴 패러프레이즈는 자카드 0.04 · 최장연속 9 로 다른
     * 모든 지표 아래를 지나가고 containment 0.27 만 남는다. 임계값별 실측:
     *   0.50 → 미검출, 베이스라인 watch 3    0.35/0.30 → 미검출, watch 4
     *   0.25 → 검출(watch), watch 4          0.20 → 검출, watch 4
     * 0.35 에서 이미 소음이 1건 늘고 0.25 까지 더 늘지 않으므로, 같은 소음으로
     * 탐지력만 얻는 0.25 를 쓴다. */
    containmentWatch: 0.25,
    containmentMinShingles: 10,    // 그보다 짧으면 containment 는 우연히도 1.0 이 된다
    runHigh: 25,                   // 연속 일치 토큰 수 — 25 단어면 문단을 옮긴 것이다
    runWatch: 12,
    sharedChoicesHigh: 3,          // 4지선다에서 3개 일치 = 재활용 서명
    minTokens: 6,                  // 이보다 짧은 단위는 완전일치만 본다
    boilerplateDf: 3,              // payload 가 통째로 같은 게 군집 3곳 이상 → 정형문
    frameDf: 3,                    // 같은 줄이 서로 다른 군집 3곳 이상 → 틀(frame)
    clusterJaccard: 0.5            // 원문 줄 자카드 이 이상이면 같은 군집(=서로 중복)
  };

  /* ── 틀(frame) 과 내용(payload) ───────────────────────────────────────────
   * TOEFL 문항은 유형이 문장을 강제한다. "What is the main topic of the talk?",
   * "Listen to the question and select the best response.", insert 문항의 지시문과
   * Position A~D 는 SET 이 달라도 글자까지 같아야 정상이다. 이걸 겹침으로 세면
   * 리포트가 정형문 쌍으로만 가득 차고 진짜 재활용이 그 안에 묻힌다(실측: 116건 중 114건).
   *
   *   frame   — 유형이 정하는 문장. 비교에서 뺀다.
   *   payload — 이 문항만의 내용. 이것만 비교한다.
   *
   * 틀을 목록으로 적어 두지 않는다(SET 이 늘 때마다 손이 가고, 빠뜨리면 조용히 오탐이 난다).
   * 말뭉치에서 유도한다: **같은 줄이 서로 다른 문항 frameDf(3)곳 이상에 나오면, 그 줄은
   * 어떤 두 문항도 구별해 주지 못하므로 정의상 틀이다.**
   *
   * 단, 여기서 "서로 다른 문항"은 반드시 **군집** 으로 세야 한다. 단위 수로 세면
   * 중복을 여러 개 심는 것만으로 틀 판정을 우회할 수 있다 — 함정 팩 검증에서 실제로
   * 뚫렸다(같은 선택지 4개를 3개 문항에 넣자 df=3 이 되어 재활용 선택지가 정형문으로
   * 강등됐다). 중복끼리는 서로 다른 문항이 아니므로 한 군집으로 묶어 1 로 친다.
   *
   * 말뭉치 유도만으로 부족한 자리가 하나 있다. insert 문항의 Position A~D 는 저장소에
   * insert 가 2개뿐이라 df=2 로 걸러지지 않는다. 그런 "유형이 필드째로 고정하는" 경우는
   * FIELD_POLICY 에 명시한다 — 어느 필드가 내용인지는 유형을 아는 사람이 정한다. */
  var FIELD_POLICY = {
    mcq:        { use: ['prompt', 'sentence'], choices: true },
    insert:     { use: ['sentence'], choices: false },   // 지시문·Position A~D 는 유형이 고정
    build:      { use: ['sentence'], choices: false },   // context/tiles/slots 는 sentence 에서 파생
    email:      { use: ['subject', 'situation', 'bullets'], choices: false },
    discussion: { use: ['prompt', 'posts'], choices: false },
    blank:      null,   // 문항 단위를 만들지 않는다 — cloze 블록 하나로 접는다
    repeat:     null,   // 팩에 텍스트가 없다 — 전사(script) 단위가 담당
    interview:  null
  };

  /* 내용이 아닌 필드. heading/instruction 은 SET 마다 같은 게 정상이라 여기서 뺀다. */
  var SKIP_KEYS = {
    id: 1, kind: 1, no: 1, layout: 1, answer: 1,
    audio: 1, image: 1, introAudio: 1, perQuestionAudio: 1,
    heading: 1, instruction: 1, label: 1, labelKo: 1,
    prepSec: 1, respondSec: 1, minWords: 1, timeLimitSec: 1,
    scriptOrigin: 1, scriptNote: 1, scriptBlockId: 1, scriptKind: 1, revisionNote: 1,
    markerOrigin: 1, markerNote: 1, origin: 1, originNote: 1,
    promptRaw: 1, choicesRaw: 1, answerKeyRaw: 1, sourceCorrections: 1,
    questions: 1, blocks: 1, modules: 1, sections: 1,
    slots: 1, voices: 1,
    hint: 1,                       // cloze 힌트("th") — 내용이 아니라 입력 보조 조각
    tiles: 1, trapTiles: 1,        // build 타일 — sentence 에서 파생된 같은 단어들
    situationLabel: 1, bulletsLabel: 1, to: 1
  };

  /* ══════════════ 1. 정규화 · shingle ══════════════════════════════════════ */

  /** 표기 차이를 없앤다 — 이걸 통과한 두 문자열이 같으면 "같은 문장"으로 본다. */
  function normalize(s) {
    return String(s == null ? '' : s)
      .replace(/[‘’ʼ]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[–—]/g, '-')
      .replace(/\{\{\s*[A-Za-z0-9]+\s*\}\}/g, ' ')     // 빈칸 마커 {{1}}
      .toLowerCase()
      .replace(/[^a-z0-9'\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function tokens(s) { var n = normalize(s); return n ? n.split(' ') : []; }

  function shingles(toks, k) {
    if (!toks.length) return [];
    if (toks.length < k) return [toks.join(' ')];
    var out = [];
    for (var i = 0; i + k <= toks.length; i++) out.push(toks.slice(i, i + k).join(' '));
    return out;
  }

  function uniq(arr) {
    var seen = {}, out = [];
    for (var i = 0; i < arr.length; i++) if (!seen[arr[i]]) { seen[arr[i]] = 1; out.push(arr[i]); }
    return out;
  }

  /** 두 토큰열의 최장 연속 공통 구간(단어 수). 후보 쌍에만 돌린다 — O(n·m). */
  function longestRun(a, b) {
    if (!a.length || !b.length) return 0;
    var prev = [], cur, best = 0, i, j;
    for (j = 0; j <= b.length; j++) prev.push(0);
    for (i = 1; i <= a.length; i++) {
      cur = [0];
      for (j = 1; j <= b.length; j++) {
        cur[j] = (a[i - 1] === b[j - 1]) ? prev[j - 1] + 1 : 0;
        if (cur[j] > best) best = cur[j];
      }
      prev = cur;
    }
    return best;
  }

  /* ══════════════ 2. 단위(unit) 추출 ═══════════════════════════════════════
   * 비교 단위는 두 종류다. 서로 다른 종류끼리는 비교하지 않는다.
   *   item — 문항 하나 (발문 + 선택지)
   *   text — 지문/전사 하나 (리딩 지문, cloze 템플릿, 리스닝 대본) */

  /** 객체에서 내용 문자열만 재귀 수집. 새 문항 종류가 생겨도 자동으로 따라온다. */
  function harvest(node, out) {
    out = out || [];
    if (node == null) return out;
    if (typeof node === 'string') { if (node.trim()) out.push(node); return out; }
    if (typeof node === 'number' || typeof node === 'boolean') return out;
    if (Object.prototype.toString.call(node) === '[object Array]') {
      for (var i = 0; i < node.length; i++) harvest(node[i], out);
      return out;
    }
    if (typeof node === 'object') {
      for (var k in node) {
        if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
        if (SKIP_KEYS[k] || k.charAt(0) === '_') continue;
        harvest(node[k], out);
      }
    }
    return out;
  }

  /** 문자열/배열/객체를 "줄" 배열로 편다. 틀 판정과 표시가 모두 줄 단위로 돈다. */
  function lines(node, out) {
    out = out || [];
    if (node == null) return out;
    if (typeof node === 'string') {
      node.split('\n').forEach(function (l) { if (l.trim()) out.push(l.trim()); });
      return out;
    }
    harvest(node, []).forEach(function (s) { lines(s, out); });
    return out;
  }

  /** 이 문항에서 "이 문항만의 내용"에 해당하는 줄들.
   *  유형을 모르면 일반 수확으로 떨어진다 — 새 종류가 검사에서 조용히 빠지지 않는다. */
  function payloadLinesFor(q) {
    var known = Object.prototype.hasOwnProperty.call(FIELD_POLICY, q.kind);
    var pol = known ? FIELD_POLICY[q.kind] : undefined;
    if (known && pol === null) return null;               // 단위를 만들지 않는다
    if (!known) {
      return { body: lines(harvest(q, [])), choices: (q.choices || []).slice(), policy: 'generic' };
    }
    var body = [];
    pol.use.forEach(function (f) { if (q[f] != null) lines(q[f], body); });
    return { body: body, choices: pol.choices ? (q.choices || []).slice() : [], policy: q.kind };
  }

  function answerLabel(q) {
    if (q.answer == null) return '';
    if (typeof q.answer === 'number' && q.choices) {
      return 'ABCDEFG'.charAt(q.answer) + '. ' + q.choices[q.answer];
    }
    if (Object.prototype.toString.call(q.answerTokens) === '[object Array]') return q.answerTokens.join(' ');
    return String(q.answer);
  }

  /** 1단계 단위 — 줄만 담는다. 틀 판정은 말뭉치 전체를 봐야 하므로 여기서 못 한다. */
  function mkUnit(u) {
    u.bodyLines = u.bodyLines || [];
    u.choices = u.choices || [];
    u.displayLines = u.displayLines || u.bodyLines;
    u.text = u.displayLines.join('\n');       // 화면용 — 정형문 포함, 원문 그대로
    return u;
  }

  /** 콘텐츠 팩(window.SMEAG_SETn 모양) → 단위 배열. */
  function unitsFromPack(pack) {
    var units = [];
    var setCode = pack.code || 'SET?';
    var setId = String(setCode).toLowerCase().replace(/\s+/g, '');

    (pack.sections || []).forEach(function (sec) {
      (sec.modules || []).forEach(function (mod) {
        (mod.blocks || []).forEach(function (block, bi) {
          var where = {
            set: setCode, setId: setId,
            section: sec.id, sectionLabel: sec.label || sec.id,
            module: mod.id, moduleLabel: mod.label || mod.id,
            blockKind: block.kind, blockHeading: block.heading || ''
          };

          /* 2-a. 블록 본문 — 지문 · cloze 템플릿 · 리스닝 대본.
           * cloze 는 빈칸 문항을 따로 세지 않는다(한 칸짜리 답 "that" 이 SET 을 넘어
           * 일치하는 건 겹침이 아니다). 지문 + 정답 순열을 블록 하나로 접으면,
           * 같은 cloze 를 재활용했을 때 지문이나 정답 순열에서 잡힌다. */
          var bodyLines = lines(harvest(block, []));
          if (block.kind === 'cloze') {
            var ansSeq = (block.questions || []).map(function (q) { return q.answer; })
              .filter(function (a) { return typeof a === 'string'; });
            if (ansSeq.length) bodyLines.push('[blanks] ' + ansSeq.join(' '));
          }
          if (bodyLines.length) {
            units.push(mkUnit({
              uid: setCode + '::blk:' + mod.id + ':' + bi,
              role: 'text', where: where,
              title: block.title || block.heading || ((mod.label || mod.id) + ' ' + block.kind),
              bodyLines: bodyLines, choices: [],
              meta: {
                scriptOrigin: block.scriptOrigin || null,
                questionIds: (block.questions || []).map(function (q) { return q.id; })
              }
            }));
          }

          /* 2-b. 문항 */
          (block.questions || []).forEach(function (q) {
            var pl = payloadLinesFor(q);
            if (!pl) return;                                  // blank/repeat/interview
            if (!pl.body.length && !pl.choices.length) return;
            var stem = q.prompt || q.sentence || q.context || q.subject || '';
            /* 화면에는 정형문까지 포함한 문항 전체를 보여 준다 — 비교에서 뺐다고
             * 사람이 볼 때까지 감추면 "무엇을 보고 판정했나"를 되짚을 수 없다. */
            units.push(mkUnit({
              uid: setCode + '::' + (q.id || (mod.id + '-' + q.no)),
              role: 'item', where: where,
              qid: q.id || null, no: q.no == null ? null : q.no,
              qkind: q.kind, policy: pl.policy,
              title: (q.id || '') + ' · ' + (stem || pl.choices[0] || q.kind),
              bodyLines: pl.body,
              displayLines: lines(harvest(q, [])),
              stem: stem,
              choices: pl.choices,
              allChoices: (q.choices || []).slice(),
              answerText: answerLabel(q)
            }));
          });
        });
      });
    });

    return units;
  }

  /** 오디오 대본 조각 → 단위. 팩에 텍스트가 없는 repeat/interview/short-response 의
   *  본문은 여기에만 있다. rows: [{id, text, kind}] */
  function unitsFromScriptRows(setCode, rows, sourceLabel) {
    var setId = String(setCode || '').toLowerCase().replace(/\s+/g, '');
    var out = [];
    (rows || []).forEach(function (r) {
      if (!r || !r.text || !String(r.text).trim()) return;
      var m = /-([RLSW]\d+)-(?:q)?0*(\d+)/i.exec(r.id || '');
      var speaking = /-S\d/i.test(r.id || '');
      out.push(mkUnit({
        uid: setCode + '::script:' + r.id,
        role: 'text',
        where: {
          set: setCode, setId: setId,
          section: speaking ? 'speaking' : 'listening',
          sectionLabel: speaking ? 'Speaking' : 'Listening',
          module: m ? m[1].toUpperCase() : '',
          moduleLabel: m ? m[1].toUpperCase() : '',
          blockKind: 'script', blockHeading: r.kind || 'audio script'
        },
        qid: m ? (m[1].toUpperCase() + '-' + Number(m[2])) : null,
        title: r.id,
        bodyLines: lines(String(r.text)), choices: [],
        meta: { source: sourceLabel || null }
      }));
    });
    return out;
  }

  /**
   * 팩 단위와 대본 단위를 합친다. 그냥 concat 하면 안 된다.
   *
   * 대본 조각(config/_*_fragments/*_script.json)은 **팩에 텍스트가 없을 때 그것을
   * 채워 주려고** 있는 파일이다. 그런데 팩이 그 문장을 이미 들고 있으면(예: 스피킹
   * 지시문이 record-set 블록에도, speaking_script.json 에도 있다) 같은 원본이 단위
   * 두 개가 되고, 검사기는 그 둘을 "완전히 동일한 문항"이라며 high 로 올린다.
   * 실제로 그렇게 걸렸다 — SET9 S1/S2 intro 2건.
   *
   * 겹침이 아니라 같은 것을 두 번 센 것이므로, 같은 SET 안에서 팩이 이미 담고 있는
   * 문장은 대본 쪽 단위를 버린다. 팩 쪽을 남기는 이유는 그쪽이 문항 id 를 들고 있어
   * "이 문항 열기"가 동작하기 때문이다.
   */
  function mergeUnits(packUnits, scriptUnits) {
    var have = {};
    packUnits.forEach(function (u) {
      var n = normalize(u.bodyLines.join('\n'));
      if (n) have[u.where.set + ' ' + n] = 1;
    });
    var kept = (scriptUnits || []).filter(function (u) {
      var n = normalize(u.bodyLines.join('\n'));
      return !n || !have[u.where.set + ' ' + n];
    });
    return packUnits.concat(kept);
  }

  /* ══════════════ 3. 군집 → 틀 유도 → payload 확정 ═════════════════════════ */

  /** 원문 줄 기준 군집화. 틀 df 를 군집 수로 세기 위한 사전 단계다(위 설명 참조).
   *  틀 제거 **전** 의 원문 줄만 쓴다 — 그래야 순환이 생기지 않는다. */
  function clusterUnits(units) {
    var parent = units.map(function (_, i) { return i; });
    function find(i) { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; }
    function union(a, b) { a = find(a); b = find(b); if (a !== b) parent[b] = a; }

    var lineSets = units.map(function (u) {
      var s = {};
      u.bodyLines.concat(u.choices).forEach(function (l) { var n = normalize(l); if (n) s[n] = 1; });
      return s;
    });

    var idx = {};
    lineSets.forEach(function (s, ui) {
      for (var n in s) if (Object.prototype.hasOwnProperty.call(s, n)) (idx[n] || (idx[n] = [])).push(ui);
    });

    var tried = {};
    for (var n2 in idx) {
      if (!Object.prototype.hasOwnProperty.call(idx, n2)) continue;
      var list = idx[n2];
      if (list.length > 40) continue;                   // 흔한 줄 — 여기서 묶을 일이 없다
      for (var i = 0; i < list.length; i++) for (var j = i + 1; j < list.length; j++) {
        var a = list[i], b = list[j], key = a + ':' + b;
        if (tried[key]) continue;
        tried[key] = 1;
        var A = lineSets[a], B = lineSets[b], inter = 0, ka = Object.keys(A);
        for (var t = 0; t < ka.length; t++) if (B[ka[t]]) inter++;
        var uni = ka.length + Object.keys(B).length - inter;
        if (uni && inter / uni >= TH.clusterJaccard) union(a, b);
      }
    }
    return units.map(function (_, i) { return find(i); });
  }

  /** 2단계 — 틀을 유도하고 payload 로 비교용 지표를 굳힌다.
   *  내용이 전부 정형문이라 비교할 게 남지 않은 단위는 결과에서 빠진다. */
  function finalizeUnits(units) {
    var cluster = clusterUnits(units);

    /* 줄별 df 를 **서로 다른 군집 수**로 센다. */
    var seenBy = {};
    units.forEach(function (u, ui) {
      var c = cluster[ui], seen = {};
      u.bodyLines.concat(u.choices).forEach(function (l) {
        var n = normalize(l);
        if (!n || seen[n]) return;
        seen[n] = 1;
        (seenBy[n] || (seenBy[n] = {}))[c] = 1;
      });
    });
    var df = {};
    for (var n in seenBy) if (Object.prototype.hasOwnProperty.call(seenBy, n)) df[n] = Object.keys(seenBy[n]).length;

    units.forEach(function (u) {
      u.framedOut = [];
      function keep(l) {
        var nn = normalize(l);
        if (!nn) return false;
        if (df[nn] >= TH.frameDf) { u.framedOut.push({ line: l, df: df[nn] }); return false; }
        return true;
      }
      u.payloadLines = u.bodyLines.filter(keep);
      u.payloadChoices = u.choices.filter(keep);

      u.payload = u.payloadLines.concat(u.payloadChoices).join('\n');
      u.toks = tokens(u.payload);
      u.sh = uniq(shingles(u.toks, K));
      u.norm = normalize(u.payload);
      /* 틀 발문("What is the main topic of the talk?")은 stem 비교에서 뺀다.
       * keep() 은 framedOut 에 기록을 남기므로 여기서는 df 만 본다. */
      var sn = normalize(u.stem || '');
      u.stemNorm = (sn && df[sn] < TH.frameDf) ? sn : '';
      u.choiceNorms = u.payloadChoices.map(normalize).filter(Boolean);
      u.short = u.toks.length < TH.minTokens;
      u.frameOnly = !u.toks.length && !u.choiceNorms.length;
    });

    return units.filter(function (u) { return !u.frameOnly; });
  }

  /* ══════════════ 4. 쌍 비교 ═══════════════════════════════════════════════ */

  function compare(a, b, boiler) {
    var aSet = {}, i;
    for (i = 0; i < a.sh.length; i++) aSet[a.sh[i]] = 1;
    var inter = 0;
    for (i = 0; i < b.sh.length; i++) if (aSet[b.sh[i]]) inter++;
    var union = a.sh.length + b.sh.length - inter;
    var jac = union ? inter / union : 0;
    var minLen = Math.min(a.sh.length, b.sh.length);
    var containment = minLen ? inter / minLen : 0;

    var exact = !!(a.norm && a.norm === b.norm);
    var sameStem = !!(a.stemNorm && a.stemNorm === b.stemNorm);

    var sharedChoices = 0;
    if (a.choiceNorms.length && b.choiceNorms.length) {
      var pool = b.choiceNorms.slice();
      a.choiceNorms.forEach(function (c) {
        var k = pool.indexOf(c);
        if (k >= 0) { sharedChoices++; pool.splice(k, 1); }
      });
    }

    var run = 0;
    if (inter >= 3 && a.toks.length <= 1500 && b.toks.length <= 1500) run = longestRun(a.toks, b.toks);
    else if (exact) run = a.toks.length;

    var reasons = [], sev = null;
    function raise(level, why) {
      reasons.push(why);
      if (level === 'high' || sev === 'high') sev = 'high';
      else sev = sev || level;
    }

    if (exact) raise('high', '정규화 후 텍스트가 완전히 동일하다.');
    if (!a.short && !b.short) {
      if (jac >= TH.jaccardHigh) raise('high', '4-gram 자카드 ' + jac.toFixed(2) + ' ≥ ' + TH.jaccardHigh + ' — 문장만 다시 쓴 수준.');
      else if (jac >= TH.jaccardWatch) raise('watch', '4-gram 자카드 ' + jac.toFixed(2) + ' — 소재·구성이 상당히 겹친다.');

      if (minLen >= TH.containmentMinShingles) {
        if (containment >= TH.containmentHigh) raise('high', '짧은 쪽의 ' + Math.round(containment * 100) + '% 가 긴 쪽 안에 그대로 들어 있다.');
        else if (containment >= TH.containmentWatch) raise('watch', '짧은 쪽의 ' + Math.round(containment * 100) + '% 가 긴 쪽과 겹친다.');
      }

      if (run >= TH.runHigh) raise('high', '연속 ' + run + '단어가 그대로 일치 — 문단을 옮긴 흔적.');
      else if (run >= TH.runWatch) raise('watch', '연속 ' + run + '단어가 그대로 일치.');
    }

    if (sharedChoices >= TH.sharedChoicesHigh) {
      raise('high', '선택지 ' + sharedChoices + '개가 그대로 일치 (' + a.choices.length + '개 중) — 문항 재활용 서명.');
    } else if (sharedChoices === 2 && a.choices.length <= 4) {
      raise('watch', '선택지 2개가 그대로 일치.');
    }

    if (sameStem && !exact) raise('watch', '발문(stem)이 글자 그대로 같다 — 정형 발문일 수도, 재활용일 수도 있다.');

    if (!sev) return null;

    /* 정형문 강등 — payload 가 통째로 같은 군집이 3곳 이상이면 그건 유형의 틀이다.
     * 단, 선택지까지 겹치면 정형문 논리가 성립하지 않으므로 강등하지 않는다. */
    var bd = Math.max(boiler[a.norm] || 0, boiler[b.norm] || 0);
    if (bd >= TH.boilerplateDf && sharedChoices < TH.sharedChoicesHigh) {
      reasons.push('정형문 강등: 같은 내용이 서로 다른 문항 ' + bd + '곳에 반복 등장한다.');
      sev = 'info';
    }

    return {
      severity: sev, jaccard: round4(jac), containment: round4(containment),
      sharedShingles: inter, longestRun: run, sharedChoices: sharedChoices,
      exact: exact, sameStem: sameStem, reasons: reasons
    };
  }

  function round4(n) { return Math.round(n * 10000) / 10000; }

  /* ══════════════ 5. 바깥 계약 ═════════════════════════════════════════════ */

  function unitOut(u) {
    var q = u.qid || (u.meta && u.meta.questionIds && u.meta.questionIds[0]) || '';
    return {
      uid: u.uid, role: u.role, qid: u.qid || null, no: u.no == null ? null : u.no,
      qkind: u.qkind || null, policy: u.policy || null, title: u.title,
      set: u.where.set, setId: u.where.setId,
      section: u.where.section, sectionLabel: u.where.sectionLabel,
      module: u.where.module, moduleLabel: u.where.moduleLabel,
      blockKind: u.where.blockKind, blockHeading: u.where.blockHeading,
      /* text/choices 는 화면에 보여 줄 원문 전체(정형문 포함), payload 는 실제로 비교한 것.
       * 둘을 같이 실어야 "무엇을 보고 이렇게 판정했나"를 되짚을 수 있다. */
      text: u.text, choices: u.allChoices || u.choices || [], answerText: u.answerText || '',
      payload: u.payload, framedOut: u.framedOut || [],
      tokenCount: u.toks.length, meta: u.meta || null,
      href: 'admin-questions.html?set=' + u.where.setId + (q ? '&q=' + encodeURIComponent(q) : '')
    };
  }

  /**
   * 단위 배열을 받아 겹침 쌍을 낸다.
   * @param {Array} rawUnits  unitsFromPack / unitsFromScriptRows 결과를 concat 한 것
   * @param {Object} [opts]   { allow: {pairKey: {reason}} }
   * @return {{pairs:Array, counts:Object, unitCount:number, frameOnlyUnits:number,
   *           candidatePairs:number, thresholds:Object}}
   */
  function analyze(rawUnits, opts) {
    opts = opts || {};
    var allow = opts.allow || {};

    var rawCount = rawUnits.length;
    var units = finalizeUnits(rawUnits);
    var frameOnly = rawCount - units.length;

    /* payload 기준 정형문 빈도 — 군집 수로 센다(단위 수로 세면 중복이 스스로를 가린다). */
    var cl = clusterUnits(units), byNormCluster = {};
    units.forEach(function (u, ui) {
      if (!u.norm) return;
      (byNormCluster[u.norm] || (byNormCluster[u.norm] = {}))[cl[ui]] = 1;
    });
    var boiler = {};
    for (var nk in byNormCluster) {
      if (Object.prototype.hasOwnProperty.call(byNormCluster, nk)) boiler[nk] = Object.keys(byNormCluster[nk]).length;
    }

    /* 후보 쌍 — shingle 역색인. 흔한 shingle 은 후보 생성에서 뺀다(지표 계산에는 남는다). */
    var index = {}, pairSeen = {}, candidates = [];
    units.forEach(function (u, ui) {
      u.sh.forEach(function (s) { (index[s] || (index[s] = [])).push(ui); });
    });
    function addPair(a, b) {
      if (units[a].role !== units[b].role) return;
      var key = a < b ? a + ':' + b : b + ':' + a;
      if (pairSeen[key]) return;
      pairSeen[key] = 1;
      candidates.push([Math.min(a, b), Math.max(a, b)]);
    }
    for (var s in index) {
      if (!Object.prototype.hasOwnProperty.call(index, s)) continue;
      var list = index[s];
      if (list.length > 30) continue;
      for (var i = 0; i < list.length; i++) for (var j = i + 1; j < list.length; j++) addPair(list[i], list[j]);
    }
    /* 완전일치는 shingle 이 흔해 후보에서 빠질 수 있다 — 정규화 텍스트로 한 번 더 훑는다. */
    var byNorm = {};
    units.forEach(function (u, ui) { if (u.norm) (byNorm[u.norm] || (byNorm[u.norm] = [])).push(ui); });
    for (var nn in byNorm) {
      if (!Object.prototype.hasOwnProperty.call(byNorm, nn)) continue;
      var l2 = byNorm[nn];
      for (var x = 0; x < l2.length; x++) for (var y = x + 1; y < l2.length; y++) addPair(l2[x], l2[y]);
    }

    var pairs = [];
    candidates.forEach(function (p) {
      var a = units[p[0]], b = units[p[1]];
      var r = compare(a, b, boiler);
      if (!r) return;
      var key = a.uid + ' | ' + b.uid;
      var al = allow[key] || allow[b.uid + ' | ' + a.uid] || null;
      pairs.push({
        key: key,
        severity: al ? 'info' : r.severity,
        allowlisted: !!al,
        allowReason: al ? al.reason : null,
        scope: a.where.set === b.where.set ? 'intra' : 'cross',
        role: a.role,
        score: round4(Math.max(r.jaccard, r.containment)),
        metrics: {
          jaccard: r.jaccard, containment: r.containment, sharedShingles: r.sharedShingles,
          longestRun: r.longestRun, sharedChoices: r.sharedChoices,
          exact: r.exact, sameStem: r.sameStem
        },
        reasons: r.reasons.concat(al ? ['허용목록: ' + al.reason] : []),
        a: unitOut(a), b: unitOut(b)
      });
    });

    var RANK = { high: 0, watch: 1, info: 2 };
    pairs.sort(function (x, y) {
      return (RANK[x.severity] - RANK[y.severity]) || (y.score - x.score) ||
             (x.key < y.key ? -1 : x.key > y.key ? 1 : 0);
    });

    var counts = { high: 0, watch: 0, info: 0, allowlisted: 0 };
    pairs.forEach(function (p) { counts[p.severity]++; if (p.allowlisted) counts.allowlisted++; });

    return {
      pairs: pairs, counts: counts, unitCount: units.length,
      frameOnlyUnits: frameOnly, candidatePairs: candidates.length, thresholds: TH
    };
  }

  /** 허용목록 파일(dup-allowlist.json) → analyze 가 쓰는 맵.
   *  reason 이 비어 있는 항목은 버린다 — 빈 알리바이로 검사를 끄지 못하게. */
  function allowMap(json) {
    var out = {};
    ((json && json.allow) || []).forEach(function (row) {
      if (!row || !row.pair || !row.reason || !String(row.reason).trim()) return;
      out[row.pair] = row;
    });
    return out;
  }

  return {
    TH: TH, FIELD_POLICY: FIELD_POLICY, SKIP_KEYS: SKIP_KEYS,
    normalize: normalize, tokens: tokens, shingles: shingles, longestRun: longestRun,
    harvest: harvest, lines: lines, payloadLinesFor: payloadLinesFor,
    unitsFromPack: unitsFromPack, unitsFromScriptRows: unitsFromScriptRows,
    clusterUnits: clusterUnits, finalizeUnits: finalizeUnits, compare: compare,
    unitOut: unitOut, analyze: analyze, allowMap: allowMap, mergeUnits: mergeUnits
  };
});
