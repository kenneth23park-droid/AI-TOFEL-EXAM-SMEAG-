/* SMEAG · StudyGround — tools/gen_answer_key_set1.js
 * 목적: sg2/assets/set1.js 를 node 로 평가해 서버측 정답 테이블
 *       app/scoring/answer_key_set1.py 를 생성한다. 손으로 옮겨 적지 않는다.
 * 실행: node studyground/tools/gen_answer_key_set1.js [--check]
 *       --check 는 파일을 쓰지 않고 기존 파일과 동일한지만 비교한다(CI 용).
 * 의존 전역: 없음 (set1.js 가 window.SMEAG_SET1 을 정의한다)
 *
 * qtype 매핑 (architecture.md §4.2 block.kind 표 + §6.2.3 QTYPES):
 *   cloze/blank        -> CLOZE           (문자열, strip().lower() 비교)
 *   mcq                -> MCQ             (정수 인덱스)
 *   insert             -> INSERT          (정수 인덱스 = 마커 위치)
 *   build              -> BUILD_SENTENCE  (answerTokens 순서 완전일치)
 *   email/discussion   -> WRITING         (자동채점 없음)
 *   repeat/interview   -> SPEAKING        (자동채점 없음)
 */
'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var SET1 = path.join(ROOT, 'sg2', 'assets', 'set1.js');
var OUT = path.join(ROOT, 'app', 'scoring', 'answer_key_set1.py');

global.window = global;
eval(fs.readFileSync(SET1, 'utf8'));

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

window.SMEAG_SET1.allQuestions().forEach(function (e) {
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
  if (AUTO[qtype]) rows.push(row); else productive.push(row);
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

var autoBySkill = { reading: 0, listening: 0, writing: 0, speaking: 0 };
rows.forEach(function (r) { autoBySkill[r.skill] += 1; });

var text = [
  '"""SET 1 answer key — GENERATED, do not edit by hand.',
  '',
  'Regenerate with:  node studyground/tools/gen_answer_key_set1.js',
  'Source of truth:  studyground/sg2/assets/set1.js  (window.SMEAG_SET1)',
  '',
  'The runtime never trusts the answers the browser sends; grading reads this table',
  'only (epics-and-stories.md Story 3.4 AC6).',
  '"""',
  '',
  'from __future__ import annotations',
  '',
  '# question_key -> {qtype, skill, module, no, answer, max_score}',
  '# Auto-scorable questions only (architecture.md README 검산표: 78).',
  'ANSWER_KEY: dict[str, dict] = {',
  block(rows),
  '}',
  '',
  '# Productive questions — graded by a teacher / rubric, never auto-scored.',
  'PRODUCTIVE_KEYS: dict[str, dict] = {',
  block(productive),
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
  'assert len(ANSWER_KEY) == 78, f"auto-scorable key must hold 78 rows, got {len(ANSWER_KEY)}"',
  'assert len(PRODUCTIVE_KEYS) == 13, f"productive key must hold 13 rows, got {len(PRODUCTIVE_KEYS)}"',
  'assert TOTAL_QUESTIONS == 91, f"SET 1 has 91 questions, got {TOTAL_QUESTIONS}"',
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

if (process.argv.indexOf('--check') >= 0) {
  var cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (cur !== text) { console.error('answer_key_set1.py is stale — rerun without --check'); process.exit(1); }
  console.log('answer_key_set1.py up to date (' + rows.length + ' auto / ' + productive.length + ' productive)');
} else {
  fs.writeFileSync(OUT, text, 'utf8');
  console.log('wrote ' + OUT);
  console.log('  auto-scorable: ' + rows.length + '  ' + JSON.stringify(autoBySkill));
  console.log('  productive   : ' + productive.length);
  console.log('  total        : ' + (rows.length + productive.length) + '  ' + JSON.stringify(counts));
}
