import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { writeSetReport } from '../sg2/tools/set_report.mjs';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'smeag-set-report-audio-'));
const sg2 = path.join(temp, 'sg2');
const audio = path.join(sg2, 'media/audio/set5');
fs.mkdirSync(audio, { recursive: true });
fs.mkdirSync(path.join(sg2, 'config'));
const job = { id: 'set5-l1-q01', out: 'media/audio/set5/l1-q01.mp3' };
const file = path.join(sg2, job.out);
fs.writeFileSync(file, 'current audio');
const hash = () => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const save = (name, data) => fs.writeFileSync(path.join(sg2, name), JSON.stringify(data));
save('tts-voices-set5exam-11labs.json', { active: false, items: [job] });
save('tts-voices-set5exam-kokoro.json', { active: true, items: [job] });
save('config/set5-listening-images.json', {});
save('config/offline.set5.json', {});
// An old provider's failed check must not override a current local check.
save('media/audio/set5/.audio-index.verify-manifest.tts.json', {
  items: { [job.id]: { stt: { verdict: 'FAIL' } } }
});
const currentIndex = 'media/audio/set5/.audio-index.tts-manifest.set5.json';
const stamp = (verdict = 'PASS') => save(currentIndex, {
  items: { [job.id]: { stt: { verdict, audioSha256: hash() } } }
});
const out = { pack: { sections: [], report: { problems: [], checks: [], unscored: [] } },
  stats: { total: 0, bySection: { reading: 0, listening: 0, writing: 0, speaking: 0 } } };
const report = () => writeSetReport({ setNo: 5, sg2, out, sources: [] });
stamp();
assert.equal(report().counts.audioFail, 0);
fs.writeFileSync(file, 'replacement audio');
assert.equal(report().counts.audioFail, 1, 'Replacing audio invalidates the stored speech check');
assert.match(report().markdown, /speech check is stale/);
stamp();
assert.equal(report().counts.audioFail, 0);
stamp('FAIL');
assert.equal(report().counts.audioFail, 1);
stamp('WARN');
assert.equal(report().counts.audioListen, 1);
// Cleanup only the exact temporary fixture directory created above.
assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir()));
assert.ok(path.basename(temp).startsWith('smeag-set-report-audio-'));
fs.rmSync(temp, { recursive: true });
console.log('PASS speech report: selected provider, current audio hashes, FAIL and WARN checks.');
