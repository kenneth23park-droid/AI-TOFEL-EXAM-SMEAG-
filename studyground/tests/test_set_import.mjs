/* SMEAG StudyGround — tests/test_set_import.mjs
 *
 * sg2/assets/set-import.js 의 회귀 검사. SET 9 는 이미 손으로 검증된 산출물
 * (sg2/assets/set9.js) 이 있으므로, 같은 docx 를 새 파서에 물려 그 결과와 대조한다.
 * 새 세트를 만들 때 서식이 조금 달라 파서를 고치게 되는데, 그때 SET 9 가 깨지지 않았는지
 * 이 파일 하나로 확인한다.
 *
 * 실행: node studyground/tests/test_set_import.mjs
 *       node studyground/tests/test_set_import.mjs --json   (결과를 JSON 으로)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);              // .../studyground
const REPO = path.dirname(ROOT);              // 원본 docx 가 있는 곳
const SG2 = path.join(ROOT, 'sg2');

const DOCX = require(path.join(SG2, 'assets/docx-read.js'));
const IMPORT = require(path.join(SG2, 'assets/set-import.js'));

const SOURCES = {
  questions: 'NEW TOEFL MOCK TEST SET  9.docx',
  script: 'SET 9 SCRIPT.docx',
  answers: 'SET 9 ANSWER KEY.docx'
};

function readDocx(name) {
  const file = path.join(REPO, name);
  if (!fs.existsSync(file)) return null;
  const b = fs.readFileSync(file);
  return DOCX.read(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

/** 검증된 산출물 set9.js 를 전역 없이 평가한다. */
function loadExpected() {
  const g = {};
  const src = fs.readFileSync(path.join(SG2, 'assets/set9.js'), 'utf8');
  new Function('window', src)(g);
  return g.SMEAG_SET9;
}

/* 정본 set9.js 가 원본 docx 와 다른 곳 — 사람이 손으로 고친 오타들이다.
 * 파서는 "원본 텍스트를 새로 만들지 않는다"가 원칙이라 이 차이는 정상이고, 대신
 * 각 항목에 gate 경고가 붙는다. 목록을 여기 남기는 이유는, 다음에 이 파일이 붉게
 * 뜨면 그건 새 회귀라는 뜻이기 때문이다. */
const AUTHORED_FIXES = {
  'R1-7': '정답지 오기 — docx "correct", 정본 "that"(힌트 th 와 일치)',
  'L2-8': 'docx 오타 — "physiology adaptations that allows" → "physiological adaptations that allow"',
  'L2-10': 'docx 오타 — "modem environments" → "modern environments"',
  'L2-14': 'docx 오타 — "others genres" → "other genres"'
};

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail: detail || '' });
}

function questionsOf(pack, sectionId) {
  const sec = pack.sections.find((s) => s.id === sectionId);
  if (!sec) return [];
  const out = [];
  sec.modules.forEach((m) => m.blocks.forEach((b) => (b.questions || []).forEach((q) => out.push(q))));
  return out;
}

