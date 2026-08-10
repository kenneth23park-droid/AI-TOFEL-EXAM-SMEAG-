/* SMEAG · StudyGround — tools/gen_answer_key_set9.js
 * 목적: sg2/assets/set9.js 를 node 로 평가해 서버측 정답 테이블
 *       app/scoring/answer_key_set9.py 를 생성한다. 손으로 옮겨 적지 않는다.
 * 실행: node studyground/tools/gen_answer_key_set9.js [--check]
 *       --check 는 파일을 쓰지 않고 기존 파일과 동일한지만 비교한다(CI 용).
 * 의존 전역: 없음 (set9.js 가 window.SMEAG_SET9 을 정의한다)
 *
 * gen_answer_key_set1.js 와 본문이 거의 같다. 공통화하지 않은 이유:
 * set1 생성물은 이미 검증된 산출물이라 그 바이트를 흔들 위험을 지지 않는 쪽을 택했다
 * (node tools/gen_answer_key_set1.js --check 가 회귀 테스트로 남아 있다).
 * 세 번째 팩이 생기면 그때 공통 모듈로 뽑는다.
 *
 * qtype 매핑 (architecture.md §4.2 block.kind 표 + §6.2.3 QTYPES):
 *   cloze/blank        -> CLOZE           (문자열, strip().lower() 비교)
 *   mcq                -> MCQ             (정수 인덱스)
 *   insert             -> INSERT          (정수 인덱스 = 마커 위치)
 *   build              -> BUILD_SENTENCE  (answerTokens 순서 완전일치)
 *   email/discussion   -> WRITING         (자동채점 없음)
 *   repeat/interview   -> SPEAKING        (자동채점 없음)
 *
 * 산출형(PRODUCTIVE_KEYS) 행에는 채점기가 쓸 두 필드를 더 싣는다(가산형 — 기존 키는 그대로).
 *   task_kind : 문항 kind 그대로(repeat / interview / email / discussion).
 *               rubric.draft() 가 이 값으로 복창 채점 경로를 켠다.
 *   reference : 복창 원문. speaking_script.json 의 lines[] 에서 문항 id 로 찾는다
 *               (오디오 대본과 같은 출처 — 여기서 새로 지어내지 않는다).
 *               복창이 아닌 문항은 None 이다. 에세이·인터뷰에는 "정답 원문"이 없다.
 */
'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var SET9 = path.join(ROOT, 'sg2', 'assets', 'set9.js');
var SCRIPT = path.join(ROOT, 'sg2', 'config', '_set9_fragments', 'speaking_script.json');
var OUT = path.join(ROOT, 'app', 'scoring', 'answer_key_set9.py');

global.window = global;
eval(fs.readFileSync(SET9, 'utf8'));

var QTYPE_BY_KIND = {
  blank: 'CLOZE',
  mcq: 'MCQ',
  insert: 'INSERT',
  build: 'BUILD_SENTENCE',
  email: 'WRITING',
  discussion: 'WRITING',
  repeat: 'SPEAKING',
  interview: 'SPEAKING'
};

var AUTO = { CLOZE: 1, MCQ: 1, INSERT: 1, BUILD_SENTENCE: 1, WORD_FILLING: 1 };

// 복창 원문이 필요한 kind. 지금은 repeat 하나뿐이지만, 이 판단을 아래 코드 여기저기에
// 흩뿌리지 않으려고 이름을 붙여 둔다.
var NEEDS_REFERENCE = { repeat: 1 };

// speaking_script.json 의 lines[] → { id: text }. 오디오 대본과 같은 파일이라
// 대본이 바뀌면 정답키도 같이 바뀐다(재생성 시 --check 가 잡는다).
var SCRIPT_LINES = (function () {
  var raw = JSON.parse(fs.readFileSync(SCRIPT, 'utf8'));
  var map = {};
  (raw.lines || []).forEach(function (line) {
    if (line && line.id) map[line.id] = String(line.text || '').trim();
  });
  return map;
})();

// SET 9 실측값 — set1 의 78/13/91 을 그대로 베끼지 않는다.
// reading 50(blank 30 + mcq 19 + insert 1) / listening 47 / writing build 10 = 107,
// 산출형은 writing 에세이 2 + speaking 11 = 13, 합 120.
var EXPECT_AUTO = 107;
var EXPECT_PRODUCTIVE = 13;
var EXPECT_TOTAL = 120;

