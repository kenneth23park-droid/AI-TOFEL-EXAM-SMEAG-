/* SMEAG StudyGround — 세트가 반쪽으로 나가지 않게 막는다.
 *
 * 왜 이 파일이 있는가
 *   SET 12 는 음성(media/audio/set12)·배역표(tts-voices-set12exam-11labs.json)·
 *   사진 배정표(config/set12-listening-images.json)까지 지어져 커밋됐는데, 정작
 *   문항 팩(assets/set12.js)이 없었다. 팩은 admin-set-import.html 로 가져온 그
 *   브라우저의 localStorage 안에만 있었고, 그래서 그 브라우저 밖에서는 존재하지
 *   않는 세트였다 — 로그인 계정 목록에도, 시험 라이브러리에도, 리뷰에도, 관리자
 *   화면에도 뜨지 않았다. "안 보인다"는 화면의 결함처럼 보이지만 실제로는 세트가
 *   파일로 지어진 적이 없다는 뜻이었고, 그 사실은 아무 검사에도 걸리지 않았다.
 *
 *   기존 검사들은 전부 "팩이 있다"를 전제로 한다(test_set_import_set<N>.mjs 도
 *   그렇다). 팩이 없는 세트는 검사할 대상 자체가 없어서 조용히 지나간다. 그래서
 *   판정을 뒤집는다 — **세트의 흔적이 하나라도 있으면 전부 있어야 한다.**
 *
 * 판정
 *   1) 세트 번호를 흔적의 합집합에서 모은다(팩·빌더·배역표·사진표·음성 폴더·
 *      사진 폴더·오프라인 목록). 하나라도 있으면 그 세트는 "짓는 중"이다.
 *   2) 그 세트가 갖춰야 할 파일이 전부 있는가.
 *   3) 세트 하나가 화면에 보이려면 이름이 열세 자리에 있어야 한다. 전부 있는가.
 *   4) 팩이 가리키는 media/ 파일이 실제로 디스크에 있는가 (없으면 시험 화면은
 *      'Audio unavailable' 만 보여 준다 — SET 12 가 그럴 뻔했다).
 *   5) 듣기 문항에 화자 사진이 붙어 있는가 (없으면 듣기만 그림 없이 뜬다).
 *
 * 2026-09-15 부터 막는 것은 1~3(팩·빌더·회귀테스트·등록)뿐이다. 음성·사진·배역표·
 * 오프라인 목록(2 의 일부, 4, 5)은 없으면 REPORT 로 적고 통과시킨다 — 세트는 부족해도
 * 항상 나가고, 빠진 것은 리포트로 보여 준다는 지시다.
 *
 * SET 1·9 는 이 규칙이 생기기 전에 만들어져 모양이 다르다(set9-audio.js,
 * config/_set9_fragments 등). 아래 LEGACY 에 사유와 함께 적고 면제한다. 면제는
 * 여기 적힌 둘뿐이고, 새로 짓는 세트는 예외 없이 전부 지나야 한다.
 *
 * 실행: node studyground/tests/test_set_complete.js
 */
'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var SG2 = path.join(ROOT, 'sg2');

/* 이 규칙이 생기기 전에 지어진 세트 — 모양이 달라 면제한다. 새 세트는 추가하지 않는다. */
var LEGACY = {
  1: '연습지. 듣기·오프라인 목록이 없는 리딩 위주 세트다.',
  9: '첫 실전 세트. 음성이 assets/set9-audio.js 로 따로 있고 지문 조각이 config/_set9_fragments 에 있다.'
};

var fails = [];
var notes = [];
/* 막는 것(fails)과 리포트할 것(reports)을 가른다. 세트는 부족해도 항상 짓는다(2026-09-15) —
   팩·빌더·회귀테스트·등록은 짓는 쪽이 언제든 채울 수 있으니 막고, 음성·사진·배역표처럼
   밖에서 와야 하는 것은 없으면 세트를 멈추지 않고 REPORT 로 적는다. */
var reports = [];
function check(ok, msg) { if (!ok) fails.push(msg); }
function report(ok, msg) { if (!ok) reports.push(msg); }
function read(rel) {
  try { return fs.readFileSync(path.join(SG2, rel), 'utf8'); } catch (e) { return null; }
}
function exists(rel) { return fs.existsSync(path.join(SG2, rel)); }

/* ── 1. 세트 번호를 흔적의 합집합에서 모은다 ───────────────────────────── */
var found = {};             // number -> [흔적 설명]
function mark(n, what) {
  n = Number(n);
  if (!n) return;
  (found[n] = found[n] || []).push(what);
}

