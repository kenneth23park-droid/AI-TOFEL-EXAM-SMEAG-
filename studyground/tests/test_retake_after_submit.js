/* 제출한 뒤 다시 응시한다 — 전체 한 벌 또는 한 영역만. node 전용.
 * 실행: node "studyground/tests/test_retake_after_submit.js"
 *
 * 발주 요구(2026-08-12): "after exam. can retake full exam / can choose each
 * reading, listening, writing, speaking section". 시험이 끝난 화면에서 곧바로
 * 다시 들어갈 수 있어야 하고, 그 문은 tests.html 과 같은 URL 계약을 써야 한다.
 *
 * 다시 응시는 학생이 바로 연다 — 관리자 승인 칸은 2026-08-12(sg-v56)에 없앴다.
 * 대신 그 이동이 재응시로 기록에 남아, 같은 세트 성적이 둘일 때 까닭을 알 수 있다.
 *
 * 여기서 붙잡는 것은 넷이다.
 *  [1] 링크가 만들어지는 규칙 — exam-shell.js 의 retakeUrl/retakeHtml 을 잘라 내
 *      화면 밖에서 돌린다(test_report_link.js 와 같은 방식).
 *  [2] 버튼 → 이동 — 누른 영역으로 가고, 그 이동이 응시 기록에 남는다.
 *  [3] 제출 화면 배선 — 채점·업로드가 끝난 뒤에야 문이 열린다. 열어 두면 학생이
 *      진행 중에 떠나 채점 요청이 끊긴다(test_submit_scores_now.js 의 waitScore 와 같은 취지).
 *  [4] 다시 들어갔을 때 새 세션이 열린다 — 제출된 세션은 이어보지 못한다는 계약에 기댄다.
 */
'use strict';

var fs = require('fs');
var path = require('path');

var SG2 = path.join(__dirname, '..', 'sg2');
var shell = fs.readFileSync(path.join(SG2, 'assets/exam-shell.js'), 'utf8');
var css = fs.readFileSync(path.join(SG2, 'assets/exam.css'), 'utf8');
var store = fs.readFileSync(path.join(SG2, 'assets/exam-store.js'), 'utf8');

var fails = [];
function ok(name, cond, detail) {
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (detail ? ': ' + detail : ''));
  if (!cond) fails.push(name);
}

/* ── [1] 링크 규칙 ─────────────────────────────────────────── */
console.log('[1] 다시 응시 링크');

var START = '  var RETAKE_SECTIONS = [';
var END = '  /* ── 제출 직후';
var a = shell.indexOf(START), b = shell.indexOf(END);
if (a < 0 || b < 0 || b < a) {
  console.error('RETAKE 블록을 찾지 못했습니다 — exam-shell.js 구조가 바뀌었는지 확인하세요.');
  process.exit(1);
}

/* 셸이 기대는 이웃만 세운다: 쿼리스트링 한 줄, 이 페이지가 실은 팩의 id,
   그리고 다시 응시 칸이 만지는 것들(document · window · STORE). */
function build(search, setId, env) {
  var stub =
    'function query(name) {' +
    '  var m = new RegExp("[?&]" + name + "=([^&]*)").exec(SEARCH);' +
    '  return m ? decodeURIComponent(m[1]) : "";' +
    '}\n' +
    'var SET_ID = SETID;\n' +
    'var document = ENV.document, window = ENV.window, STORE = ENV.STORE,' +
    '    setTimeout = ENV.setTimeout;\n' +
    // 셸은 전체화면 모듈을 전역 이름으로 부른다(window.SG_FS 로 있는지 보고 SG_FS 로 쓴다).
    'var SG_FS = (ENV.window || {}).SG_FS;\n';
  return new Function('SEARCH', 'SETID', 'ENV',
    stub + shell.slice(a, b) +
    '\nreturn { retakeUrl: retakeUrl, retakeHtml: retakeHtml, sections: RETAKE_SECTIONS,' +
    '          bindRetake: bindRetake };'
  )(search, setId, env || {});
}

var R = build('?mode=exam&profile=toefl&set=set9', 'set9');

ok('영역은 시험을 치르는 순서다',
   R.sections.map(function (s) { return s.id; }).join(',') === 'reading,listening,speaking,writing',
   R.sections.map(function (s) { return s.id; }).join(','));

var full = R.retakeUrl(null);
ok('전체 한 벌은 mode=exam', /(^|[?&])mode=exam($|&)/.test(full), full);
ok('전체 링크에 section 이 없다', full.indexOf('section=') < 0, full);

