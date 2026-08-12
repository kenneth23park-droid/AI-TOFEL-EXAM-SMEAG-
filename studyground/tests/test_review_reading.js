/* 리딩 채점 리뷰(assets/sg-review-reading.js) — node 전용.
 * 실행: node "studyground/tests/test_review_reading.js"
 *
 * 지키는 것 넷.
 *  [A] SET 9 리딩이 모듈 → 블록 → 문항으로 펴지고, 블록 이름이 학생 말로 나온다
 *      ('Fill in the blank.' → C-Test, 'Read a passage.' → Academic Passage).
 *  [B] 왼쪽에 읽은 것이 그대로 다시 펴진다 — 지문은 문단으로, C-Test 는 어간 + 네모.
 *  [C] 정답 보기는 초록(key)·고른 보기는 산호(pick)로 갈리고, 정오가 글로도 남는다.
 *      C-Test 는 보기가 없으니 판정 상자에 내 단어와 정답 단어가 글로 선다.
 *  [D] 문항 이동 줄의 동그라미 색이 채점 결과(맞음·틀림·무응답)를 그대로 따른다.
 */
var fs = require('fs');
var path = require('path');

var SG2 = path.join(__dirname, '..', 'sg2');
global.window = global;

function load(rel) {
  var code = fs.readFileSync(path.join(SG2, rel), 'utf8');
  (0, eval)(code);
}

load('assets/set9.js');
load('assets/sg-review-reading.js');

var RR = window.SG_REVIEW_READING;
var PACK = window.SMEAG_SET9;
var fails = [];
function ok(cond, msg) { if (!cond) fails.push(msg); }

/* 채점 행을 흉내낸다. 짝수 문항은 맞히고, 홀수 문항은 틀린다.
   R1-3 만 무응답으로 남겨 '아직 안 푼 문항'도 확인한다. */
var rows = [];
PACK.sections.forEach(function (sec) {
  if (sec.id !== 'reading') return;
  sec.modules.forEach(function (mod) {
    mod.blocks.forEach(function (blk) {
      (blk.questions || []).forEach(function (q) {
        var key = PACK.answerKey[q.id] != null ? PACK.answerKey[q.id] : q.answer;
        var given, okv;
        if (q.id === 'R1-3') { given = ''; okv = false; }
        else if (q.no % 2 === 0) { given = String(key); okv = true; }
        else if (q.kind === 'blank') { given = String(key) + 'x'; okv = false; }
        else { given = String((Number(key) + 1) % 4); okv = false; }
        rows.push({ qid: q.id, no: q.no, section: 'reading', given: given, key: key, ok: okv });
      });
    });
  });
});

/* [A] 구조와 블록 이름 */
var M = RR.model(PACK, rows);
ok(M.length === 2, 'A: 리딩 모듈이 둘이어야 한다 — 실제 ' + M.length);
ok(M[0].items.length === 35, 'A: M1 문항 35개여야 한다 — 실제 ' + M[0].items.length);
var labels = M[0].groups.map(function (g) { return g.label; });
ok(labels[0] === 'C-Test' && labels[1] === 'C-Test',
   'A: 앞 두 블록은 C-Test — 실제 ' + JSON.stringify(labels));
ok(labels.filter(function (l) { return l === 'Read in Daily Life (Short)'; }).length === 2,
   'A: 2문항짜리 생활문 2개여야 한다 — 실제 ' + JSON.stringify(labels));
ok(labels.filter(function (l) { return l === 'Read in Daily Life (Long)'; }).length === 2,
   'A: 3문항짜리 생활문 2개여야 한다 — 실제 ' + JSON.stringify(labels));
ok(labels[labels.length - 1] === 'Academic Passage',
   'A: 마지막 블록은 학술 지문 — 실제 ' + labels[labels.length - 1]);

/* [B] 왼쪽에 읽은 것이 다시 펴진다 */
var cloze = RR.html(M, { m: 0, q: 0 });
var q1 = M[0].items[0];
ok(cloze.indexOf('rr-cloze') >= 0, 'B: C-Test 문단이 왼쪽에 없다');
ok(cloze.indexOf('>' + RR.esc(RR.stemOf(q1.q)) + '□') >= 0,
   'B: 어간 뒤에 빠진 글자만큼의 네모가 서야 한다');
ok(RR.missingCount(q1.q) === String(q1.q.answer).length - String(q1.q.hint).length,
   'B: 네모 개수는 정답 글자수 - 어간 글자수다');
