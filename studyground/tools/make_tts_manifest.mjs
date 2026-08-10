/* SMEAG StudyGround — tools/make_tts_manifest.mjs
 *
 * 가져온 콘텐츠 팩(admin-set-import.html 의 "JSON 내보내기") → ElevenLabs 음성 매니페스트.
 * 이 파일이 만든 매니페스트를 sg2/tools/tts_multivoice.py 가 그대로 읽어 mp3 를 만든다.
 *
 * 왜 따로 있나
 *   tts_multivoice.py 는 "무엇을 어떤 목소리로 읽을지" 를 매니페스트에서만 받는다.
 *   SET 9 은 그 매니페스트를 사람이 만들었다(tts-voices-set9exam-11labs.json).
 *   새 세트마다 40개 항목을 손으로 적을 수는 없으므로, 팩에 이미 붙어 있는 대본과
 *   파일 경로에서 기계적으로 뽑는다.
 *
 * 배역
 *   config/set9-voice-casting.json 의 13명은 이 계정에서 실제로 검증된 voiceId 다.
 *   그 명단을 목소리 풀로 재사용하고, 아래 규칙으로 배정한다 —
 *     · 한 블록 안에서 같은 화자(M/W)는 같은 목소리를 유지한다.
 *     · 이웃한 블록끼리는 목소리가 겹치지 않게 돌려 쓴다(누가 말하는지가 문항의 일부다).
 *     · Listen & Repeat 드릴은 한 명이 전담한다 — 따라 읽기는 일관성이 자연스러움보다 낫다.
 *   배역을 손보려면 만들어진 매니페스트의 voice/voice_name 을 고치면 된다.
 *
 * 대본이 없는 항목은 매니페스트에 넣지 않는다. 없는 말을 지어내지 않는다 —
 * 빠진 것은 목록으로 알려주고, 사람이 대본을 채운 뒤 다시 돌리면 된다.
 *
 * 실행:
 *   node studyground/tools/make_tts_manifest.mjs <팩.json> [--out <경로>] [--model <모델>]
 *
 * 그 다음:
 *   ELEVENLABS_API_KEY=... studyground/.venv/bin/python studyground/sg2/tools/tts_multivoice.py \
 *     --manifest tts-voices-<slug>-11labs.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);                 // .../studyground
const SG2 = path.join(ROOT, 'sg2');
const CASTING = path.join(SG2, 'config', 'set9-voice-casting.json');

/* 모델을 항목마다 나눠 쓴다.
 *   1인 낭독  → Flash v2.5. 값이 절반이고, 더 중요하게는 같은 입력에 같은 소리를 낸다.
 *               따라 읽기 드릴에 필요한 건 감정이 아니라 발음의 또렷함과 일관성이다.
 *   다화자 대화 → v3 Dialogue. 화자들을 한 번에 만들어 말차례와 억양을 서로 맞춘다.
 *               대화 문항은 화자 사이의 반응이 곧 정답의 단서라, 따로 만들어 이어 붙이면
 *               문항이 요구하는 정보가 음성에 없다.
 */
const DEFAULTS = { model: 'eleven_flash_v2_5', output: 'mp3_44100_128' };
const DIALOGUE_MODEL = 'eleven_v3';

/* 짧은 응답 문항은 학생이 한 번 듣고 답한다 — SET 9 정본이 0.75 로 느리게 읽었다. */
const SHORT_SPEED = 0.75;

/* ------------------------------------------------------------------ 목소리 풀 */

function loadVoicePool() {
  const cast = JSON.parse(fs.readFileSync(CASTING, 'utf8'));
  const ok = (cast.characters || []).filter((c) => c.voiceId);
  if (!ok.length) throw new Error('검증된 voiceId 가 배역표에 없습니다: ' + CASTING);
  return {
    female: ok.filter((c) => c.gender === 'female'),
    male: ok.filter((c) => c.gender === 'male'),
    byName: new Map(ok.map((c) => [c.name, c]))
  };
}

/** 화자 기호 → 성별. 관례상 M=남, W=여. 그 밖은 내레이션으로 보고 번갈아 쓴다. */
function genderOf(speaker) {
  const s = String(speaker || '').toUpperCase();
  if (s.startsWith('M')) return 'male';
  if (s.startsWith('W') || s.startsWith('F')) return 'female';
  return null;
}

/**
 * 블록마다 목소리를 돌려 쓰는 배정기.
 * 같은 블록 안에서는 화자별로 고정, 블록이 바뀌면 다음 목소리로 넘어간다.
 */
