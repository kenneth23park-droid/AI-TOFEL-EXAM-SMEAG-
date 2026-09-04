/* TOEFL 1~6 밴드 — 같은 표의 세 벌이 어긋나지 않는지 검증한다.
 *
 * 표는 세 곳에 산다. 화면마다 자립형이어야 해서(smeag.com 은 파일 하나, sg2 는
 * 빌드 없음, 서버는 파이썬) 사본을 피할 수 없다. 대신 어긋나는 순간 여기서 죽는다 —
 * 세 곳이 다른 밴드를 보여 주면 학생은 자기 점수가 몇인지 알 수 없다.
 *
 *   app/scoring/toefl6_band_table.json   서버 정본
 *   sg2/assets/sg-band.js                응시·대시보드·리뷰
 *   smeag-com/scores.html                성적 조회
 *
 * 실행: node studyground/tests/test_band_table.js
 */
'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var BAND = require(path.join(ROOT, 'sg2', 'assets', 'sg-band.js'));

var fails = 0;
function ok(cond, label) {
  if (cond) { console.log('PASS ' + label); return; }
  fails += 1;
  console.error('FAIL ' + label);
}
function eq(got, want, label) {
  ok(got === want, label + ' (got ' + got + ', want ' + want + ')');
}

/* ── ETS 공식 표, 손으로 옮겨 적은 정본 ────────────────────────────────────
   sg-band.js 에서 읽어 오지 않는다 — 읽어 오면 사본이 틀려도 테스트가 통과한다. */
var ETS = {
  reading:   { 1:[0,1],  1.5:[2,2],  2:[3,3],   2.5:[4,5],   3:[6,11],
               3.5:[12,17], 4:[18,21], 4.5:[22,23], 5:[24,26], 5.5:[27,28], 6:[29,30] },
  listening: { 1:[0,1],  1.5:[2,3],  2:[4,5],   2.5:[6,8],   3:[9,12],
               3.5:[13,16], 4:[17,19], 4.5:[20,21], 5:[22,25], 5.5:[26,27], 6:[28,30] },
  writing:   { 1:[0,2],  1.5:[3,6],  2:[7,10],  2.5:[11,12], 3:[13,14],
               3.5:[15,16], 4:[17,20], 4.5:[21,23], 5:[24,26], 5.5:[27,28], 6:[29,30] },
  speaking:  { 1:[0,4],  1.5:[5,9],  2:[10,12], 2.5:[13,15], 3:[16,17],
               3.5:[18,19], 4:[20,22], 4.5:[23,24], 5:[25,26], 5.5:[27,27], 6:[28,30] }
};

/* ── 1. sg-band.js 가 0~30 전 구간에서 공식 표와 같은가 ── */
Object.keys(ETS).forEach(function (skill) {
  var wrong = [];
  Object.keys(ETS[skill]).forEach(function (band) {
    var lo = ETS[skill][band][0], hi = ETS[skill][band][1];
    for (var n = lo; n <= hi; n++) {
      if (BAND.bandForScaled(n, skill) !== Number(band)) {
        wrong.push(n + '→' + BAND.bandForScaled(n, skill) + '(want ' + band + ')');
      }
    }
  });
  ok(wrong.length === 0, 'sg-band.js ' + skill + ' 0~30 전 구간 ' + (wrong.join(' ') || ''));
});

/* ── 2. 서버 JSON 이 같은 하한을 쓰는가 ── */
var json = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'app', 'scoring', 'toefl6_band_table.json'), 'utf8')
);
Object.keys(ETS).forEach(function (skill) {
  var rows = json.sections[skill] || [];
  var mins = {};
  rows.forEach(function (r) { mins[r.band] = r.min; });
  var bad = Object.keys(ETS[skill]).filter(function (band) {
    return mins[Number(band).toFixed(1)] !== ETS[skill][band][0] &&
           mins[band] !== ETS[skill][band][0];
  });
  ok(bad.length === 0, 'toefl6_band_table.json ' + skill + ' 하한 ' + (bad.join(',') || ''));
});
ok(json._provenance.level === 'official', 'JSON 이 공식 표라고 표시되어 있다');

