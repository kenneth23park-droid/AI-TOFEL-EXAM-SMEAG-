/* 샘플 응시 시드 검산 — assets/seed-attempt.js
 * 실행: node studyground/tests/test_seed_attempt.js
 *
 * 시드는 "거의 다 푼 응시" 를 만드는 개발 도구다. 여기서 고정하는 성질은 셋이다.
 *  (1) 모듈마다 정확히 하나씩만 비운다 — 그 하나가 resume 으로 들어가 답할 문항이다.
 *  (2) 채워 넣은 답이 실제 채점기(sg-results.js)로 목표 정답률을 낸다. 시드가 만든 답을
 *      채점기가 다르게 읽으면(형식 불일치) 점수가 0 이 되는데, 그건 시드 탓인지 채점 탓인지
 *      화면에서는 가려지지 않는다. 그래서 시드의 답을 진짜 채점기에 그대로 먹인다.
 *  (3) 커서가 가리키는 화면에 "처음 비운 문항" 이 실려 있다 — 셸이 이 화면에서 이어받는다.
 */
var fs = require('fs');
var path = require('path');

var SG2 = path.join(__dirname, '..', 'sg2');
global.window = global;
global.fetch = undefined;
global.localStorage = undefined;

function load(rel) { eval(fs.readFileSync(path.join(SG2, rel), 'utf8')); }
load('assets/set9.js');
load('assets/exam-types.js');
load('assets/exam-media.js');
load('assets/exam-timing.js');
load('assets/exam-compile.js');
load('assets/seed-attempt.js');
load('assets/sg-results.js');

var timing = JSON.parse(fs.readFileSync(path.join(SG2, 'config/timing.toefl.json'), 'utf8'));
var PACK = window.SMEAG_SET9;
var SCREENS = window.SG_COMPILE.compileScreens(PACK, timing, { profile: 'toefl' }).screens;

var fails = 0;
function ok(label, cond, detail) {
  if (!cond) fails++;
  console.log('  ' + (cond ? 'ok  ' : 'FAIL') + ' ' + label + (detail === undefined ? '' : '  ' + detail));
}

console.log('\n[1] 모듈마다 마지막 문항 하나씩');
var lasts = window.SG_SEED.lastOfEachModule(SCREENS);
var mods = lasts.map(function (x) { return x.module; });
ok('모듈 수', lasts.length === 9, lasts.length + ' → ' + mods.join(','));
ok('중복 없음', new Set(mods).size === mods.length);
ok('각 모듈의 마지막 문항', lasts.map(function (x) { return x.qid; }).join(',') ===
   'L1-32,L2-15,set9-S1-q07,set9-S2-q04,R1-35,R2-15,set9-W1-q10,set9-W2-email,set9-W3-disc');

console.log('\n[2] 채운 답을 진짜 채점기에 먹인다');
[1, 0.8, 0.6].forEach(function (acc) {
  var plan = window.SG_SEED.plan(PACK, SCREENS, { accuracy: acc });
  // SG_STORE 없이도 채점기는 { qid: value } 를 그대로 읽는다(valueOf 가 두 모양을 다 받는다).
  var s = window.SG_RESULTS.score(PACK, plan.answers);
  var got = s.total ? s.score / s.total : 0;
  /* 비워 둔 문항(모듈마다 하나)은 무응답이라 오답으로 잡힌다. 채점 대상 107문항 중
     다섯이 그 몫이라 실측은 목표보다 5%p 가량 낮게 나온다 — 허용폭 10%p 는 그 자리다. */
  var within = Math.abs(got - acc) <= 0.1;
  ok('정답률 ' + Math.round(acc * 100) + '% → 채점 ' + Math.round(got * 1000) / 10 + '%',
     within, s.score + '/' + s.total);
  ok('  섹션이 넷 다 채점됨', Object.keys(s.bySection).length >= 4, Object.keys(s.bySection).join(','));
});

console.log('\n[3] 비운 문항은 답이 없다');
var plan = window.SG_SEED.plan(PACK, SCREENS, { accuracy: 0.8 });
var leaked = lasts.filter(function (x) { return plan.answers.hasOwnProperty(x.qid); });
ok('비운 문항에 답이 새지 않음', leaked.length === 0, leaked.map(function (x) { return x.qid; }).join(','));
ok('녹음 대상은 스피킹 9문항', plan.spoken.length === 9,
   plan.spoken.map(function (s) { return s.qid; }).join(','));
