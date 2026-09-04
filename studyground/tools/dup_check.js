#!/usr/bin/env node
/* dup_check.js — 문항·지문 겹침(중복) 검사, 터미널·CI 용.
 *
 * 판정은 여기 없다. 전부 sg2/assets/dup-core.js 에 있고 이 파일은 껍데기다 —
 * 디스크에서 팩과 대본을 읽어 넘기고, 결과를 파일로 쓰고, 종료코드를 낸다.
 * 브라우저(admin-set-import.html · admin-dup.html)가 같은 코어를 쓰므로
 * "터미널에서는 통과했는데 화면에서는 걸린다" 같은 일이 생기지 않는다.
 *
 * 실행:
 *   node studyground/tools/dup_check.js                       # 커밋된 팩 전체끼리
 *   node studyground/tools/dup_check.js --candidate <파일.js>  # 새 팩을 기존 전부와
 *   node studyground/tools/dup_check.js --fail-on watch       # watch 도 실패로
 *   node studyground/tools/dup_check.js --quiet                # 요약만
 *
 * 산출:
 *   sg2/config/dup-report.json   기계용 (테스트·CI)
 *   sg2/config/dup-report.js     화면용 (window.SG_DUP_REPORT — file:// 에서도 로드된다)
 *   → 뷰어: sg2/admin-dup.html
 *
 * 표준 라이브러리만 쓴다. 팩은 sg2 런타임과 같은 방식(window 섀도우 + eval)으로 읽는다.
 */

'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');            // studyground/
var SG2 = path.join(ROOT, 'sg2');
var SG_DUP = require(path.join(SG2, 'assets', 'dup-core.js'));

/* ══════════════ 팩 · 대본 로드 ═══════════════════════════════════════════ */

/** sg2 런타임과 같은 방식으로 콘텐츠 팩을 읽는다(ES5 · window 전역 · 빌드 없음).
 *
 * 팩은 자기 이름을 window 에 직접 박는다(window.SMEAG_SET9 = …). 그래서 "eval 전후로
 * 새로 생긴 SMEAG_* 키"를 찾는 방식은 **두 번째 호출부터 조용히 틀린다** — 이미 그 키가
 * 있으면 새로 생긴 키가 없고, 폴백이 엉뚱한 팩(마지막 키)을 돌려준다. 같은 파일을 두 번
 * 읽는 것만으로 SET1 자리에 SET9 이 들어와 겹침이 폭증했다(테스트에서 실제로 겪음).
 *
 * 그래서 읽기 전에 SMEAG_* 를 통째로 치우고, 읽은 뒤 원래대로 돌려놓는다. */
function loadPack(file) {
  var saved = {};
  Object.keys(global).forEach(function (k) {
    if (/^SMEAG_SET/.test(k)) { saved[k] = global[k]; delete global[k]; }
  });
  global.window = global;
  try {
    // eslint-disable-next-line no-eval
    eval(fs.readFileSync(file, 'utf8'));
    var fresh = Object.keys(global).filter(function (k) { return /^SMEAG_SET/.test(k); });
    if (fresh.length !== 1) {
      throw new Error('팩 하나가 전역 하나를 정의해야 한다 — ' + file +
        ' 이 정의한 것: [' + fresh.join(', ') + ']');
    }
    var pack = global[fresh[0]];
    if (!pack || !pack.sections) throw new Error('콘텐츠 팩이 아님: ' + file);
    pack.__file = path.relative(ROOT, file);
    return pack;
  } finally {
    Object.keys(global).forEach(function (k) { if (/^SMEAG_SET/.test(k)) delete global[k]; });
    Object.keys(saved).forEach(function (k) { global[k] = saved[k]; });
  }
}

function discoverPacks() {
  var dir = path.join(SG2, 'assets');
  return fs.readdirSync(dir)
    .filter(function (f) { return /^set[0-9a-z]+\.js$/i.test(f); })
    .sort()
    .map(function (f) { return path.join(dir, f); });
}

/** config/_<setid>_fragments/*_script.json → dup-core 가 받는 [{id,text,kind}]. */
function scriptRows(setCode) {
  var setId = String(setCode || '').toLowerCase().replace(/\s+/g, '');
  var dir = path.join(SG2, 'config', '_' + setId + '_fragments');
  var rows = [], src = [];
  if (!fs.existsSync(dir)) return { rows: rows, sources: src };

  fs.readdirSync(dir).filter(function (f) { return /_script\.json$/.test(f); }).forEach(function (f) {
    var raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    src.push(path.relative(ROOT, path.join(dir, f)));
    if (Object.prototype.toString.call(raw.lines) === '[object Array]') {
      raw.lines.forEach(function (l) { rows.push({ id: l.id, text: l.text, kind: l.kind }); });
    } else {
      Object.keys(raw).forEach(function (id) {
        var v = raw[id];
        if (v && typeof v === 'object' && v.text) rows.push({ id: id, text: v.text, kind: v.kind });
      });
    }
  });
  return { rows: rows, sources: src };
}

/* ══════════════ 실행 ═════════════════════════════════════════════════════ */

