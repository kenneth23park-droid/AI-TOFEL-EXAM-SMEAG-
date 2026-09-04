/* SMEAG StudyGround — SET 12 importer regression.
   원본 세 장의 이름은 세트마다 다르다(SET 12 도 'ANWER KEY' 오타다) — 적어 두지 않고
   tools/source_docs.mjs 로 고른다. build_set12.mjs 와 같은 자리를 본다. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const SG2 = path.join(ROOT, 'sg2');

const { sourceDirs, findSourceDocsIn } = await import(path.join(SG2, 'tools/source_docs.mjs'));
const DOCX = require(path.join(SG2, 'assets/docx-read.js'));
const IMPORT = require(path.join(SG2, 'assets/set-import.js'));

const FOUND = findSourceDocsIn(sourceDirs(SG2), 12);

const checks = [];
function check(name, ok, detail) { checks.push({ name, ok: !!ok, detail: detail || '' }); }
function modulesOf(pack, sectionId) {
  const sec = pack.sections.find((s) => s.id === sectionId);
  return sec ? sec.modules : [];
}
function questionsOfModule(mod) {
  const out = [];
  mod.blocks.forEach((b) => (b.questions || []).forEach((q) => out.push(q)));
  return out;
}
async function readDocx(name) {
  const b = fs.readFileSync(path.join(FOUND.dir, name));
  return DOCX.read(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

const [questions, script, answers] = await Promise.all([
  readDocx(FOUND.questions), readDocx(FOUND.script), readDocx(FOUND.answers)
]);
const result = IMPORT.build({ code: 'SET 12', questions, script, answers });
const pack = result.pack;

check('no stop gates', result.gates.filter((g) => g.level === 'stop').length === 0,
  result.gates.map((g) => g.level + ' ' + g.scope + ' ' + g.message).join('\n'));

/* 시험에 실제로 나갈 팩은 strict source mode 로 지어진다 — 관리자 화면도, tools/build_set12.mjs
   도 그 잣대다. 느슨한 모드만 확인하면 "테스트는 초록인데 저장은 막히는" 세트가 나온다. */
const listeningImages = JSON.parse(fs.readFileSync(path.join(SG2, 'config/set12-listening-images.json'), 'utf8'));
const strict = IMPORT.build({ code: 'SET 12', questions, script, answers, listeningImages, strictSource: true });
check('strict source build has no stops', strict.gates.filter((g) => g.level === 'stop').length === 0,
  strict.gates.filter((g) => g.level === 'stop').map((g) => g.scope + ' ' + g.message).join('\n  '));

check('section counts', result.stats.total === 120
  && result.stats.bySection.reading === 50
  && result.stats.bySection.listening === 47
  && result.stats.bySection.writing === 12
  && result.stats.bySection.speaking === 11, JSON.stringify(result.stats));

/* 모듈별 번호는 1..n 이어야 한다 — 정답지가 한 줄 밀리면 여기서 먼저 어긋난다. */
for (const secId of ['reading', 'listening']) {
  modulesOf(pack, secId).forEach((mod) => {
    const nos = questionsOfModule(mod).map((q) => q.no);
    check(mod.id + ' numbering', JSON.stringify(nos) === JSON.stringify(nos.map((_, i) => i + 1)),
      nos.join(','));
  });
}
check('reading module sizes', questionsOfModule(modulesOf(pack, 'reading')[0]).length === 35
  && questionsOfModule(modulesOf(pack, 'reading')[1]).length === 15,
  modulesOf(pack, 'reading').map((m) => questionsOfModule(m).length).join(','));

/* 듣기 — 소리가 붙지 않은 블록이 하나라도 있으면 학생 화면은 'Audio unavailable' 이 된다.
   SET 12 가 그렇게 나갈 뻔했다. */
const listening = modulesOf(pack, 'listening');
const missingAudio = [];
const badChoices = [];
listening.forEach((mod) => mod.blocks.forEach((b) => {
  const perQ = b.perQuestionAudio && b.questions.every((q) => q.script && q.audio);
  if (!b.script && !perQ) missingAudio.push(mod.id + ' ' + b.heading);
  b.questions.forEach((q) => { if ((q.choices || []).length !== 4) badChoices.push(q.id); });
}));
check('listening scripts attached', missingAudio.length === 0, missingAudio.join(' / '));
check('listening choices all four', badChoices.length === 0, badChoices.join(', '));
check('L1 opens with 12 per-question clips',
  !!listening[0].blocks.find((b) => b.heading === 'Questions 1-12' && b.perQuestionAudio && b.questions.length === 12), 'missing');
check('L2 Q12-15 is one transcript block',
  !!listening[1].blocks.find((b) => b.heading === 'Questions 12-15' && b.script && !b.perQuestionAudio), 'missing');

