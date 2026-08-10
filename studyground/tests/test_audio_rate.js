/* 전체 말하기 속도(SG_AUDIO.setRate) 검산.
 * 실행: node studyground/tests/test_audio_rate.js
 *
 * 이 값은 클립 하나가 아니라 모든 클립에 걸린다. 그래서 지켜야 할 것이 셋이다.
 *
 *   [전체 적용] 오버라이드가 없는 <audio> 에도 걸려야 한다 — 교체한 클립만
 *              빨라지면 "전체 속도"가 아니라 클립별 설정이 된다.
 *   [교체 후에도] src 가 바뀌면 playbackRate 는 defaultPlaybackRate 로 돌아간다.
 *              그래서 둘 다 세운다. 하나만 세우면 파일을 갈아끼운 클립만 1× 로 새어나간다.
 *   [보존]      새로 고쳐도 남아야 한다(localStorage). 시험 중에 리로드가 일어나면
 *              학생마다 다른 속도로 듣게 되기 때문이다.
 *
 * 브라우저 없이 돌리려고 window/document 를 최소한으로 흉내 낸다 — audio-config.js
 * 가 실제로 만지는 것(querySelectorAll, localStorage, playbackRate)만 있으면 된다.
 */

'use strict';

var fs = require('fs');
var path = require('path');

var SG2 = path.join(__dirname, '..', 'sg2');

var fails = 0, checks = 0;
function ok(cond, label, detail) {
  checks++;
  if (cond) { console.log('  ✓ ' + label); return; }
  fails++;
  console.log('  ✗ ' + label + (detail ? '\n      ' + detail : ''));
}

/* ── 최소 브라우저 흉내 ──────────────────────────────────────────────────── */

function makeAudio() {
  return { tagName: 'AUDIO', playbackRate: 1, defaultPlaybackRate: 1,
           _attrs: {}, getAttribute: function (k) { return this._attrs[k] || null; },
           setAttribute: function (k, v) { this._attrs[k] = v; },
           load: function () { this.playbackRate = this.defaultPlaybackRate; } };
}

function makeEnv(store) {
  var medias = [];
  var doc = {
    readyState: 'complete',
    documentElement: {},
    addEventListener: function () {},
    querySelectorAll: function (sel) {
      // audio-config.js 가 쓰는 두 갈래만 구분한다.
      return /source/.test(sel) ? medias.filter(function (m) { return m.getAttribute('src'); }) : medias;
    }
  };
  var win = {
    document: doc,
    localStorage: {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem: function (k, v) { store[k] = String(v); }
    },
    addEventListener: function () {},
    setTimeout: setTimeout
  };
  win.window = win;
  return { win: win, doc: doc, medias: medias };
}

/** audio-config.js 를 깨끗한 전역에서 한 번 실행하고 SG_AUDIO 를 돌려준다. */
function loadStore(env) {
  var src = fs.readFileSync(path.join(SG2, 'assets', 'audio-config.js'), 'utf8');
  var fn = new Function('window', 'document', 'localStorage', 'indexedDB', 'URL', 'MutationObserver', 'setTimeout', src);
  fn(env.win, env.doc, env.win.localStorage, undefined, { createObjectURL: function () { return 'blob:x'; },
    revokeObjectURL: function () {} }, undefined, setTimeout);
  return env.win.SG_AUDIO;
}

/* ── 1. 전체 적용 ────────────────────────────────────────────────────────── */

var store = {};
var env = makeEnv(store);
var plain = makeAudio();                       // 오버라이드 없는 평범한 클립
var swapped = makeAudio();                     // 파일을 갈아끼운 클립
swapped.setAttribute('src', 'media/audio/set9/l1-q01.mp3');
env.medias.push(plain, swapped);

var SG = loadStore(env);
ok(SG && typeof SG.setRate === 'function', 'SG_AUDIO.setRate 가 있다');
ok(SG.getRate() === 1, '기본값은 1× 다', '실제: ' + SG.getRate());

SG.setRate(0.8);
ok(plain.playbackRate === 0.8, '오버라이드 없는 클립에도 걸린다', '실제: ' + plain.playbackRate);
ok(swapped.playbackRate === 0.8, '교체된 클립에도 걸린다', '실제: ' + swapped.playbackRate);
ok(plain.defaultPlaybackRate === 0.8, 'defaultPlaybackRate 도 함께 선다',
   '실제: ' + plain.defaultPlaybackRate);

/* ── 2. src 를 갈아끼워도 속도가 남는다 ──────────────────────────────────── */

