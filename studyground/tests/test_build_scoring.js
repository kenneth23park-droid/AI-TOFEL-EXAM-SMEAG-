/* 문장 만들기(Build a Sentence) 채점 — sg2/assets/sg-results.js 의 score().
 * 실행: node studyground/tests/test_build_scoring.js
 *
 * 가져온 세트(SET 10~)는 정답표에 완성 문장을 적어 둔다. 학생 답은 토큰 배열이라, key 가
 * 있다고 문장과 견주면 전부 맞혀도 0 이었다(SET 12 가 10문항 0점). 빈칸 토큰 순서로 잰다.
 * 그리고 세트를 지을 때 성립하지 않은 문항(q.unscored)은 합계에서 빠진다.
 */
'use strict';

var path = require('path');
var SG2 = path.join(__dirname, '..', 'sg2');
global.window = global;
['set9', 'set10', 'set11', 'set12', 'set2'].forEach(function (s) { require(path.join(SG2, 'assets', s + '.js')); });
require(path.join(SG2, 'assets', 'sg-results.js'));

var fails = [];
function ok(name, cond, extra) {
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (extra ? ': ' + extra : ''));
  if (!cond) fails.push(name);
}

function builds(p) {
  var out = [];
  p.sections.forEach(function (s) {
    s.modules.forEach(function (m) {
      m.blocks.forEach(function (b) { (b.questions || []).forEach(function (q) { if (q.kind === 'build') out.push(q); }); });
    });
  });
  return out;
}
function tokens(q) { return q.slots.filter(function (x) { return x.t === 'b'; }).map(function (x) { return x.a; }); }

['SET9', 'SET10', 'SET11', 'SET12', 'SET2'].forEach(function (code) {
  var p = window['SMEAG_' + code];
  var qs = builds(p), scored = qs.filter(function (q) { return !q.unscored; });
  var right = {}, wrong = {};
  scored.forEach(function (q) {
    var t = tokens(q);
    right[q.id] = { v: t };
    wrong[q.id] = { v: t.slice(1).concat(t.slice(0, 1)) };
  });
  var r = window.SG_RESULTS.score(p, right).bySection.writing || {};
  var w = window.SG_RESULTS.score(p, wrong).bySection.writing || {};
  ok(code + ' 다 맞힌 토큰은 만점', r.score === scored.length && r.total === scored.length, JSON.stringify(r));
  ok(code + ' 순서가 틀리면 0', w.score === 0, JSON.stringify(w));
});

var two = builds(window.SMEAG_SET2).filter(function (q) { return q.unscored; }).map(function (q) { return q.id; });
ok('SET 2 의 unscored 문항은 합계에 없다', two.join() === 'set2-W1-q05'
  && window.SG_RESULTS.score(window.SMEAG_SET2, {}).bySection.writing.total === 9, two.join());

console.log(fails.length ? '\n✗ ' + fails.length + ' FAILED' : '\n✓ ALL PASS');
process.exit(fails.length ? 1 : 0);
