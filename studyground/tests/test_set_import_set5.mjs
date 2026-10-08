import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { sourceDirs, findSourceDocsIn } from '../sg2/tools/source_docs.mjs';

const require = createRequire(import.meta.url);
const SG2 = fileURLToPath(new URL('../sg2/', import.meta.url));
const DOCX = require('../sg2/assets/docx-read.js');
const IMPORT = require('../sg2/assets/set-import.js');
const found = findSourceDocsIn(sourceDirs(SG2), 5);
async function read(name) {
  const b = fs.readFileSync(path.join(found.dir, name));
  return DOCX.read(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}
const [questions, script, answers] = await Promise.all([
  read(found.questions), read(found.script), read(found.answers)
]);
const optional = (p) => {
  const f = path.join(SG2, p);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : undefined;
};
const out = IMPORT.build({ code: 'SET 5', questions, script, answers, strictSource: true,
  listeningImages: optional('config/set5-listening-images.json'),
  discussionImages: optional('config/set5-writing-images.json') });
assert.ok(out.pack);
assert.deepEqual(out.gates.filter(g => g.level === 'stop'), [], 'strict source gates');
const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(SG2, 'assets/set5.js'), 'utf8'), ctx);
const pack = JSON.parse(JSON.stringify(ctx.window.SMEAG_SET5));
const built = JSON.parse(JSON.stringify(out.pack));
built.importedAt = pack.importedAt;
built.summary.sources = pack.summary.sources;
assert.deepEqual(pack, built, 'committed pack must equal source rebuild');
const flat = s => s.modules.flatMap(m => m.blocks.flatMap(b => b.questions || []));
const sections = Object.fromEntries(pack.sections.map(s => [s.id, s]));
const all = pack.sections.flatMap(flat);
const byId = Object.fromEntries(all.map(q => [q.id, q]));
assert.equal(pack.code, 'SET5');
assert.deepEqual(Object.fromEntries(pack.sections.map(s => [s.id, flat(s).length])), {
  reading: 35, listening: 35, writing: 12, speaking: 11
});
assert.equal(all.filter(q => q.unscored).length, 0);
assert.equal(new Set(all.map(q => q.id)).size, 93);
assert.equal(byId['R1-1'].answer, 'moving');
assert.equal(byId['R2-10'].answer, 'warnings');
assert.equal(byId['R2-14'].answer, 1);
assert.equal(byId['R2-14'].kind, 'insert');
assert.equal(byId['L1-1'].answer, 3);
assert.equal(byId['L2-5'].answer, 2);
const l2 = sections.listening.modules[1].blocks;
assert.equal(byId['L2-1'].script, 'That’s a lot of luggage for a weekend trip, isn’t it?');
assert.equal(byId['L2-2'].script, 'The Wi-Fi password doesn’t seem to be working?');
assert.equal(byId['L2-3'].script, 'The shipment was supposed to arrive yesterday.');
const starts = [
  'Man: Professor Adams, I wanted to update you on my dissertation progress.',
  'Man: Did you see the email about the leadership conference next week?',
  'Alright, today I want to compare two different strategies animals use',
  'OK, so let’s talk about something you encounter every day'
];
l2.filter(b => b.script).forEach((b, i) => {
  assert.ok(b.script.startsWith(starts[i]), b.heading + ' script mapping');
});
assert.equal(l2.filter(b => b.script).length, 4);
const grouped = IMPORT._parseScript([{text:'Listening'}, {text:'Module 2'},
  {text:'Question1-3'}, {text:'First?'}, {text:'Second?'}, {text:'Third?'},
  {text:'Question 4-5'}, {text:'Man: Conversation.'}]);
