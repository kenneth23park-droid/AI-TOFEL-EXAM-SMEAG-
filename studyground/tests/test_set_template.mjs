/* SMEAG StudyGround — 새 세트 원본 docx 빈 틀(studyground/docs/set-template)이 가져오기 파서에 맞는가.
 *
 * 틀은 "이 모양대로 채우면 가져와진다" 는 약속이다. 파서(sg2/assets/set-import.js)는 문서의
 * 모양에 기대어 문항을 찾으므로, 파서가 바뀌면 틀이 조용히 어긋날 수 있다 — 그러면 선생님은
 * 틀대로 채웠는데 문항이 사라진 세트를 받는다. 여기서 틀을 **시험에 나갈 때와 같은 strict
 * source mode** 로 지어 120문항이 stop 없이 나오는지, 커밋된 틀이 생성기와 같은지 본다. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const SG2 = path.join(ROOT, 'sg2');

const DOCX = require(path.join(SG2, 'assets/docx-read.js'));
const IMPORT = require(path.join(SG2, 'assets/set-import.js'));
const { OUT_DIR, FILES, templateDocs } = await import(path.join(ROOT, 'tools/make_set_template.mjs'));

const checks = [];
function check(name, ok, detail) { checks.push({ name, ok: !!ok, detail: detail || '' }); }
const read = (b) => DOCX.read(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));

/* 커밋된 틀 = 생성기 결과. 손으로 고친 틀은 다음 생성 때 사라지고, 검사는 생성기만 본다. */
const fresh = templateDocs();
for (const k of Object.keys(FILES)) {
  const p = path.join(OUT_DIR, FILES[k]);
  const onDisk = fs.existsSync(p) ? fs.readFileSync(p) : null;
  check(FILES[k] + ' matches the generator', onDisk && Buffer.compare(onDisk, fresh[k]) === 0,
    'run: node studyground/tools/make_set_template.mjs');
}

const [questions, script, answers] = await Promise.all([read(fresh.questions), read(fresh.script), read(fresh.answers)]);
const out = IMPORT.build({ code: 'SET XX', questions, script, answers, strictSource: true });
const stops = out.gates.filter((g) => g.level === 'stop');
check('strict source build has no stops', stops.length === 0, stops.map((g) => g.scope + ' ' + g.message).join('\n  '));
check('no warnings either', out.gates.length === 0, out.gates.map((g) => g.level + ' ' + g.scope + ' ' + g.message).join('\n  '));

const s = out.stats;
check('120 questions: R50 · L47 · W12 · S11', s.total === 120 && s.bySection.reading === 50
  && s.bySection.listening === 47 && s.bySection.writing === 12 && s.bySection.speaking === 11, JSON.stringify(s));

const sec = (id) => out.pack.sections.find((x) => x.id === id);
const qsOf = (mod) => mod.blocks.flatMap((b) => b.questions || []);
const sizes = { R1: 35, R2: 15, L1: 32, L2: 15 };
for (const id of ['reading', 'listening']) {
  sec(id).modules.forEach((mod) => {
    const qs = qsOf(mod);
    check(mod.id + ' has ' + sizes[mod.id] + ' questions numbered 1..n',
      qs.length === sizes[mod.id] && qs.every((q, i) => q.no === i + 1), qs.map((q) => q.no).join(','));
    check(mod.id + ' every question has an answer', qs.every((q) => q.answer !== undefined && q.answer !== ''),
      qs.filter((q) => q.answer === undefined).map((q) => q.id).join(','));
  });
}

/* 듣기 — 블록마다 소리의 근거(대본)가 붙어야 한다. 짧은 응답은 문항마다 한 줄. */
const noScript = [];
sec('listening').modules.forEach((mod) => mod.blocks.forEach((b) => {
  const ok = b.perQuestionAudio ? b.questions.every((q) => q.script && q.audio) : !!b.script;
  if (!ok) noScript.push(mod.id + ' ' + b.heading);
}));
check('every listening block has its script', noScript.length === 0, noScript.join(' / '));

const w1 = sec('writing').modules.find((m) => m.id === 'W1');
const build = qsOf(w1);
check('build a sentence: 10 items, each answer built from its tiles',
  build.length === 10 && build.every((q) => q.answerTokens && q.answerTokens.length && q.trapTiles && q.trapTiles.length === 1),
  build.map((q) => q.id + ':' + (q.answerTokens || []).join('|')).join(' '));
const email = qsOf(sec('writing').modules.find((m) => m.id === 'W2'))[0];
check('email: to · subject · situation · 3 bullets', email && email.to && email.subject && email.situation && email.bullets.length === 3,
  JSON.stringify(email));
const disc = qsOf(sec('writing').modules.find((m) => m.id === 'W3'))[0];
check('discussion: professor · question · 2 posts', disc && disc.professor && disc.prompt && disc.posts.length === 2
  && disc.posts.every((p) => p.name && p.text), JSON.stringify(disc));

const [s1, s2] = sec('speaking').modules;
check('speaking task 1: 7 repeat lines, one picture each', s1 && qsOf(s1).length === 7
  && qsOf(s1).every((q) => q.kind === 'repeat' && q.script && q.image) && new Set(qsOf(s1).map((q) => q.image)).size === 7);
check('speaking task 2: 4 interview questions sharing one picture', s2 && qsOf(s2).length === 4
  && qsOf(s2).every((q) => q.kind === 'interview' && q.script && q.image && !/^\d/.test(q.script)));
check('speaking tasks carry their situation line', [s1, s2].every((m) => m && m.blocks[0].introScript));

const failed = checks.filter((c) => !c.ok);
checks.forEach((c) => console.log((c.ok ? 'ok   ' : 'FAIL ') + c.name + (c.ok ? '' : '\n     ' + c.detail)));
console.log(failed.length ? '\n' + failed.length + ' failed' : '\nset template: all ' + checks.length + ' checks passed');
process.exit(failed.length ? 1 : 0);