fs.readdirSync(path.join(SG2, 'assets')).forEach(function (f) {
  var m = /^set(\d+)\.js$/.exec(f);
  if (m) mark(m[1], 'assets/' + f);
});
fs.readdirSync(path.join(SG2, 'tools')).forEach(function (f) {
  var m = /^build_set(\d+)\.mjs$/.exec(f);
  if (m) mark(m[1], 'tools/' + f);
});
fs.readdirSync(SG2).forEach(function (f) {
  var m = /^tts-voices-set(\d+)exam-11labs\.json$/.exec(f);
  if (m) mark(m[1], f);
});
fs.readdirSync(path.join(SG2, 'config')).forEach(function (f) {
  var m = /^set(\d+)-listening-images\.json$/.exec(f) || /^offline\.set(\d+)\.json$/.exec(f);
  if (m) mark(m[1], 'config/' + f);
});
['media/audio', 'media/pictures'].forEach(function (dir) {
  var p = path.join(SG2, dir);
  if (!fs.existsSync(p)) return;
  fs.readdirSync(p).forEach(function (f) {
    var m = /^set(\d+)$/.exec(f);
    if (m && fs.statSync(path.join(p, f)).isDirectory()) mark(m[1], dir + '/' + f + '/');
  });
});

var sets = Object.keys(found).map(Number).sort(function (a, b) { return a - b; });
check(sets.length > 0, '세트를 하나도 찾지 못했습니다 — 이 검사가 아무것도 보고 있지 않습니다.');

/* ── 2·3. 세트마다 파일과 등록 자리를 본다 ─────────────────────────────── */

/* 세트 하나가 화면에 보이려면 이름이 있어야 하는 자리들. 하나만 빠져도 그 화면에서만
   조용히 사라진다 — 어느 화면인지 함께 적어 두는 이유다. */
function registrationPoints(n) {
  var S = 'set' + n, U = 'SET' + n, G = 'SMEAG_SET' + n;
  return [
    { file: 'login.html', want: 'value="' + S + '"', why: '로그인 계정 목록' },
    { file: 'dashboard.html', want: 'assets/' + S + '.js', why: '학생 대시보드가 팩을 싣는다' },
    { file: 'exam-runtime.html', want: 'assets/' + S + '.js', why: '시험 화면이 팩을 싣는다' },
    { file: 'review.html', want: 'assets/' + S + '.js', why: '리뷰가 팩을 싣는다' },
    { file: 'admin-set-view.html', want: 'assets/' + S + '.js', why: '관리자 세트 보기가 팩을 싣는다' },
    { file: 'tests.html', want: 'data-set="' + U + '"', why: '시험 라이브러리 카드' },
    { file: 'assets/question-config.js', want: G + ": '" + S + "'", why: '문항 편집기 후킹' },
    { file: 'assets/exam-shell.js', want: S + ": '" + G + "'", why: '?set= 로 팩을 고른다' },
    { file: 'assets/exam-shell.js', want: "return '" + S + "'", why: '?testId= 에서 세트를 추론한다' },
    { file: 'assets/offline-prep.js', want: "return '" + S + "'", why: '오프라인 준비가 같은 세트를 본다' },
    { file: 'assets/admin-session.js', want: "id: '" + S + "', pw:", why: '관리자 계정' },
    { file: 'assets/admin-session.js', want: "id: '" + S + "', label:", why: '관리자 SET 선택기' },
    { file: 'config/offline.sets.json', want: '"' + S + '"', why: '오프라인 사전 다운로드 목록' },
    { file: 'sw.js', want: 'assets/' + S + '.js', why: '서비스워커 프리캐시(팩)' },
    { file: 'sw.js', want: 'config/offline.' + S + '.json', why: '서비스워커 프리캐시(오프라인 목록)' },
    { file: 'tools/build_offline_manifest.py', want: "'" + S + "': {", why: '오프라인 목록 생성기' }
  ];
}

