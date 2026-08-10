/* 겹침(중복) 검사 검산.
 * 실행: node studyground/tests/test_dup_check.js
 *
 * 이 테스트가 지키는 것은 두 방향이다. 한쪽만 지키는 검사기는 쓸모가 없다.
 *
 *   [탐지력] 재활용 수법을 심으면 반드시 high 가 난다.
 *            함정 팩(아래 TRAP)은 실제로 검사기를 두 번 뚫었던 수법들을 담고 있다 —
 *            특히 [수법 2]는 "같은 선택지를 여러 문항에 심어 정형문으로 위장"하는
 *            우회로였고, 그래서 틀 df 를 군집 수로 세도록 고쳤다. 그 회귀를 여기서 막는다.
 *   [무탐지] 유형이 강제하는 정형문("What is the main topic of the talk?", Position A~D,
 *            cloze 힌트)은 절대 high 가 되면 안 된다. 이걸 놓치면 리포트가 정형문으로
 *            가득 차 사람이 안 보게 되고, 검사기가 있으나 마나가 된다(실측: 116건 중 114건).
 *
 * 판정 로직은 sg2/assets/dup-core.js 한 벌이므로, 이 테스트가 곧 브라우저
 * (admin-set-import.html 의 저장 잠금) 의 검산이기도 하다.
 */

'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var SG2 = path.join(ROOT, 'sg2');
var SG_DUP = require(path.join(SG2, 'assets', 'dup-core.js'));
var CLI = require(path.join(ROOT, 'tools', 'dup_check.js'));

var fails = 0, checks = 0;
function ok(cond, label, detail) {
  checks++;
  if (cond) { console.log('  ✓ ' + label); return; }
  fails++;
  console.log('  ✗ ' + label + (detail ? '\n      ' + detail : ''));
}

/* ── 말뭉치 ──────────────────────────────────────────────────────────────── */

function loadAll() {
  var units = [], codes = [];
  CLI.discoverPacks().forEach(function (f) {
    var p = CLI.loadPack(f);
    codes.push(p.code);
    var sc = CLI.scriptRows(p.code || '');
    units = units.concat(
      SG_DUP.unitsFromPack(p),
      SG_DUP.unitsFromScriptRows(p.code || '', sc.rows, sc.sources.join(' '))
    );
  });
  return { units: units, codes: codes };
}

function allow() {
  var f = path.join(SG2, 'config', 'dup-allowlist.json');
  return fs.existsSync(f) ? SG_DUP.allowMap(JSON.parse(fs.readFileSync(f, 'utf8'))) : {};
}

/* ── 함정 팩 — 실제 재활용 수법 5가지 + 대조군 3가지 ─────────────────────
 * 원본은 SET 9 R1 도서관 지문/문항. 여기서 문자열을 직접 들고 있지 않고
 * 팩에서 읽어와 변형한다 — 원본이 바뀌면 함정도 같이 따라가야 하기 때문이다. */
function buildTrap(set9) {
  var libBlock = null;
  (set9.sections || []).forEach(function (sec) {
    (sec.modules || []).forEach(function (mod) {
      (mod.blocks || []).forEach(function (b) {
        var q = (b.questions || [])[0];
        if (q && q.prompt === 'When does the library close on Fridays?') libBlock = b;
      });
    });
  });
  if (!libBlock) throw new Error('함정의 원본(SET9 도서관 블록)을 찾지 못했다 — 팩이 바뀌었으면 이 테스트를 고칠 것.');

  var q21 = libBlock.questions[0];            // "When does the library close on Fridays?"
  var q22 = libBlock.questions[1];            // "What are visitors allowed to do at the library?"

  return {
    code: 'SETTRAP', title: 'trap',
    sections: [{
      id: 'reading', label: 'Reading',
      modules: [{
        id: 'T1', label: 'Trap Module 1',
        blocks: [{
          kind: 'passage', heading: 'Questions 1-4', instruction: 'Read the passage.',
          title: 'Library hours',
          /* [수법 4] 지문 문단을 통째로 옮기고 앞뒤만 바꿈 */
          paragraphs: ['Welcome to the campus resource guide.'].concat(libBlock.paragraphs.slice(1)),
          questions: [
            /* [수법 1] 글자 그대로 복사 */
            { id: 'T1-1', kind: 'mcq', no: 1, prompt: q21.prompt, choices: q21.choices.slice(), answer: q21.answer },
            /* [수법 2] 발문만 다시 쓰고 선택지 4개는 그대로.
             * 아래 [수법 3] 과 함께 들어 있는 것이 중요하다 — 같은 선택지가 세 문항에
             * 걸치면 예전 검사기는 이걸 정형문으로 강등해 놓쳤다. */
            { id: 'T1-2', kind: 'mcq', no: 2, prompt: 'Which activity is permitted for people visiting the library?',
              choices: q22.choices.slice(), answer: q22.answer },
            /* [수법 3] 선택지 4개 중 3개만 재사용 */
            { id: 'T1-3', kind: 'mcq', no: 3, prompt: 'What is one restriction on library visitors?',
              choices: q22.choices.slice(0, 3).concat(['They must sign the front desk register']), answer: 3 },
            /* [대조군 A] 완전 신규 */
            { id: 'T1-4', kind: 'mcq', no: 4, prompt: 'What does the guide say about parking permits?',
              choices: ['They are issued each semester', 'They cost forty dollars monthly',
                        'They are limited to graduate students', 'They must be displayed on the windshield'], answer: 0 }
          ]
        }, {
          kind: 'audio-set', heading: 'Questions 5-6', instruction: 'Listen and answer.',
          questions: [
            /* [대조군 B] 정형 발문 + 신규 선택지 — 걸리면 안 된다 */
            { id: 'T1-5', kind: 'mcq', no: 5, prompt: 'What is the main topic of the talk?',
              choices: ['How glaciers carve valleys', 'Why sediment layers form bands',
                        'The role of meltwater in erosion', 'Techniques for dating ice cores'], answer: 2 },
            /* [대조군 C] 완전 신규 */
            { id: 'T1-6', kind: 'mcq', no: 6, prompt: 'Why does the professor mention the 1963 survey?',
              choices: ['To correct an earlier measurement', 'To introduce a competing hypothesis',
                        'To show how instruments improved', 'To explain a funding decision'], answer: 0 }
          ]
        }]
      }]
    }]
  };
}

