/* 듣기의 소리와 얼굴 — 세트를 어느 길로 지어도 붙는가.
 * 실행: node studyground/tests/test_listening_pictures.js
 *
 * 소리도 사진도 없으면 시험은 그대로 돌아간다. 그래서 시험장에서야 보인다 — SET 12 가
 * 그랬다(듣기가 'Audio unavailable' 에 그림도 없었다). 빠질 수 있는 자리를 전부 본다.
 *   1) 커밋된 팩   — 음원이 있는 듣기 자리에는 사진도 있어야 한다.
 *   2) 화면 경로   — admin-set-import.html 이 이미지 파일을 읽어 넘기는가. 넘기지 않던
 *                    시절에는 명령줄로 지은 세트에만 사진이 있었다.
 *   3) 규칙        — 사진 배정을 손으로 적지 않고 tools/build_listening_images.mjs 가 짓는가.
 *                    (generatedBy 가 적힌 파일은 그 도구가 그대로 다시 만들 수 있어야 한다.)
 */

'use strict';

var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var SG2 = path.join(__dirname, '..', 'sg2');
var fails = [];
function ok(name, cond, extra) {
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (extra ? ': ' + extra : ''));
  if (!cond) fails.push(name);
}

/* ── 1. 커밋된 팩 ─────────────────────────────────────────────────────────── */
console.log('[1] 커밋된 팩 — 음원이 있는 듣기 자리에는 사진이 있다');
global.window = {};
['set1.js', 'set9.js', 'set10.js', 'set11.js'].forEach(function (f) {
  var file = path.join(SG2, 'assets', f);
  if (fs.existsSync(file)) new Function('window', fs.readFileSync(file, 'utf8'))(global.window);
});
var packs = Object.keys(global.window)
  .filter(function (k) { return /^SMEAG_SET/.test(k) && global.window[k] && global.window[k].sections; })
  .map(function (k) { return global.window[k]; });
ok('팩을 2개 이상 읽었다', packs.length >= 2, packs.length + '개');

packs.forEach(function (pack) {
  var slots = 0, bare = [];
  (pack.sections || []).filter(function (s) { return s.id === 'listening'; })
    .forEach(function (sec) {
      (sec.modules || []).forEach(function (mod) {
        (mod.blocks || []).forEach(function (blk) {
          var qs = blk.questions || [];
          if (blk.audio || blk.introAudio) {
            slots++;
            if (!blk.image && !qs.some(function (q) { return q.image; })) bare.push(mod.id + ' ' + (blk.heading || ''));
          }
          qs.forEach(function (q) {
            if (!q.audio) return;
            slots++;
            if (!q.image && !blk.image) bare.push(q.id);
          });
        });
      });
    });
  ok(pack.code + ' — 사진 없는 듣기 자리 0개 (' + slots + '자리)', bare.length === 0, bare.slice(0, 5).join(' · '));
});

/* ── 2. 화면 경로 ─────────────────────────────────────────────────────────── */
console.log('\n[2] 화면(admin-set-import.html)도 사진을 읽어 넘긴다');
var screen = fs.readFileSync(path.join(SG2, 'admin-set-import.html'), 'utf8');
ok('config/<set>-listening-images.json 을 읽는다', /listening-images\.json/.test(screen));
ok('build 에 listeningImages 를 넘긴다', /listeningImages:\s*listeningImages/.test(screen));
ok('없으면 검산 줄에 적는다', /No speaker pictures for this set/.test(screen));

console.log('\n[2-1] 음원 파일이 서버에 있는지도 화면이 미리 두드려 본다');
ok('팩이 가리키는 경로를 HEAD 로 확인한다', /method:\s*'HEAD'/.test(screen),
   '없으면 소리 없는 세트를 저장하고 시험장에서 안다');
ok('404 만 없는 것으로 센다', /status === 404/.test(screen));
ok('없으면 검산 줄에 적는다', /are not on the server yet/.test(screen));
ok('만드는 방법까지 적는다', /make_set_audio\.sh/.test(screen));

/* ── 3. 규칙 ──────────────────────────────────────────────────────────────── */
console.log('\n[3] 사진 배정은 도구가 짓는다 — 손으로 적지 않는다');
var tool = path.join(SG2, 'tools', 'build_listening_images.mjs');
ok('tools/build_listening_images.mjs 가 있다', fs.existsSync(tool));

var configs = fs.readdirSync(path.join(SG2, 'config'))
  .filter(function (f) { return /^set\d+-listening-images\.json$/.test(f); });
ok('사진 배정 파일이 하나 이상 있다', configs.length > 0, configs.join(' · '));

var checked = 0;
configs.forEach(function (f) {
  var json = JSON.parse(fs.readFileSync(path.join(SG2, 'config', f), 'utf8'));
  /* 도구가 생기기 전에 손으로 적은 것(SET 10)은 재현 대상이 아니다 — 그 사실이
     파일에 적혀 있으므로(generatedBy 없음) 조용히 봐주는 것이 아니라 구분해서 넘긴다. */
  if (!json.generatedBy) { console.log('  --   ' + f + ' 은 손으로 적은 것 (generatedBy 없음)'); return; }
  checked++;
  var n = /^set(\d+)-/.exec(f)[1];
  var r = cp.spawnSync('node', [tool, '--set', n, '--check'], { cwd: SG2, encoding: 'utf8' });
  ok(f + ' 을 도구가 그대로 다시 만든다', r.status === 0,
     (r.stdout || '').trim().split('\n').pop());

  var missing = Object.keys(json.questions || {}).concat(Object.keys(json.blocks || {}))
    .map(function (k) { return (json.questions || {})[k] || json.blocks[k]; })
    .filter(function (p, i, a) { return a.indexOf(p) === i; })
    .filter(function (p) { return !fs.existsSync(path.join(SG2, p)); });
  ok(f + ' 이 가리키는 사진 파일이 모두 있다', missing.length === 0, missing.join(' · '));
});
ok('도구가 지은 파일을 하나 이상 대조했다', checked > 0, checked + '개');

console.log(fails.length ? '\n✗ ' + fails.length + ' FAILED: ' + fails.join(', ') : '\n✓ ALL PASS');
process.exit(fails.length ? 1 : 0);
