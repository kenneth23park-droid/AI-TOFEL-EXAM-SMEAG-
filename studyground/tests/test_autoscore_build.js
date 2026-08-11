/* 자동채점 범위 — SET 9 는 107 문항이 규칙으로 채점돼야 한다.
 *
 * 여기서 지키는 것은 숫자 하나다: **107**.
 *   리딩 50 + 리스닝 47 + 라이팅 W1(Build a Sentence) 10 = 107
 *   나머지 13(스피킹 11 + 이메일 + 디스커션)은 루브릭 채점이라 여기서 빠진다.
 *
 * W1 이 빠지기 쉬운 이유: 이 문항의 정답은 ANSWER_KEY 에 없다. 슬롯 정의
 * (slots[].a)가 정본이라, score() 가 거기서 꺼내 오지 않으면 key 가 null 이 되어
 * 조용히 '주관식'으로 분류된다. 그러면 만점을 맞아도 97/97 이 되고 라이팅은
 * 0/0 으로 사라진다 — 아무도 에러를 보지 못한 채로.
 *
 * 실행: node studyground/tests/test_autoscore_build.js
 */
'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var SG2 = path.join(ROOT, 'sg2');

/* sg-results.js 는 window 전역에 붙는 브라우저 파일이라 require 로는 못 읽는다. */
global.window = {};
require(path.join(SG2, 'assets', 'set9.js'));
new Function('window', fs.readFileSync(path.join(SG2, 'assets', 'sg-results.js'), 'utf8'))(global.window);

var PACK = global.window.SMEAG_SET9;
var RESULTS = global.window.SG_RESULTS;

var fails = 0;
function eq(got, want, label) {
  if (got === want) { console.log('  ok   ' + label + ': ' + got); return; }
  fails += 1;
  console.error('  FAIL ' + label + ': ' + got + ' (기대 ' + want + ')');
}

/* 모든 문항을 정답으로 채운 답안지. mut 로 한 문항만 망가뜨려 감점을 확인한다. */
function sheet(mut) {
  var a = {};
  PACK.allQuestions().forEach(function (e) {
    var q = e.q;
    if (q.kind === 'blank' || q.kind === 'mcq' || q.kind === 'insert') a[q.id] = { v: q.answer };
    else if (q.kind === 'build') {
      a[q.id] = { v: q.slots.filter(function (s) { return s.t === 'b'; })
                            .map(function (s) { return s.a; }) };
    }
  });
  if (mut) mut(a);
  return a;
}
function scored(mut) { return RESULTS.score(PACK, sheet(mut)); }

console.log('만점 답안');
var full = scored();
eq(full.score, 107, '자동채점 정답 수');
eq(full.total, 107, '자동채점 문항 수');
eq(full.percent, 100, '백분율');
eq(full.bySection.reading.total, 50, '리딩');
eq(full.bySection.listening.total, 47, '리스닝');
eq(full.bySection.writing.total, 10, '라이팅 W1');
eq(full.rows.filter(function (r) { return r.ok === null; }).length, 13, '루브릭 채점으로 남는 문항');

console.log('Build a Sentence 판정');
eq(scored(function (a) {
  a['set9-W1-q06'].v = a['set9-W1-q06'].v.map(function (t) { return t.toUpperCase(); });
}).score, 107, '대소문자만 다르면 정답');

eq(scored(function (a) {
  var v = a['set9-W1-q01'].v.slice();
  var t = v[4]; v[4] = v[5]; v[5] = t;
  a['set9-W1-q01'].v = v;
}).score, 106, '토큰 순서가 바뀌면 오답');

eq(scored(function (a) { delete a['set9-W1-q02']; }).score, 106, '무응답은 오답');

eq(scored(function (a) {
  a['set9-W1-q03'].v = a['set9-W1-q03'].v.slice(0, 3);
}).score, 106, '빈칸을 덜 채우면 오답');

console.log('리뷰 표기');
var row = full.rows.filter(function (r) { return r.qid === 'set9-W1-q01'; })[0];
eq(typeof row.key === 'string' && row.key.indexOf('which books') >= 0, true,
   '정답 칸은 빈칸 토막이 아니라 완성 문장');

/* 정답을 꺼내는 곳이 두 군데다 — 브라우저 채점(sg-results.js)과 서버 정답지로
   내보내는 스크립트(tools/export_answer_key.js). 둘이 다른 정답을 들면 화면 점수와
   DB 점수가 갈린다. 같은 문항 수·같은 배열이 나오는지 여기서 대조한다. */
console.log('정본 대조');
var sql = require('child_process')
  .execFileSync('node', [path.join(ROOT, 'tools', 'export_answer_key.js')],
                { encoding: 'utf8' });
eq((sql.match(/'slot_sequence'/g) || []).length, 10, '내보내기의 슬롯 채점 문항 수');
eq((sql.match(/,'ai',null,/g) || []).length, 13, '내보내기의 루브릭 채점 문항 수');

PACK.allQuestions().forEach(function (e) {
  if (e.q.kind !== 'build') return;
  var mine = e.q.slots.filter(function (s) { return s.t === 'b'; })
                      .map(function (s) { return s.a; });
  eq(sql.indexOf("'" + e.q.id + "'") >= 0 &&
     sql.indexOf(JSON.stringify(mine).replace(/'/g, "''")) >= 0, true,
     e.q.id + ' 정답 배열이 양쪽에서 같다');
});

console.log(fails ? '\n실패 ' + fails + '건' : '\n모두 통과');
process.exit(fails ? 1 : 0);