/* ══════════════ [1] 저장소 기준선 ════════════════════════════════════════ */
console.log('\n[1] 커밋된 팩 기준선 — 정형문이 high 로 새지 않는가');

var corpus = loadAll();
var base = SG_DUP.analyze(corpus.units.slice(), { allow: allow() });

ok(corpus.codes.length >= 2, '팩을 2개 이상 읽었다', '읽은 것: ' + corpus.codes.join(', '));
ok(base.unitCount > 100, '비교 단위가 100개를 넘는다 (' + base.unitCount + '개)');
ok(base.counts.high === 0, '커밋된 팩 사이에 high 가 없다',
   base.pairs.filter(function (p) { return p.severity === 'high'; })
     .map(function (p) { return p.key + ' — ' + p.reasons[0]; }).join('\n      '));

/* 정형 발문이 payload 에서 빠졌는지 직접 확인한다. 등급만 보면 임계값이 우연히
 * 가려 준 경우와 구분되지 않는다. */
var finalized = SG_DUP.finalizeUnits(loadAll().units);
var stock = finalized.filter(function (u) {
  return (u.framedOut || []).some(function (f) {
    return /listen to the question and select the best response/i.test(f.line);
  });
});
ok(stock.length >= 5, '"Listen to the question…" 정형 발문이 틀로 제외됐다 (' + stock.length + '개 단위)');

var clozeHint = finalized.filter(function (u) { return u.qkind === 'blank'; });
ok(clozeHint.length === 0, 'cloze 빈칸은 문항 단위를 만들지 않는다 (힌트 "th" 오탐 방지)');

/* ══════════════ [2] 함정 팩 — 탐지력 ═════════════════════════════════════ */
console.log('\n[2] 함정 팩 — 재활용 수법을 심으면 high 가 나는가');

var set9 = null;
CLI.discoverPacks().forEach(function (f) {
  var p = CLI.loadPack(f);
  if (String(p.code).replace(/\s+/g, '').toUpperCase() === 'SET9') set9 = p;
});
ok(!!set9, 'SET9 팩을 찾았다');

var trapped = loadAll().units.concat(SG_DUP.unitsFromPack(buildTrap(set9)));
var res = SG_DUP.analyze(trapped, { allow: allow() });

function sevOf(idA, idB) {
  var hit = res.pairs.filter(function (p) {
    var k = p.key;
    return k.indexOf(idA) >= 0 && k.indexOf(idB) >= 0;
  })[0];
  return hit ? hit.severity : '(무판정)';
}
function flagged(id) {
  return res.pairs.some(function (p) { return p.key.indexOf(id) >= 0 && p.severity !== 'info'; });
}

