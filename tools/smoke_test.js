/* 통합 스모크 테스트 — node 로 브라우저 없이 채점 경로를 검증한다.
   1) 정답만 고른 학생이 78/78 인가
   2) 전부 미응답이면 0/78 이고 앱이 죽지 않는가
   3) build 응답 형태(빈 문자열 포함)를 grade 가 견디는가 */
const fs = require('fs');
const path = require('path');
const ROOT = path.dirname(__dirname);

// 최소한의 브라우저 셰이퍼
global.window = global;
global.localStorage = (() => {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
  };
})();
global.document = { addEventListener() {}, createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }), head: { insertBefore() {}, appendChild() {} }, getElementById: () => null, querySelector: () => null };
global.navigator = { onLine: true };
global.crypto = require('crypto').webcrypto;

function load(rel) { eval(fs.readFileSync(path.join(ROOT, rel), 'utf8')); }
load('app/js/config.js');
load('app/js/data/set1.js');
load('app/js/util.js');
load('app/js/grade.js');

const SET = window.SMEAG_SET1;
const G = window.SMEAG_GRADE;

function makeAttempt(answers) {
  return { id: 'test', setCode: 'SET1', startedAt: new Date(0).toISOString(), answers };
}

/* --- 1) 만점 --- */
const perfect = {};
SET.allQuestions().forEach(({ q }) => {
  if (q.kind === 'blank') perfect[q.id] = q.answer;
  else if (q.kind === 'mcq' || q.kind === 'insert') perfect[q.id] = q.answer;
  else if (q.kind === 'build') perfect[q.id] = q.answerTokens.slice();
  else if (q.kind === 'email' || q.kind === 'discussion') perfect[q.id] = 'x'.repeat(200);
  else perfect[q.id] = { recorded: true, durationMs: 20000 };
});
const r1 = G.run(makeAttempt(perfect));

/* --- 2) 백지 --- */
const r2 = G.run(makeAttempt({}));

/* --- 3) 부분 입력 build (빈 문자열 섞임) --- */
const partial = {};
const w1 = SET.findQuestion('W-1').q;
partial['W-1'] = [w1.answerTokens[0], ''];
const r3 = G.run(makeAttempt(partial));

/* --- 4) 대소문자/공백 흔들린 blank --- */
const messy = { 'R1-1': '  BRAIN ', 'R2-10': 'How' };
const r4 = G.run(makeAttempt(messy));

const checks = [
  ['만점 autoScore', r1.autoScore.correct === 78 && r1.autoScore.total === 78, `${r1.autoScore.correct}/${r1.autoScore.total}`],
  ['만점 reading 35', r1.sections.reading.correct === 35, r1.sections.reading.correct],
  ['만점 listening 33', r1.sections.listening.correct === 33, r1.sections.listening.correct],
  ['만점 writing 10', r1.sections.writing.correct === 10, r1.sections.writing.correct],
  ['speaking 11 제출', r1.sections.speaking.submitted === 11, r1.sections.speaking.submitted],
  ['pending 13건', r1.pending.length === 13, r1.pending.length],
  ['백지 0점', r2.autoScore.correct === 0, r2.autoScore.correct],
  ['백지도 total 78', r2.autoScore.total === 78, r2.autoScore.total],
  ['부분 build 는 오답', r3.perQuestion['W-1'].correct === false, r3.perQuestion['W-1'].correct],
  ['blank 대소문자/공백 무시', r4.perQuestion['R1-1'].correct === true && r4.perQuestion['R2-10'].correct === true,
    `${r4.perQuestion['R1-1'].correct}/${r4.perQuestion['R2-10'].correct}`],
];

let fail = 0;
checks.forEach(([name, ok, got]) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + '  → ' + got);
  if (!ok) fail++;
});
console.log(fail ? `\n실패 ${fail}건 ❌` : '\n스모크 전부 통과 ✅');
process.exit(fail ? 1 : 0);
