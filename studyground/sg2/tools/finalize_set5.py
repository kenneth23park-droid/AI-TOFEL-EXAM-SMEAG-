"""Refresh Set 5 delivery artifacts from the actual passed audio gate."""
import hashlib
import json
from pathlib import Path
import shutil
import build_offline_manifest as offline

ROOT = Path(__file__).resolve().parent.parent

def write(path, content):
    if path.exists():
        shutil.copy2(path, str(path) + '.bak-set5-final')
    path.write_text(content, encoding='utf-8')

def json_write(path, value):
    write(path, json.dumps(value, ensure_ascii=False, indent=2) + '\n')

report = json.loads((ROOT / 'config/audio-verify.set5.json').read_text(encoding='utf-8'))
assert report['counts'] == {'PASS': 33, 'WARN': 0, 'FAIL': 0}
assert not report['skipped'] and not report['globalReasons']
scripts = json.loads((ROOT / 'tts-manifest.set5.json').read_text(encoding='utf-8'))
cast = json.loads((ROOT / 'tts-voices-set5exam-kokoro.json').read_text(encoding='utf-8'))
texts = {item['id']: item for item in scripts['items']}
voices = {item['id']: item for item in cast['items']}
checks = []
generated_path = ROOT / 'tts-voices-set5exam-kokoro.generated.json'
generated = json.loads(generated_path.read_text(encoding='utf-8'))
for item in report['items']:
    transcript = item['layers']['layer3_transcript']
    sha = hashlib.sha256((ROOT / item['path']).read_bytes()).hexdigest()
    assert transcript['verdict'] == 'PASS' and transcript['audioSha256'] == sha
    checks.append({'id': item['id'].removeprefix('set5-'), 'path': item['path'],
        'text': texts[item['id']]['text'], 'asr': transcript['transcript'],
        'voices': list(dict.fromkeys(s['voice'] for s in voices[item['id']]['segments'])),
        'asrAudioSha256': sha})
    generated[item['id']]['validation'] = 'PASS: actual ASR and strict audio gate'
    generated[item['id']]['audioSha256'] = sha
    generated[item['id']]['wer'] = transcript['wer']
json_write(ROOT / 'config/audio-check.set5.json', {'set': 'set5', 'source': 'tts-manifest.set5.json', 'items': checks})
json_write(generated_path, generated)
manifest, missing = offline.build('set5', offline.SETS['set5'])
assert not missing and manifest['count'] == 52, (manifest['count'], missing)
write(ROOT / 'config/offline.set5.json', json.dumps(manifest, indent=1, ensure_ascii=False) + '\n')
tests = ROOT / 'tests.html'
write(tests, tests.read_text(encoding='utf-8').replace('Audio pending', '33 audio files'))
sw = ROOT / 'sw.js'
write(sw, sw.read_text(encoding='utf-8').replace("const VERSION = 'sg-v114'", "const VERSION = 'sg-v115'"))
for name in ['assets/build-version.js', 'version.json']:
    shutil.copy2(ROOT / name, str(ROOT / name) + '.bak-set5-final')
print('Set 5: 33 passed audio checks; 52 offline media files; ready card; cache v115.')