/* ── 3. scores.html 이 같은 표를 들고 있는가 ── */
var html = fs.readFileSync(path.join(ROOT, 'smeag-com', 'scores.html'), 'utf8');
var hit = /var\s+TOEFL6\s*=\s*\{([\s\S]*?)\n\s*\};/.exec(html);
ok(!!hit, 'scores.html 에 TOEFL6 표가 있다');
if (hit) {
  Object.keys(ETS).forEach(function (skill) {
    var row = new RegExp(skill + ':\\s*\\[([^\\]]*\\][^\\]]*)*\\]').exec(hit[1]);
    var found = row && row[0];
    var bad = [];
    Object.keys(ETS[skill]).forEach(function (band) {
      var pair = '[' + ETS[skill][band][0] + ',' + Number(band) + ']';
      if (!found || found.replace(/\s/g, '').indexOf(pair) < 0) bad.push(pair);
    });
    ok(bad.length === 0, 'scores.html ' + skill + ' 구간 ' + (bad.join(' ') || ''));
  });
}

/* ── 3-1. scores.html 의 스피킹 규칙이 sg-band.js 와 같은 값을 내는가 ──
   스피킹만은 표가 아니라 "과제 평균을 0.5 로 올린다" 는 규칙이다. 표를 대조하는
   것만으로는 이 규칙이 어긋난 것을 못 잡는다 — 그래서 조회 화면의 BAND 를 잘라
   내 실제로 돌려 본다. */
var BAND_START = 'var BAND = (function () {';
var bs = html.indexOf(BAND_START);
ok(bs >= 0, 'scores.html 에서 BAND 모듈을 찾았다');
if (bs >= 0) {
  var be = html.indexOf('\n})();', bs);
  var pageBand = eval('(function(){ ' + html.slice(bs, be + 6) + ' return BAND; })()');
  [[3, 3], [3.25, 3.5], [3.5, 3.5], [3.75, 4], [4.25, 4.5], [4.75, 5], [5, 5], [0, 1]]
    .forEach(function (pair) {
      eq(pageBand.taskBand([{ score: pair[0] }], 'speaking'), pair[1],
         'scores.html S 평균 ' + pair[0].toFixed(2) + ' → ' + pair[1].toFixed(1));
      eq(pageBand.taskBand([{ score: pair[0] }], 'speaking'),
         BAND.taskBand([{ score: pair[0] }], 'speaking'),
         'scores.html 과 sg-band.js 가 같은 스피킹 밴드를 낸다 (' + pair[0] + ')');
    });
  eq(pageBand.taskBand([{ score: 3.5 }], 'writing'), 4.5,
     'scores.html 라이팅은 여전히 0~30 표를 탄다');
}

/* ── 4. 종합은 합이 아니라 평균이고, .25 는 올라간다 (ETS 규칙) ── */
eq(BAND.overall({ r: 5, l: 5, w: 5, s: 5.5 }), 5, '종합 5.125 → 5.0 (ETS 예시)');
eq(BAND.overall({ r: 5, l: 5, w: 5.5, s: 5.5 }), 5.5, '종합 5.25 → 5.5 (ETS 예시)');
eq(BAND.overall({ r: 6, l: 6, w: 5, s: 5 }), 5.5, '종합은 합이 아니다');
eq(BAND.overall({}), null, '점수가 하나도 없으면 종합도 없다');

/* ── 5. 채점 대기 영역은 0 이 아니라 "없음" 이다 ── */
eq(BAND.sectionBand(0, 0, 'writing'), null, '문항 0 개 → null (밴드 1 이 아니다)');
eq(BAND.sectionBand(0, 50, 'reading'), 1, '다 틀리면 밴드 1');
eq(BAND.overall({ r: 5, l: 5, w: null, s: null }), 5,
   '채점 대기 영역은 평균에서 빠진다');
eq(BAND.taskBand([], 'writing'), null, '채점된 과제가 없으면 null');

/* ── 6. 원점수 → 0~30 (⚠️가설 단계) ── */
eq(BAND.scaledFromRaw(50, 50), 30, '만점 → 30');
eq(BAND.scaledFromRaw(0, 0), 0, '0 으로 나누지 않는다');
eq(BAND.scaledFromRaw(25, 50), 15, '절반 → 15');
eq(BAND.scaledFromRaw(99, 50), 30, '비율은 1.0 을 넘지 않는다');
eq(BAND.sectionBand(40, 50, 'reading'), 5, 'R 40/50 → 24/30 → 밴드 5.0');
eq(BAND.sectionBand(40, 47, 'listening'), 5.5, 'L 40/47 → 26/30 → 밴드 5.5');

