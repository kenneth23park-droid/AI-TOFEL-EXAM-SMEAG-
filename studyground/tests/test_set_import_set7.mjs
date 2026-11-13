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
const found = findSourceDocsIn(sourceDirs(SG2), 7);

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
  code: 'SET 7', questions, script, answers, strictSource: true,
  readingChats: optional('config/set7-reading-chat.json'),
  listeningImages: optional('config/set7-listening-images.json'),
  discussionImages: optional('config/set7-writing-images.json')
});
assert.ok(out.pack, 'SET 7 pack must build');

const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(SG2, 'assets/set7.js'), 'utf8'), ctx);
const pack = JSON.parse(JSON.stringify(ctx.window.SMEAG_SET7));
const rebuilt = JSON.parse(JSON.stringify(out.pack));
rebuilt.importedAt = pack.importedAt;
rebuilt.summary.sources = pack.summary.sources;
assert.deepEqual(pack, rebuilt, 'committed pack must equal a fresh source rebuild');

const section = (id) => pack.sections.find((s) => s.id === id);
const flat = (s) => s.modules.flatMap((m) => m.blocks.flatMap((b) => b.questions || []));
const all = pack.sections.flatMap(flat);
const byId = Object.fromEntries(all.map((q) => [q.id, q]));

assert.equal(pack.code, 'SET7');
assert.deepEqual(Object.fromEntries(pack.sections.map((s) => [s.id, flat(s).length])), {
  reading: 35, listening: 35, writing: 12, speaking: 11
});
assert.equal(new Set(all.map((q) => q.id)).size, 93, 'question ids must be unique');

/* The repo copy of the question DOCX was corrected (2026-11-13) so every question
   cross-checks: W1 Q6 blank row was split over two paragraphs, Q4/Q10 rows lacked the
   end mark, Q7 had one blank too many. Nothing may be unscored and no gate may stop. */
assert.deepEqual(all.filter((q) => q.unscored).map((q) => q.id), []);
assert.deepEqual(out.gates.filter((g) => g.level === 'stop'), []);

/* Answer key, full sweep — matches NEW TOEFL SET 7 ANSWER KEY. */
const L = (s) => [...s].map((c) => 'ABCD'.indexOf(c));
const expect = {
  R1: ['unified', 'nomadic', 'highly', 'military', 'organization', 'conquered', 'territories', 'established', 'routes', 'that',
    ...L('BABADBBCCA')],
  R2: ['the', 'condenses', 'called', 'indicate', 'various', 'can', 'upcoming', 'typically', 'while', 'thunderstorms',
    ...L('DCACB')],
  L1: L('DDBAACCABCBBBDBCDACB'),
  L2: L('ABABDCBDCABABAC')
};
for (const [mod, list] of Object.entries(expect)) {
  list.forEach((a, k) => assert.equal(byId[mod + '-' + (k + 1)].answer, a, `${mod}-${k + 1}`));
}

/* Reading: text message chain renders as bubbles, insert question keeps its sentence. */
const chat = section('reading').modules[0].blocks[1];
assert.equal(chat.kind, 'chat');
assert.equal(chat.title, 'Text Message Chain');
assert.deepEqual(chat.messages.map((m) => m.name),
  ['Professor Adams', 'Yuki Tanaka', 'Kevin Martinez', 'Yuki Tanaka', 'Amara Diallo', 'Yuki Tanaka']);
assert.equal(byId['R1-20'].kind, 'insert');
assert.match(byId['R1-20'].sentence, /replicated across numerous studies/);
for (const mod of section('reading').modules) {
  for (const block of mod.blocks) {
    if (!(block.questions || []).length) continue;
    if (block.kind === 'cloze') assert.ok(block.template, `${mod.id} cloze template`);
    else if (block.kind === 'chat') assert.ok((block.messages || []).length, `${mod.id} chat messages`);
    else assert.ok(block.passage || (block.paragraphs || []).length, `${mod.id} ${block.heading} passage content`);
  }
}

/* Listening: per-question scripts for short responses, block scripts elsewhere. */
assert.equal(byId['L1-1'].script, 'When does the dry cleaner close?');
assert.equal(byId['L2-3'].script, 'You’re presenting first, aren’t you?');
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
assert.equal(audio.size, 33, 'all audio references must be unique');

/* Writing contracts used by rendering, review, and autoscore. */
const builds = flat(section('writing')).filter((q) => q.kind === 'build');
assert.equal(builds.length, 10);
for (const q of builds) {
  const blanks = q.slots.filter((s) => s.t === 'b');
  assert.ok(blanks.every((s) => s.a), q.id);
  assert.deepEqual(q.answerTokens, blanks.map((s) => s.a));
  assert.equal(q.sentence, q.answerSentence);
  assert.doesNotMatch(q.context, /^\d+\./, `${q.id} context carries no printed number`);
}
assert.deepEqual(byId['set7-W1-q06'].answerTokens,
  ['she', 'impressed', 'with', 'the projects', 'that', 'she', 'had led']);
assert.deepEqual(byId['set7-W1-q07'].trapTiles, ['learning']);

const email = byId['set7-W2-email'];
assert.equal(email.to, 'Parks Department Director');
assert.equal(email.subject, 'Concern About Park Maintenance');
assert.match(email.situation, /benches are broken/);
assert.equal(email.bullets.length, 3);
assert.equal(email.minWords, 80);

const discussion = byId['set7-W3-disc'];
assert.equal(discussion.professor, 'Professor Nelson – Communication Studies');
assert.match(discussion.prompt, /does social media cause more harm than good\?$/);
assert.deepEqual(discussion.posts.map((p) => p.name), ['Tina', 'Rick']);
assert.match(discussion.posts[0].text, /credible and unreliable sources\.$/);
assert.match(discussion.posts[1].text, /crucial for public safety\.$/);

const speaking = section('speaking').modules.map((m) => flat({ modules: [m] }));
assert.deepEqual(speaking.map((qs) => qs.length), [7, 4]);
assert.ok(speaking.flat().every((q) => q.script && q.audio));

const pictureRefs = new Set();
for (const s of pack.sections) for (const m of s.modules) for (const b of m.blocks) {
  for (const ref of b.images || []) pictureRefs.add(ref);
  for (const q of b.questions || []) if (q.image) pictureRefs.add(q.image);
}
for (const ref of pictureRefs) {
  if (/^media\/pictures\//.test(ref)) assert.ok(fs.existsSync(path.join(SG2, ref)), `missing picture ${ref}`);
}

console.log('PASS SET 7: reproducible 93-question pack, full answer-key sweep, chat bubbles, 33 audio references, complete writing cards.');