function makeCaster(pool) {
  const cursor = { male: 0, female: 0 };
  let narrations = 0;      /* 화자 표시가 없는 1인 낭독이 몇 번째인지 */

  return {
    /**
     * 이 블록에 등장하는 화자들에게 목소리를 배정한다.
     * @param {string[]} speakers  블록 안의 화자 기호(M/W/N…)
     * @param {{pin?:string}} opts pin 이 있으면 전원 그 배역으로 고정한다
     */
    castBlock(speakers, { pin } = {}) {
      const map = new Map();
      for (const sp of speakers) {
        if (pin && pool.byName.has(pin)) { map.set(sp, pool.byName.get(pin)); continue; }

        /* 화자 표시가 없는 낭독(강의·안내)은 성별 단서가 없다. 등장 순서대로 남녀를
           번갈아 준다 — 긴 강의가 연달아 같은 성별로 나오면 학생이 화자를 구분하지
           못하고, 그건 내용 이해와 무관하게 오답이 된다(배역표 designNotes ①). */
        const g = genderOf(sp) || (narrations++ % 2 === 0 ? 'male' : 'female');
        const list = pool[g];
        map.set(sp, list[cursor[g] % list.length]);
        cursor[g]++;
      }
      return map;
    }
  };
}

/* -------------------------------------------------------------- 대본 자르기 */

/**
 * 'M: 안녕\nW: 반가워' → [{speaker:'M', text:'안녕'}, …]
 * 화자 표시가 없으면 통째로 내레이션 한 덩어리다.
 */