ok('복창은 대본을 들고 온다', plan.spoken.filter(function (s) { return s.kind === 'repeat'; })
     .every(function (s) { return !!s.script; }));
ok('라이팅 서술형은 비워 둔 쪽에 있다', plan.written.length === 0);

console.log('\n[4] 커서');
function cursorOf(at) {
  var p = window.SG_SEED.plan(PACK, SCREENS, { accuracy: 0.8, cursorAt: at });
  return { cur: p.cursor, first: p.skip[0] };
}
var c0 = cursorOf('first');
var sc0 = SCREENS[c0.cur.screenIndex];
ok('기본 커서 화면에 처음 비운 문항이 있다',
   (sc0.questionIds || []).indexOf('L1-32') >= 0, sc0.id);

['speaking', 'writing'].forEach(function (sec) {
  var p = window.SG_SEED.plan(PACK, SCREENS, { accuracy: 0.8, cursorAt: sec });
  var sc = SCREENS[p.cursor.screenIndex];
  ok(sec + ' 진입점이 그 섹션이다', sc.section === sec, sc.id);
  var ids = sc.questionIds || [];
  var isBlank = ids.some(function (id) {
    return p.skip.some(function (x) { return x.qid === id; });
  });
  ok('  그 화면에 비운 문항이 있다', isBlank, ids.join(','));
});

console.log('\n[5] 같은 입력이면 같은 결과 (시드는 무작위가 아니다)');
var a = window.SG_SEED.plan(PACK, SCREENS, { accuracy: 0.8 });
var b = window.SG_SEED.plan(PACK, SCREENS, { accuracy: 0.8 });
ok('두 번 돌려도 같은 답', JSON.stringify(a.answers) === JSON.stringify(b.answers));

/* 시드가 심은 세션을 셸이 실제로 "이어서 응시" 로 인정하는지. 화면 없이 확인할 수 있는
   이유는 셸의 판정이 두 순수 함수에 모여 있기 때문이다 — canResume() 이 문을 열고
   planResume() 이 어느 화면에서 이어받을지 고른다. 여기가 어긋나면 시드를 심어도
   "새로 시작" 만 뜬다(그리고 그 순간 답이 통째로 날아간다). */
console.log('\n[6] 셸이 이 세션을 이어받을 수 있나');
load('assets/exam-store.js');
var STORE = window.SG_STORE;
var session = STORE.offlineSessionId();
STORE.open(session);
STORE.saveMeta({
  session: session, examCode: 'SET9', setCode: 'SET9', studentNo: '',
  startedAt: Date.now() - 25 * 60 * 1000, profile: 'toefl', mode: 'exam',
  screenCount: SCREENS.length, submittedAt: null, serverSession: null
  // contentHash·timingHash 는 시드가 일부러 비운다 — 아래 [6] 이 그 계약을 고정한다.
});
Object.keys(plan.answers).forEach(function (qid) { STORE.upsertAnswer(qid, plan.answers[qid], { seeded: true }); });
STORE.flushAnswers();
STORE.saveCursor(SCREENS[plan.cursor.screenIndex].id, plan.cursor.screenIndex, 0);

ok('활성 세션이다', STORE.activeSession() === session);
var can = STORE.canResume('some-content-hash', 'some-timing-hash');
ok('해시가 무엇이든 이어받기가 열린다', can.ok === true, can.reason);
ok('커서가 남아 있다', !!STORE.cursor(), STORE.cursor() && STORE.cursor().screenId);
var rp = STORE.planResume(SCREENS, STORE.cursor(), STORE.clocks(), Date.now());
ok('이어받는 화면이 심은 그 화면', rp.screenIndex === plan.cursor.screenIndex, rp.screenId);
ok('만료된 시계가 없다(시드는 시계를 심지 않는다)', rp.expiredKeys.length === 0);
ok('답이 그대로 읽힌다', Object.keys(STORE.answers()).length === Object.keys(plan.answers).length);

console.log(fails ? '\n' + fails + ' FAILED\n' : '\nALL PASS\n');
process.exit(fails ? 1 : 0);
