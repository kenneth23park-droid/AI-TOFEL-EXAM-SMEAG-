#!/usr/bin/env node
/* dup_check.js — 문항·지문 중복(겹침) 검사기.
 *
 * 새 SET 을 만들 때 "기존 SET 과 겹치는 문항이 있는가"를 기계적으로 판정한다.
 * 사람이 눈으로 훑어서는 SET 이 3개만 넘어가도 못 잡는다 — 특히 다음 세 가지가
 * 육안 검수를 통과해 버린다.
 *
 *   1) 선택지 4개 중 3개가 그대로이고 문장만 다시 쓴 문항 (재활용 서명)
 *   2) 지문 문단 하나를 통째로 옮겨 온 뒤 앞뒤만 바꾼 경우 (긴 verbatim 조각)
 *   3) 발문(stem)은 같은데 선택지가 다른 경우 — 보일러플레이트일 수도, 재활용일 수도 있다
 *
 * 판정은 세 등급으로만 낸다. 회색지대를 사람에게 넘기기 위해서다.
 *   high  — 겹침으로 본다. 빌드/테스트를 실패시킨다(--fail-on high, 기본값).
 *   watch — 사람이 봐야 한다. 실패시키지 않고 뷰어에 남긴다.
 *   info  — 보일러플레이트(여러 SET 에 정상적으로 반복되는 지시문·정형 발문)로 강등된 것.
 *
 * 의도적으로 허용한 겹침은 sg2/config/dup-allowlist.json 에 사유와 함께 적는다.
 * 등급을 낮추는 유일한 수단이며, 사유 없는 항목은 무시된다(빈 알리바이 금지).
 *
 * 실행:
 *   node studyground/tools/dup_check.js                       # 저장소의 모든 팩끼리
 *   node studyground/tools/dup_check.js --candidate <파일.js>  # 새 팩을 기존 전부와
 *   node studyground/tools/dup_check.js --fail-on watch       # watch 도 실패로
 *   node studyground/tools/dup_check.js --quiet                # 요약만
 *
 * 산출:
 *   sg2/config/dup-report.json   기계용 (테스트·CI)
 *   sg2/config/dup-report.js     화면용 (window.SG_DUP_REPORT — file:// 에서도 로드된다)
 *   → 뷰어: sg2/admin-dup.html
 *
 * 표준 라이브러리만 쓴다. 팩은 sg2 런타임과 같은 방식(window 섀도우 + eval)으로 읽는다.
 */

'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');            // studyground/
var SG2 = path.join(ROOT, 'sg2');

/* ══════════════ 0. 판정 상수 ═══════════════════════════════════════════════
 * 임계값은 전부 여기 한 곳에만 적는다. 리포트에 그대로 실어 보내므로 뷰어가
 * "왜 이 등급인가"를 화면에서 되짚을 수 있다. */
var K = 4;                       // shingle 크기(토큰). 문항이 짧아 5 보다 4 가 맞다.
var TH = {
  shingleK: K,
  jaccardHigh: 0.55,             // 절반 이상이 같은 4-gram → 다시 쓴 티가 안 나는 재활용
  jaccardWatch: 0.28,
  containmentHigh: 0.80,         // 짧은 쪽이 긴 쪽에 통째로 들어 있음
  /* 0.25 는 함정 팩 실측으로 고른 값이다. SET9 L2-B2 지문(257단어)의 한 대목을
   * 44단어로 가볍게 바꿔 쓴 패러프레이즈는 자카드 0.04 · 최장연속 9 로 다른 모든
   * 지표 아래를 지나간다. containment 만 0.27 로 남는다. 임계값별 실측:
   *   0.50 → 함정 미검출, 베이스라인 watch 3     0.35/0.30 → 미검출, watch 4
   *   0.25 → 검출(watch), watch 4               0.20 → 검출, watch 4
   * 0.35 에서 이미 소음이 1건 늘고 0.25 까지는 더 늘지 않으므로, 같은 값으로
   * 탐지력만 얻는 0.25 를 쓴다. */
  containmentWatch: 0.25,
  containmentMinShingles: 10,    // 그보다 짧으면 containment 는 우연히도 1.0 이 된다
  runHigh: 25,                   // 연속 일치 토큰 수 — 25 단어면 문단을 옮긴 것이다
  runWatch: 12,
  sharedChoicesHigh: 3,          // 4지선다에서 3개 일치 = 재활용 서명
  minTokens: 6,                  // 이보다 짧은 단위는 완전일치만 본다
  boilerplateDf: 3,              // 같은 정규화 텍스트가 3개 단위 이상에 나오면 정형문
  frameDf: 3                     // 같은 줄이 서로 다른 단위 3곳 이상 → 틀(frame). 아래 설명 참조.
};