const main = async () => {
  const missing = Object.entries(SOURCES).filter(([, f]) => !fs.existsSync(path.join(REPO, f)));
  if (missing.length) {
    console.error('원본 docx 를 찾지 못했습니다:\n  ' + missing.map(([, f]) => f).join('\n  '));
    process.exit(2);
  }

  const [questions, script, answers] = await Promise.all([
    readDocx(SOURCES.questions), readDocx(SOURCES.script), readDocx(SOURCES.answers)
  ]);

  const result = IMPORT.build({ code: 'SET 9', questions, script, answers });
  const got = result.pack;
  const want = loadExpected();

  if (!got) {
    console.error('팩을 만들지 못했습니다.');
    result.gates.forEach((g) => console.error('  ' + g.level + ' ' + g.message));
    process.exit(1);
  }

  /* ---- 1. 섹션 4개 ---- */
  check('4개 섹션', got.sections.length === 4,
    got.sections.map((s) => s.id).join(', '));

  /* ---- 2. 섹션별 문항 수 ---- */
  for (const id of ['reading', 'listening', 'writing', 'speaking']) {
    const g = questionsOf(got, id).length;
    const w = questionsOf(want, id).length;
    check(`${id} 문항 수`, g === w, `추출 ${g} / 정본 ${w}`);
  }

  /* ---- 3. 총 문항 수 ---- */
  const gTotal = got.sections.reduce((n, s) => n + questionsOf(got, s.id).length, 0);
  const wTotal = want.sections.reduce((n, s) => n + questionsOf(want, s.id).length, 0);
  check('총 문항 수', gTotal === wTotal, `추출 ${gTotal} / 정본 ${wTotal}`);

  /* ---- 4. 리딩·리스닝 정답 일치 ---- */
  for (const id of ['reading', 'listening']) {
    const gq = questionsOf(got, id);
    const wq = questionsOf(want, id);
    const wMap = new Map(wq.map((q) => [q.id, q.answer]));
    let same = 0, expected = 0, diff = [];
    gq.forEach((q) => {
      if (!wMap.has(q.id)) return;
      if (AUTHORED_FIXES[q.id]) return;
      expected++;
      const a = wMap.get(q.id);
      const norm = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v);
      if (norm(a) === norm(q.answer)) same++;
      else if (diff.length < 5) diff.push(`${q.id}: ${JSON.stringify(q.answer)} ≠ ${JSON.stringify(a)}`);
    });
    check(`${id} 정답 일치`, same === expected,
      `${same}/${expected}` + (diff.length ? ' — ' + diff.join('; ') : ''));
  }

  /* ---- 5. 문항 본문 일치(리딩·리스닝 mcq) ---- */
  for (const id of ['reading', 'listening']) {
    const wq = new Map(questionsOf(want, id).map((q) => [q.id, q]));
    const gq = questionsOf(got, id);
    let same = 0, expected = 0, diff = [];
    gq.forEach((q) => {
      const w = wq.get(q.id);
      if (!w || AUTHORED_FIXES[q.id]) return;
      expected++;
      if ((w.prompt || '') === (q.prompt || '')) same++;
      else if (diff.length < 3) diff.push(`${q.id}`);
    });
    check(`${id} 문항 본문 일치`, same === expected,
      `${same}/${expected}` + (diff.length ? ' — ' + diff.join(', ') : ''));
  }

  /* ---- 6. 보기 일치 ---- */
  {
    const wq = new Map([...questionsOf(want, 'reading'), ...questionsOf(want, 'listening')].map((q) => [q.id, q]));
    const gq = [...questionsOf(got, 'reading'), ...questionsOf(got, 'listening')];
    let same = 0, expected = 0, diff = [];
    gq.forEach((q) => {
      const w = wq.get(q.id);
      if (!w || !w.choices || AUTHORED_FIXES[q.id]) return;
      expected++;
      if (JSON.stringify(w.choices) === JSON.stringify(q.choices)) same++;
      else if (diff.length < 3) diff.push(q.id);
    });
    check('보기 일치', same === expected, `${same}/${expected}` + (diff.length ? ' — ' + diff.join(', ') : ''));
  }

  /* ---- 7. 멈춤 게이트 ---- */
  const stops = result.gates.filter((g) => g.level === 'stop');
  check('멈춤 게이트 없음', stops.length === 0, stops.map((g) => g.message).join(' / '));

  /* ---- 출력 ---- */
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ checks, gates: result.gates, stats: result.stats }, null, 2));
  } else {
    console.log('SET 9 원본 → set-import.js 회귀 검사\n');
    checks.forEach((c) => {
      console.log(`  ${c.ok ? '✔' : '✘'} ${c.name.padEnd(22)} ${c.detail}`);
    });
    console.log('\n  통계:', JSON.stringify(result.stats));
    console.log('\n  정본이 손으로 고친 항목(비교에서 제외 — 파서는 원본 그대로가 맞다)');
    Object.entries(AUTHORED_FIXES).forEach(([id, why]) => console.log(`    · ${id}  ${why}`));
    const warns = result.gates.filter((g) => g.level === 'warn');
    if (warns.length) {
      console.log(`\n  경고 ${warns.length}건`);
      warns.slice(0, 12).forEach((g) => console.log('    · [' + g.scope + '] ' + g.message));
      if (warns.length > 12) console.log(`    · … 외 ${warns.length - 12}건`);
    }
  }

  const failed = checks.filter((c) => !c.ok);
  if (failed.length) {
    console.error(`\n${failed.length}개 항목 실패`);
    process.exit(1);
  }
  console.log('\n전부 통과');
};

main().catch((e) => { console.error(e); process.exit(1); });
