import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = new URL('../sg2/', import.meta.url);
const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(new URL('assets/set4.js', root), 'utf8'), ctx);
const pack = ctx.window.SMEAG_SET4;
const questions = (sec) => sec.modules.flatMap((m) => m.blocks.flatMap((b) => b.questions || []));
const sections = Object.fromEntries(pack.sections.map((s) => [s.id, s]));
const all = pack.sections.flatMap(questions);
const byId = Object.fromEntries(all.map((q) => [q.id, q]));

assert.equal(pack.code, 'SET4');
assert.deepEqual(Object.fromEntries(pack.sections.map((s) => [s.id, questions(s).length])), {
  reading: 35, listening: 35, writing: 12, speaking: 11
});
assert.equal(all.length, 93);
assert.equal(all.filter((q) => q.unscored).length, 0);

/* SET 4 정답지는 한 줄에 번호까지 적는다('11. A' · '1. blood'). 번호가 정답에 남으면
   빈칸은 학생이 맞게 써도 틀리고, 객관식은 보기와 맞지 않아 통째로 채점에서 빠진다. */
for (const q of all) {
  if (typeof q.answer === 'string') assert.doesNotMatch(q.answer, /^\d{1,3}\s*[.)]/, q.id + ' answer keeps its number');
}
assert.equal(byId['R1-1'].answer, 'blood');
assert.equal(byId['R2-10'].answer, 'populations');
assert.equal(byId['R1-11'].answer, 0);   /* '11. A' */
assert.equal(byId['L1-1'].answer, 1);    /* '1. B' */

const reading = questions(sections.reading);
for (const b of sections.reading.modules.flatMap((m) => m.blocks)) {
  if (b.kind === 'passage') assert.ok((b.paragraphs || []).length || (b.images || []).length);
  if (b.kind === 'chat') assert.ok((b.messages || []).length);
}
assert.equal(reading.filter((q) => q.kind === 'blank').length, 20);

/* R1 13-15 는 문자 대화다. 원본은 말풍선마다 떠 있는 글상자라 문서 순서대로 읽으면
   이름·시각이 먼저 몰려 나오고 아바타 머리글자 'R' · 'H' 가 지문 한 줄이 됐다.
   순서는 config/set4-reading-chat.json 이 주고, 글은 원본 그대로다. */
const chat = sections.reading.modules[0].blocks.find((b) => b.questions?.[0]?.id === 'R1-13');
assert.equal(chat.kind, 'chat');
assert.equal(chat.paragraphs, undefined);
assert.deepEqual([...chat.messages.map((m) => m.name + ' ' + m.time)], [
  'Rebecca Chen 9:15 A.M.', 'Derek Simmons 9:18 A.M.', 'Hannah Moreno 9:22 A.M.', 'Rebecca Chen 9:25 A.M.',
  'Derek Simmons 9:28 A.M.', 'Rebecca Chen 9:32 A.M.', 'Hannah Moreno 9:22 A.M.'
]);
assert.match(chat.messages[0].text, /^Morning, everyone\./);
assert.deepEqual([...chat.messages.map((m) => m.side === 'right')], [false, true, false, false, true, false, false]);
assert.deepEqual([...chat.questions.map((q) => q.id)], ['R1-13', 'R1-14', 'R1-15']);

const listening = questions(sections.listening);
const listeningBlocks = sections.listening.modules.flatMap((m) => m.blocks);
const listeningAudio = listeningBlocks.flatMap((b) => [b.audio, ...(b.questions || []).map((q) => q.audio)]).filter(Boolean);
assert.equal(new Set(listeningAudio).size, 20);
assert.equal(listening.length, 35);
assert.ok(listening.some((q) => q.script));
/* 대본 문서 맨 위의 제목 줄('New TOEFL Set 4 Audio Script')은 대사가 아니다. 대사로 받으면
   모든 대화·강의 블록의 대본이 그 제목 한 줄로 바뀐다. */
for (const b of listeningBlocks.filter((b) => b.audio)) {
  assert.doesNotMatch(String(b.script || ''), /audio script/i, b.heading + ' script is the document title');
  assert.ok(String(b.script || '').length > 80, b.heading + ' script is empty');
}

/* 원본은 화자를 'W   How's…' 로 적는다(콜론 없음). 교정본대로 'Man:' · 'Woman:' 로 바꿔 싣고,
   줄바꿈으로 끊긴 대사('heads to confirm…')는 앞 대사에 잇는다. */
const PLAN = require('../sg2/assets/tts-plan.js');
const convScript = listeningBlocks.find((b) => b.heading === 'Questions 9-10').script;
assert.match(convScript, /^Woman: How’s the quarterly budget report/);
assert.match(convScript, /department heads to confirm/);
for (const b of listeningBlocks.filter((b) => /^(Man|Woman):/.test(b.script || ''))) {
  for (const line of b.script.split('\n')) assert.match(line, /^(Man|Woman): \S/, b.heading + ' line without a speaker');
}
const conv = PLAN.parseScript(convScript);
assert.deepEqual([...new Set(conv.map((l) => l.speaker))].sort(), ['Man', 'Woman']);
assert.doesNotMatch(conv[0].text, /^W\s/);
const voices = JSON.parse(fs.readFileSync(new URL('tts-voices-set4exam-11labs.json', root), 'utf8'));
assert.equal(voices.items.filter((i) => i.kind === 'conversation').length, 4);

/* 라이팅 정답 앞의 'Build a sentence' · 'Question 1-10' 두 줄은 정답이 아니다.
   답으로 읽으면 열 문항이 두 칸씩 밀려 전부 채점에서 빠진다. */
const builds = questions(sections.writing).filter((q) => q.kind === 'build');
assert.equal(builds.length, 10);
assert.equal(builds[0].sentence, 'The instructor showed us how to use natural light effectively.');
for (const q of builds) {
  assert.ok(q.sentence && q.answerTokens?.length);
  assert.ok(q.slots.every((s) => s.t !== 'b' || s.a));
}
assert.ok(questions(sections.writing).some((q) => q.kind === 'email'));
const disc = questions(sections.writing).find((q) => q.kind === 'discussion');
assert.ok(disc);
for (const p of [disc.professorImage, ...disc.posts.map((x) => x.image)]) {
  assert.ok(p && fs.existsSync(new URL(p, root)), 'discussion photo missing: ' + p);
}
assert.equal(questions(sections.speaking).length, 11);

const IMPORT = require('../sg2/assets/set-import.js');
const key = IMPORT._parseAnswerKey(['WRITING SECTION', 'Build a sentence', 'Question 1-10', '1. Do you know who she invited?']
  .map((text) => ({ text })));
assert.deepEqual(key.writing[1], ['Do you know who she invited?']);

const audioDir = new URL('media/audio/set4/', root);
const audio = fs.readdirSync(audioDir).filter((f) => f.endsWith('.mp3'));
assert.equal(audio.length, 33);
console.log('PASS SET 4: 93 questions, numbered answer key read, 33 audio files, writing contracts, and speaking coverage.');
