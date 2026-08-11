/* Story 2.5 검증 — Speaking phase 전이 순수함수 + 컴파일된 speaking 화면 계약.
 * 실행: node studyground/tests/test_speaking_phases.js
 *
 * 녹음은 헤드리스에서 검증할 수 없으므로, 전이 로직만 DOM·미디어 없이 돌린다.
 * window 섀도우 위에 sg2 런타임을 얹는 방식은 test_compile_screens.js 와 동일.
 */
var fs = require('fs');
var path = require('path');

var SG2 = path.join(__dirname, '..', 'sg2');
global.window = global;
global.fetch = undefined;

function load(rel) { eval(fs.readFileSync(path.join(SG2, rel), 'utf8')); }
load('assets/set1.js');
load('assets/exam-types.js');
load('assets/exam-media.js');
load('assets/exam-timing.js');
load('assets/exam-compile.js');
load('assets/exam-render-speaking.js');   // document 없이도 순수부만 노출된다

var SP = window.SG_SPEAKING;
var fails = [];

function check(name, actual, expected) {
  var a = typeof actual === 'object' ? JSON.stringify(actual) : String(actual);
  var e = typeof expected === 'object' ? JSON.stringify(expected) : String(expected);
  var ok = a === e;
  console.log((ok ? '  ok   ' : '  FAIL ') + name + ': ' + a + (ok ? '' : '  (expected ' + e + ')'));
  if (!ok) fails.push(name);
}

/* phases 를 끝까지 몰아서 (phase 이름, 발생 액션) 궤적을 뽑는 드라이버.
   각 단계에서 endCondition 이 요구하는 이벤트만 넣는다 — 분기 없는 단일 루프의 재현. */
var EVENT_FOR = { button: 'button', media: 'mediaEnded', deadline: 'expire' };

function drive(phases) {
  var st = SP.initialState({ phases: phases }, 0);
  var trace = [];
  var out = SP.nextPhase(st, { type: 'start' });
  st = { phases: out.phases, phaseIndex: out.phaseIndex, status: out.status };
  trace.push({ at: st.status === 'done' ? '(end)' : phases[st.phaseIndex].name, actions: out.actions });
  var guard = 0;
  while (st.status === 'active' && guard < 50) {
    var cond = SP.endCondition(phases[st.phaseIndex]);
    var ev = EVENT_FOR[cond];
    if (!ev) { trace.push({ at: 'STUCK:' + cond, actions: [] }); break; }
    out = SP.nextPhase(st, { type: ev });
    st = { phases: out.phases, phaseIndex: out.phaseIndex, status: out.status };
    trace.push({ at: st.status === 'done' ? '(end)' : phases[st.phaseIndex].name, actions: out.actions });
    guard += 1;
  }
  return { status: st.status, trace: trace };
}

function names(r) { return r.trace.map(function (t) { return t.at; }).join(' → '); }
function acts(r) {
  var o = [];
  r.trace.forEach(function (t) { t.actions.forEach(function (a) { o.push(a); }); });
  return o.join(',');
}

/* ── [1] 종료조건표 4종 (architecture.md §3.3) ───────────────────────── */
console.log('\n[1] endCondition 종료조건표 4종');
check('selfPaced:true → button',
  SP.endCondition({ name: 'read', seconds: 0, selfPaced: true }), 'button');
check('selfPaced 는 seconds 보다 우선',
  SP.endCondition({ name: 'read', seconds: 30, selfPaced: true }), 'button');
check('media(audio) + seconds:0 → media',
  SP.endCondition({ name: 'listen', seconds: 0, media: { src: 'media/audio/x.mp3', kind: 'audio' } }), 'media');
check('seconds>0 → deadline',
  SP.endCondition({ name: 'record', seconds: 20 }), 'deadline');
check('media + seconds>0 → deadline (deadline 이 이김)',
  SP.endCondition({ name: 'listen', seconds: 10, media: { src: 'x.mp3', kind: 'audio' } }), 'deadline');
check('seconds:0 + media 없음 + selfPaced 아님 → immediate',
  SP.endCondition({ name: 'prep', seconds: 0 }), 'immediate');
check('이미지 media 는 종료조건이 아니다 (ended 이벤트 없음)',
  SP.endCondition({ name: 'read', seconds: 0, selfPaced: false, media: { src: 'cue.png', kind: 'image' } }), 'immediate');
check('phase 없음 → none', SP.endCondition(null), 'none');

