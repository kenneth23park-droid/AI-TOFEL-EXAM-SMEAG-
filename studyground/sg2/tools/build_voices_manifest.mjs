/* SMEAG StudyGround — tools/build_voices_manifest.mjs
 *
 * 원본 docx 3종 → tts-voices-<set>exam-11labs.json (음성 생성용 배역 매니페스트).
 *
 * 왜 손으로 쓰지 않는가
 *   SET 9 의 tts-voices-set9exam-11labs.json 은 40항목을 손으로 적은 것이다. 대본을
 *   한 글자라도 고치면 매니페스트와 팩이 조용히 갈라지고, 그러면 mp3 는 옛 대본을
 *   읽은 채 남는다. 여기서는 팩을 만드는 바로 그 파서(set-import.js)로 대본을 얻으므로
 *   두 벌이 어긋날 길이 없다.
 *
 * 배역은 세트마다 적지 않는다
 *   자리의 **종류와 순서** 만 보고 규칙(RULES)으로 정한다. 세트가 늘어도 이 파일을
 *   고치지 않는다 — 그것이 "문서만 넣으면 문항과 음성이 나온다" 의 마지막 조각이다.
 *   손으로 적은 SET 10 배역표를 규칙으로 바꾼 뒤 --check 로 대조해, 같은 결과가
 *   나오는 것을 확인하고 표를 지웠다. 규칙은 SET 9 의 designNotes 를 그대로 옮긴 것이다.
 *
 *   목소리 13명은 SET 9 에서 계정 라이브러리 실조회로 확정된 것을 물려받는다
 *   (config/set9-voice-casting.json). 새 voice_id 를 고르지 않는 이유는 두 가지다 —
 *   이미 검증된 ID 이고, 두 세트를 이어 치르는 학생에게 목소리 세계가 바뀌지 않는다.
 *
 * 실행
 *   node studyground/sg2/tools/build_voices_manifest.mjs --set 11
 *   node studyground/sg2/tools/build_voices_manifest.mjs --set 11 --check   (쓰지 않고 대조만)
 *
 * 문서에서 음성까지 한 번에
 *   cd studyground/sg2 && ELEVENLABS_API_KEY=... sh tools/make_set_audio.sh 11
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SG2 = path.dirname(HERE);
const REPO = path.dirname(path.dirname(SG2));      // 원본 docx 가 있는 곳

const DOCX = require(path.join(SG2, 'assets/docx-read.js'));
const IMPORT = require(path.join(SG2, 'assets/set-import.js'));
const PLAN = require(path.join(SG2, 'assets/tts-plan.js'));

/* SET 9 에서 확정된 13명. voiceId 는 이 계정에서 실제로 산출물이 나온 ID 다
   (config/set9-voice-casting.json 의 resolvedAt 참조). */
const CAST = {
  'US-Ava':    { voice: 'FGY2WhTYpPnrIDTdsKH5', el: 'Laura',   gender: 'female' },
  'US-Emma':   { voice: 'EXAVITQu4vr4xnSDxMaL', el: 'Sarah',   gender: 'female' },
  'US-Mia':    { voice: 'XrExE9yKIg1WjnnlVkGX', el: 'Matilda', gender: 'female' },
  'US-Zoe':    { voice: 'cgSgspJ2msm6clMCkdW9', el: 'Jessica', gender: 'female' },
  'US-Liam':   { voice: 'TX3LPaxmHKxFdv7VOQHJ', el: 'Liam',    gender: 'male' },
  'US-Mason':  { voice: 'cjVigY5qzO86Huf0OWal', el: 'Eric',    gender: 'male' },
  'US-Ethan':  { voice: 'nPczCjzI2devNBz1zQrb', el: 'Brian',   gender: 'male' },
  'US-Noah':   { voice: 'CwhRBWXzGAHq8TQ4Fs17', el: 'Roger',   gender: 'male' },
  'GB-Alice':  { voice: 'Xb7hH8MSUJpSbSDYk0k2', el: 'Alice',   gender: 'female' },
  'GB-Ivy':    { voice: 'pFZP5JQG7iQjIQuC4Bku', el: 'Lily',    gender: 'female' },
  'GB-Henry':  { voice: 'JBFqnCBsd6RMkjVDRZzb', el: 'George',  gender: 'male' },
  'GB-Oliver': { voice: 'onwK4e9ZLuTAKqWW03F9', el: 'Daniel',  gender: 'male' },
  'AU-Lily':   { voice: 'VyyyOgRmsqOzaZXnKWnI', el: 'Sunny - AU Female (SET9)', gender: 'female' }
};

/* 항목 종류별 낭독 속도. SET 9 산출물에서 쓰인 값을 그대로 쓴다 — 짧은 응답은 한 번만
   들려주므로 느리게, 대화는 자연스러움이 더 중요해 거의 정상 속도, 따라 읽기는 가장 느리게.
   값이 없는 종류는 엔진 기본 속도다. */
