/* 리스닝 채점 리뷰(assets/sg-review-listening.js) — node 전용.
 * 실행: node "studyground/tests/test_review_listening.js"
 *
 * 지키는 것 넷.
 *  [A] SET 9 리스닝이 모듈 → 블록 → 문항으로 펴지고, 블록 이름이 학생 말로 나온다
 *      ('Listen to a conversation.' → Conversation).
 *  [B] 문항마다 들을 것이 붙는다 — 단답형은 문항 클립, 대화·강의는 블록 클립.
 *  [C] 정답 보기는 초록(key)·고른 보기는 산호(pick)로 갈리고, 정오가 글로도 남는다.
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

load('assets/exam-media.js');
load('assets/set9.js');
load('assets/sg-review-listening.js');

var RL = window.SG_REVIEW_LISTENING;
var PACK = window.SMEAG_SET9;
var fails = [];
function ok(cond, msg) { if (!cond) fails.push(msg); }

/* 채점 행을 흉내낸다. 짝수 문항은 맞히고, 홀수 문항은 정답이 아닌 보기를 골랐다고 둔다.
   9번만 무응답으로 남겨 '아직 안 푼 문항'도 확인한다. */
var rows = [];
PACK.sections.forEach(function (sec) {
  if (sec.id !== 'listening') return;
  sec.modules.forEach(function (mod) {
    mod.blocks.forEach(function (blk) {
      (blk.questions || []).forEach(function (q) {
        var key = PACK.answerKey[q.id] != null ? PACK.answerKey[q.id] : q.answer;
        var given, okv;
        if (q.id === 'L1-9') { given = ''; okv = false; }
        else if (q.no % 2 === 0) { given = String(key); okv = true; }
        else { given = String((Number(key) + 1) % 4); okv = false; }
        rows.push({ qid: q.id, no: q.no, section: 'listening', given: given, key: key, ok: okv });
      });
    });
  });
});

/* [A] 구조와 블록 이름 */
var M = RL.model(PACK, rows);
ok(M.length === 2, 'A: 리스닝 모듈이 둘이어야 한다 — 실제 ' + M.length);
ok(M[0].items.length === 32, 'A: M1 문항 32개여야 한다 — 실제 ' + M[0].items.length);
var labels = M[0].groups.map(function (g) { return g.label; });
ok(labels[0] === 'Best Response', 'A: 첫 블록은 Best Response — 실제 ' + labels[0]);
ok(labels.filter(function (l) { return l === 'Conversation'; }).length === 3,
   'A: M1 대화 블록 3개여야 한다 — 실제 ' + JSON.stringify(labels));
ok(labels.filter(function (l) { return l === 'Announcement'; }).length === 3,
   'A: M1 안내 방송 블록 3개여야 한다 — 실제 ' + JSON.stringify(labels));
ok(labels.filter(function (l) { return l === 'Academic Talk'; }).length === 2,
   'A: M1 강의 블록 2개여야 한다 — 실제 ' + JSON.stringify(labels));

/* [B] 들을 것이 문항마다 붙는다 */
var noAudio = [];
M.forEach(function (mod) {
  mod.items.forEach(function (it) { if (!it.audio) noAudio.push(it.qid); });
});
ok(!noAudio.length, 'B: 오디오 없는 문항 — ' + noAudio.join(', '));
ok(M[0].items[0].audio.indexOf('l1-q01') >= 0, 'B: 단답형은 문항 자체 클립이어야 한다');
ok(M[0].items[12].audio.indexOf('l1-q13-14') >= 0, 'B: 대화는 블록 클립을 나눠 쓴다');
ok(M[0].items[13].audio === M[0].items[12].audio, 'B: 같은 대화의 두 문항은 같은 클립이다');

/* [C] 보기 색과 정오 — 1번(틀림)과 2번(맞음)을 각각 그려 본다 */
var wrong = RL.html(M, { m: 0, q: 0 });
var q1 = M[0].items[0];
var keyText = q1.q.choices[Number(q1.key)];
var pickText = q1.q.choices[Number(q1.given)];
ok(wrong.indexOf('lr-ch key') >= 0, 'C: 정답 보기에 key 표시가 없다');
ok(wrong.indexOf('lr-ch pick') >= 0, 'C: 고른 보기에 pick 표시가 없다');
ok(wrong.indexOf(RL.esc(keyText)) >= 0, 'C: 정답 보기 글이 화면에 없다');
ok(wrong.indexOf(RL.esc(pickText)) >= 0, 'C: 내가 고른 보기 글이 화면에 없다');
ok(wrong.indexOf('Incorrect') >= 0, 'C: 오답이라고 말하지 않는다');
ok(wrong.indexOf('lr-verdict no') >= 0, 'C: 오답 판정 상자가 아니다');
ok(/<audio[^>]+src="[^"]*l1-q01/.test(wrong), 'C: 그 문항의 오디오가 걸리지 않았다');

var right = RL.html(M, { m: 0, q: 1 });
ok(right.indexOf('lr-verdict ok') >= 0, 'C: 정답 판정 상자가 아니다');
ok(right.indexOf('Incorrect') < 0, 'C: 맞은 문항에 오답 표시가 남았다');
ok(right.indexOf('lr-ch pick') < 0, 'C: 정답을 골랐으면 산호색 pick 은 없어야 한다');

/* 무응답(L1-9) — 정답은 보이되 내 답은 '(no answer)' 다 */
var blank = RL.html(M, { m: 0, q: 8 });
ok(blank.indexOf('(no answer)') >= 0, 'C: 무응답 표시가 없다');
ok(blank.indexOf('lr-ch key') >= 0, 'C: 무응답이어도 정답은 보여야 한다');

/* [D] 이동 줄 동그라미 색 = 채점 결과 */
var dots = wrong.match(/class="lr-dot ([a-z]+)/g) || [];
ok(dots.length === 32, 'D: M1 동그라미가 32개여야 한다 — 실제 ' + dots.length);
ok(dots[0].indexOf('no') >= 0, 'D: 1번은 틀렸으니 빨강이어야 한다');
ok(dots[1].indexOf('ok') >= 0, 'D: 2번은 맞았으니 초록이어야 한다');
ok(wrong.indexOf('lr-dot no now') >= 0, 'D: 지금 보는 문항에 표시(now)가 없다');
/* 모듈 탭에는 그 모듈의 오답 수가 함께 나온다 — 어디부터 볼지 정하는 숫자다. */
ok(/lr-count bad">\d+ ✗/.test(wrong), 'D: 모듈 탭에 오답 수가 없다');

if (fails.length) {
  console.error('FAIL (' + fails.length + ')');
  fails.forEach(function (f) { console.error(' - ' + f); });
  process.exit(1);
}
console.log('OK — 리스닝 리뷰: 구조 · 오디오 · 정오 표시 · 이동 줄');