ok(/rr-blank now/.test(cloze), 'B: 지금 보는 빈칸이 짚어지지 않았다');
ok((cloze.match(/rr-blank now/g) || []).length === 1, 'B: 짚어지는 빈칸은 하나뿐이어야 한다');

var passage = RR.html(M, { m: 0, q: 34 });          // 31-35 학술 지문의 마지막 문항
ok(passage.indexOf('rr-title') >= 0, 'B: 지문 제목이 없다');
ok((passage.match(/<p>/g) || []).length >= 3, 'B: 지문이 문단으로 펴지지 않았다');
ok(passage.indexOf('{{') < 0, 'B: 지문에 원본 마커가 그대로 남았다');

/* 삽입 문항(R2-15)에서만 A~D 표식이 산다 — 정답 자리에는 넣었어야 할 문장이 붙는다 */
var ins = M[1].items.filter(function (it) { return it.q.kind === 'insert'; })[0];
ok(!!ins, 'B: SET 9 M2 에 삽입 문항이 있어야 한다');
var insHtml = RR.html(M, { m: 1, q: ins.index });
ok(insHtml.indexOf('rr-mark key') >= 0, 'B: 삽입 문항의 정답 자리가 표시되지 않았다');
ok(insHtml.indexOf(RR.esc(ins.q.sentence)) >= 0, 'B: 넣었어야 할 문장이 지문에 없다');

/* [C] 보기 색과 정오 */
var q21 = M[0].items[20];                            // 21번 — 홀수라 틀렸다
var wrong = RR.html(M, { m: 0, q: 20 });
ok(wrong.indexOf('lr-ch key') >= 0, 'C: 정답 보기에 key 표시가 없다');
ok(wrong.indexOf('lr-ch pick') >= 0, 'C: 고른 보기에 pick 표시가 없다');
ok(wrong.indexOf(RR.esc(q21.q.choices[Number(q21.key)])) >= 0, 'C: 정답 보기 글이 화면에 없다');
ok(wrong.indexOf('Incorrect') >= 0, 'C: 오답이라고 말하지 않는다');
ok(wrong.indexOf('lr-verdict no') >= 0, 'C: 오답 판정 상자가 아니다');

var right = RR.html(M, { m: 0, q: 21 });             // 22번 — 짝수라 맞았다
ok(right.indexOf('lr-verdict ok') >= 0, 'C: 정답 판정 상자가 아니다');
ok(right.indexOf('lr-ch pick') < 0, 'C: 정답을 골랐으면 산호색 pick 은 없어야 한다');

/* C-Test 는 보기가 없다 — 판정 상자에 내 단어와 정답 단어가 글로 선다 */
var c2 = RR.html(M, { m: 0, q: 1 });                 // 2번 — 맞은 빈칸
ok(c2.indexOf('lr-choices') < 0, 'C: C-Test 에 사지선다 보기가 생겼다');
ok(c2.indexOf('rr-cue') >= 0, 'C: 오른쪽에 빈칸 모양이 다시 서지 않았다');
ok(c2.indexOf(RR.esc(String(M[0].items[1].key))) >= 0, 'C: 정답 단어가 글로 서지 않았다');

var na = RR.html(M, { m: 0, q: 2 });                 // 3번 — 무응답
ok(na.indexOf('(no answer)') >= 0, 'C: 무응답 표시가 없다');

/* [D] 이동 줄 동그라미 색 = 채점 결과 */
var dots = cloze.match(/class="lr-dot ([a-z]+)/g) || [];
ok(dots.length === 35, 'D: M1 동그라미가 35개여야 한다 — 실제 ' + dots.length);
ok(dots[0].indexOf('no') >= 0, 'D: 1번은 틀렸으니 빨강이어야 한다');
ok(dots[1].indexOf('ok') >= 0, 'D: 2번은 맞았으니 초록이어야 한다');
ok(cloze.indexOf('lr-dot no now') >= 0, 'D: 지금 보는 문항에 표시(now)가 없다');
ok(/lr-count bad">\d+ ✗/.test(cloze), 'D: 모듈 탭에 오답 수가 없다');

if (fails.length) {
  console.error('FAIL (' + fails.length + ')');
  fails.forEach(function (f) { console.error(' - ' + f); });
  process.exit(1);
}
console.log('OK — 리딩 리뷰: 구조 · 지문 · C-Test 빈칸 · 정오 표시 · 이동 줄');
