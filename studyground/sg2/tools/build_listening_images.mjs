/* SMEAG StudyGround — tools/build_listening_images.mjs
 *
 * 배역 매니페스트(tts-voices-set<N>exam-11labs.json) → config/set<N>-listening-images.json.
 *
 * 무엇인가
 *   듣기 화면의 화자 사진이다. 사진이 없으면 듣기 문항만 그림 없이 뜬다.
 *   지금까지 이 파일은 세트마다 손으로 적었다. 손으로 적으면 두 가지가 어긋난다 —
 *   목소리는 여자인데 사진은 남자이거나(사람이 매니페스트를 다시 안 본다), 세트 안에서
 *   같은 목소리가 문항마다 다른 얼굴을 달거나. SET 11 은 규칙이 서 있었고 SET 10 은
 *   그렇지 않았다(같은 목소리에 다른 사진). 그 SET 11 의 규칙을 코드로 옮긴 것이다.
 *
 * 규칙
 *   1. 목소리 하나가 읽는 자리(짧은 응답 · 안내 방송) — 그 목소리의 성별에 맞는 사진.
 *      어느 사진인지는 **그 세트에서 그 목소리가 처음 나온 순서**로 정하고, 사진이
 *      모자라면 처음으로 돌아간다. 그래서 한 세트 안에서 같은 목소리는 늘 같은 얼굴이다.
 *   2. 둘이 주고받는 자리(대화) — 두 사람 사진을 번갈아 쓴다.
 *   3. 문항 하나짜리 음원은 questions 에, 여러 문항이 묶인 음원은 그 묶음의 첫 문항 id 로
 *      blocks 에 적는다(set-import.js 가 그 모양으로 읽는다).
 *
 * 실행
 *   node studyground/sg2/tools/build_listening_images.mjs --set 12
 *   node studyground/sg2/tools/build_listening_images.mjs --set 11 --check   (쓰지 않고 대조만)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SG2 = path.dirname(HERE);

const PIC = 'media/pictures/';
const FEMALE = [
  'TOEFL Listening Image (Single female).webp',
  'TOEFL Listening Image (Single female 2).webp',
  'TOEFL Listening Image (Academic, Single female).webp'
];
const MALE = [
  'TOEFL Listening Image (Single male).webp',
  'TOEFL Listening Image (Single male 2).webp',
  'TOEFL Listening Image (Single male 3).webp'
];
const PAIR = [
  'TOEFL Listening Image (2 People).webp',
  'TOEFL Listening Image (2 Persons).webp'
];

/* 목소리 이름에 성별이 적혀 있지 않으므로 배역표에서 가져온다 — 이름 규칙(US-Ava)이
   아니라 매니페스트를 만든 그 표를 봐야 목소리를 바꿔도 사진이 따라온다. */
const GENDER = {
  'US-Ava': 'female', 'US-Emma': 'female', 'US-Mia': 'female', 'US-Zoe': 'female',
  'GB-Alice': 'female', 'GB-Ivy': 'female', 'AU-Lily': 'female',
  'US-Liam': 'male', 'US-Mason': 'male', 'US-Ethan': 'male', 'US-Noah': 'male',
  'GB-Henry': 'male', 'GB-Oliver': 'male'
};

/** 'set12-l1-q13-14' → {mod:'L1', from:13, to:14} · 'set12-l1-q01' → {mod:'L1', from:1, to:1} */
function slotOf(id) {
  const m = /-l(\d)-q0*(\d+)(?:-0*(\d+))?$/i.exec(String(id));
  if (!m) return null;
  return { mod: 'L' + m[1], from: +m[2], to: m[3] ? +m[3] : +m[2] };
}

function main() {
  const argv = process.argv.slice(2);
  const setNo = +(argv[argv.indexOf('--set') + 1] || 0);
  const checkOnly = argv.includes('--check');
  if (!setNo) { console.error('세트 번호를 주세요 — --set 12'); process.exit(2); }

  const manifestName = `tts-voices-set${setNo}exam-11labs.json`;
  const manifestFile = path.join(SG2, manifestName);
  if (!fs.existsSync(manifestFile)) {
    console.error('배역 매니페스트가 없습니다: ' + manifestName
      + '\n  먼저: node studyground/sg2/tools/build_voices_manifest.mjs --set ' + setNo);
    process.exit(2);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));

  const questions = {}, blocks = {};
  const chosen = {};                 // 목소리 이름 → 사진 (세트 안에서 고정)
  const used = { female: 0, male: 0 };
  let pair = 0;
  const unknown = [];

  (manifest.items || []).forEach((item) => {
    const slot = slotOf(item.id);
    if (!slot) return;               // 스피킹 자리는 사진을 쓰지 않는다
    const voices = [];
    (item.segments || []).forEach((s) => {
      if (voices.indexOf(s.voice_name) < 0) voices.push(s.voice_name);
    });

    let file;
    if (voices.length > 1) {
      file = PAIR[pair++ % PAIR.length];
    } else {
      const v = voices[0];
      const g = GENDER[v];
      if (!g) { unknown.push(item.id + ' (' + v + ')'); return; }
      if (!chosen[v]) {
        const pool = g === 'female' ? FEMALE : MALE;
        chosen[v] = pool[used[g]++ % pool.length];
      }
      file = chosen[v];
    }
    const key = slot.mod + '-' + slot.from;
    if (slot.from === slot.to) questions[key] = PIC + file;
    else blocks[key] = PIC + file;
  });

  if (unknown.length) {
    console.error('성별을 모르는 목소리가 있습니다 — GENDER 에 보태 주세요:\n  ' + unknown.join('\n  '));
    process.exit(1);
  }

  /* 사진 파일이 실제로 있는지 본다. 없는 경로를 팩에 박으면 시험 화면에서만 드러난다. */
  const missing = [...new Set(Object.values(questions).concat(Object.values(blocks)))]
    .filter((p) => !fs.existsSync(path.join(SG2, p)));
  if (missing.length) {
    console.error('사진 파일이 없습니다:\n  ' + missing.join('\n  '));
    process.exit(1);
  }

  const out = {
    source: manifestName + ' voice casting + shared TOEFL listening picture assets',
    generatedBy: 'tools/build_listening_images.mjs',
    questions: questions,
    blocks: blocks
  };
  const outFile = path.join(SG2, 'config', `set${setNo}-listening-images.json`);
  const text = JSON.stringify(out, null, 2) + '\n';

  console.log(`SET ${setNo} → 문항 사진 ${Object.keys(questions).length}장 · 묶음 사진 ${Object.keys(blocks).length}장`);
  Object.keys(chosen).forEach((v) => console.log('  ' + v + ' → ' + chosen[v].replace(/^TOEFL Listening Image \(|\)\.webp$/g, '')));

  if (checkOnly) {
    const now = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
    /* 손으로 적던 시절의 파일에는 generatedBy 가 없다 — 사진 배정만 견준다. */
    const same = now && JSON.stringify(JSON.parse(now).questions) === JSON.stringify(questions)
      && JSON.stringify(JSON.parse(now).blocks) === JSON.stringify(blocks);
    console.log(same ? '\n커밋된 사진 배정과 일치합니다.' : '\n커밋된 사진 배정과 다릅니다.');
    process.exit(same ? 0 : 1);
  }

  fs.writeFileSync(outFile, text);
  console.log('\nstudyground/sg2/config/set' + setNo + '-listening-images.json 를 썼습니다.');
}

main();