function segmentScript(script) {
  const lines = String(script || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const out = [];
  let cur = null;
  for (const line of lines) {
    const m = /^([A-Z][A-Za-z]{0,11})\s*:\s*(.*)$/.exec(line);
    if (m && m[2]) {
      cur = { speaker: m[1].toUpperCase(), text: m[2] };
      out.push(cur);
    } else if (cur) {
      cur.text += ' ' + line;
    } else {
      cur = { speaker: 'N', text: line };
      out.push(cur);
    }
  }
  return out;
}

/* ------------------------------------------------------------ 팩 → 항목 목록 */

/** 팩을 훑어 "음성이 필요한 자리" 를 순서대로 모은다. */
function collectClips(pack) {
  const clips = [];
  for (const sec of pack.sections || []) {
    for (const mod of sec.modules || []) {
      for (const blk of mod.blocks || []) {
        if (blk.introAudio) {
          clips.push({
            out: blk.introAudio, kind: 'narration',
            script: blk.introScript || blk.instruction || '',
            section: sec.id, module: mod.id, why: mod.label + ' 안내'
          });
        }
        if (blk.audio) {
          clips.push({
            out: blk.audio,
            kind: /conversation/i.test(blk.instruction || '') ? 'conversation' : 'narration',
            script: blk.script || '',
            section: sec.id, module: mod.id, why: blk.heading || mod.label
          });
        }
        for (const q of blk.questions || []) {
          if (!q.audio) continue;
          clips.push({
            out: q.audio,
            kind: sec.id === 'speaking' ? (q.kind === 'repeat' ? 'repeat' : 'interview') : 'short',
            script: q.script || '',
            section: sec.id, module: mod.id, why: q.id
          });
        }
      }
    }
  }
  return clips;
}

/* ------------------------------------------------------------------- 조립 */

function build(pack, opts) {
  const pool = loadVoicePool();
  const caster = makeCaster(pool);
  const clips = collectClips(pack);

  const items = [];
  const missing = [];

  for (const clip of clips) {
    if (!clip.script.trim()) { missing.push(clip); continue; }

    const segs = segmentScript(clip.script);
    const speakers = [...new Set(segs.map((s) => s.speaker))];

    /* 한 사람이 끝까지 맡아야 하는 두 자리 —
       · 따라 읽기 드릴: 발음 일관성이 자연스러움보다 중요하다(배역표 designNotes ③).
       · 면접: 질문 4개를 던지는 사람은 한 명이다. 매번 목소리가 바뀌면 면접이 아니다. */
    const PINNED = { repeat: 'US-Emma', interview: 'GB-Oliver' };
    const pin = PINNED[clip.kind] || null;
    const cast = caster.castBlock(speakers, { pin });

    const item = {
      id: path.basename(clip.out, '.mp3'),
      kind: clip.kind,
      out: clip.out,
      segments: segs.map((s) => {
        const v = cast.get(s.speaker);
        return {
          speaker: s.speaker,
          voice: v.voiceId,
          voice_name: v.name,
          text: s.text
        };
      })
    };

    /* 화자가 둘 이상이면 대화다 — 한 번에 만든다. */
    const voices = new Set(item.segments.map((s) => s.voice));
    if (voices.size > 1) {
      item.mode = 'dialogue';
      item.model = DIALOGUE_MODEL;
    } else if (clip.kind === 'short' || clip.kind === 'repeat') {
      /* 낭독 속도는 1인 항목에만 걸린다. Dialogue 는 말차례를 스스로 잡으므로 건드리지 않는다. */
      item.speed = SHORT_SPEED;
    }
    items.push(item);
  }

  const manifest = {
    provider: 'elevenlabs',
    model: opts.model || DEFAULTS.model,
    output: DEFAULTS.output,
    note: [
      `${pack.title || pack.code} 음성 매니페스트. tools/make_tts_manifest.mjs 가 콘텐츠 팩에서 자동 생성했다.`,
      '배역은 config/set9-voice-casting.json 의 검증된 13명을 블록마다 돌려 쓴 것이다 —',
      '음색 대비가 중요한 항목은 이 파일의 voice/voice_name 을 직접 고치면 된다.',
      '대본이 없는 항목은 아예 실리지 않는다(없는 말을 만들지 않는다).'
    ].join(' '),
    items
  };

  return { manifest, missing, clips };
}

/* -------------------------------------------------------------------- CLI */

function main() {
  const args = process.argv.slice(2);
  const packPath = args.find((a) => !a.startsWith('--'));
  if (!packPath) {
    console.error('사용법: node studyground/tools/make_tts_manifest.mjs <팩.json> [--out <경로>] [--model <모델>]');
    process.exit(2);
  }
  const flag = (name) => {
    const i = args.indexOf('--' + name);
    return i >= 0 ? args[i + 1] : '';
  };

  const pack = JSON.parse(fs.readFileSync(packPath, 'utf8'));
  const slug = String(pack.code || 'set').toLowerCase().replace(/[^a-z0-9]/g, '');
  const { manifest, missing, clips } = build(pack, { model: flag('model') });

  const out = flag('out') || path.join(SG2, `tts-voices-${slug}-11labs.json`);
  fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');

  const chars = manifest.items.reduce(
    (n, it) => n + it.segments.reduce((m, s) => m + s.text.length, 0), 0);

  console.log(`${pack.title || pack.code} 음성 매니페스트`);
  console.log(`  음성이 필요한 자리 : ${clips.length}`);
  console.log(`  매니페스트에 실림   : ${manifest.items.length}`);
  console.log(`  대본이 없어 빠짐    : ${missing.length}`);
  console.log(`  읽을 글자 수        : ${chars.toLocaleString()}`);
  console.log(`  → ${path.relative(process.cwd(), out)}`);

  const byKind = {};
  manifest.items.forEach((it) => { byKind[it.kind] = (byKind[it.kind] || 0) + 1; });
  console.log(`  종류: ${Object.entries(byKind).map(([k, v]) => `${k} ${v}`).join(' · ')}`);

  const dlg = manifest.items.filter((it) => it.mode === 'dialogue');
  const dlgChars = dlg.reduce((n, it) => n + it.segments.reduce((m, s) => m + s.text.length, 0), 0);
  console.log(`  모델: 다화자 ${dlg.length}건 → ${DIALOGUE_MODEL} · 1인 ${manifest.items.length - dlg.length}건 → ${manifest.model}`);
  console.log(`  예상 비용: ${((dlgChars / 1000) * 0.10 + ((chars - dlgChars) / 1000) * 0.05).toFixed(2)} (v3 $0.10/1k · Flash $0.05/1k)`);

  if (missing.length) {
    console.log(`\n  대본이 없는 자리 — 원본 문서에 그 대사가 없습니다:`);
    missing.forEach((c) => console.log(`    · ${c.out.split('/').pop().padEnd(22)} ${c.why}`));
    console.log('    이 항목들은 음성이 만들어지지 않습니다. 대본을 채운 뒤 다시 실행하세요.');
  }

  console.log(`\n다음 단계:`);
  console.log(`  ELEVENLABS_API_KEY=... studyground/.venv/bin/python studyground/sg2/tools/tts_multivoice.py \\`);
  console.log(`    --manifest ${path.basename(out)}`);
}

main();