function py(value, indent) {
  var pad = indent || '';
  if (value === null || value === undefined) return 'None';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (Array.isArray(value)) {
    var parts = value.map(function (v) { return py(v, pad); });
    return '[' + parts.join(', ') + ']';
  }
  return JSON.stringify(String(value));
}

var rows = [];
var productive = [];
var counts = { reading: 0, listening: 0, writing: 0, speaking: 0 };

window.SMEAG_SET9.allQuestions().forEach(function (e) {
  var q = e.q;
  var qtype = QTYPE_BY_KIND[q.kind];
  if (!qtype) throw new Error('unmapped question kind: ' + q.kind + ' (' + q.id + ')');
  counts[e.section.id] += 1;
  var row = {
    key: q.id,
    qtype: qtype,
    skill: e.section.id,
    module: e.module.id,
    no: q.no,
    answer: AUTO[qtype] ? (qtype === 'BUILD_SENTENCE' ? q.answerTokens : q.answer) : null,
    max_score: 1
  };
  if (AUTO[qtype]) {
    // 근거 없는 값을 만들지 않는다 — 정답이 비어 있으면 조용히 0점 처리하지 말고 여기서 멈춘다.
    if (row.answer === null || row.answer === undefined || row.answer === '') {
      throw new Error('auto-scorable question without an answer: ' + q.id);
    }
    rows.push(row);
  } else {
    // 산출형에만 붙는 두 필드. task_kind 는 kind 그대로고, reference 는 복창에만 있다.
    row.task_kind = q.kind;
    row.reference = null;
    if (NEEDS_REFERENCE[q.kind]) {
      var line = SCRIPT_LINES[q.id];
      // 근거 없는 값을 만들지 않는다 — 원문이 없으면 빈 문자열로 때우지 말고 여기서 멈춘다.
      if (!line) throw new Error('repeat question without a script line: ' + q.id);
      row.reference = line;
    }
    productive.push(row);
  }
});

function block(list) {
  return list.map(function (r) {
    return '    ' + JSON.stringify(r.key) + ': {' +
      '"qtype": ' + py(r.qtype) + ', ' +
      '"skill": ' + py(r.skill) + ', ' +
      '"module": ' + py(r.module) + ', ' +
      '"no": ' + py(r.no) + ', ' +
      '"answer": ' + py(r.answer) + ', ' +
      '"max_score": ' + py(r.max_score) + '},';
  }).join('\n');
}

// 산출형 전용 블록 — 자동채점 행의 바이트는 건드리지 않으려고 함수를 나눠 둔다.
function productiveBlock(list) {
  return list.map(function (r) {
    return '    ' + JSON.stringify(r.key) + ': {' +
      '"qtype": ' + py(r.qtype) + ', ' +
      '"skill": ' + py(r.skill) + ', ' +
      '"module": ' + py(r.module) + ', ' +
      '"no": ' + py(r.no) + ', ' +
      '"answer": ' + py(r.answer) + ', ' +
      '"max_score": ' + py(r.max_score) + ', ' +
      '"task_kind": ' + py(r.task_kind) + ', ' +
      '"reference": ' + py(r.reference) + '},';
  }).join('\n');
}

var autoBySkill = { reading: 0, listening: 0, writing: 0, speaking: 0 };
rows.forEach(function (r) { autoBySkill[r.skill] += 1; });

var productiveBySkill = { reading: 0, listening: 0, writing: 0, speaking: 0 };
productive.forEach(function (r) { productiveBySkill[r.skill] += 1; });

