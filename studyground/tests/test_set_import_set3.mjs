import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../sg2/', import.meta.url);
const sg2 = new URL(root).pathname;
const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(new URL('assets/set3.js', root), 'utf8'), ctx);
const pack = ctx.window.SMEAG_SET3;
const questions = (sec) => sec.modules.flatMap((m) => m.blocks.flatMap((b) => b.questions || []));
const sections = Object.fromEntries(pack.sections.map((s) => [s.id, s]));

assert.equal(pack.code, 'SET3');
assert.deepEqual(Object.fromEntries(pack.sections.map((s) => [s.id, questions(s).length])), {
  reading: 35, listening: 35, writing: 12, speaking: 11
});
assert.equal(pack.sections.flatMap(questions).length, 93);

const reading = questions(sections.reading);
assert.equal(reading.filter((q) => q.kind === 'insert').length, 1);
assert.ok(reading.find((q) => q.kind === 'insert').sentence);
for (const b of sections.reading.modules.flatMap((m) => m.blocks)) {
  if (b.kind === 'passage') assert.ok((b.paragraphs || []).length || (b.images || []).length);
  if (b.kind === 'chat') assert.ok((b.messages || []).length);
}

const listening = questions(sections.listening);
const listeningBlocks = sections.listening.modules.flatMap((m) => m.blocks);
const listeningAudio = listeningBlocks.flatMap((b) => [b.audio, ...(b.questions || []).map((q) => q.audio)]).filter(Boolean);
assert.equal(new Set(listeningAudio).size, 20);
assert.equal(listening.length, 35);
assert.ok(listening.some((q) => q.script));

const builds = questions(sections.writing).filter((q) => q.kind === 'build');
assert.equal(builds.length, 10);
assert.equal(builds.filter((q) => q.unscored).length, 1);
for (const q of builds.filter((q) => !q.unscored)) {
  assert.ok(q.sentence && q.answerTokens?.length);
  assert.ok(q.slots.every((s) => s.t !== 'b' || s.a));
}
assert.ok(questions(sections.writing).some((q) => q.kind === 'email'));
assert.ok(questions(sections.writing).some((q) => q.kind === 'discussion'));
assert.equal(questions(sections.speaking).length, 11);

const audioDir = new URL('media/audio/set3/', root);
const audio = fs.readdirSync(audioDir).filter((f) => f.endsWith('.mp3'));
assert.equal(audio.length, 33);
console.log('PASS SET 3: 93 questions, 33 audio files, reading insertion, writing contracts, and speaking coverage.');
