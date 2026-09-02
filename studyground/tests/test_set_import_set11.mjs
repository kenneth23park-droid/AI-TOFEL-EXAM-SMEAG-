/* SMEAG StudyGround — SET 11 importer regression. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const REPO = path.dirname(path.dirname(ROOT));
const SOURCE_ROOT = path.join(REPO, 'kenneth-brain/smeag-TOFEL 자료');
const SG2 = path.join(ROOT, 'sg2');

const DOCX = require(path.join(SG2, 'assets/docx-read.js'));
const IMPORT = require(path.join(SG2, 'assets/set-import.js'));

const SOURCES = {
  questions: 'NEW TOEFL SET 11.docx',
  script: 'SET 11 SCRIPT.docx',
  answers: 'SET 11 ANWER KEY.docx'
};

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
  const b = fs.readFileSync(path.join(SOURCE_ROOT, name));
  return DOCX.read(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

const [questions, script, answers] = await Promise.all([
  readDocx(SOURCES.questions), readDocx(SOURCES.script), readDocx(SOURCES.answers)
]);
const result = IMPORT.build({ code: 'SET 11', questions, script, answers });
const pack = result.pack;

check('no stop gates', result.gates.filter((g) => g.level === 'stop').length === 0,
  result.gates.map((g) => g.level + ' ' + g.scope + ' ' + g.message).join('\n'));

/* 시험에 실제로 나갈 팩은 strict source mode 로 지어진다 — 관리자 화면도, tools/build_set11.mjs
   도 그 잣대다. 느슨한 모드만 확인하면 "테스트는 초록인데 저장은 막히는" 세트가 나온다. */
const strict = IMPORT.build({ code: 'SET 11', questions, script, answers, strictSource: true });
check('strict source build has no stops', strict.gates.filter((g) => g.level === 'stop').length === 0,
  strict.gates.filter((g) => g.level === 'stop').map((g) => g.scope + ' ' + g.message).join('\n  '));
check('section counts', result.stats.total === 120
  && result.stats.bySection.reading === 50
  && result.stats.bySection.listening === 47
  && result.stats.bySection.writing === 12
  && result.stats.bySection.speaking === 11, JSON.stringify(result.stats));

for (const secId of ['reading', 'listening']) {
  modulesOf(pack, secId).forEach((mod) => {
    const nos = questionsOfModule(mod).map((q) => q.no);
    check(mod.id + ' numbering', JSON.stringify(nos) === JSON.stringify(nos.map((_, i) => i + 1)),
      nos.join(','));
  });
}

const r1 = modulesOf(pack, 'reading').find((m) => m.id === 'R1');
const r1q = questionsOfModule(r1);
const q30 = r1q.find((q) => q.id === 'R1-30');
const q35 = r1q.find((q) => q.id === 'R1-35');
check('R1-30 insertion sentence exact', q30 && q30.sentence === '“This task, however, involves overcoming several distinct obstacles”', q30 && q30.sentence);
check('R1-35 insertion sentence exact', q35 && q35.sentence === '“These include road traffic, rail systems, construction sites, and industrial machinery”', q35 && q35.sentence);
check('R1-34 click sentence preserved', !!r1q.find((q) => q.id === 'R1-34' && q.prompt.startsWith('Click on the sentence')), 'missing');

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
check('SET11 L2 Q8-11 is one transcript block',
  !!listening[1].blocks.find((b) => b.heading === 'Questions 8-11' && b.script && !b.perQuestionAudio), 'missing');

const writing = modulesOf(pack, 'writing');
const builds = questionsOfModule(writing[0]);
check('writing build questions 1-10', builds.length === 10
  && builds[6].context === '7. What was the email from the registrar about?'
  && builds[9].context === '10. Who helped you move all those boxes?', builds.map((q) => q.context).join(' | '));
check('build answers complete', builds.every((q) => q.slots.some((s) => s.t === 'b')
  && q.answerSentence && q.tiles && q.tiles.length), 'blank answer');

/* 빈칸마다 정답이 붙어 있어야 라이팅 1교시가 채점된다 — 자동채점도 성적표도 slots[].a 만 본다.
   그리고 조각은 문서에 적힌 그대로여야 한다: 'wanted to know' 가 낱말 셋으로 쪼개지면
   빈칸 수와 조각 수가 어긋나 학생이 문장을 완성할 수 없다. */
const noKey = builds.filter((q) => q.slots.some((s) => s.t === 'b' && !s.a)).map((q) => q.id);
check('every blank carries its answer', noKey.length === 0, noKey.join(', '));

const rebuilt = builds.filter((q) => {
  const said = q.slots.map((s) => (s.t === 'b' ? s.a : s.text)).join(' ').replace(/\s+([,.;:!?])/g, '$1');
  const want = q.answerSentence.replace(/\s+([,.;:!?])/g, '$1');
  return said.toLowerCase() !== want.toLowerCase();
}).map((q) => q.id);
check('slots rebuild the answer sentence', rebuilt.length === 0, rebuilt.join(', '));

check('tiles keep the phrases the docx wrote', builds[0].tiles.includes('wanted to know')
  && builds[0].tiles.includes('two courses')
  && builds[3].tiles.includes('the last chapter')
  && builds[8].tiles.includes('my study group'), builds[0].tiles.join(' | '));

/* 함정 조각 — 어느 빈칸에도 들어가지 않는 것들. 문서에 있는 그대로 남아야 한다. */
check('trap tiles found', builds[1].trapTiles.join() === 'ready'
  && builds[3].trapTiles.join() === 'questions'
  && builds[5].trapTiles.join() === 'sampled'
  && builds[7].trapTiles.join() === 'menu'
  && builds[9].trapTiles.join() === 'nearby',
  builds.map((q) => (q.trapTiles || []).join('+')).join(' | '));

const email = questionsOfModule(writing[1])[0];
check('email source text exact', email.to === 'Customer Service Manager'
  && email.subject === 'Feedback on Recent Group Stay'
  && email.situation.includes('amember of a book club')
  && email.bullets[0] === 'Describe what you and your club members enjoyed about staying at the hotel.'
  && email.bullets[1] === 'Explain a problem you experienced during you stay and how it affected you group.'
  && email.bullets[2] === 'Suggest what the hotel could do to address the issue for future guests.'
  && email.minWords === 80, JSON.stringify(email));

const discussion = questionsOfModule(writing[2])[0];
check('discussion source text exact', discussion.professor === 'Professor Green – Sustainability'
  && discussion.posts.length === 2
  && discussion.posts[0].name === 'John'
  && discussion.posts[1].name === 'Amy'
  && discussion.minWords === 100, JSON.stringify(discussion));

const speaking = modulesOf(pack, 'speaking');
check('speaking counts', questionsOfModule(speaking[0]).length === 7
  && questionsOfModule(speaking[1]).length === 4, speaking.map((m) => questionsOfModule(m).length).join(','));

const failed = checks.filter((c) => !c.ok);
checks.forEach((c) => console.log((c.ok ? 'PASS ' : 'FAIL ') + c.name + (c.detail ? ' — ' + c.detail : '')));
if (failed.length) process.exit(1);