const SPEED = { short: 0.75, conversation: 0.9, repeat: 0.7 };

/* 배역 배정 규칙.
 *
 * 세트마다 표를 손으로 적으면 "문서만 넣으면 끝" 이 되지 않는다. 자리의 **종류와 순서**만
 * 보고 정하는 규칙으로 둔다 — SET 11, 12 도 이 파일을 고치지 않고 돌아간다.
 * 순서는 팩이 만드는 순서(문서 순서)이므로 같은 문서를 두 번 넣어도 배역이 흔들리지 않는다.
 *
 * 규칙은 SET 9 의 designNotes 를 그대로 옮긴 것이다.
 *   · 짧은 응답은 문항마다 다른 사람 — 모듈마다 목록을 처음부터 돈다.
 *   · 대화는 남녀 한 쌍이고, 쌍 목록을 순서대로 쓴다. 세트 안에서 앞 대화와 겹치지 않는다.
 *   · 강의·안내는 음색이 가장 멀리 떨어진 화자부터 돌려 쓴다.
 *   · Listen & Repeat 은 세트에서 가장 또렷한 목소리 하나가 끝까지 맡는다.
 *   · 면접은 진행자 한 명이 끝까지 맡는다.
 */
const RULES = {
  /* 짧은 응답 — 모듈별로 다른 목록을 쓴다. Module 2 는 문항이 적어 셋만 돈다. */
  short: {
    1: ['US-Ava', 'US-Liam', 'US-Mia', 'US-Mason', 'GB-Alice', 'GB-Henry',
        'AU-Lily', 'US-Noah', 'US-Emma', 'US-Ethan', 'US-Zoe', 'GB-Oliver'],
    2: ['US-Ava', 'US-Emma', 'GB-Ivy']
  },
  /* 대화 — 세트 안에서 나온 순서대로. 다섯 쌍이면 대화 다섯 개까지 서로 겹치지 않는다. */
  conversation: [
    { W: 'US-Emma', M: 'US-Liam' },
    { W: 'US-Mia',  M: 'US-Ethan' },
    { W: 'US-Zoe',  M: 'US-Mason' },
    { W: 'GB-Ivy',  M: 'US-Noah' },
    { W: 'AU-Lily', M: 'US-Mason' }
  ],
  /* 안내 방송·강의 — 긴 지문이라 음색 대비가 가장 큰 순서로 돌린다. */
  announcement: ['US-Liam', 'US-Ethan', 'US-Mason', 'GB-Oliver', 'GB-Henry', 'US-Ethan', 'US-Mia'],
  /* 스피킹 — 따라 읽기는 가장 또렷한 목소리, 면접은 진행자 한 명. */
  repeat: 'US-Emma',
  interview: 'GB-Oliver'
};

/* 규칙으로 정하기 어려운 자리만 세트별로 덮어쓴다. 비어 있는 것이 정상이다 —
   여기에 무언가 적히기 시작하면 규칙이 현실을 못 따라간다는 신호다. */
const OVERRIDE = {};

/* ------------------------------------------------------------------ */