/* ── [2] immediate(0-length) phase 는 즉시 통과 ──────────────────────── */
console.log('\n[2] seconds:0 prep 은 분기 없이 즉시 통과');
var r0 = drive([
  { name: 'listen', seconds: 0, media: { src: 'a.mp3', kind: 'audio' } },
  { name: 'prep', seconds: 0 },
  { name: 'record', seconds: 20 }
]);
check('궤적', names(r0), 'listen → record → (end)');
check('액션', acts(r0), 'playMedia,startRecord,stopRecord,screenDone');

console.log('\n[2b] 전 phase 가 immediate 면 start 만으로 done');
var rAll = drive([{ name: 'prep', seconds: 0 }, { name: 'prompt', seconds: 0 }]);
check('status', rAll.status, 'done');
check('궤적', names(rAll), '(end)');

/* ── [3] TOEFL S1 / S2 실제 컴파일 결과 ─────────────────────────────── */
console.log('\n[3] TOEFL SET 1 speaking 실제 화면 (컴파일러 산출)');
var timing = JSON.parse(fs.readFileSync(path.join(SG2, 'config/timing.toefl.json'), 'utf8'));
var res = window.SG_COMPILE.compileScreens(window.SMEAG_SET1, timing, { profile: 'toefl', lang: 'en' });
var spk = res.screens.filter(function (s) { return s.screenType === 'speaking'; });

check('speaking 화면 수 (S1 7 + S2 4)', spk.length, 11);
check('S1 화면 수', spk.filter(function (s) { return s.moduleId === 'S1'; }).length, 7);
check('S2 화면 수', spk.filter(function (s) { return s.moduleId === 'S2'; }).length, 4);

var s1 = spk[0], s2 = spk[7];
check('S1 첫 화면 id', s1.id, 'speaking.q.S1.01');
var rS1 = drive(s1.phases);
check('S1 궤적', names(rS1), 'listen → prep → record → (end)');
check('S1 액션', acts(rS1), 'playMedia,startRecord,stopRecord,screenDone');
check('S1 prep 초', s1.phases[1].seconds, 2);
check('S1 record 초 (responseSecByIndex[0])', s1.phases[2].seconds, 8);
/* Task 1 문장별 답변 시간 — 1~2번 8초 / 3~5번 10초 / 6~7번 12초 (최종수정사항.docx). */
check('S1 7문항 record 초 시퀀스',
  spk.slice(0, 7).map(function (s) { return s.phases[2].seconds; }).join(','),
  '8,8,10,10,10,12,12');
check('S1 7문항 timer.seconds 도 동일',
  spk.slice(0, 7).map(function (s) { return s.timer.seconds; }).join(','),
  '8,8,10,10,10,12,12');
check('S1 timer.format', s1.timer.format, 'HH:MM:SS');
check('S1 timer.mode', s1.timer.mode, 'response');

check('S2 첫 화면 id', s2.id, 'speaking.q.S2.01');
var rS2 = drive(s2.phases);
check('S2 궤적', names(rS2), 'read → listen → prep → record → (end)');
check('S2 액션', acts(rS2), 'playMedia,startRecord,stopRecord,screenDone');
check('S2 read 는 selfPaced', s2.phases[0].selfPaced, true);
check('S2 record 초 (interview.responseSec)', s2.phases[3].seconds, 45);

console.log('\n[3b] 11문항 전부가 record phase 로 끝나고 done 에 도달');
var bad = 0, noRecord = 0;
spk.forEach(function (s) {
  var r = drive(s.phases);
  if (r.status !== 'done') bad++;
  var last = s.phases[s.phases.length - 1];
  if (!last || last.name !== 'record') noRecord++;
  if (acts(r).indexOf('startRecord,stopRecord,screenDone') < 0) bad++;
});
check('done 미도달/액션 누락', bad, 0);
check('record 로 끝나지 않는 화면', noRecord, 0);

/* ── [4] IELTS Speaking Part 2 (cue card) — 같은 코드경로 ───────────── */
console.log('\n[4] IELTS Part 2 [read, prep(60), record(120)] — 코드 변경 없이 동작');
var ielts2 = [
  { name: 'read', seconds: 0, selfPaced: true, media: { src: 'cue-card.png', kind: 'image' } },
  { name: 'prep', seconds: 60 },
  { name: 'record', seconds: 120 }
];
var rI = drive(ielts2);
check('궤적', names(rI), 'read → prep → record → (end)');
check('액션', acts(rI), 'startRecord,stopRecord,screenDone');
check('prep 초 (TOEFL 3 → IELTS 60, 코드 동일)', ielts2[1].seconds, 60);
check('record 초', ielts2[2].seconds, 120);
check('cue card 는 playable 아님', SP.isPlayable(ielts2[0].media), false);

