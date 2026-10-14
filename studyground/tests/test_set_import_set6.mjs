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
const found = findSourceDocsIn(sourceDirs(SG2), 6);

async function read(name) {
  const b = fs.readFileSync(path.join(found.dir, name));
  return DOCX.read(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

const [questions, script, answers] = await Promise.all([
  read(found.questions), read(found.script), read(found.answers)
]);
const optional = (rel) => {
  const file = path.join(SG2, rel);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : undefined;
};
const out = IMPORT.build({
  code: 'SET 6', questions, script, answers, strictSource: true,
  listeningImages: optional('config/set6-listening-images.json'),
  discussionImages: optional('config/set6-writing-images.json')
});
assert.ok(out.pack, 'SET 6 pack must build');

const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(SG2, 'assets/set6.js'), 'utf8'), ctx);
const pack = JSON.parse(JSON.stringify(ctx.window.SMEAG_SET6));
const rebuilt = JSON.parse(JSON.stringify(out.pack));
rebuilt.importedAt = pack.importedAt;
rebuilt.summary.sources = pack.summary.sources;
assert.deepEqual(pack, rebuilt, 'committed pack must equal a fresh source rebuild');

const section = (id) => pack.sections.find((s) => s.id === id);
const flat = (s) => s.modules.flatMap((m) => m.blocks.flatMap((b) => b.questions || []));
const all = pack.sections.flatMap(flat);
const byId = Object.fromEntries(all.map((q) => [q.id, q]));

assert.equal(pack.code, 'SET6');
assert.deepEqual(Object.fromEntries(pack.sections.map((s) => [s.id, flat(s).length])), {
  reading: 35, listening: 35, writing: 12, speaking: 11
});
assert.equal(new Set(all.map((q) => q.id)).size, 93, 'question ids must be unique');

/* Source defect policy: both questions stay visible but cannot be scored because
   the DOCX has fewer blanks than the answer needs. The report must retain this fact. */
const unscored = all.filter((q) => q.unscored).map((q) => q.id).sort();
assert.deepEqual(unscored, ['set6-W1-q03', 'set6-W1-q05']);
const stops = out.gates.filter((g) => g.level === 'stop');
assert.equal(stops.length, 1);
assert.equal(stops[0].scope, 'writing');
assert.match(stops[0].message, /set6-W1-q03, set6-W1-q05/);

/* Reading: the first source marker is the superscript 1 character, and must not
   shift all ten answers. Every block with questions needs actual source content. */
assert.equal(byId['R1-1'].hint, 'a');
assert.equal(byId['R1-1'].answer, 'and');
assert.equal(byId['R1-10'].answer, 'commissioned');
assert.equal(byId['R1-11'].prompt, 'What is the notice mainly about?');
assert.equal(byId['R1-11'].answer, 1);
assert.equal(byId['R2-15'].answer, 1);
for (const mod of section('reading').modules) {
  for (const block of mod.blocks) {
    if (!(block.questions || []).length) continue;
    if (block.kind === 'cloze') {
      assert.ok(block.template, `${mod.id} cloze template`);
    } else if (block.kind === 'chat') {
      assert.ok((block.messages || []).length, `${mod.id} chat messages`);
    } else {
      assert.ok(block.passage || (block.paragraphs || []).length || (block.images || []).length,
        `${mod.id} ${block.heading} passage content`);
    }
  }
}

/* Listening: the first L2 instruction is printed after four choices in the DOCX.
   It must remain an instruction, not become choice D, and each prompt gets its own audio. */
const l2First = section('listening').modules[1].blocks[0];
assert.equal(l2First.perQuestionAudio, true);
assert.match(l2First.instruction, /select the best response/i);
assert.deepEqual(byId['L2-1'].choices, [
  'My phone battery died.',
  'I dressed warmly today.',
  'The event was well organized.',
  'Business casual, I think.'
]);
assert.equal(byId['L2-1'].script, 'What’s the dress code for the event?');
assert.equal(byId['L2-1'].answer, 3);
assert.equal(byId['L2-7'].script, 'We’re still on for Friday, aren’t we?');
for (const mod of section('listening').modules) {
  for (const block of mod.blocks) {
    if (block.perQuestionAudio) {
      assert.ok(block.questions.every((q) => q.script && q.audio), `${mod.id} per-question scripts`);
    } else {
      assert.ok(block.script && block.audio, `${mod.id} ${block.heading} block script`);
    }
  }
}

const audio = new Set();
for (const s of pack.sections) for (const m of s.modules) for (const b of m.blocks) {
  if (m.introAudio) audio.add(m.introAudio);
  if (b.introAudio) audio.add(b.introAudio);
  if (b.audio) audio.add(b.audio);
  for (const q of b.questions || []) if (q.audio) audio.add(q.audio);
}
assert.equal(audio.size, 37, 'all audio references must be unique');

/* Writing contracts used by rendering, review, and autoscore. */
const builds = flat(section('writing')).filter((q) => q.kind === 'build');
assert.equal(builds.length, 10);
for (const q of builds.filter((q) => !q.unscored)) {
  const blanks = q.slots.filter((s) => s.t === 'b');
  assert.ok(blanks.every((s) => s.a));
  assert.deepEqual(q.answerTokens, blanks.map((s) => s.a));
  assert.equal(q.sentence, q.answerSentence);
}
assert.deepEqual(byId['set6-W1-q01'].answerTokens,
  ['asked', 'if', 'we', 'wanted', 'to keep', 'the original', 'flooring']);
assert.equal(byId['set6-W1-q10'].slots[0].t, 'b', 'printed "10." is numbering, not sentence text');

const email = byId['set6-W2-email'];
assert.equal(email.to, 'Dr. Mitchell');
assert.equal(email.subject, 'Request for Deadline Extension');
assert.match(email.situation, /family emergency/);
assert.deepEqual(email.bullets, [
  'Ask for an extension on the deadline for your research paper.',
  'Provide details about the challenges you have encountered that prevented you from completing the paper on time.',
  'Suggest a new deadline and offer to provide updates on your progress.'
]);
assert.equal(email.prompt, [email.situation].concat(email.bullets).join(' '));
assert.equal(email.minWords, 80);

const discussion = byId['set6-W3-disc'];
assert.equal(discussion.professor, 'Professor Roberts- Psychology');
assert.deepEqual(discussion.posts.map((p) => p.name), ['Megan', 'Alex']);
assert.match(discussion.posts[0].text, /mental and emotional strain than before\.$/);
assert.match(discussion.posts[1].text, /actually worse now\.$/);
assert.equal(discussion.minWords, 100);

const speaking = section('speaking').modules.map((m) => flat({ modules: [m] }));
assert.deepEqual(speaking.map((qs) => qs.length), [7, 4]);
assert.ok(speaking.flat().every((q) => q.script && q.audio));
assert.equal(speaking[1][3].script,
  'Good points. Lastly, do you think schools should teach young people how to manage money and make smart spending decisions?');

assert.equal(pack.summary.pictures, 16);
const pictureRefs = new Set();
for (const s of pack.sections) for (const m of s.modules) for (const b of m.blocks) {
  for (const ref of b.images || []) pictureRefs.add(ref);
  for (const q of b.questions || []) if (q.image) pictureRefs.add(q.image);
}
for (const ref of pictureRefs) assert.ok(fs.existsSync(path.join(SG2, ref)), `missing picture ${ref}`);

console.log('PASS SET 6: reproducible 93-question pack, exact source mapping, 37 audio references, complete writing cards, and two documented unscored source defects.');