function readDocx(name) {
  const file = path.join(REPO, name);
  if (!fs.existsSync(file)) return null;
  const b = fs.readFileSync(file);
  return DOCX.read(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

/** 'media/audio/set10/l1-q13-14.mp3' → 'l1-q13-14' */
function slotOf(p) { return String(p).split('/').pop().replace(/\.mp3$/, ''); }

/**
 * 이 자리의 배역을 정한다. 종류마다 셈틀(cursor)을 따로 두고 문서 순서대로 돌린다 —
 * 자리의 이름이 아니라 **몇 번째 그 종류인가** 로 정하므로 세트가 바뀌어도 규칙이 산다.
 * @param {object} cur {short:{모듈번호:n}, conversation:n, announcement:n}
 */
function roleFor(setNo, slot, kind, cur) {
  const over = (OVERRIDE[setNo] || {})[slot];
  if (over) return over;

  if (kind === 'repeat' || kind === 'interview') return RULES[kind];
  /* 안내 방송(instructions)은 그 Task 를 맡은 사람이 그대로 읽는다 — 안내와 문항이
     다른 목소리면 학생은 둘을 다른 사람으로 듣는다. */
  if (kind === 'instructions') return /^s1-/.test(slot) ? RULES.repeat : RULES.interview;

  if (kind === 'short') {
    const mod = (/^l(\d)-/.exec(slot) || [, '1'])[1];
    const list = RULES.short[mod] || RULES.short[1];
    const n = (cur.short[mod] = (cur.short[mod] || 0));
    cur.short[mod] = n + 1;
    return list[n % list.length];
  }
  if (kind === 'conversation') return RULES.conversation[cur.conversation++ % RULES.conversation.length];
  return RULES.announcement[cur.announcement++ % RULES.announcement.length];
}

function kindOf(slot, speakers) {
  if (/^s\d-instructions$/.test(slot)) return 'instructions';
  if (/^s1-/.test(slot)) return 'repeat';
  if (/^s2-/.test(slot)) return 'interview';
  if (speakers.length > 1) return 'conversation';
  return /^l\d-q\d+$/.test(slot) ? 'short' : 'announcement';
}

const main = async () => {
  const argv = process.argv.slice(2);
  const setNo = +(argv[argv.indexOf('--set') + 1] || 10);
  const checkOnly = argv.includes('--check');
  const sources = {
    questions: `NEW TOEFL MOCK TEST SET ${setNo} Questions.docx`,
    script: `SET ${setNo} SCRIPT.docx`,
    answers: `SET ${setNo} ANSWER KEY.docx`
  };
  const missing = Object.values(sources).filter((f) => !fs.existsSync(path.join(REPO, f)));
  if (missing.length) {
    console.error('원본 docx 를 찾지 못했습니다:\n  ' + missing.join('\n  '));
    process.exit(2);
  }

  const [questions, script, answers] = await Promise.all([
    readDocx(sources.questions), readDocx(sources.script), readDocx(sources.answers)
  ]);
  const result = IMPORT.build({ code: `SET ${setNo}`, questions, script, answers });
  if (!result.pack) {
    console.error('팩을 만들지 못했습니다.');
    result.gates.filter((g) => g.level === 'stop').forEach((g) => console.error('  ' + g.message));
    process.exit(1);
  }

  const jobs = PLAN.jobsFrom(result.pack);
  const items = [];
  const unknown = [];
  const cur = { short: {}, conversation: 0, announcement: 0 };
  let chars = 0;

  jobs.forEach((job) => {
    const slot = slotOf(job.path);
    const lines = PLAN.parseScript(job.script);
    const speakers = [...new Set(lines.map((l) => l.speaker))];
    const kind = kindOf(slot, speakers);
    const role = roleFor(setNo, slot, kind, cur);
    if (!role) { unknown.push(slot); return; }

    const segments = lines.map((l) => {
      /* 대화는 화자 표시(M/W)마다 배역이 다르고, 나머지는 한 명이 끝까지 읽는다.
         표시가 배역표에 없으면 지어내지 않고 아래에서 멈춘다. */
      const name = typeof role === 'string' ? role : role[l.speaker];
      if (!name || !CAST[name]) { unknown.push(slot + ' (' + l.speaker + ')'); return null; }
      const c = CAST[name];
      chars += l.text.length;
      return { speaker: l.speaker, voice: c.voice, voice_name: name, el_voice: c.el, text: l.text };
    });
    if (segments.some((s) => !s)) return;

    const item = { id: `set${setNo}-${slot}`, kind, out: job.path, segments };
    if (SPEED[kind]) item.speed = SPEED[kind];
    items.push(item);
  });

  if (unknown.length) {
    console.error('배역이 정해지지 않은 자리가 있습니다 — RULES 나 OVERRIDE 를 보태 주세요:\n  ' + unknown.join('\n  '));
    process.exit(1);
  }

  const manifest = {
    provider: 'elevenlabs',
    model: 'eleven_flash_v2_5',
    output: 'mp3_44100_128',
    note: [
      `SET ${setNo} 시험 음성 배역 매니페스트. tools/build_voices_manifest.mjs 가 원본 docx 에서 만든다 — 손으로 고치지 말 것.`,
      '대본은 set-import.js 가 읽은 것과 같은 것이고, out 은 콘텐츠 팩이 가리키는 경로 그대로다.',
      `목소리 13명은 SET 9 에서 확정된 것을 그대로 쓴다(config/set9-voice-casting.json).`,
      'id 에 세트 접두사를 붙이는 이유: tools/tts_multivoice.py 의 검산 매니페스트는 tts-voices*.json 을 합치므로, l1-q01 같은 이름은 SET 9 것과 부딪친다.'
    ],
    items
  };

  const dest = path.join(SG2, `tts-voices-set${setNo}exam-11labs.json`);
  const text = JSON.stringify(manifest, null, 2) + '\n';
  const same = fs.existsSync(dest) && fs.readFileSync(dest, 'utf8') === text;

  const byKind = {};
  items.forEach((i) => { byKind[i.kind] = (byKind[i.kind] || 0) + 1; });
  console.log(`SET ${setNo} → ${items.length}개 항목 · ${chars.toLocaleString()}자`);
  console.log('  ' + Object.entries(byKind).map(([k, n]) => `${k} ${n}`).join(' · '));

  if (checkOnly) {
    console.log(same ? '\n매니페스트가 원본과 일치합니다.' : '\n매니페스트가 원본과 다릅니다 — --check 없이 다시 돌리세요.');
    process.exit(same ? 0 : 1);
  }
  fs.writeFileSync(dest, text, 'utf8');
  console.log('\n' + path.relative(REPO, dest) + ' 를 썼습니다.');
};

main().catch((e) => { console.error(e); process.exit(1); });