var reading = R.retakeUrl('reading');
ok('한 영역은 mode=section', /(^|[?&])mode=section($|&)/.test(reading), reading);
ok('영역이 붙는다', /(^|[?&])section=reading($|&)/.test(reading), reading);

/* 라우트 페이지(en/test-nt/{section}/)에는 <base> 가 있다 — 경로를 앞에 붙이면
   거기서 두 번 풀려 시험 밖으로 나간다. 위의 review.html 링크와 같은 이유다. */
R.sections.concat([{ id: null }]).forEach(function (s) {
  var u = R.retakeUrl(s.id);
  ok('상대경로 그대로다 (' + (s.id || 'full') + ')', u.indexOf('exam-runtime.html?') === 0, u);
});

ok('세트는 지금 실은 팩을 넘긴다', /(^|[?&])set=set9($|&)/.test(full), full);
ok('프로필을 잃지 않는다', /(^|[?&])profile=toefl($|&)/.test(full), full);

/* set9.html 은 쿼리 없이 들어온다 — 그래도 같은 세트로 다시 쳐야 한다. */
var bare = build('', 'set9');
ok('쿼리가 없어도 세트는 남는다', /(^|[?&])set=set9($|&)/.test(bare.retakeUrl(null)), bare.retakeUrl(null));
ok('프로필이 없으면 toefl', /(^|[?&])profile=toefl($|&)/.test(bare.retakeUrl(null)), bare.retakeUrl(null));

var withId = build('?testId=NT-016&profile=toefl', 'set1');
ok('시험 코드를 잃지 않는다', /(^|[?&])testId=NT-016($|&)/.test(withId.retakeUrl('writing')),
   withId.retakeUrl('writing'));

/* 세션은 넘기지 않는다 — 넘기면 boot() 가 그 세션을 그대로 열어 방금 낸 답안 위에 덧쓴다. */
R.sections.concat([{ id: null }]).forEach(function (s) {
  ok('세션을 물려주지 않는다 (' + (s.id || 'full') + ')', R.retakeUrl(s.id).indexOf('sessionId=') < 0);
});

var html = R.retakeHtml();
ok('네 영역이 모두 서 있다',
   R.sections.every(function (s) { return html.indexOf('>' + s.label + '</button>') >= 0; }));
ok('전체 한 벌이 서 있다', html.indexOf('Full test') >= 0);
ok('처음에는 접혀 있다', /id="done-retake" hidden/.test(html));
/* 버튼은 <a> 가 아니다 — 누른 자리에서 재응시를 기록에 남기고 옮겨 가야 하므로,
   주소는 data-retake 에만 있고 손에 잡히는 링크로는 내걸지 않는다. */
ok('누를 수 있는 주소를 내걸지 않는다', html.indexOf('href=') < 0);

/* ── [2] 버튼 → 이동 ──────────────────────────────────────────
 * 다시 응시는 학생이 바로 연다 — 관리자 승인 칸은 없앴다(2026-08-12, sg-v56).
 * 남은 계약은 둘이다: 누른 영역으로 간다, 그리고 그 이동이 재응시로 기록에 남는다.
 * 기록이 빠지면 같은 세트를 두 번 친 성적이 나중에 왜 둘인지 알 수 없다. */
console.log('\n[2] 버튼 → 이동');

/* retakeHtml() 이 낸 마크업에서 필요한 만큼만 DOM 을 세운다 — id 하나가 어긋나면
   여기서 null 참조로 터진다(= 배선이 끊긴 것을 잡는다). */
function fakeDom(markup) {
  var byId = {}, retakes = [];
  var tag = /<([a-z]+)([^>]*)>/gi, m;
  while ((m = tag.exec(markup))) {
    var attrs = {}, at = /([a-z-]+)(?:="([^"]*)")?/gi, k;
    while ((k = at.exec(m[2]))) attrs[k[1]] = k[2] === undefined ? '' : k[2];
    var el = mk(attrs);
    if (attrs.id) byId[attrs.id] = el;
    if (attrs.hasOwnProperty('data-retake')) retakes.push(el);
  }
  function mk(attrs) {
    var el = {
      hidden: attrs.hasOwnProperty('hidden'),
      value: '', textContent: '', onclick: null, focused: false, _ev: {},
      getAttribute: function (n) { return attrs.hasOwnProperty(n) ? attrs[n] : null; },
      focus: function () { el.focused = true; },
      click: function () { if (el.onclick) el.onclick(); },
      addEventListener: function (t, fn) { (el._ev[t] = el._ev[t] || []).push(fn); },
      emit: function (t, e) { (el._ev[t] || []).forEach(function (f) { f(e || {}); }); },
      querySelectorAll: function (sel) { return sel === '[data-retake]' ? retakes : []; }
    };
    return el;
  }
  return {
    byId: byId, retakes: retakes,
    document: { getElementById: function (id) { return byId[id] || null; } }
  };
}