swapped.load();                                // 브라우저는 이때 playbackRate 를 되돌린다
ok(swapped.playbackRate === 0.8, 'load() 뒤에도 속도가 남는다', '실제: ' + swapped.playbackRate);

/* ── 3. 범위를 벗어난 값은 잘린다 ────────────────────────────────────────── */

ok(SG.setRate(9) === SG.rateRange().max, '너무 빠른 값은 상한으로 잘린다', '실제: ' + SG.getRate());
ok(SG.setRate(0.01) === SG.rateRange().min, '너무 느린 값은 하한으로 잘린다', '실제: ' + SG.getRate());
ok(SG.setRate('nonsense') === 1, '숫자가 아니면 1× 로 돌아간다', '실제: ' + SG.getRate());

/* ── 4. 새로 고쳐도 남는다 ───────────────────────────────────────────────── */

SG.setRate(1.25);
var env2 = makeEnv(store);                     // 같은 localStorage, 새 페이지
var later = makeAudio();
env2.medias.push(later);
var SG2API = loadStore(env2);
ok(SG2API.getRate() === 1.25, '리로드 뒤에도 값이 남는다', '실제: ' + SG2API.getRate());
SG2API.tune(later);
ok(later.playbackRate === 1.25, 'DOM 밖의 new Audio() 는 tune() 으로 맞춘다', '실제: ' + later.playbackRate);

/* ── 5. 클립 하나만 따로 ─────────────────────────────────────────────────── */

var envC = makeEnv({});
var a1 = makeAudio(); a1.setAttribute('src', 'media/audio/set9/l1-q01.mp3');
var a2 = makeAudio(); a2.setAttribute('src', 'media/audio/set9/l1-q02.mp3');
envC.medias.push(a1, a2);
var C = loadStore(envC);

C.setRate(0.9);
C.setClipRate('media/audio/set9/l1-q02.mp3', 1.25);
ok(a1.playbackRate === 0.9, '지정하지 않은 클립은 전체 값을 따른다', '실제: ' + a1.playbackRate);
ok(a2.playbackRate === 1.25, '따로 정한 클립은 그 값이 이긴다', '실제: ' + a2.playbackRate);
ok(C.clipRate('media/audio/set9/l1-q01.mp3') === null, '전체를 따르는 클립은 clipRate 가 null');
ok(C.clipRateCount() === 1, '따로 정한 클립 수를 센다', '실제: ' + C.clipRateCount());

C.setRate(1.1);
ok(a1.playbackRate === 1.1, '전체 값을 바꾸면 따라오는 클립은 따라온다', '실제: ' + a1.playbackRate);
ok(a2.playbackRate === 1.25, '전체 값을 바꿔도 따로 정한 클립은 그대로다', '실제: ' + a2.playbackRate);

C.setClipRate('media/audio/set9/l1-q02.mp3', null);
ok(a2.playbackRate === 1.1, 'null 로 지우면 다시 전체 값을 따른다', '실제: ' + a2.playbackRate);
ok(C.clipRateCount() === 0, '지우면 예외 수가 0 이 된다', '실제: ' + C.clipRateCount());

C.setClipRate('media/audio/set9/l1-q01.mp3', 1.5);
C.setClipRate('media/audio/set9/l1-q02.mp3', 0.75);
ok(C.clearClipRates() === 2, 'clearClipRates() 가 지운 개수를 돌려준다');
ok(a1.playbackRate === 1.1 && a2.playbackRate === 1.1, '모두 해제하면 전부 전체 값',
   a1.playbackRate + ' / ' + a2.playbackRate);

/* 파일을 교체한 클립도 원래 경로로 알아본다 — src 는 blob 이라 알아볼 수 없다. */
C.setClipRate('media/audio/set9/l1-q02.mp3', 0.8);
a2.setAttribute('data-sg-orig', 'media/audio/set9/l1-q02.mp3');
a2.setAttribute('src', 'blob:whatever');
C.setRate(1);                                  // 다시 훑게 만든다
ok(a2.playbackRate === 0.8, '교체된 클립도 원래 경로로 제 속도를 찾는다', '실제: ' + a2.playbackRate);

/* ── 6. 화면이 값을 되읽을 수 있다 ───────────────────────────────────────── */

var range = SG2API.rateRange();
ok(range.min > 0 && range.max > range.min, 'rateRange() 가 슬라이더 범위를 준다',
   JSON.stringify(range));

console.log('\n' + (fails ? '✗ ' + fails + ' / ' + checks + ' 실패' : '✓ ' + checks + ' 항목 통과'));
process.exit(fails ? 1 : 0);