ok(sevOf('SETTRAP::T1-1', 'R1-21') === 'high', '[수법 1] 글자 그대로 복사 → high', '실제: ' + sevOf('SETTRAP::T1-1', 'R1-21'));
ok(sevOf('SETTRAP::T1-2', 'R1-22') === 'high', '[수법 2] 발문만 바꾸고 선택지 4개 그대로 → high', '실제: ' + sevOf('SETTRAP::T1-2', 'R1-22'));
ok(sevOf('SETTRAP::T1-3', 'R1-22') === 'high', '[수법 3] 선택지 4개 중 3개 재사용 → high', '실제: ' + sevOf('SETTRAP::T1-3', 'R1-22'));
ok(sevOf('SETTRAP::blk:T1:0', 'blk:R1') === 'high', '[수법 4] 지문 문단 이식 → high', '실제: ' + sevOf('SETTRAP::blk:T1:0', 'blk:R1'));
ok(res.counts.high >= 4, '함정 팩에서 high 가 4건 이상 (' + res.counts.high + '건)');

/* ══════════════ [3] 함정 팩 — 무탐지 ═════════════════════════════════════ */
console.log('\n[3] 함정 팩 — 새로 쓴 문항을 겹침으로 몰지 않는가');

ok(!flagged('SETTRAP::T1-4'), '[대조군 A] 완전 신규 문항은 무판정');
ok(!flagged('SETTRAP::T1-5'), '[대조군 B] 정형 발문 + 신규 선택지는 무판정 (정형문 오탐 방지)');
ok(!flagged('SETTRAP::T1-6'), '[대조군 C] 완전 신규 문항은 무판정');

/* ══════════════ [4] 허용목록 계약 ════════════════════════════════════════ */
console.log('\n[4] 허용목록 — 사유 없는 항목으로 검사를 끌 수 없는가');

var m = SG_DUP.allowMap({ allow: [
  { pair: 'A | B', reason: '' },
  { pair: 'C | D', reason: '   ' },
  { pair: 'E | F' },
  { pair: 'G | H', reason: '사람이 보고 판정함' }
] });
ok(!m['A | B'] && !m['C | D'] && !m['E | F'], '사유가 비어 있으면 무시된다');
ok(!!m['G | H'], '사유가 있으면 등록된다');

var allowFile = path.join(SG2, 'config', 'dup-allowlist.json');
ok(fs.existsSync(allowFile), 'dup-allowlist.json 이 있다');
if (fs.existsSync(allowFile)) {
  var raw = JSON.parse(fs.readFileSync(allowFile, 'utf8'));
  var bad = (raw.allow || []).filter(function (r) { return !r.reason || !String(r.reason).trim(); });
  ok(bad.length === 0, '허용목록의 모든 항목에 사유가 적혀 있다',
     bad.map(function (r) { return r.pair; }).join(', '));

  /* 허용목록이 유령을 가리키고 있으면(팩이 바뀌어 없어진 쌍) 조용히 남아 다음 겹침을
   * 덮을 수 있다. 실제로 올라온 쌍만 남아 있는지 확인한다. */
  var live = {};
  base.pairs.forEach(function (p) { live[p.key] = 1; });
  var ghosts = (raw.allow || []).filter(function (r) {
    var parts = String(r.pair).split(' | ');
    return !live[r.pair] && !live[parts[1] + ' | ' + parts[0]];
  });
  ok(ghosts.length === 0, '허용목록에 유령 항목(이제 올라오지 않는 쌍)이 없다',
     ghosts.map(function (r) { return r.pair; }).join(', '));
}

/* ══════════════ [5] 리포트 산출물 ════════════════════════════════════════ */
console.log('\n[5] 리포트 — 화면이 읽을 수 있는 모양인가');

var reportJs = path.join(SG2, 'config', 'dup-report.js');
var reportJson = path.join(SG2, 'config', 'dup-report.json');
ok(fs.existsSync(reportJson), 'dup-report.json 이 있다');
ok(fs.existsSync(reportJs), 'dup-report.js 가 있다 (file:// 뷰어용)');
if (fs.existsSync(reportJs)) {
  var shadow = {};
  // eslint-disable-next-line no-eval
  (function () { var window = shadow; eval(fs.readFileSync(reportJs, 'utf8')); })();
  var R = shadow.SG_DUP_REPORT;
  ok(!!R && !!R.counts && !!R.pairs, 'dup-report.js 가 window.SG_DUP_REPORT 를 정의한다');
  if (R) {
    ok(R.counts.high === 0, '커밋된 리포트에 high 가 없다 — 최신 상태로 재생성돼 있다');
    var missingHref = (R.pairs || []).filter(function (p) { return !p.a.href || !p.b.href; });
    ok(missingHref.length === 0, '모든 쌍이 문항으로 건너뛸 링크를 들고 있다');
  }
}

/* ══════════════ 결과 ═════════════════════════════════════════════════════ */
console.log('\n' + (fails ? '✗ ' + fails + '/' + checks + ' FAILED' : '✓ ALL PASS (' + checks + ' checks)') + '\n');
process.exit(fails ? 1 : 0);