var text = [
  '"""SET 9 answer key — GENERATED, do not edit by hand.',
  '',
  'Regenerate with:  node studyground/tools/gen_answer_key_set9.js',
  'Source of truth:  studyground/sg2/assets/set9.js  (window.SMEAG_SET9)',
  '',
  'The runtime never trusts the answers the browser sends; grading reads this table',
  'only (epics-and-stories.md Story 3.4 AC6).',
  '"""',
  '',
  'from __future__ import annotations',
  '',
  '# question_key -> {qtype, skill, module, no, answer, max_score}',
  '# Auto-scorable questions only (SET 9 실측: reading 50 / listening 47 / writing 10).',
  'ANSWER_KEY: dict[str, dict] = {',
  block(rows),
  '}',
  '',
  '# Productive questions — graded by a teacher / rubric, never auto-scored.',
  '# task_kind 는 채점 방식을 고르는 스위치이고(repeat 이면 원문 대조),',
  '# reference 는 복창 원문이다(speaking_script.json 출처, 복창이 아니면 None).',
  'PRODUCTIVE_KEYS: dict[str, dict] = {',
  productiveBlock(productive),
  '}',
  '',
  'AUTO_TOTAL_BY_SKILL: dict[str, int] = {',
  Object.keys(autoBySkill).map(function (k) {
    return '    ' + JSON.stringify(k) + ': ' + autoBySkill[k] + ',';
  }).join('\n'),
  '}',
  '',
  'TOTAL_QUESTIONS = len(ANSWER_KEY) + len(PRODUCTIVE_KEYS)',
  '',
  '# Story 3.4 AC7 — a mis-generated key must fail at import time, not at grading time.',
  'assert len(ANSWER_KEY) == ' + EXPECT_AUTO + ', f"auto-scorable key must hold ' + EXPECT_AUTO + ' rows, got {len(ANSWER_KEY)}"',
  'assert len(PRODUCTIVE_KEYS) == ' + EXPECT_PRODUCTIVE + ', f"productive key must hold ' + EXPECT_PRODUCTIVE + ' rows, got {len(PRODUCTIVE_KEYS)}"',
  'assert TOTAL_QUESTIONS == ' + EXPECT_TOTAL + ', f"SET 9 has ' + EXPECT_TOTAL + ' questions, got {TOTAL_QUESTIONS}"',
  '',
  '',
  'def lookup(question_key: str) -> dict | None:',
  '    """Auto-scorable entry for a question key, or None (productive / unknown)."""',
  '    return ANSWER_KEY.get(question_key)',
  '',
  '',
  'def meta(question_key: str) -> dict | None:',
  '    """Any known entry — auto-scorable or productive."""',
  '    return ANSWER_KEY.get(question_key) or PRODUCTIVE_KEYS.get(question_key)',
  ''
].join('\n');

if (rows.length !== EXPECT_AUTO || productive.length !== EXPECT_PRODUCTIVE) {
  throw new Error(
    'SET 9 문항 수가 실측값과 다르다: auto ' + rows.length + '/' + EXPECT_AUTO +
    ', productive ' + productive.length + '/' + EXPECT_PRODUCTIVE +
    ' — set9.js 가 바뀌었다면 이 상수부터 갱신하라.'
  );
}

// SET 9 S1 은 복창 7문항이다(실측). 원문이 하나라도 새면 채점이 조용히 중앙값으로 내려앉으므로
// 여기서 잡는다 — 미채점보다 "그럴듯하게 틀린 점수"가 나쁘다.
var EXPECT_REFERENCES = 7;
var withReference = productive.filter(function (r) { return r.reference; }).length;
if (withReference !== EXPECT_REFERENCES) {
  throw new Error(
    '복창 원문이 실린 문항 수가 다르다: ' + withReference + '/' + EXPECT_REFERENCES +
    ' — speaking_script.json 의 lines[] id 와 set9.js 문항 id 가 어긋났는지 보라.'
  );
}

if (process.argv.indexOf('--check') >= 0) {
  var cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (cur !== text) { console.error('answer_key_set9.py is stale — rerun without --check'); process.exit(1); }
  console.log('answer_key_set9.py up to date (' + rows.length + ' auto / ' + productive.length + ' productive)');
} else {
  fs.writeFileSync(OUT, text, 'utf8');
  console.log('wrote ' + OUT);
  console.log('  auto-scorable: ' + rows.length + '  ' + JSON.stringify(autoBySkill));
  console.log('  productive   : ' + productive.length + '  ' + JSON.stringify(productiveBySkill));
  console.log('  total        : ' + (rows.length + productive.length) + '  ' + JSON.stringify(counts));
}
