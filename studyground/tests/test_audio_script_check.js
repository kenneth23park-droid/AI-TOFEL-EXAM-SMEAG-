/* sg2 assets/audio-script-check.js — 대본↔오디오 판정 규칙 검증.
 *
 * 이 모듈은 화면 두 곳(admin-audio-files.html 의 표 판정, admin-audio-sync.html 의
 * 단어 형광)이 같이 쓴다. 그래서 여기서 지키려는 것은 하나다 — 같은 입력에 같은 판정.
 *   1) 실제 데이터(config/audio-check.set9.json 40개)로 대조가 통과하는가.
 *      이 40개는 이미 사람이 확인한 음원이므로, 규칙이 망가지면 여기서 먼저 무너진다.
 *   2) 숫자 표기 차이("400" vs "four hundred")를 불일치로 세지 않는가.
 *   3) 길이 모델 밴드가 tools/verify_audio.py 의 THRESHOLDS 와 같은가.
 *   4) 잘린 음원·엉뚱한 음원이 실제로 bad 로 떨어지는가.
 *
 * 실행: node studyground/tests/test_audio_script_check.js
 */
'use strict';

var fs = require('fs');
var path = require('path');

global.window = global;
require(path.join(__dirname, '..', 'sg2', 'assets', 'audio-script-check.js'));
var SC = window.SG_SCRIPT_CHECK;

var fails = 0;
function ok(cond, msg) {
  if (!cond) { fails++; console.error('  ✗ ' + msg); } else { console.log('  ✓ ' + msg); }
}

/* ── 1. 실제 SET 9 데이터 ───────────────────────────────────── */
var data = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'sg2', 'config', 'audio-check.set9.json'), 'utf8'));
var items = data.items || [];
ok(items.length === 40, 'audio-check.set9.json 40 clips (got ' + items.length + ')');

/* 밴드는 세 칸이다. 지금 실린 40개 중 둘(s2-instructions · s2-q4)이 96% 대로 warn 에
   앉아 있다 — 받아쓰기 잡음 수준이지 잘못 읽힌 음원이 아니다. 그래서 게이트는
   "bad 가 없다"로 두고, warn 은 몇 개인지 세어 두기만 한다. warn 이 늘면 여기서 보인다. */
var worst = { id: null, ratio: 2 }, bad = [], warn = [], noAsr = [];
items.forEach(function (it) {
  var c = SC.compare(it);
  if (c.ratio == null) { noAsr.push(it.id); return; }
  if (c.ratio < worst.ratio) worst = { id: it.id, ratio: c.ratio };
  var b = SC.asrBand(c.ratio);
  if (b === 'bad') bad.push(it.id + ' ' + Math.round(c.ratio * 100) + '%');
  else if (b === 'warn') warn.push(it.id + ' ' + Math.round(c.ratio * 100) + '%');
});
ok(noAsr.length === 0, 'every shipped clip has an ASR transcript' +
   (noAsr.length ? ' — missing: ' + noAsr.join(', ') : ''));
ok(bad.length === 0, 'no shipped clip is off its script (worst ' +
   worst.id + ' ' + Math.round(worst.ratio * 1000) / 10 + '%)' +
   (bad.length ? ' — bad: ' + bad.join(', ') : ''));
ok(warn.length === 2, 'exactly the two known borderline clips are in the warn band (got ' +
   (warn.join(', ') || 'none') + ')');

/* ── 2. 숫자 표기 ──────────────────────────────────────────── */
ok(SC.compare({ text: 'It costs four hundred dollars.', asr: 'It costs 400 dollars.' }).ratio === 1,
   '"four hundred" == "400"');
ok(SC.compare({ text: "I'm fourteenth in the queue.", asr: 'I am 14th in the queue.' }).ratio < 1,
   '"I\'m" vs "I am" is still counted (contraction is not expanded)');
ok(SC.compare({ text: 'Room twenty three.', asr: 'Room 23.' }).ratio === 1, '"twenty three" == "23"');

/* ── 3. 길이 모델 ──────────────────────────────────────────── */
var TH = SC.TH;
ok(TH.wpm === 165, 'wpm 165 (tools/tts_set9.py RATE_WPM)');
ok(Math.abs(SC.expectedSeconds('one two three four five six') - 6 / 165 * 60) < 1e-9,
   'expected = words / wpm * 60');
// 긴 항목(25단어 이상) 밴드 — verify_audio.py THRESHOLDS 와 같은 경계
ok(SC.durationBand(100, 1.00) === 'ok', 'long ratio 1.00 → ok');
ok(SC.durationBand(100, 0.75) === 'warn', 'long ratio 0.75 → warn');
ok(SC.durationBand(100, 0.30) === 'bad', 'long ratio 0.30 (앞 30%만 남은 잘림) → bad');
ok(SC.durationBand(100, 1.80) === 'bad', 'long ratio 1.80 → bad');
// 짧은 항목은 밴드가 더 넓다 — 문미 한 번의 쉼이 비율을 흔들어서
ok(SC.durationBand(8, 1.50) === 'ok', 'short ratio 1.50 → ok (같은 비율도 long 이면 warn)');
ok(SC.durationBand(100, 1.50) === 'warn', '  ↑ 같은 1.50 이 long 에서는 warn');
ok(SC.durationBand(8, 1.70) === 'warn', 'short ratio 1.70 → warn');
ok(SC.durationBand(8, 2.60) === 'bad', 'short ratio 2.60 → bad');
ok(SC.durationBand(8, 0) === 'none', 'no duration → none, not a failure');

/* ── 4. 엉뚱한 음원 ────────────────────────────────────────── */
var q = { text: 'Where is the student lounge?', asr: 'What does the woman suggest the man do?' };
ok(SC.asrBand(SC.compare(q).ratio) === 'bad', '문항 질문문이 대신 녹음된 경우 → bad');
var half = items[items.length - 1];
ok(SC.asrBand(SC.compare({ text: half.text, asr: half.asr.slice(0, Math.floor(half.asr.length / 2)) }).ratio) !== 'ok',
   '뒤 절반이 잘린 받아쓰기 → ok 아님');

/* ── 5. 형광 ───────────────────────────────────────────────── */
var c = SC.compare({ text: 'alpha bravo charlie', asr: 'alpha delta charlie' });
ok(/<mark class="miss">bravo<\/mark>/.test(c.scriptHtml), '대본에만 있는 낱말에 miss 형광');
ok(/<mark class="extra">delta<\/mark>/.test(c.asrHtml), '음성에만 있는 낱말에 extra 형광');
ok(SC.compare({ text: 'a & b', asr: '' }).scriptHtml.indexOf('&amp;') >= 0, 'HTML 이스케이프');

console.log(fails ? '\nFAIL ' + fails : '\nAll good');
process.exit(fails ? 1 : 0);