console.log('\n[4b] IELTS Part 1/3 (prep 0초) 도 동일 루프');
var rI13 = drive([
  { name: 'listen', seconds: 0, media: { src: 'q.mp3', kind: 'audio' } },
  { name: 'prep', seconds: 0 },
  { name: 'record', seconds: 30 }
]);
check('궤적', names(rI13), 'listen → record → (end)');

/* ── [5] force / 중복 이벤트 / done 이후 불변 ───────────────────────── */
console.log('\n[5] 방어 동작');
var stF = { phases: s1.phases, phaseIndex: 0, status: 'active' };
check('잘못된 이벤트는 무시 (listen 에 expire)',
  SP.nextPhase(stF, { type: 'expire' }).changed, false);
check('force 는 어떤 phase 든 종료',
  SP.nextPhase(stF, { type: 'force' }).phaseIndex, 1);
var stRec = { phases: s1.phases, phaseIndex: 2, status: 'active' };
var outRec = SP.nextPhase(stRec, { type: 'expire' });
check('record 종료 시 stopRecord+screenDone', outRec.actions.join(','), 'stopRecord,screenDone');
check('done 이후 어떤 이벤트도 무시',
  SP.nextPhase({ phases: s1.phases, phaseIndex: 3, status: 'done' }, { type: 'force' }).changed, false);
check('start 를 두 번 불러도 진행하지 않는다',
  SP.nextPhase({ phases: s1.phases, phaseIndex: 0, status: 'active' }, { type: 'start' }).changed, false);
console.log('  --   새로고침 복구: phaseIndex 를 record 로 두고 start');
var outResume = SP.nextPhase({ phases: s1.phases, phaseIndex: 2, status: 'idle' }, { type: 'start' });
check('record 에서 재개', outResume.phaseIndex, 2);
check('재개 액션', outResume.actions.join(','), 'startRecord');

/* ── [6] 렌더러가 참조하는 필드가 11화면 전부에 존재하는가 ──────────── */
console.log('\n[6] 렌더러 참조 필드 전수 존재 확인');
var missing = [];
function need(cond, where) { if (!cond) missing.push(where); }
spk.forEach(function (s) {
  need(typeof s.id === 'string' && s.id, s.id + '.id');
  need(s.questionIds && s.questionIds.length === 1 && s.questionIds[0], s.id + '.questionIds[0]');
  need(s.progress && typeof s.progress.index === 'number' && typeof s.progress.total === 'number', s.id + '.progress');
  need(s.timer && s.timer.mode === 'response' && s.timer.format === 'HH:MM:SS', s.id + '.timer');
  need(s.phases && s.phases.length >= 3, s.id + '.phases');
  need(s.image && s.image.src, s.id + '.image.src');
  need(s.image && s.image.srcRaw, s.id + '.image.srcRaw');
  (s.phases || []).forEach(function (p, i) {
    need(typeof p.name === 'string' && p.name, s.id + '.phases[' + i + '].name');
    need(typeof p.seconds === 'number', s.id + '.phases[' + i + '].seconds');
    if (p.media) {
      need(p.media.src, s.id + '.phases[' + i + '].media.src');
      need(p.media.srcRaw, s.id + '.phases[' + i + '].media.srcRaw');
      need(SP.mediaKind(p.media) === 'audio', s.id + '.phases[' + i + '].media.kind=audio');
    }
  });
});
if (missing.length) console.log('       ' + missing.slice(0, 10).join('\n       '));
check('누락 필드', missing.length, 0);

/* srcOf() 는 srcRaw 를 resolveMedia() 에 통과시킨다. 그 결과가 컴파일된 src 와
   같아야 이중 인코딩(%→%25)이 없다는 뜻이다. */
console.log('\n[7] 미디어 경로 — srcRaw → resolveMedia 가 컴파일 src 와 일치 (이중 인코딩 없음)');
var mism = [];
spk.forEach(function (s) {
  var all = [s.image].concat((s.phases || []).map(function (p) { return p.media; }));
  all.forEach(function (m) {
    if (!m || !m.srcRaw) return;
    var got = window.SG_MEDIA.resolveMedia(m.srcRaw);
    if (got !== m.src) mism.push(s.id + ': ' + got + ' != ' + m.src);
    if (window.SG_MEDIA.resolveMedia(m.src) === m.src && m.src.indexOf('%') >= 0) {
      mism.push(s.id + ': re-encoding src is not idempotent');
    }
  });
});
if (mism.length) console.log('       ' + mism.slice(0, 6).join('\n       '));
check('불일치', mism.length, 0);

console.log('\n' + (fails.length ? 'FAILED: ' + fails.join(', ') : 'ALL PASS'));
process.exit(fails.length ? 1 : 0);