/* ── 7. 산출형: 루브릭 0~5 → 밴드. 영역마다 경계가 다르다 ── */
eq(BAND.taskBand([{ score: 3.5 }], 'writing'), 4.5, 'W 3.5/5 → 21/30 → 4.5');

/* 스피킹만은 표를 타지 않는다 — 과제 평균(0~5)을 0.5 로 올린 값이 곧 밴드다.
   2026-09-04 운영 결정. 아래 표는 요구받은 그대로다(.25·.75 는 올라간다). */
[[3, 3], [3.25, 3.5], [3.5, 3.5], [3.75, 4], [4, 4],
 [4.25, 4.5], [4.5, 4.5], [4.75, 5], [5, 5]].forEach(function (pair) {
  /* 과제 넷의 평균이 pair[0] 이 되도록 한 과제에 그 값을 그대로 준다. */
  eq(BAND.taskBand([{ score: pair[0] }], 'speaking'), pair[1],
     'S 평균 ' + pair[0].toFixed(2) + ' → ' + pair[1].toFixed(1));
});
eq(BAND.taskBand([{ score: 4 }, { score: 4 }, { score: 5 }, { score: 4 }], 'speaking'), 4.5,
   'S 과제 넷 4·4·5·4 → 평균 4.25 → 4.5');
eq(BAND.taskBand([{ score: 0 }], 'speaking'), 1, 'S 0점도 밴드 1 (0 이라는 밴드는 없다)');
eq(BAND.taskBand([], 'speaking'), null, 'S 채점된 과제가 없으면 null');
eq(BAND.taskBand([{ score: 5 }, { score: 5 }], 'writing'), 6, 'W 만점 → 6.0');
eq(BAND.taskBand([{ score: 0 }], 'writing'), 1, 'W 0점 → 밴드 1 (0 이라는 밴드는 없다)');

/* ── 8. of() — 화면이 실제로 부르는 모양 ── */
var row = {
  scale: 'toefl6',
  by_section: {
    reading: { score: 40, total: 50 },
    listening: { score: 40, total: 47 },
    writing: { score: 0, total: 0 },      // 산출형: 자동채점 총점이 0 이다
    speaking: { score: 0, total: 0 }
  }
};
var view = BAND.of(row, []);
eq(view.sections.reading.band, 5, 'of(): 리딩 밴드');
eq(view.sections.reading.status, 'scored', 'of(): 리딩 상태');
eq(view.sections.writing.band, null, 'of(): 채점 전 라이팅은 밴드 없음');
eq(view.sections.writing.status, 'pending', 'of(): 채점 전 라이팅 상태');
eq(view.pending.join(','), 'writing,speaking', 'of(): 대기 목록');
eq(view.overall, 5.5, 'of(): 종합은 채점된 둘의 평균 (5.0 + 5.5) / 2');
eq(view.cefr, 'C1', 'of(): CEFR');

var withAi = BAND.of(row, [
  { skill: 'writing', question_id: 'set9-W2-email', ai_score: 4, teacher_score: null, confirmed_at: null },
  { skill: 'writing', question_id: 'set9-W3-disc', ai_score: 3, teacher_score: null, confirmed_at: null }
]);
eq(withAi.sections.writing.band, 4.5, 'of(): AI 채점 7/10 → 21/30 → W 4.5');
eq(withAi.sections.writing.status, 'scored', 'of(): 교사 확정 없이도 채점된 상태다');
eq(withAi.overall, 5, 'of(): AI 점수도 종합에 그대로 들어간다 (5.0 + 5.5 + 4.5) / 3 = 5.0');

var confirmed = BAND.of(row, [
  { skill: 'writing', question_id: 'set9-W2-email', ai_score: 4, teacher_score: 5, confirmed_at: '2026-08-11T00:00:00Z' },
  { skill: 'writing', question_id: 'set9-W3-disc', ai_score: 3, teacher_score: 5, confirmed_at: '2026-08-11T00:00:00Z' }
]);
eq(confirmed.sections.writing.band, 6, 'of(): 교사 점수가 AI 를 이긴다 (10/10 → 30/30 → 6.0)');
eq(confirmed.sections.writing.status, 'final', 'of(): 확정 상태');

console.log('\n' + (fails ? fails + ' FAILED' : 'ALL PASS'));
process.exit(fails ? 1 : 0);