/* ── 틀(frame) 과 내용(payload) ─────────────────────────────────────────────
 * TOEFL 문항은 유형이 문장을 강제한다. "What is the main topic of the talk?",
 * "Listen to the question and select the best response.", insert 문항의 지시문과
 * Position A~D 는 SET 이 달라도 글자까지 같아야 정상이다. 이걸 겹침으로 세면
 * 리포트가 정형문 쌍으로만 가득 차고, 정작 진짜 재활용이 그 안에 묻힌다.
 *
 * 그래서 단위를 두 겹으로 나눈다.
 *   frame   — 유형이 정하는 문장. 비교에서 뺀다.
 *   payload — 이 문항만의 내용. 이것만 비교한다.
 *
 * 틀을 목록으로 적어 두지 않는다(SET 이 늘 때마다 손이 가고, 빠뜨리면 조용히 오탐이 난다).
 * 대신 말뭉치에서 유도한다: **같은 줄이 서로 다른 단위 frameDf(3)곳 이상에 등장하면,
 * 그 줄은 어떤 두 단위도 구별해 주지 못하므로 정의상 틀이다.** 두 문항이 정말로
 * 중복이라 df=2 인 경우는 걸리지 않으므로, 이 규칙이 진짜 겹침을 삼키지 않는다.
 *
 * 말뭉치 유도만으로 부족한 자리 하나가 있다. insert 문항의 Position A~D 는 저장소에
 * insert 가 2개뿐이라 df=2 로 걸러지지 않는다. 그런 "유형이 필드째로 고정하는" 경우는
 * 아래 FIELD_POLICY 에 명시한다 — 어느 필드가 내용인지는 유형을 아는 사람이 정한다. */
var FIELD_POLICY = {
  mcq:        { use: ['prompt', 'sentence'], choices: true },
  insert:     { use: ['sentence'], choices: false },   // 지시문·Position A~D 는 유형이 고정
  build:      { use: ['sentence'], choices: false },   // context/tiles/slots 는 sentence 에서 파생
  email:      { use: ['subject', 'situation', 'bullets'], choices: false },
  discussion: { use: ['prompt', 'posts'], choices: false },
  blank:      null,   // 문항 단위를 만들지 않는다 — cloze 블록 하나로 접는다(아래 참조)
  repeat:     null,   // 팩에 텍스트가 없다 — 전사 단위(_fragments/*_script.json)가 담당
  interview:  null
};

/* 내용이 아닌 필드 — 겹침 판정에서 뺀다.
 * heading/instruction 은 SET 마다 같은 게 정상이고(“Fill in the blank.”),
 * 여기 넣어 두지 않으면 리포트가 지시문 쌍으로만 가득 찬다. */
var SKIP_KEYS = {
  id: 1, kind: 1, no: 1, layout: 1, answer: 1, answerTokens: 0,
  audio: 1, image: 1, introAudio: 1, perQuestionAudio: 1,
  heading: 1, instruction: 1, label: 1, labelKo: 1,
  prepSec: 1, respondSec: 1, minWords: 1, timeLimitSec: 1,
  scriptOrigin: 1, scriptNote: 1, scriptBlockId: 1, scriptKind: 1, revisionNote: 1,
  markerOrigin: 1, markerNote: 1, origin: 1, originNote: 1,
  promptRaw: 1, choicesRaw: 1, answerKeyRaw: 1, sourceCorrections: 1,
  questions: 1, blocks: 1, modules: 1, sections: 1,
  slots: 1, voices: 1,
  hint: 1,                       // cloze 힌트("th") — 내용이 아니라 입력 보조 조각
  tiles: 1, trapTiles: 1,        // build 문항의 타일 — sentence 에서 파생된 같은 단어들
  situationLabel: 1, bulletsLabel: 1, to: 1
};

/* ══════════════ 1. 정규화 · shingle ════════════════════════════════════════ */

/** 표기 차이를 없앤다 — 이걸 통과한 두 문자열이 같으면 "같은 문장"으로 본다.
 *  곱슬따옴표, {{1}} 빈칸 마커, 문항번호 접두("21."), 연속 공백을 제거한다. */
function normalize(s) {
  return String(s == null ? '' : s)
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\{\{\s*[A-Za-z0-9]+\s*\}\}/g, ' ')
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
  var seen = Object.create(null), out = [];
  for (var i = 0; i < arr.length; i++) if (!seen[arr[i]]) { seen[arr[i]] = 1; out.push(arr[i]); }
  return out;
}

