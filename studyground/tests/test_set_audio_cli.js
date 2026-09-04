/* 세트 하나의 음성을 만드는 명령 — sg2/tools/make_set_audio.sh 의 검산.
 * 실행: node studyground/tests/test_set_audio_cli.js
 *
 * 이 명령은 세트 번호 하나만 받는 자리다. 그 약속이 깨진 자리가 둘 있었다.
 *   · 번호를 소비하지 않고 "$@" 를 그대로 넘겨, 생성기가 'unrecognized arguments: 12' 로
 *     멈췄다 — 음성이 한 장도 나오지 않았다.
 *   · 음성만 만들고 듣기 화자 사진은 만들지 않아, 사진은 늘 뒤늦게 손으로 채웠다.
 * 둘 다 API 키가 있어야만 드러나는 자리라 사람이 확인하기 어렵다. 글로 고정해 둔다.
 */

'use strict';

var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var SG2 = path.join(__dirname, '..', 'sg2');
var SH = path.join(SG2, 'tools', 'make_set_audio.sh');
var fails = [];
function ok(name, cond, extra) {
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (extra ? ': ' + extra : ''));
  if (!cond) fails.push(name);
}

console.log('[1] 명령이 있고, 세트 번호를 소비한다');
ok('tools/make_set_audio.sh 가 있다', fs.existsSync(SH));
var sh = fs.readFileSync(SH, 'utf8');
ok('세트 번호를 받는다', /N="\$\{1:/.test(sh));
ok('번호를 shift 로 소비한다', /^\s*shift\s*$/m.test(sh),
   '없으면 번호가 생성기의 위치 인자로 다시 들어간다');
var shiftAt = sh.search(/^\s*shift\s*$/m);
var pyAt = sh.lastIndexOf('tts_multivoice.py');   /* 머리말의 설명이 아니라 실제 호출 */
ok('shift 가 생성기 호출보다 먼저다', shiftAt >= 0 && pyAt >= 0 && shiftAt < pyAt);

console.log('\n[2] 한 번에 배역표와 사진까지 짓는다');
ok('배역 매니페스트를 짓는다', /build_voices_manifest\.mjs/.test(sh));
ok('듣기 화자 사진도 짓는다', /build_listening_images\.mjs/.test(sh),
   '없으면 음성만 있고 듣기 화면에 그림이 없다');

console.log('\n[3] 남은 인자는 그대로 넘어간다 (--dry-run 은 과금 없이 돈다)');
/* 원본 docx 가 있는 기계에서만 끝까지 간다. CI 에는 문서가 없으므로, 문서를 못 찾아
   멈추는 것까지는 정상으로 본다 — 확인하려는 것은 인자가 새지 않는가이다. */
var r = cp.spawnSync('sh', [SH, '12', '--dry-run'], { cwd: SG2, encoding: 'utf8', timeout: 120000 });
var out = (r.stdout || '') + (r.stderr || '');
ok('인자를 잘못 넘겨 멈추지 않는다', !/unrecognized arguments/.test(out),
   (out.match(/unrecognized arguments.*/) || [''])[0]);
if (/원본 docx|찾지 못했습니다/.test(out)) {
  console.log('  --   원본 docx 가 없는 기계다 — 여기까지 본다');
} else {
  ok('dry-run 이 끝까지 간다', /dry-run/.test(out) && r.status === 0, 'exit=' + r.status);
}

console.log(fails.length ? '\n✗ ' + fails.length + ' FAILED: ' + fails.join(', ') : '\n✓ ALL PASS');
process.exit(fails.length ? 1 : 0);