sets.forEach(function (n) {
  var S = 'set' + n;
  var trail = found[n].join(', ');

  if (LEGACY[n]) {
    notes.push('SET ' + n + ' 면제 — ' + LEGACY[n]);
    /* 면제해도 팩만은 있어야 한다. 흔적만 있고 팩이 없는 것이 SET 12 의 결함이었다. */
    check(exists('assets/' + S + '.js'),
      'SET ' + n + ': 흔적이 있는데 문항 팩 assets/' + S + '.js 가 없습니다 (' + trail + ')');
    return;
  }

  /* 갖춰야 할 파일 — 팩과 빌더가 없으면 세트가 지어진 것이 아니다. */
  var required = [
    ['assets/' + S + '.js', '문항 팩. 없으면 이 세트는 가져온 브라우저 밖에 존재하지 않는다'],
    ['tools/build_set' + n + '.mjs', '빌더. 없으면 팩을 다시 지을 길이 없다']
  ];
  required.forEach(function (pair) {
    check(exists(pair[0]), 'SET ' + n + ': ' + pair[0] + ' 가 없습니다 — ' + pair[1] + ' (있는 것: ' + trail + ')');
  });
  /* 음성·사진·배역표 — 없어도 세트는 나간다. 대신 무엇이 빠졌는지 리포트한다. */
  [
    ['tts-voices-set' + n + 'exam-11labs.json', '목소리 배역표'],
    ['config/' + S + '-listening-images.json', '듣기 화자 사진 배정표'],
    ['config/offline.' + S + '.json', '오프라인 사전 다운로드 목록'],
    ['media/audio/' + S, '듣기 음성 폴더']
  ].forEach(function (pair) {
    report(exists(pair[0]), 'SET ' + n + ': ' + pair[0] + ' 가 없습니다 — ' + pair[1]);
  });
  check(fs.existsSync(path.join(ROOT, 'tests/test_set_import_set' + n + '.mjs')),
    'SET ' + n + ': tests/test_set_import_set' + n + '.mjs 가 없습니다 — 이 세트의 원본 회귀를 잡는 유일한 그물입니다');

  /* 등록 자리 */
  registrationPoints(n).forEach(function (p) {
    var src = read(p.file);
    if (src === null) { check(false, 'SET ' + n + ': ' + p.file + ' 을 읽지 못했습니다'); return; }
    check(src.indexOf(p.want) !== -1,
      'SET ' + n + ' 등록 누락 — ' + p.file + ' 에 `' + p.want + '` 가 없습니다 (' + p.why + ')');
  });
});

/* ── 4·5. 팩이 가리키는 미디어가 실제로 있는가 ─────────────────────────── */
sets.forEach(function (n) {
  var S = 'set' + n;
  var packSrc = read('assets/' + S + '.js');
  if (!packSrc) return;

  var win = {};
  try {
    /* eslint-disable no-new-func */
    new Function('window', packSrc)(win);
  } catch (e) {
    check(false, 'SET ' + n + ': assets/' + S + '.js 를 읽을 수 없습니다 — ' + e.message);
    return;
  }
  var pack = win['SMEAG_SET' + n];
  check(!!pack, 'SET ' + n + ': assets/' + S + '.js 가 window.SMEAG_SET' + n + ' 를 만들지 않습니다');
  if (!pack) return;

  /* 팩 안의 모든 media/ 참조를 모은다. 문자열 어디에 박혀 있든 찾는다. */
  var refs = {};
  (function walk(v) {
    if (typeof v === 'string') { if (v.indexOf('media/') === 0) refs[v] = 1; return; }
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v && typeof v === 'object') { Object.keys(v).forEach(function (k) { walk(v[k]); }); }
  })(pack);

  var missing = Object.keys(refs).filter(function (u) { return !exists(u); });
  report(missing.length === 0,
    'SET ' + n + ': 팩이 가리키는 파일 ' + missing.length + '개가 디스크에 없습니다 — 학생 화면은 '
      + "'Audio unavailable' 만 봅니다: " + missing.slice(0, 5).join(', '));

  if (LEGACY[n]) return;

  /* 듣기 문항마다 화자 사진 — 소리와 달리 없어도 시험은 그대로 돌아가서 시험장에서야 보인다. */
  var sec = (pack.sections || []).filter(function (s) { return s.id === 'listening'; })[0];
  if (!sec) { report(false, 'SET ' + n + ': 듣기 영역이 없습니다'); return; }
  var noPic = [];
  sec.modules.forEach(function (m) {
    m.blocks.forEach(function (b) {
      (b.questions || []).forEach(function (q) { if (!q.image && !b.image) noPic.push(q.id); });
    });
  });
  report(noPic.length === 0,
    'SET ' + n + ': 듣기 ' + noPic.length + '문항에 화자 사진이 없습니다 — 듣기 화면만 그림 없이 뜹니다: '
      + noPic.slice(0, 5).join(', '));
});

/* ── 보고 ──────────────────────────────────────────────────────────────── */
console.log('세트 검사: ' + sets.map(function (n) { return 'SET ' + n; }).join(' · '));
notes.forEach(function (m) { console.log('  · ' + m); });
if (reports.length) {
  console.log('');
  reports.forEach(function (m) { console.log('REPORT ' + m); });
  console.log('(REPORT 는 막지 않습니다 — 세트는 나가고, 빠진 것은 세트 리포트에 남습니다.)');
}
if (fails.length) {
  console.error('');
  fails.forEach(function (m) { console.error('FAIL ' + m); });
  console.error('');
  console.error('세트 하나가 보이려면 팩과 등록이 함께 있어야 합니다.');
  console.error('절차는 studyground/docs/set-build.md 에 있습니다.');
  process.exit(1);
}
console.log('');
console.log('✓ 모든 세트가 팩·미디어·등록을 갖췄습니다 (' + sets.length + '개 세트).');
