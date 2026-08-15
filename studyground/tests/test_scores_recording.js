/* smeag-com/scores.html — 스피킹 한 줄을 누르면 녹음이 들린다.
 *
 * 이 화면은 시험을 친 컴퓨터가 아니다. 표에 남은 'idb:set9-S1-q01' 은 그 기기의
 * IndexedDB 를 가리키는 쪽지라 여기서는 아무 소리도 내지 못한다. 들려줄 수 있는
 * 사본은 제출 때 올라간 비공개 버킷의 파일 하나뿐이고, 서명 URL 로만 열린다.
 *
 * 여기서 붙잡는 것 셋.
 *   1) 녹음 자리(media_path)를 실제로 읽어 온다 — 안 읽으면 화면은 자리를 모른다.
 *   2) 채점 전이라 자리가 비어도 업로더 규칙({owner}/{session}/{qid}.{ext})으로 찾는다.
 *   3) 스피킹 줄은 누를 수 있고, 'idb:…' 쪽지는 답인 척 남지 않는다.
 *
 * 페이지는 파일 하나짜리 자립형이라 import 할 수 없다. test_scores_dashboard.js 와
 * 같은 방식으로 필요한 블록만 잘라 내 화면 밖에서 실행시킨다.
 *
 * 실행: node studyground/tests/test_scores_recording.js
 */
'use strict';

var fs = require('fs');
var path = require('path');

var HTML = path.join(__dirname, '..', 'smeag-com', 'scores.html');
var src = fs.readFileSync(HTML, 'utf8');

var fails = 0;
function ok(cond, msg) {
  if (!cond) { fails++; console.error('  ✗ ' + msg); } else { console.log('  ✓ ' + msg); }
}
function eq(got, want, msg) {
  var same = JSON.stringify(got) === JSON.stringify(want);
  ok(same, msg + ' → ' + JSON.stringify(got) + (same ? '' : ' (기대 ' + JSON.stringify(want) + ')'));
}

function slice(startMark, endMark, what) {
  var a = src.indexOf(startMark), b = src.indexOf(endMark, a + 1);
  if (a < 0 || b < 0 || b < a) {
    console.error(what + ' 블록을 찾지 못했습니다 — scores.html 구조가 바뀌었는지 확인하세요.');
    process.exit(1);
  }
  return src.slice(a, b);
}

var REC = new Function(slice('var REC = (function () {', '/** 한 스피킹 과제의 녹음', 'REC') +
                       '\nreturn REC;')();

console.log('녹음 자리는 서버에서 읽어 온다');
ok(/TASK_SELECT\s*=\s*'[^']*media_path/.test(src),
   'sg_task_scores 조회에 media_path 가 들어 있다');
ok(/media:\s*t\.media_path/.test(src),
   '읽어 온 자리를 과제 목록까지 들고 간다');

console.log('자리를 알면 그 자리를 먼저 연다');
var known = REC.paths('u1/s1/set9-S1-q01.webm', 'u1', 's1', 'set9-S1-q01');
eq(known[0], 'u1/s1/set9-S1-q01.webm', '아는 자리가 첫 후보다');
ok(known.filter(function (p) { return p === 'u1/s1/set9-S1-q01.webm'; }).length === 1,
   '같은 자리를 두 번 시도하지 않는다');

console.log('자리가 비어도 업로더 규칙으로 찾는다');
var guess = REC.paths('', 'u1', 's1', 'set9-S1-q01');
eq(guess[0], 'u1/s1/set9-S1-q01.webm', '규칙은 {owner}/{session}/{qid}.{ext}');
ok(guess.length >= 5, '확장자는 기기마다 다르다 — 후보를 돈다 (' + guess.length + '개)');
ok(guess.indexOf('u1/s1/set9-S1-q01.m4a') > 0, 'm4a(사파리)도 후보에 있다');

console.log('무엇 하나라도 모르면 지어내지 않는다');
eq(REC.paths('', '', 's1', 'q1'), [], 'owner 가 없으면 후보도 없다');
eq(REC.paths('', 'u1', '', 'q1'), [], 'session 이 없으면 후보도 없다');

console.log('스피킹 줄은 누를 수 있다');
ok(/data-task="' \+ i \+ '"/.test(src), '스피킹 줄마다 누를 수 있는 표시가 붙는다');
ok(/class="task' \+ \(speak \? ' playable'/.test(src), '라이팅 줄은 그대로다 — 누를 것이 없다');
ok(/\.task\.playable\{[^}]*cursor:pointer/.test(src), '손가락이 먼저 안다(cursor)');
ok(/playRecording\(r, tasks\[/.test(src), '누르면 그 과제의 녹음을 연다');
ok(/note = \/\^idb:\/\.test/.test(src) && /given && !note/.test(src),
   "'idb:…' 쪽지는 내 답인 척 남지 않는다");

console.log('서명은 자기 몫만 — 열쇠를 화면이 쥐지 않는다');
ok(/object\/sign\/toefl-recordings/.test(src), '서명 URL 로만 연다(공개 주소가 아니다)');
ok(/expiresIn/.test(src), '서명에는 기한이 있다');

process.exit(fails ? 1 : 0);
