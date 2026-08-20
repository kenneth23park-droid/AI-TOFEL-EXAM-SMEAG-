/* SMEAG StudyGround — tests/test_set_import_set10.mjs
 *
 * SET 10 은 SET 9 와 서식이 여러 군데 다르다. 손으로 검증된 정본이 아직 없으므로
 * **정답지와 대본이 스스로 말하는 것**을 기준으로 검사한다 —
 * 모듈별 문항 수는 정답지의 개수와 같아야 하고, 리스닝 블록은 하나도 빠짐없이
 * 들려줄 대사를 가져야 하며, 문장 조립에는 끌어다 놓을 낱말이 있어야 한다.
 *
 * SET 9 회귀(test_set_import.mjs)와 짝이다. 둘 다 초록이어야 파서를 고친 것이다 —
 * 한쪽만 보면 SET 10 을 맞추다 SET 9 를 깨뜨리는 일이 반복된다.
 *
 * 실행: node studyground/tests/test_set_import_set10.mjs
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
  questions: 'NEW TOEFL MOCK TEST SET 10 Questions.docx',
  script: 'SET 10 SCRIPT.docx',
  answers: 'SET 10 ANSWER KEY.docx'
};

/* 원본 문서가 스스로 틀린 곳 — 파서가 고른 번호가 맞고, 경고로 남는 것이 정상이다.
 * 다음에 이 목록보다 경고가 늘면 그건 새 회귀다. */
const SOURCE_ERRORS = [
  'R1 Questions 21-22 블록의 본문 번호가 22·23 으로 하나씩 밀려 있다',
  'L1 머리글 "Questions 15-16" 이 19-20 · 25-28 자리에도 되풀이돼 있다',
  'L2 "Questions 1-3" 머리글이 통째로 빠져 있다',
  'W1 에 타일(끌어다 놓을 낱말) 줄이 없다 — 정답 문장에서 만든다'
];

const checks = [];
function check(name, ok, detail) { checks.push({ name, ok: !!ok, detail: detail || '' }); }