assert.equal(grouped.listening[0].from, 1);
assert.equal(grouped.listening[0].lines.length, 3);
assert.equal(grouped.listening[1].from, 4);
const builds = flat(sections.writing).filter(q => q.kind === 'build');
for (const q of builds) {
  assert.ok(q.sentence && q.answerTokens.length);
  assert.ok(q.slots.every(s => s.t !== 'b' || s.a));
}
assert.equal(builds[0].slots.filter(s => s.t === 'b').length, 7);
assert.equal(builds[3].slots.filter(s => s.t === 'b').length, 10);
assert.equal(builds[9].slots.filter(s => s.t === 'b').length, 6);
assert.ok(builds[9].tiles.includes('to'));
const discussion = flat(sections.writing).find(q => q.kind === 'discussion');
for (const p of [discussion.professorImage, ...discussion.posts.map(p => p.image)]) {
  assert.ok(p && fs.existsSync(path.join(SG2, p)), 'discussion portrait: ' + p);
}
const speaking = flat(sections.speaking);
assert.equal(speaking.filter(q => q.kind === 'repeat').length, 7);
assert.equal(speaking.filter(q => q.kind === 'interview').length, 4);
const audio = new Set();
for (const s of pack.sections) for (const m of s.modules) for (const b of m.blocks) {
  if (m.introAudio) audio.add(m.introAudio);
  if (b.introAudio) audio.add(b.introAudio);
  if (b.audio) audio.add(b.audio);
  for (const q of b.questions || []) if (q.audio) audio.add(q.audio);
}
assert.equal(audio.size, 33);
const voices = optional('tts-voices-set5exam-11labs.json');
if (voices) {
  assert.equal(voices.items.length, 33);
  assert.deepEqual(new Set(voices.items.map(i => i.out)), audio);
  const spoken = {};
  for (const s of pack.sections) for (const m of s.modules) for (const b of m.blocks) {
    if (b.introAudio) spoken[b.introAudio] = b.instruction;
    if (b.audio) spoken[b.audio] = b.script;
    for (const q of b.questions || []) if (q.audio) spoken[q.audio] = q.script;
  }
  const normalize = t => String(t || '').replace(/^Instructions?:\s*/i, '')
    .replace(/^(?:Man|Woman):\s*/gm, '').replace(/\s+/g, ' ').trim();
  for (const job of voices.items) {
    assert.equal(normalize(job.segments.map(s => s.text).join(' ')),
      normalize(spoken[job.out]), job.id + ' cast must speak exact pack script');
  }
}
/* 2026-10-08: SET 5 is rendered with ElevenLabs again. The cast manifest is active;
   Speaking 1 is re-voiced by its own manifest (a livelier trainer), which sorts later
   in tts_multivoice's union and so owns those eight files. Kokoro stays as reference. */
const trainer = optional('tts-voices-set5s1-11labs.json');
if (trainer) {
  assert.equal(trainer.active, true);
  assert.equal(voices.active, true, 'ElevenLabs cast renders SET 5');
  const cast = Object.fromEntries(voices.items.map(i => [i.id, i]));
  assert.equal(trainer.items.length, 8);
  for (const job of trainer.items) {
    assert.match(job.id, /^set5-s1-/);
    assert.equal(job.out, cast[job.id].out);
    assert.deepEqual(job.segments.map(s => s.text), cast[job.id].segments.map(s => s.text),
      job.id + ' trainer must speak the cast script');
  }
}
const localVoices = optional('tts-voices-set5exam-kokoro.json');
if (localVoices && localVoices.active !== false) {
  assert.equal(localVoices.provider, 'kokoro-onnx');
  assert.equal(voices.active, false, 'Only the rendered provider should be active');
  assert.equal(localVoices.items.length, 33);
  assert.deepEqual(new Set(localVoices.items.map(i => i.out)), audio);
  const reference = Object.fromEntries(voices.items.map(i => [i.id, i]));
  const generated = optional('tts-voices-set5exam-kokoro.generated.json');
  for (const job of localVoices.items) {
    assert.deepEqual(job.segments.map(s => s.text), reference[job.id].segments.map(s => s.text),
      job.id + ' local speech must preserve every original turn');
    assert.ok(fs.existsSync(path.join(SG2, job.out)), job.id + ' audio file missing');
    assert.equal(generated[job.id].file, job.out);
    assert.equal(generated[job.id].speed, job.speed, job.id + ' rendered pace mismatch');
    assert.deepEqual(generated[job.id].voices, [...new Set(job.segments.map(s => s.voice))]);
  }
  assert.equal(fs.readdirSync(path.join(SG2, 'media/audio/set5')).filter(f => f.endsWith('.mp3')).length, 33);
}
console.log('PASS SET 5: source rebuild equality, 93 questions, zero stops/unscored, exact L2 script mapping, corrected W1 tiles, and 33 audio references.');
