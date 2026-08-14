/* 시험일 명단 대조 — 빈칸이 이름을 갖는다.
 *
 * 성적 화면은 "올라온 것" 만 그린다. 그래서 올라오지 않은 응시는 화면 어디에도
 * 자리가 없고, 없다는 사실 자체가 안 보인다. 2026-08-12 시험이 그랬다: 배부한
 * 아이디 9개 중 8개만 sg_results 에 닿았는데, 표는 8줄을 멀쩡히 그렸고 아무도
 * 세지 않았다. smeag007(PAI JUN YUAN)이 빠진 것은 학생들이 다 돌아간 뒤에 알았다.
 *
 * 대조의 정본은 sg_exam_accounts(배부한 아이디)다. 거기서 도착한 것을 빼면 남는
 * 것이 빈칸이고, 그 빈칸에는 이름이 붙어 있다.
 *
 * 도착 판정을 owner(uuid)로 하는 것이 이 파일의 핵심이다 — 학번(smeag007)은
 * 시험일마다 다시 쓰이므로 유일하지 않다. 학번으로 맞추면 지난달 같은 번호의
 * 응시가 오늘 도착한 것처럼 보인다.
 *
 * 실행: node studyground/tests/test_roster_rollcall.js
 */
'use strict';

var fs = require('fs');
var path = require('path');

var HTML = fs.readFileSync(
  path.join(__dirname, '..', 'sg2', 'admin-results.html'), 'utf8');

var fails = 0;
function ok(cond, msg) {
  if (!cond) { fails++; console.error('  ✗ ' + msg); } else { console.log('  ✓ ' + msg); }
}

/* ── paintRoster 를 화면 밖으로 꺼낸다 ─────────────────────── */
var a = HTML.indexOf('  function paintRoster() {');
var b = HTML.indexOf('\n  function load() {', a + 1);
if (a < 0 || b < 0) { console.error('paintRoster 블록을 찾지 못했습니다.'); process.exit(1); }
var SRC = HTML.slice(a, b);

/* 화면 대신 값을 받아 두는 자리. innerHTML 을 문자열로 모아 두고 뒤에서 읽는다. */
function harness(roster, results, day) {
  var els = {};
  function el() { return { value: '', innerHTML: '', classList: { remove: function () {} } }; }
  ['roster-sum', 'roster-body', 'roster-date'].forEach(function (id) { els[id] = el(); });
  els['roster-date'].value = day;

  var fn = new Function('ROSTER', 'ALL', '$', 'esc', 'bi', SRC + '\nreturn paintRoster;');
  fn(roster, results,
     function (id) { return els[id]; },
     function (s) { return String(s == null ? '' : s); },
     function (en, ko) { return en + '|' + ko; })();
  return { sum: els['roster-sum'].innerHTML, body: els['roster-body'].innerHTML };
}

/* 2026-08-12 시험을 그대로 세운다: 배부 9명, 도착 8명, 빠진 사람은 smeag007. */
var ROSTER = [
  { student_id: 'smeag006', name: 'HAYUL KIM',     exam_date: '2026-08-12', user_id: 'u6' },
  { student_id: 'smeag007', name: 'PAI JUN YUAN',  exam_date: '2026-08-12', user_id: 'u7' },
  { student_id: 'smeag008', name: 'LIN HSUAN CHENG', exam_date: '2026-08-12', user_id: 'u8' },
  /* 지난달 시험의 같은 학번 — 오늘 대조에 끼면 안 된다. */
  { student_id: 'smeag007', name: 'SOMEONE ELSE',  exam_date: '2026-07-15', user_id: 'old7' }
];

console.log('빠진 사람을 이름으로 부른다');
var r = harness(ROSTER, [{ owner: 'u6' }, { owner: 'u8' }], '2026-08-12');
ok(/MISSING/.test(r.sum), '미도착이 있으면 요약이 그렇게 말한다');
ok(/2 of 3 arrived/.test(r.sum), '도착 2 / 배부 3 으로 센다 → ' + r.sum);
ok(/#c0392b/.test(r.sum), '붉게 편다');
ok(/PAI JUN YUAN/.test(r.body), '빠진 학생의 이름이 나온다');
ok(/smeag007/.test(r.body), '빠진 학생의 학번이 나온다');
ok(!/HAYUL KIM/.test(r.body), '도착한 학생은 명단에 없다');
ok(/시험 PC/.test(r.body), '그 PC 를 지우지 말라고 이른다');

console.log('\n다른 시험일은 섞이지 않는다');
ok(!/SOMEONE ELSE/.test(r.body), '지난달 같은 학번은 오늘 대조에 끼지 않는다');

console.log('\n도착 판정은 학번이 아니라 owner 로 한다');
/* 지난달 smeag007(old7)의 응시가 서버에 있어도, 오늘의 smeag007(u7)은 미도착이다. */
var r2 = harness(ROSTER, [{ owner: 'u6' }, { owner: 'u8' }, { owner: 'old7' }], '2026-08-12');
ok(/PAI JUN YUAN/.test(r2.body), '같은 학번의 지난 응시가 오늘을 채워 주지 않는다');
ok(/landed\[a\.user_id\]/.test(SRC), '코드가 user_id 로 맞춘다');
ok(!/landed\[a\.student_id\]/.test(SRC), '학번으로 맞추지 않는다');

console.log('\n전원 도착이면 조용하다');
var r3 = harness(ROSTER, [{ owner: 'u6' }, { owner: 'u7' }, { owner: 'u8' }], '2026-08-12');
ok(/All 3 arrived/.test(r3.sum), '전원 도착이라고 말한다 → ' + r3.sum);
ok(/#1e8449/.test(r3.sum), '초록으로 편다');
ok(r3.body === '', '붉은 막을 세우지 않는다');

console.log('\n결과가 하나도 없어도 대조는 돈다');
var r4 = harness(ROSTER, [], '2026-08-12');
ok(/3 MISSING|0 of 3/.test(r4.sum), '전원 미도착을 센다 → ' + r4.sum);
ok(/PAI JUN YUAN/.test(r4.body) && /HAYUL KIM/.test(r4.body), '세 사람 모두 부른다');
/* 그 자리가 가장 중요하다 — load() 의 "결과 없음" 이른 return 보다 앞에 서야 한다. */
ok(HTML.indexOf('loadRoster();') < HTML.indexOf("notice('No submitted test has been uploaded yet."),
   '명단 대조가 "결과 없음" 이른 return 보다 앞에 선다');

console.log(fails ? '\nFAIL ' + fails + '건' : '\nALL PASS (exam day roll call)');
process.exit(fails ? 1 : 0);