function retakeRun() {
  var dom = fakeDom(R.retakeHtml());
  var events = [], allowed = false;
  var env = {
    document: dom.document,
    window: { location: { href: '' }, SG_FS: { allow: function () { allowed = true; } } },
    STORE: {
      pushEvent: function (kind, id, data) { events.push({ kind: kind, id: id, data: data }); },
      flushAnswers: function () {}
    },
    setTimeout: function (fn) { fn(); }
  };
  build('?profile=toefl&set=set9', 'set9', env).bindRetake('sess-1');
  return { dom: dom, events: events, env: env, allowed: function () { return allowed; } };
}

var g = retakeRun();
ok('버튼은 다섯이다 (전체 + 네 영역)', g.dom.retakes.length === 5, String(g.dom.retakes.length));
ok('누르기 전에는 아무 데도 가지 않았다', g.env.window.location.href === '');

var readingBtn = g.dom.retakes.filter(function (el) {
  return /section=reading/.test(el.getAttribute('data-retake'));
})[0];
readingBtn.click();
ok('누르면 그 영역으로 간다', /(^|[?&])section=reading($|&)/.test(g.env.window.location.href),
   g.env.window.location.href);
ok('묻지 않고 바로 연다 — 승인 칸은 없다', g.dom.byId['done-retake-gate'] === undefined);
ok('재응시로 기록에 남는다',
   g.events.length === 1 && g.events[0].kind === 'retake' &&
   g.events[0].id === 'sess-1' && /section=reading/.test(g.events[0].data.to),
   JSON.stringify(g.events));
/* 전체화면은 학생이 스스로 여는 이동이므로 다시 묻지 않는다 — 안 풀면 이동한 자리에서
   화면 잠금이 덮어쓴다. */
ok('전체화면 잠금을 풀고 간다', g.allowed() === true);

/* 전체 한 벌도 같은 길이다. */
var g2 = retakeRun();
g2.dom.retakes.filter(function (el) {
  return el.getAttribute('data-retake').indexOf('mode=exam') >= 0;
})[0].click();
ok('전체 한 벌도 바로 연다', /(^|[?&])mode=exam($|&)/.test(g2.env.window.location.href),
   g2.env.window.location.href);

/* ── [3] 제출 화면 배선 ────────────────────────────────────── */
console.log('\n[3] 제출 화면 배선');

ok('다시 응시 칸을 배선한다', /bindRetake\(session\);/.test(shell));

ok('제출 화면에 붙는다', /retakeHtml\(\) \+/.test(shell));
ok('여는 함수가 있다', /function openRetake\s*\(/.test(shell));
ok('로그인 전이면 바로 연다', /say\('Saved on this device\.'[^)]*\);\s*\n\s*openRetake\(\);/.test(shell));
ok('업로드·채점이 끝난 뒤에 연다', /\.then\(openRetake, openRetake\);/.test(shell));
ok('채점 실패해도 열린다 — 갇히지 않는다',
   shell.indexOf('.catch(function () {') >= 0 && /\.then\(openRetake, openRetake\);/.test(shell));
ok('숨은 상태가 CSS 에도 있다', css.indexOf('.exam-retake[hidden]') >= 0);
ok('흰 배경 위에서 버튼이 보인다', css.indexOf('.exam-done .exam-btn') >= 0);

/* ── [4] 다시 들어가면 새 세션 ─────────────────────────────── */
console.log("\n[4] 새 세션");

ok('제출된 세션은 이어볼 수 없다',
   /if \(m\.submittedAt\) return \{ ok: false, reason: 'submitted' \}/.test(store));
ok('이어볼 수 없으면 셸이 새 세션을 연다',
   /if \(!can\.ok && can\.reason !== 'no_meta'[\s\S]{0,200}offlineSessionId\(\)/.test(shell));
/* 방금 친 응시를 지우지는 않는다 — 리뷰·성적이 그 기록을 읽는다. */
ok('제출 화면은 세션을 지우지 않는다',
   shell.slice(shell.indexOf('function finishScreen')).indexOf('dropSession') < 0);

console.log('');
if (fails.length) { console.log('FAIL ' + fails.length + '건'); process.exit(1); }
console.log('ALL PASS (retake after submit)');