function readDocx(name) {
  const file = path.join(REPO, name);
  if (!fs.existsSync(file)) return null;
  const b = fs.readFileSync(file);
  return DOCX.read(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

function modulesOf(pack, sectionId) {
  const sec = pack.sections.find((s) => s.id === sectionId);
  return sec ? sec.modules : [];
}

function questionsOfModule(mod) {
  const out = [];
  mod.blocks.forEach((b) => (b.questions || []).forEach((q) => out.push(q)));
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

  const result = IMPORT.build({ code: 'SET 10', questions, script, answers });
  const pack = result.pack;
  if (!pack) {
    console.error('팩을 만들지 못했습니다.');
    result.gates.forEach((g) => console.error('  ' + g.level + ' ' + g.message));
    process.exit(1);
  }

  const key = IMPORT._parseAnswerKey(answers.paragraphs);

  /* ---- 1. 모듈별 문항 수가 정답지 개수와 같은가 ---- */
  for (const secId of ['reading', 'listening']) {
    modulesOf(pack, secId).forEach((mod) => {
      const no = +String(mod.id).replace(/\D/g, '') || 1;
      const want = (key[secId] && key[secId][no] ? key[secId][no] : []).length;
      const got = questionsOfModule(mod).length;
      check(`${mod.id} 문항 수`, got === want, `추출 ${got} / 정답지 ${want}`);
    });
  }

  /* ---- 2. 번호가 1..n 으로 빠짐없이 이어지는가 ---- */
  for (const secId of ['reading', 'listening']) {
    modulesOf(pack, secId).forEach((mod) => {
      const nos = questionsOfModule(mod).map((q) => q.no);
      const want = nos.map((_, i) => i + 1);
      check(`${mod.id} 번호 연속`, JSON.stringify(nos) === JSON.stringify(want),
        nos.length ? `${nos[0]}…${nos[nos.length - 1]}` : '비었음');
    });
  }

  /* 머리글 위에 놓인 지문도 다음 블록으로 넘어가야 한다(SET10 R1 26-30). */
  {
    const r1 = modulesOf(pack, 'reading').find((m) => m.id === 'R1');
    const twin = r1 && r1.blocks.find((b) => (b.questions || []).some((q) => q.id === 'R1-26'));
    check('R1 26-30 Twin Stars 지문', !!twin && twin.title === 'Twin Stars'
      && twin.paragraphs && twin.paragraphs.length === 3,
      twin ? `${twin.title || '제목 없음'} / ${twin.paragraphs.length}문단` : '블록 없음');
  }

  /* ---- 3. 리스닝 블록마다 들려줄 것이 있는가 ---- */
  {
    const naked = [];
    modulesOf(pack, 'listening').forEach((mod) => {
      mod.blocks.forEach((b) => {
        const perQ = (b.questions || []).every((q) => q.script);
        if (!b.script && !(b.perQuestionAudio && perQ)) naked.push(mod.id + ' ' + (b.heading || ''));
      });
    });
    check('리스닝 대본 빠짐없음', naked.length === 0, naked.join(' / '));
  }

  /* ---- 4. 리스닝 음성 파일 이름이 겹치지 않는가 ---- */
  {
    const seen = new Set(), dup = [];
    modulesOf(pack, 'listening').forEach((mod) => {
      mod.blocks.forEach((b) => {
        const files = b.audio ? [b.audio] : (b.questions || []).map((q) => q.audio).filter(Boolean);
        files.forEach((f) => { if (seen.has(f)) dup.push(f); else seen.add(f); });
      });
    });
    check('음성 파일 이름 겹침 없음', dup.length === 0, dup.join(', '));
  }

  /* ---- 5. 문장 조립에 끌어다 놓을 낱말이 있는가 ---- */
  {
    const builds = [];
    modulesOf(pack, 'writing').forEach((mod) => {
      mod.blocks.forEach((b) => (b.questions || []).forEach((q) => { if (q.kind === 'build') builds.push(q); }));
    });
    const empty = builds.filter((q) => !q.tiles || !q.tiles.length).map((q) => q.id);
    check('문장 조립 타일 있음', builds.length === 10 && empty.length === 0,
      `${builds.length}문항, 타일 없는 것 ${empty.length}`);
    /* 타일은 정답 문장의 낱말 그대로여야 한다 — 지어낸 낱말이 섞이면 채점이 어긋난다. */
    const odd = builds.filter((q) => {
      if (!q.answerSentence) return false;
      const words = q.answerSentence.replace(/[.?!]+\s*$/, '').split(/\s+/).join(' ');
      return q.tiles.some((t) => words.indexOf(t) < 0);
    }).map((q) => q.id);
    check('타일이 정답 문장의 낱말', odd.length === 0, odd.join(', '));
  }

  /* ---- 6. 스피킹 ---- */
  {
    const mods = modulesOf(pack, 'speaking');
    const counts = mods.map((m) => questionsOfModule(m).length);
    check('스피킹 Task 2개', mods.length === 2, mods.map((m) => m.id).join(', '));
    check('스피킹 문항 7 + 4', JSON.stringify(counts) === '[7,4]', counts.join(', '));
    const noScript = [];
    mods.forEach((m) => questionsOfModule(m).forEach((q) => { if (!q.script) noScript.push(q.id); }));
    check('스피킹 대사 빠짐없음', noScript.length === 0, noScript.join(', '));
  }

  /* ---- 7. 멈춤 게이트 ---- */
  const stops = result.gates.filter((g) => g.level === 'stop');
  check('멈춤 게이트 없음', stops.length === 0, stops.map((g) => g.message).join(' / '));

  /* ---- 출력 ---- */
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ checks, gates: result.gates, stats: result.stats }, null, 2));
  } else {
    console.log('SET 10 원본 → set-import.js 검사\n');
    checks.forEach((c) => console.log(`  ${c.ok ? '✔' : '✘'} ${c.name.padEnd(22)} ${c.detail}`));
    console.log('\n  통계:', JSON.stringify(result.stats));
    console.log('\n  원본 문서가 스스로 틀린 곳(경고로 남는 것이 정상)');
    SOURCE_ERRORS.forEach((why) => console.log('    · ' + why));
    const warns = result.gates.filter((g) => g.level === 'warn');
    if (warns.length) {
      console.log(`\n  경고 ${warns.length}건`);
      warns.forEach((g) => console.log('    · [' + g.scope + '] ' + g.message));
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