/** 두 토큰열의 최장 연속 공통 구간(단어 수). 후보 쌍에만 돌린다 — O(n·m). */
function longestRun(a, b) {
  if (!a.length || !b.length) return 0;
  var prev = new Array(b.length + 1).fill(0), best = 0;
  for (var i = 1; i <= a.length; i++) {
    var cur = new Array(b.length + 1).fill(0);
    for (var j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        cur[j] = prev[j - 1] + 1;
        if (cur[j] > best) best = cur[j];
      }
    }
    prev = cur;
  }
  return best;
}

/* ══════════════ 2. 팩 로드 ═════════════════════════════════════════════════ */

/** sg2 런타임과 같은 방식으로 콘텐츠 팩을 읽는다(ES5 · window 전역 · 빌드 없음). */
function loadPack(file) {
  var before = Object.keys(global).filter(function (k) { return /^SMEAG_SET/.test(k); });
  global.window = global;
  // eslint-disable-next-line no-eval
  eval(fs.readFileSync(file, 'utf8'));
  var after = Object.keys(global).filter(function (k) { return /^SMEAG_SET/.test(k); });
  var fresh = after.filter(function (k) { return before.indexOf(k) < 0; });
  var key = fresh[0] || after[after.length - 1];
  var pack = global[key];
  if (!pack || !pack.sections) throw new Error('콘텐츠 팩이 아님: ' + file);
  pack.__file = path.relative(ROOT, file);
  return pack;
}

function discoverPacks() {
  var dir = path.join(SG2, 'assets');
  return fs.readdirSync(dir)
    .filter(function (f) { return /^set[0-9a-z]+\.js$/i.test(f); })
    .sort()
    .map(function (f) { return path.join(dir, f); });
}

/* ══════════════ 3. 단위(unit) 추출 ═════════════════════════════════════════
 * 비교 단위는 두 종류다.
 *   item — 문항 하나 (발문 + 선택지 + 정답)
 *   text — 지문/전사 하나 (리딩 지문, cloze 템플릿, 리스닝 스크립트)
 * 서로 다른 종류끼리는 비교하지 않는다. */

