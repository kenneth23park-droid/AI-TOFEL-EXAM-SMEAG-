/* SMEAG StudyGround — SET 2 importer regression.
   SET 2 에서 새로 온 두 가지를 고정한다.
     1) 문장 만들기 빈칸이 '__' 글자가 아니라 밑줄 친 탭('_' 하나 + 밑줄 탭 포함)으로 그어져
        있다 — docx-read.js 의 textU 로 읽는다. 이걸 놓치면 10문항이 5문항이 되고 정답지가
        밀려 네 문항이 서로 안 맞는다(처음 가져왔을 때 실제로 그랬다).
     2) 세트는 부족해도 짓는다 — 성립하지 않는 문항(W1-q05: 밑줄 10칸, 타일 9개)은 세트에
        남되 unscored 로 점수에서 빠진다. */
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

const FOUND = findSourceDocsIn(sourceDirs(SG2), 2);

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
check('script doc found under its TEST name', FOUND.script === 'TEST 2 SCRIPT 2.docx', FOUND.script);

const out = IMPORT.build({ code: 'SET 2', questions, script, answers, strictSource: true });
const pack = out.pack;

check('section counts', out.stats.total === 122
  && out.stats.bySection.reading === 50
  && out.stats.bySection.listening === 49
  && out.stats.bySection.writing === 12
  && out.stats.bySection.speaking === 11, JSON.stringify(out.stats));

for (const secId of ['reading', 'listening']) {
  modulesOf(pack, secId).forEach((mod) => {
    const nos = questionsOfModule(mod).map((q) => q.no);
    check(mod.id + ' numbering', JSON.stringify(nos) === JSON.stringify(nos.map((_, i) => i + 1)), nos.join(','));
  });
}

/* 짧은 응답 — SET 2 대본은 안내 줄('Listen to a conversation.')을 머리글 **앞에** 적는다.
   그 줄을 앞 덩어리에 붙이면 1-12 문항 낭독이 대사로 오해돼 문항마다 음성이 생기지 않았다. */
const listening = modulesOf(pack, 'listening');
const shortBlock = (mod) => mod.blocks.find((b) => b.perQuestionAudio);
const l1s = shortBlock(listening[0]), l2s = shortBlock(listening[1]);
check('L1 Q1-12 get one clip each', l1s && l1s.questions.length === 12
  && l1s.questions.every((q, i) => q.audio === 'media/audio/set2/l1-q' + String(i + 1).padStart(2, '0') + '.mp3' && q.script)
  && !l1s.script, l1s && JSON.stringify(l1s.questions.map((q) => q.audio)));
check('L2 Q1-7 get one clip each', l2s && l2s.questions.length === 7 && l2s.questions.every((q) => q.audio && q.script),
  l2s && l2s.questions.length);
check('typed numbers are not read aloud', l1s.questions[8].script === "Have you decided which elective you're taking next semester?"
  && l2s.questions[0].script === 'Where can I find the recycling bins?', l1s.questions[8].script + ' / ' + l2s.questions[0].script);
check('the cue before a heading belongs to that heading',
  listening[0].blocks.find((b) => b.heading === 'Questions 13-14').instruction === 'Listen to a conversation.'
  && l1s.instruction !== 'Listen to a conversation.', l1s.instruction);

/* 1) 밑줄 빈칸 */
const builds = questionsOfModule(modulesOf(pack, 'writing')[0]);
check('writing build questions 1-10', builds.length === 10
  && builds[0].context === '1. The weather forecast says it might rain tomorrow.'
  && builds[1].context === '2. The library has extended hours during finals week.'
  && builds[9].context === '10. I noticed you have been bringing lunch from home more often lately.',
  builds.map((q) => q.context).join(' | '));
const blanksOf = (q) => q.slots.filter((s) => s.t === 'b').length;
check('underlined-tab blanks are read (q02: 2 + know + 5)', blanksOf(builds[1]) === 7
  && builds[1].slots.some((s) => s.t === 'f' && s.text === 'know'), JSON.stringify(builds[1].slots));
check('single "_" + underlined tab is one blank (q07: 2 + like + 7)', blanksOf(builds[6]) === 9,
  JSON.stringify(builds[6].slots));

/* 2) 성립하지 않는 문항은 남되 점수에서 빠진다 */
const unscored = builds.filter((q) => q.unscored).map((q) => q.id);
check('only W1-q05 is unscored', unscored.join() === 'set2-W1-q05', unscored.join());
check('unscored question keeps no answer to score against',
  builds[4].slots.every((s) => s.t !== 'b' || s.a === undefined) && pack.answerKey['set2-W1-q05'] === undefined);
check('report lists it', (pack.report.unscored || []).some((u) => u.id === 'set2-W1-q05'), JSON.stringify(pack.report));
const scored = builds.filter((q) => !q.unscored);
check('every scored blank carries its answer', scored.every((q) => q.slots.every((s) => s.t !== 'b' || s.a)),
  scored.filter((q) => q.slots.some((s) => s.t === 'b' && !s.a)).map((q) => q.id).join(', '));

const email = questionsOfModule(modulesOf(pack, 'writing')[1])[0];
check('email source text exact', email.to === 'Mr. Harris'
  && email.subject === 'Thank You for the Project Management Workshop' && email.bullets.length === 3, JSON.stringify(email));

const speaking = modulesOf(pack, 'speaking');
check('speaking counts', questionsOfModule(speaking[0]).length === 7
  && questionsOfModule(speaking[1]).length === 4, speaking.map((m) => questionsOfModule(m).length).join(','));

const built = fs.readFileSync(path.join(SG2, 'assets/set2.js'), 'utf8');
check('assets/set2.js is the generated pack', built.includes('window.SMEAG_SET2 =')
  && built.includes('Generated by tools/build_set2.mjs'), 'hand-edited?');

const failed = checks.filter((c) => !c.ok);
checks.forEach((c) => console.log((c.ok ? 'PASS ' : 'FAIL ') + c.name + (c.detail && !c.ok ? ' — ' + c.detail : '')));
if (failed.length) process.exit(1);