/* 듣기 화자 사진 — 없으면 듣기 화면만 그림 없이 뜬다(코드가 아니라 파일이 빠지는 결함이라
   시험장에서야 보인다). 배역표에서 나온 매핑이 팩에 실제로 붙었는지 본다. */
/* 사진은 배역표를 넘긴 빌드에만 붙는다 — 커밋되는 팩(strict)이 그쪽이므로 그쪽을 본다. */
const pictured = [];
modulesOf(strict.pack, 'listening').forEach((mod) => mod.blocks.forEach((b) => b.questions.forEach((q) => {
  if (q.image || b.image) pictured.push(q.id);
})));
check('listening speaker pictures attached', pictured.length >= 15, pictured.length + ' questions carry a picture');

const writing = modulesOf(pack, 'writing');
const builds = questionsOfModule(writing[0]);
check('writing build questions 1-10', builds.length === 10
  && builds[0].context === '1. Did the plumber give you any update on the repair?'
  && builds[9].context === '10. Are you going to the weekend flea market?', builds.map((q) => q.context).join(' | '));
check('build answers complete', builds.every((q) => q.slots.some((s) => s.t === 'b')
  && q.answerSentence && q.tiles && q.tiles.length), 'blank answer');

/* 빈칸마다 정답이 붙어 있어야 라이팅 1교시가 채점된다 — 자동채점도 성적표도 slots[].a 만 본다. */
const noKey = builds.filter((q) => q.slots.some((s) => s.t === 'b' && !s.a)).map((q) => q.id);
check('every blank carries its answer', noKey.length === 0, noKey.join(', '));

/* 조각을 이어 붙이면 정답 문장이 그대로 나와야 한다. 끝 부호는 두 문서가 다를 수 있어
   (set12-W1-q06: 문제지 '?' · 정답지 '.') 비교에서 뺀다 — 단어가 어긋나는 것만 잡는다. */
const rebuilt = builds.filter((q) => {
  const norm = (s) => s.replace(/\s+([,.;:!?])/g, '$1').replace(/[.?!]+$/, '').toLowerCase();
  const said = q.slots.map((s) => (s.t === 'b' ? s.a : s.text)).join(' ');
  return norm(said) !== norm(q.answerSentence);
}).map((q) => q.id);
check('slots rebuild the answer sentence', rebuilt.length === 0, rebuilt.join(', '));

check('tiles keep the phrases the docx wrote', builds[0].tiles.includes('would arrive')
  && builds[0].tiles.includes('the parts')
  && builds[0].tiles.includes('told me'), builds[0].tiles.join(' | '));

/* 함정 조각 — 어느 빈칸에도 들어가지 않는 것들. 문서에 있는 그대로 남아야 한다. */
check('trap tiles found', builds[1].trapTiles.join() === 'lend'
  && builds[3].trapTiles.join() === 'in Friday'
  && builds[5].trapTiles.join() === 'winner',
  builds.map((q) => (q.trapTiles || []).join('+')).join(' | '));

const email = questionsOfModule(writing[1])[0];
check('email source text exact', email.to === 'Dr. Wilson'
  && email.subject === 'Request for assistance'
  && email.bullets.length === 3
  && email.bullets[0] === 'Describe the concept you are trying to remember from a recent class.'
  && email.bullets[2] === 'Suggest a time when you could meet with her to discuss the concept in more detail.'
  && email.minWords === 80, JSON.stringify(email));

const discussion = questionsOfModule(writing[2])[0];
check('discussion source text exact', discussion.professor === 'Professor – Business Management'
  && discussion.posts.length === 2
  && discussion.posts[0].name === 'Brandon'
  && discussion.posts[1].name === 'Hailey'
  && discussion.minWords === 100, JSON.stringify(discussion));

const speaking = modulesOf(pack, 'speaking');
check('speaking counts', questionsOfModule(speaking[0]).length === 7
  && questionsOfModule(speaking[1]).length === 4, speaking.map((m) => questionsOfModule(m).length).join(','));

/* 커밋된 팩이 방금 지은 것과 같은가 — assets/set12.js 를 손으로 고치면 여기서 걸린다. */
const built = fs.readFileSync(path.join(SG2, 'assets/set12.js'), 'utf8');
check('assets/set12.js is the generated pack', built.includes('window.SMEAG_SET12 =')
  && built.includes('Generated by tools/build_set12.mjs'), 'hand-edited?');

const failed = checks.filter((c) => !c.ok);
checks.forEach((c) => console.log((c.ok ? 'PASS ' : 'FAIL ') + c.name + (c.detail ? ' — ' + c.detail : '')));
if (failed.length) process.exit(1);