function main() {
  var argv = process.argv.slice(2);
  var candidate = null, failOn = 'high', quiet = false;
  for (var i = 0; i < argv.length; i++) {
    if (argv[i] === '--candidate') candidate = argv[++i];
    else if (argv[i] === '--fail-on') failOn = argv[++i];
    else if (argv[i] === '--quiet') quiet = true;
  }

  var files = discoverPacks();
  if (candidate) {
    var abs = path.resolve(candidate);
    if (files.map(function (f) { return path.resolve(f); }).indexOf(abs) < 0) files.push(abs);
  }

  var units = [], setInfo = [];
  files.map(loadPack).forEach(function (p) {
    var fromPack = SG_DUP.unitsFromPack(p);
    var sc = scriptRows(p.code || '');
    var fromScript = SG_DUP.unitsFromScriptRows(p.code || '', sc.rows, sc.sources.join(' '));
    setInfo.push({
      code: p.code, title: p.title, file: p.__file,
      items: fromPack.filter(function (u) { return u.role === 'item'; }).length,
      texts: fromPack.filter(function (u) { return u.role === 'text'; }).length,
      scripts: fromScript.length,
      isCandidate: !!candidate && path.resolve(path.join(ROOT, p.__file)) === path.resolve(candidate)
    });
    /* concat 이 아니라 mergeUnits — 대본 조각이 팩에 이미 있는 문장을 다시 들고 오면
     * 같은 원본이 단위 두 개가 되어 "완전히 동일한 문항"으로 걸린다(코어 주석 참조). */
    units = units.concat(SG_DUP.mergeUnits(fromPack, fromScript));
  });

  var allowFile = path.join(SG2, 'config', 'dup-allowlist.json');
  var allow = fs.existsSync(allowFile)
    ? SG_DUP.allowMap(JSON.parse(fs.readFileSync(allowFile, 'utf8'))) : {};

  var res = SG_DUP.analyze(units, { allow: allow });
  var counts = res.counts;

  var report = {
    tool: 'studyground/tools/dup_check.js',
    core: 'sg2/assets/dup-core.js',
    viewer: 'sg2/admin-dup.html',
    packs: setInfo,
    unitCount: res.unitCount,
    frameOnlyUnits: res.frameOnlyUnits,
    candidatePairs: res.candidatePairs,
    thresholds: res.thresholds,
    fieldPolicy: SG_DUP.FIELD_POLICY,
    blockPolicy: SG_DUP.BLOCK_POLICY,
    coverage: {
      note: '팩에 텍스트로 존재하는 것만 비교한다. mp3 만 있고 대본이 없는 오디오는 비교 대상이 아니다.',
      scriptsLoaded: setInfo.map(function (s) { return s.code + ':' + s.scripts; }).join(' '),
      frameNote: '유형이 강제하는 정형문(같은 줄이 서로 다른 문항 군집 ' + res.thresholds.frameDf +
        '곳 이상)은 비교에서 제외했다. 제외된 줄은 각 단위의 framedOut 에 df 와 함께 남는다.',
      frameOnlyUnits: res.frameOnlyUnits + '개 단위는 내용이 전부 정형문이라 비교 대상에서 빠졌다.'
    },
    counts: counts,
    pairs: res.pairs
  };

  fs.writeFileSync(path.join(SG2, 'config', 'dup-report.json'), JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(path.join(SG2, 'config', 'dup-report.js'),
    '/* GENERATED — node studyground/tools/dup_check.js. 손으로 고치지 말 것.\n' +
    ' * file:// 에서도 뷰어가 읽을 수 있도록 fetch 대신 <script src> 로 싣는다. */\n' +
    'window.SG_DUP_REPORT = ' + JSON.stringify(report) + ';\n');

  if (!quiet) {
    console.log('단위 ' + res.unitCount + '개 · 후보 쌍 ' + res.candidatePairs + '개 비교');
    setInfo.forEach(function (s) {
      console.log('  ' + s.code + ' — 문항 ' + s.items + ' · 지문 ' + s.texts + ' · 대본 ' + s.scripts +
        (s.isCandidate ? '   ← 후보(신규)' : ''));
    });
    console.log('');
    if (counts.high) {
      console.log('❌ 기존과 같은 문항이 있습니다 — high ' + counts.high + '건, watch ' + counts.watch + '건');
      res.pairs.filter(function (p) { return p.severity === 'high'; }).slice(0, 20).forEach(function (p) {
        console.log('   · ' + p.a.uid + '  ↔  ' + p.b.uid + '   (' + p.reasons[0] + ')');
      });
      if (counts.high > 20) console.log('   … 외 ' + (counts.high - 20) + '건');
    } else if (counts.watch) {
      console.log('⚠️  확실한 겹침은 없습니다. 사람이 볼 것 ' + counts.watch + '건 (watch)');
      res.pairs.filter(function (p) { return p.severity === 'watch'; }).slice(0, 10).forEach(function (p) {
        console.log('   · ' + p.a.uid + '  ↔  ' + p.b.uid + '   (' + p.reasons[0] + ')');
      });
    } else {
      /* "없다"를 그냥 말하지 않는다 — 허용목록으로 내려놓은 건수를 같이 보여 줘야
       * 검사를 통과한 것과 검사를 꺼 둔 것을 구분할 수 있다. */
      console.log('✅ 겹치는 문항이 없습니다.' +
        (counts.allowlisted ? '  (사람이 보고 허용한 것 ' + counts.allowlisted + '건 포함 — dup-allowlist.json)' : '') +
        (counts.info - counts.allowlisted ? '  (정형문 강등 ' + (counts.info - counts.allowlisted) + '건)' : ''));
    }
    console.log('\n리포트: sg2/config/dup-report.json   뷰어: sg2/admin-dup.html');
  }

  var bad = failOn === 'watch' ? (counts.high + counts.watch) : failOn === 'none' ? 0 : counts.high;
  process.exit(bad ? 1 : 0);
}

if (require.main === module) main();

module.exports = { loadPack: loadPack, discoverPacks: discoverPacks, scriptRows: scriptRows, core: SG_DUP };