/** 객체에서 내용 문자열만 재귀 수집. 새 문항 종류가 생겨도 자동으로 따라온다. */
function harvest(node, skip, out) {
  out = out || [];
  if (node == null) return out;
  if (typeof node === 'string') { if (node.trim()) out.push(node); return out; }
  if (typeof node === 'number' || typeof node === 'boolean') return out;
  if (Array.isArray(node)) { node.forEach(function (v) { harvest(v, skip, out); }); return out; }
  if (typeof node === 'object') {
    Object.keys(node).forEach(function (k) {
      if (skip[k]) return;
      if (k.charAt(0) === '_') return;
      harvest(node[k], skip, out);
    });
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
  if (Array.isArray(node)) { node.forEach(function (v) { lines(v, out); }); return out; }
  if (typeof node === 'object') { harvest(node, SKIP_KEYS, []).forEach(function (s) { lines(s, out); }); }
  return out;
}

/** 이 문항에서 "이 문항만의 내용"에 해당하는 줄들. 유형을 모르면 일반 수확으로 떨어진다
 *  — 새 문항 종류가 생겨도 검사에서 조용히 빠지지 않는다. */
function payloadLinesFor(q) {
  var pol = FIELD_POLICY.hasOwnProperty(q.kind) ? FIELD_POLICY[q.kind] : undefined;
  if (pol === null) return null;                       // 단위를 만들지 않는다
  if (pol === undefined) {
    return { body: lines(harvest(q, SKIP_KEYS, [])), choices: (q.choices || []).slice(), policy: 'generic' };
  }
  var body = [];
  pol.use.forEach(function (f) { if (q[f] != null) lines(q[f], body); });
  return { body: body, choices: pol.choices ? (q.choices || []).slice() : [], policy: q.kind };
}

function answerLabel(q) {
  if (q.answer == null) return '';
  if (typeof q.answer === 'number' && q.choices) return 'ABCDEFG'.charAt(q.answer) + '. ' + q.choices[q.answer];
  if (Array.isArray(q.answerTokens)) return q.answerTokens.join(' ');
  return String(q.answer);
}

function unitsFromPack(pack) {
  var units = [];
  var setCode = pack.code || 'SET?';
  var setId = setCode.toLowerCase().replace(/\s+/g, '');

  (pack.sections || []).forEach(function (sec) {
    (sec.modules || []).forEach(function (mod) {
      (mod.blocks || []).forEach(function (block, bi) {
        var where = {
          set: setCode, setId: setId,
          section: sec.id, sectionLabel: sec.label || sec.id,
          module: mod.id, moduleLabel: mod.label || mod.id,
          blockKind: block.kind, blockHeading: block.heading || ''
        };

        /* 3-a. 블록 본문 — 지문 · cloze 템플릿 · 리스닝 전사.
         * cloze 는 빈칸 문항을 따로 세지 않고(한 칸짜리 답 "that" 이 SET 을 넘어 일치하는
         * 건 겹침이 아니다) 지문 + 정답 순열을 블록 하나로 접는다. 같은 cloze 를 재활용하면
         * 지문이 같거나 정답 순열이 같으므로 여기서 잡힌다. */
        var bodyLines = lines(harvest(block, SKIP_KEYS, []));
        if (block.kind === 'cloze') {
          var ansSeq = (block.questions || []).map(function (q) { return q.answer; })
            .filter(function (a) { return typeof a === 'string'; });
          if (ansSeq.length) bodyLines.push('[blanks] ' + ansSeq.join(' '));
        }
        if (bodyLines.length) {
          units.push(mkUnit({
            uid: setCode + '::blk:' + mod.id + ':' + bi,
            role: 'text',
            where: where,
            title: block.title || block.heading || (mod.label + ' ' + block.kind),
            bodyLines: bodyLines,
            choices: [],
            meta: {
              scriptOrigin: block.scriptOrigin || null,
              questionIds: (block.questions || []).map(function (q) { return q.id; })
            }
          }));
        }

        /* 3-b. 문항 */
        (block.questions || []).forEach(function (q) {
          var pl = payloadLinesFor(q);
          if (!pl) return;                                   // blank/repeat/interview
          if (!pl.body.length && !pl.choices.length) return;
          var stem = q.prompt || q.sentence || q.context || q.subject || '';
          /* 화면에는 정형문까지 포함한 문항 전체를 보여 준다 — 비교에서 뺐다고
           * 사람이 볼 때까지 감추면 "무엇을 보고 판정했나"를 되짚을 수 없다. */
          var display = lines(harvest(q, SKIP_KEYS, []));
          units.push(mkUnit({
            uid: setCode + '::' + (q.id || (mod.id + '-' + q.no)),
            role: 'item',
            where: where,
            qid: q.id || null,
            no: q.no,
            qkind: q.kind,
            policy: pl.policy,
            title: (q.id || '') + ' · ' + (stem || pl.choices[0] || q.kind),
            bodyLines: pl.body,
            displayLines: display,
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

/** 오디오 전사 조각(config/_set*_fragments/*_script.json) — 팩에 텍스트가 없는
 *  repeat/interview/short-response 문항의 본문은 여기에만 있다. */
function unitsFromScripts(setCode) {
  var setId = setCode.toLowerCase().replace(/\s+/g, '');
  var dir = path.join(SG2, 'config', '_' + setId + '_fragments');
  var out = [];
  if (!fs.existsSync(dir)) return out;

  fs.readdirSync(dir).filter(function (f) { return /_script\.json$/.test(f); }).forEach(function (f) {
    var raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    var rows = [];
    if (Array.isArray(raw.lines)) {
      rows = raw.lines.map(function (l) { return { id: l.id, text: l.text, kind: l.kind }; });
    } else {
      Object.keys(raw).forEach(function (id) {
        var v = raw[id];
        if (v && typeof v === 'object' && v.text) rows.push({ id: id, text: v.text, kind: v.kind });
      });
    }
    rows.forEach(function (r) {
      if (!r.text || !String(r.text).trim()) return;
      var m = /-([RLSW]\d+)-(?:q)?0*(\d+)/i.exec(r.id || '');
      out.push(mkUnit({
        uid: setCode + '::script:' + r.id,
        role: 'text',
        where: {
          set: setCode, setId: setId,
          section: /-S\d/i.test(r.id || '') ? 'speaking' : 'listening',
          sectionLabel: /-S\d/i.test(r.id || '') ? 'Speaking' : 'Listening',
          module: m ? m[1].toUpperCase() : '',
          moduleLabel: m ? m[1].toUpperCase() : '',
          blockKind: 'script', blockHeading: r.kind || 'audio script'
        },
        qid: m ? (m[1].toUpperCase() + '-' + Number(m[2])) : null,
        title: r.id,
        bodyLines: lines(String(r.text)),
        choices: [],
        meta: { source: path.relative(ROOT, path.join(dir, f)) }
      }));
    });
  });
  return out;
}

/** 1단계 — 줄만 담아 둔다. 틀 판정은 말뭉치 전체를 봐야 하므로 여기서 못 한다. */
function mkUnit(u) {
  u.bodyLines = u.bodyLines || [];
  u.choices = u.choices || [];
  u.displayLines = u.displayLines || u.bodyLines;
  u.text = u.displayLines.join('\n');            // 화면용 — 정형문 포함, 원문 그대로
  return u;
}

/** 원문 줄 기준으로 단위를 군집화한다 — 틀 판정 전에 반드시 먼저 돌아야 한다.
 *
 * 이유: 틀 df 를 "단위 수"로 세면 **중복을 여러 개 심는 것만으로 틀 판정을 우회**할 수
 * 있다(함정 팩 검증에서 실제로 뚫렸다: 같은 선택지 4개를 3개 문항에 넣자 df=3 이 되어
 * 재활용 선택지가 정형문으로 강등됐다). 중복끼리는 서로 다른 문항이 아니므로,
 * df 는 **군집 수**로 세야 한다. 원문 줄 자카드 0.5 이상이면 한 군집으로 묶는다.
 *
 * 군집화는 정규화된 원문 줄만 쓴다(틀 제거 전) — 그래야 순환이 생기지 않는다. */
var CLUSTER_JACCARD = 0.5;

function clusterUnits(units) {
  var parent = units.map(function (_, i) { return i; });
  function find(i) { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; }
  function union(a, b) { a = find(a); b = find(b); if (a !== b) parent[b] = a; }

  var lineSets = units.map(function (u) {
    var s = Object.create(null);
    u.bodyLines.concat(u.choices).forEach(function (l) { var n = normalize(l); if (n) s[n] = 1; });
    return s;
  });

  var idx = Object.create(null);
  lineSets.forEach(function (s, ui) {
    Object.keys(s).forEach(function (n) { (idx[n] || (idx[n] = [])).push(ui); });
  });

  var tried = Object.create(null);
  Object.keys(idx).forEach(function (n) {
    var list = idx[n];
    if (list.length > 40) return;                     // 흔한 줄 — 여기서 묶을 일이 없다
    for (var i = 0; i < list.length; i++) for (var j = i + 1; j < list.length; j++) {
      var a = list[i], b = list[j], key = a + ':' + b;
      if (tried[key]) continue;
      tried[key] = 1;
      var A = lineSets[a], B = lineSets[b], inter = 0;
      var ka = Object.keys(A);
      for (var t = 0; t < ka.length; t++) if (B[ka[t]]) inter++;
      var uni = ka.length + Object.keys(B).length - inter;
      if (uni && inter / uni >= CLUSTER_JACCARD) union(a, b);
    }
  });

  return units.map(function (_, i) { return find(i); });
}

/** 2단계 — 말뭉치에서 틀을 유도하고, 틀을 뺀 payload 로 비교용 지표를 굳힌다. */
function finalizeUnits(units) {
  var cluster = clusterUnits(units);

  /* 줄별 df: **서로 다른 군집 수**로 센다. 같은 줄을 여러 번 쓰는 단위도,
   * 서로 중복인 단위 뭉치도 각각 1 로만 친다. */
  var seenBy = Object.create(null);
  units.forEach(function (u, ui) {
    var c = cluster[ui], seen = Object.create(null);
    u.bodyLines.concat(u.choices).forEach(function (l) {
      var n = normalize(l);
      if (!n || seen[n]) return;
      seen[n] = 1;
      (seenBy[n] || (seenBy[n] = Object.create(null)))[c] = 1;
    });
  });
  var df = Object.create(null);
  Object.keys(seenBy).forEach(function (n) { df[n] = Object.keys(seenBy[n]).length; });

  units.forEach(function (u) {
    u.framedOut = [];
    function keep(l) {
      var n = normalize(l);
      if (!n) return false;
      if (df[n] >= TH.frameDf) { u.framedOut.push({ line: l, df: df[n] }); return false; }
      return true;
    }
    u.payloadLines = u.bodyLines.filter(keep);
    u.payloadChoices = u.choices.filter(keep);

    var payload = u.payloadLines.concat(u.payloadChoices).join('\n');
    u.payload = payload;
    u.toks = tokens(payload);
    u.sh = uniq(shingles(u.toks, K));
    u.norm = normalize(payload);
    /* 틀 발문("What is the main topic of the talk?")은 stem 비교에서 뺀다 —
     * 부작용 없이 df 만 본다(keep() 은 framedOut 에 기록을 남기므로 쓰지 않는다). */
    var sn = normalize(u.stem || '');
    u.stemNorm = (sn && df[sn] < TH.frameDf) ? sn : '';
    u.choiceNorms = u.payloadChoices.map(normalize).filter(Boolean);
    u.short = u.toks.length < TH.minTokens;
    u.frameOnly = !u.toks.length && !u.choiceNorms.length;
  });

  return units.filter(function (u) { return !u.frameOnly; });
}

/* ══════════════ 4. 쌍 비교 ═════════════════════════════════════════════════ */

function jaccard(aSet, b) {
  var inter = 0;
  for (var i = 0; i < b.length; i++) if (aSet[b[i]]) inter++;
  var union = Object.keys(aSet).length + b.length - inter;
  return { inter: inter, jac: union ? inter / union : 0 };
}

function compare(a, b, boiler) {
  var aSet = Object.create(null);
  for (var i = 0; i < a.sh.length; i++) aSet[a.sh[i]] = 1;
  var j = jaccard(aSet, b.sh);
  var minLen = Math.min(a.sh.length, b.sh.length);
  var containment = minLen ? j.inter / minLen : 0;

  var exact = a.norm && a.norm === b.norm;
  var sameStem = a.stemNorm && a.stemNorm === b.stemNorm;

  var sharedChoices = 0;
  if (a.choiceNorms.length && b.choiceNorms.length) {
    var pool = b.choiceNorms.slice();
    a.choiceNorms.forEach(function (c) {
      var k = pool.indexOf(c);
      if (k >= 0) { sharedChoices++; pool.splice(k, 1); }
    });
  }

  var run = 0;
  if (j.inter >= 3 && a.toks.length <= 1500 && b.toks.length <= 1500) run = longestRun(a.toks, b.toks);
  else if (exact) run = a.toks.length;

  var reasons = [], sev = null;

  function raise(level, why) {
    reasons.push(why);
    if (level === 'high' || sev === 'high') sev = 'high';
    else sev = sev || level;
  }

  if (exact) raise('high', '정규화 후 텍스트가 완전히 동일하다.');
  if (!a.short && !b.short) {
    if (j.jac >= TH.jaccardHigh) raise('high', '4-gram 자카드 ' + j.jac.toFixed(2) + ' ≥ ' + TH.jaccardHigh + ' — 문장만 다시 쓴 수준.');
    else if (j.jac >= TH.jaccardWatch) raise('watch', '4-gram 자카드 ' + j.jac.toFixed(2) + ' — 소재·구성이 상당히 겹친다.');

    if (minLen >= TH.containmentMinShingles) {
      if (containment >= TH.containmentHigh) raise('high', '짧은 쪽의 ' + Math.round(containment * 100) + '% 가 긴 쪽 안에 그대로 들어 있다.');
      else if (containment >= TH.containmentWatch) raise('watch', '짧은 쪽의 ' + Math.round(containment * 100) + '% 가 긴 쪽과 겹친다.');
    }

    if (run >= TH.runHigh) raise('high', '연속 ' + run + '단어가 그대로 일치 — 문단을 옮긴 흔적.');
    else if (run >= TH.runWatch) raise('watch', '연속 ' + run + '단어가 그대로 일치.');
  } else if (exact) {
    // 짧은 단위는 완전일치만 본다(위에서 이미 high).
  }

  if (sharedChoices >= TH.sharedChoicesHigh) {
    raise('high', '선택지 ' + sharedChoices + '개가 그대로 일치 (' + a.choices.length + '개 중) — 문항 재활용 서명.');
  } else if (sharedChoices === 2 && a.choices.length <= 4) {
    raise('watch', '선택지 2개가 그대로 일치.');
  }

  if (sameStem && !exact) raise('watch', '발문(stem)이 글자 그대로 같다 — 정형 발문일 수도, 재활용일 수도 있다.');

  if (!sev) return null;

  /* 보일러플레이트 강등 — 여러 단위에 정상적으로 반복되는 정형문이면 info 로 내린다.
   * 단, 선택지까지 겹치면 정형문 논리가 성립하지 않으므로 강등하지 않는다. */
  var isBoiler = (boiler[a.norm] >= TH.boilerplateDf) || (boiler[b.norm] >= TH.boilerplateDf);
  if (isBoiler && sharedChoices < TH.sharedChoicesHigh) {
    reasons.push('정형문 강등: 같은 문장이 서로 다른 단위 ' +
      Math.max(boiler[a.norm] || 0, boiler[b.norm] || 0) + '곳에 반복 등장한다.');
    sev = 'info';
  }

  return {
    severity: sev,
    jaccard: +j.jac.toFixed(4),
    containment: +containment.toFixed(4),
    sharedShingles: j.inter,
    longestRun: run,
    sharedChoices: sharedChoices,
    exact: !!exact,
    sameStem: !!sameStem,
    reasons: reasons
  };
}

/* ══════════════ 5. 실행 ════════════════════════════════════════════════════ */

function unitOut(u) {
  return {
    uid: u.uid, role: u.role, qid: u.qid || null, no: u.no == null ? null : u.no,
    qkind: u.qkind || null, policy: u.policy || null, title: u.title,
    set: u.where.set, setId: u.where.setId,
    section: u.where.section, sectionLabel: u.where.sectionLabel,
    module: u.where.module, moduleLabel: u.where.moduleLabel,
    blockKind: u.where.blockKind, blockHeading: u.where.blockHeading,
    /* text/choices 는 화면에 보여 줄 원문 전체(정형문 포함), payload 는 실제로 비교한 것.
     * 둘을 같이 실어야 뷰어에서 "무엇을 보고 이렇게 판정했나"를 되짚을 수 있다. */
    text: u.text, choices: u.allChoices || u.choices || [], answerText: u.answerText || '',
    payload: u.payload, framedOut: u.framedOut || [],
    tokenCount: u.toks.length,
    meta: u.meta || null,
    /* 뷰어의 "이 문항 열기" 링크. 문항이 아닌 지문은 블록의 첫 문항으로 보낸다. */
    href: (function () {
      var q = u.qid || (u.meta && u.meta.questionIds && u.meta.questionIds[0]) || '';
      return 'admin-questions.html?set=' + u.where.setId + (q ? '&q=' + encodeURIComponent(q) : '');
    })()
  };
}

function main() {
  var argv = process.argv.slice(2);
  var candidate = null, failOn = 'high', quiet = false;
  for (var i = 0; i < argv.length; i++) {
    if (argv[i] === '--candidate') candidate = argv[++i];
    else if (argv[i] === '--fail-on') failOn = argv[++i];
    else if (argv[i] === '--quiet') quiet = true;
  }

  var files = discoverPacks();
  if (candidate) {
    var abs = path.resolve(candidate);
    if (files.map(function (f) { return path.resolve(f); }).indexOf(abs) < 0) files.push(abs);
  }

  var packs = files.map(loadPack);
  var units = [];
  var setInfo = [];
  packs.forEach(function (p) {
    var a = unitsFromPack(p);
    var b = unitsFromScripts(p.code || '');
    setInfo.push({
      code: p.code, title: p.title, file: p.__file,
      items: a.filter(function (u) { return u.role === 'item'; }).length,
      texts: a.filter(function (u) { return u.role === 'text'; }).length,
      scripts: b.length,
      isCandidate: candidate ? path.resolve(p.__file && path.join(ROOT, p.__file)) === path.resolve(candidate) : false
    });
    units = units.concat(a, b);
  });

  /* 틀 유도 → payload 확정. 내용이 전부 정형문이라 비교할 게 남지 않은 단위는 빠진다. */
  var rawCount = units.length;
  units = finalizeUnits(units);
  var frameOnly = rawCount - units.length;

  /* 보일러플레이트 빈도표 — payload 기준. 틀 제거 후에도 통째로 같은 게 3곳 이상이면 정형문이다. */
  var boiler = Object.create(null);
  units.forEach(function (u) { if (u.norm) boiler[u.norm] = (boiler[u.norm] || 0) + 1; });

  /* 후보 쌍 생성 — shingle 역색인. 흔한 shingle 은 후보 생성에서 뺀다(자카드 계산에는 남는다). */
  var index = Object.create(null);
  units.forEach(function (u, ui) {
    u.sh.forEach(function (s) { (index[s] || (index[s] = [])).push(ui); });
  });
  var pairSeen = Object.create(null), candidates = [];
  Object.keys(index).forEach(function (s) {
    var list = index[s];
    if (list.length > 30) return;                      // 지시문류 — 후보 폭발 방지
    for (var i = 0; i < list.length; i++) {
      for (var j = i + 1; j < list.length; j++) {
        var a = list[i], b = list[j];
        if (units[a].role !== units[b].role) continue;
        var key = a + ':' + b;
        if (pairSeen[key]) continue;
        pairSeen[key] = 1;
        candidates.push([a, b]);
      }
    }
  });
  /* 완전일치는 shingle 이 흔해서 후보에서 빠질 수 있다 — 정규화 텍스트로 한 번 더 훑는다. */
  var byNorm = Object.create(null);
  units.forEach(function (u, ui) {
    if (!u.norm) return;
    (byNorm[u.norm] || (byNorm[u.norm] = [])).push(ui);
  });
  Object.keys(byNorm).forEach(function (n) {
    var list = byNorm[n];
    for (var i = 0; i < list.length; i++) for (var j = i + 1; j < list.length; j++) {
      if (units[list[i]].role !== units[list[j]].role) continue;
      var key = list[i] + ':' + list[j];
      if (!pairSeen[key]) { pairSeen[key] = 1; candidates.push([list[i], list[j]]); }
    }
  });

  /* 허용목록 */
  var allowFile = path.join(SG2, 'config', 'dup-allowlist.json');
  var allow = Object.create(null);
  if (fs.existsSync(allowFile)) {
    var raw = JSON.parse(fs.readFileSync(allowFile, 'utf8'));
    (raw.allow || []).forEach(function (row) {
      if (!row.pair || !row.reason || !String(row.reason).trim()) return;   // 사유 없으면 무효
      allow[row.pair] = row;
    });
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
      score: +Math.max(r.jaccard, r.containment).toFixed(4),
      metrics: {
        jaccard: r.jaccard, containment: r.containment, sharedShingles: r.sharedShingles,
        longestRun: r.longestRun, sharedChoices: r.sharedChoices, exact: r.exact, sameStem: r.sameStem
      },
      reasons: r.reasons.concat(al ? ['허용목록: ' + al.reason] : []),
      a: unitOut(a), b: unitOut(b)
    });
  });

  var RANK = { high: 0, watch: 1, info: 2 };
  pairs.sort(function (x, y) {
    return (RANK[x.severity] - RANK[y.severity]) || (y.score - x.score) || x.key.localeCompare(y.key);
  });

  var counts = { high: 0, watch: 0, info: 0, allowlisted: 0 };
  pairs.forEach(function (p) { counts[p.severity]++; if (p.allowlisted) counts.allowlisted++; });

  var report = {
    tool: 'studyground/tools/dup_check.js',
    viewer: 'sg2/admin-dup.html',
    packs: setInfo,
    unitCount: units.length,
    frameOnlyUnits: frameOnly,
    candidatePairs: candidates.length,
    thresholds: TH,
    fieldPolicy: FIELD_POLICY,
    coverage: {
      note: '팩에 텍스트로 존재하는 것만 비교한다. mp3 만 있고 전사가 없는 오디오는 비교 대상이 아니다.',
      scriptsLoaded: setInfo.map(function (s) { return s.code + ':' + s.scripts; }).join(' '),
      frameNote: '유형이 강제하는 정형문(같은 줄이 서로 다른 단위 ' + TH.frameDf +
        '곳 이상)은 비교에서 제외했다. 제외된 줄은 각 단위의 framedOut 에 df 와 함께 남는다.',
      frameOnlyUnits: frameOnly + '개 단위는 내용이 전부 정형문이라 비교 대상에서 빠졌다.'
    },
    counts: counts,
    pairs: pairs
  };

  var outJson = path.join(SG2, 'config', 'dup-report.json');
  fs.writeFileSync(outJson, JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(path.join(SG2, 'config', 'dup-report.js'),
    '/* GENERATED — node studyground/tools/dup_check.js. 손으로 고치지 말 것.\n' +
    ' * file:// 에서도 뷰어가 읽을 수 있도록 fetch 대신 <script src> 로 싣는다. */\n' +
    'window.SG_DUP_REPORT = ' + JSON.stringify(report) + ';\n');

  if (!quiet) {
    console.log('단위 ' + units.length + '개 · 후보 쌍 ' + candidates.length + '개 비교');
    setInfo.forEach(function (s) {
      console.log('  ' + s.code + ' — 문항 ' + s.items + ' · 지문 ' + s.texts + ' · 전사 ' + s.scripts +
        (s.isCandidate ? '   ← 후보(신규)' : ''));
    });
    console.log('');
    if (counts.high) {
      console.log('❌ 기존과 같은 문항이 있습니다 — high ' + counts.high + '건, watch ' + counts.watch + '건');
      pairs.filter(function (p) { return p.severity === 'high'; }).slice(0, 20).forEach(function (p) {
        console.log('   · ' + p.a.uid + '  ↔  ' + p.b.uid + '   (' + p.reasons[0] + ')');
      });
      if (counts.high > 20) console.log('   … 외 ' + (counts.high - 20) + '건');
    } else if (counts.watch) {
      console.log('⚠️  확실한 겹침은 없습니다. 사람이 볼 것 ' + counts.watch + '건 (watch)');
      pairs.filter(function (p) { return p.severity === 'watch'; }).slice(0, 10).forEach(function (p) {
        console.log('   · ' + p.a.uid + '  ↔  ' + p.b.uid + '   (' + p.reasons[0] + ')');
      });
    } else {
      /* "없다"를 그냥 말하지 않는다 — 허용목록으로 내려놓은 건수를 같이 보여 줘야
       * 검사를 통과한 것과 검사를 꺼 둔 것을 구분할 수 있다. */
      console.log('✅ 겹치는 문항이 없습니다.' +
        (counts.allowlisted ? '  (사람이 보고 허용한 것 ' + counts.allowlisted + '건 포함 — dup-allowlist.json)' : '') +
        (counts.info - counts.allowlisted ? '  (정형문 강등 ' + (counts.info - counts.allowlisted) + '건)' : ''));
    }
    console.log('\n리포트: sg2/config/dup-report.json   뷰어: sg2/admin-dup.html');
  }

  var bad = failOn === 'watch' ? (counts.high + counts.watch) : failOn === 'none' ? 0 : counts.high;
  process.exit(bad ? 1 : 0);
}

if (require.main === module) main();

module.exports = { normalize: normalize, tokens: tokens, shingles: shingles, longestRun: longestRun, TH: TH };
