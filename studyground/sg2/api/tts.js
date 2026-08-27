/* SMEAG StudyGround — /api/tts : 문항 스크립트 → 음성(mp3) 생성.
 *
 * 엔진은 다섯이다. 기본은 여전히 ElevenLabs 다.
 *   SET 9 의 시험 음성 정본(media/audio/set9/)이 전부 ElevenLabs 로 만들어졌고,
 *   배역표(config/set9-voice-casting.json)의 13인도 그 계정의 voice_id 다. 그래서
 *   **이미 있는 세트의 한 문항만 다시 만들 때는 ElevenLabs 를 쓴다** — 리스닝은
 *   "누가 말하는가" 가 문항의 일부라, 그 문항만 목소리가 튀는 것은 취향이 아니라 결함이다.
 *
 *   그럼에도 다른 엔진을 여는 이유(2026-08-17, 사용자 지시): AI 로 **새 세트를 통째로**
 *   지을 때는 비교 대상이 없다. 그 세트의 모든 트랙을 같은 엔진으로 만들면 목소리는
 *   처음부터 끝까지 일관된다. 키가 하나 막히거나 크레딧이 떨어졌을 때 시험 준비가
 *   통째로 멈추지 않는 것도 같은 이유로 중요하다.
 *
 *   섞어 쓰지 말 것 — 한 세트 안에서 엔진을 바꾸면 목소리가 갈린다. 화면(admin-set-import)
 *   은 세트 하나에 엔진 하나를 고르게 되어 있다.
 *
 *   elevenlabs  ELEVENLABS_API_KEY   기본값. SET 9 정본과 같은 목소리.
 *   openai      OPENAI_API_KEY       채점·생성에 이미 쓰는 키를 그대로 쓴다(가장 싸게 시작).
 *   google      GOOGLE_TTS_API_KEY   en-US·GB·AU·IN 억양 폭이 가장 넓다(리스닝 다양성).
 *   deepgram    DEEPGRAM_API_KEY     빠르고 싸다. 목소리(voice)가 곧 모델이다.
 *   qwen        DASHSCOPE_API_KEY    무료 한도가 있다(신규 계정). WAV 로 내준다.
 *
 * 왜 서버가 필요한가
 *   정적 사이트라 프런트에 TTS API 키를 두면 그대로 공개된다. 그래서 키는 Vercel
 *   환경변수에만 두고, 브라우저는 이 함수에 스크립트만 보낸다. 환경변수가 없는 기기에서는
 *   관리자가 자기 키를 붙여넣을 수 있다(x-sg-key) — 그 키는 이 호출 안에서만 산다.
 *
 * 서버리스에는 ffmpeg 이 없다. 엔진이 내주는 mp3 를 그대로 이어 붙이므로 화자 사이
 * 무음(gap)은 넣지 못한다 — 무음이 필요한 시험 정본은 로컬 tools/tts_multivoice.py 로 만든다.
 *
 * 필요한 환경변수 (Vercel → Project → Settings → Environment Variables)
 *   SG_TTS_TOKEN        이 엔드포인트를 열 수 있는 공용 토큰. 없으면 함수는 503 으로 닫힌다
 *                       (열린 채로 두면 남의 요청이 그대로 과금된다).
 *   <엔진>_API_KEY      위 표 참조. 하나도 없으면 화면에서 키를 붙여넣어야 한다.
 *
 * 계약
 *   GET  /api/tts[?provider=<id>]
 *        → { providers:[{id,label,ready,envReady,mp3,free,note,models,defaultModel,langs,gap,
 *                        envVar,acceptsKey,speed:{min,max}}],
 *            voices:{ <id>:[{id,name,lang,gender,family}] } }
 *        provider 를 주고 x-sg-key 를 함께 보내면 그 키로 그 엔진의 목소리만 받아 온다.
 *   POST /api/tts { provider?, model?, gapMs?, rate?, segments:[{text, voice}] }   헤더 x-sg-token
 *        → { audio:<base64 mp3>, mime:'audio/mpeg', bytes, chars, segments, provider, model, speed }
 *
 * 화자별로 다른 voice 를 줄 수 있고, 세그먼트를 각각 합성해 mp3 를 이어 붙인다.
 */

'use strict';

/* 비용·지연 상한. 시험 한 문항 분량은 넉넉히 들어가고, 실수로 책 한 권을 보내면 막힌다. */
const MAX_SEGMENTS = 20;
const MAX_CHARS_PER_SEGMENT = 1200;
const MAX_CHARS_TOTAL = 6000;

const WAV = require('../assets/wav-join.js');   // UMD — 화면과 같은 코드로 WAV 를 잇는다

function env(n) { return process.env[n] || ''; }

async function fail(r) {
  const text = await r.text();
  let body = null;
  try { body = JSON.parse(text); } catch (e) {}
  const msg = (body && (body.error && (body.error.message || body.error) || body.detail && (body.detail.message || body.detail)))
    || text.slice(0, 300) || ('HTTP ' + r.status);
  const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  err.status = r.status;
  return err;
}

/* ── 엔진 ────────────────────────────────────────────────────────────────
 *
 * 엔진 하나가 알아야 하는 것은 넷뿐이다: 무슨 모델이 있는가(models), 어떤 목소리
 * 이름을 받아들이는가(okVoice), 목소리 목록을 어떻게 받는가(voices), 한 토막을 어떻게
 * mp3 로 만드는가(synth). 나머지(토큰 검사·상한·이어붙이기)는 아래 핸들러가 공통으로 한다.
 *
 * speed 는 엔진마다 받는 범위가 다르다. 화면은 0.5–1.5 를 받지만 그대로 보내면 422 로
 * 튕기는 엔진이 있어서, 각자의 범위로 접어서 보낸다(접었다는 사실은 응답의 speed 에 남는다).
 */

/* ElevenLabs — 시험 정본과 같은 규격. tools/tts_multivoice.py 의 MODEL·OUTPUT 과 맞춰 둔다. */
const XI_OUTPUT = 'mp3_44100_128';

const ENGINES = {
  elevenlabs: {
    label: 'ElevenLabs',
    envVar: 'ELEVENLABS_API_KEY',
    models: ['eleven_flash_v2_5', 'eleven_multilingual_v2', 'eleven_turbo_v2_5', 'eleven_v3'],
    defaultModel: 'eleven_flash_v2_5',
    langs: [],                     // 다국어 모델이 언어를 자동 판별한다
    speed: { min: 0.7, max: 1.2 }, // 0.7 가장 느림 … 1.2 가장 빠름
    free: '가입 시 무료 크레딧, 이후 유료',
    note2: 'SET 9 정본과 같은 목소리 — 이미 있는 문항을 다시 만들 때는 이 엔진',
    okVoice: (v) => /^[A-Za-z0-9]{15,32}$/.test(v),
    async voices(key) {
      const r = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': key } });
      if (!r.ok) throw await fail(r);
      const j = await r.json();
      return (j.voices || []).map((v) => ({
        id: v.voice_id, name: v.name, lang: (v.labels && v.labels.accent) || '',
        gender: (v.labels && v.labels.gender) || '', family: (v.labels && v.labels.use_case) || v.category || ''
      }));
    },
    async synth(seg, o, key) {
      const body = { text: seg.text, model_id: o.model, output_format: XI_OUTPUT };
      if (o.speed !== 1) body.voice_settings = { speed: o.speed };
      const r = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' +
          encodeURIComponent(seg.voice) + '?output_format=' + XI_OUTPUT, {
        method: 'POST',
        headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify(body)
      });
      if (!r.ok) throw await fail(r);
      return Buffer.from(await r.arrayBuffer());
    }
  },

  /* OpenAI — 채점·문항 생성에 이미 쓰는 키를 그대로 쓴다. 목소리는 고정 11인이고
     목록 API 가 없어서 여기에 적어 둔다(이 목록은 OpenAI 문서의 것과 같다). */
  openai: {
    label: 'OpenAI',
    envVar: 'OPENAI_API_KEY',
    models: ['gpt-4o-mini-tts', 'tts-1-hd', 'tts-1'],
    defaultModel: 'gpt-4o-mini-tts',
    langs: [],
    speed: { min: 0.25, max: 4 },
    free: '무료 없음 · 1M자 약 $12(gpt-4o-mini-tts)',
    note2: '문항 생성 키(OPENAI_API_KEY)를 그대로 쓴다 — 키를 하나만 둘 때 가장 간단',
    fixed: [
      { id: 'alloy',   name: 'Alloy',   lang: 'en-US', gender: 'neutral' },
      { id: 'ash',     name: 'Ash',     lang: 'en-US', gender: 'male' },
      { id: 'ballad',  name: 'Ballad',  lang: 'en-US', gender: 'male' },
      { id: 'coral',   name: 'Coral',   lang: 'en-US', gender: 'female' },
      { id: 'echo',    name: 'Echo',    lang: 'en-US', gender: 'male' },
      { id: 'fable',   name: 'Fable',   lang: 'en-GB', gender: 'neutral' },
      { id: 'nova',    name: 'Nova',    lang: 'en-US', gender: 'female' },
      { id: 'onyx',    name: 'Onyx',    lang: 'en-US', gender: 'male' },
      { id: 'sage',    name: 'Sage',    lang: 'en-US', gender: 'female' },
      { id: 'shimmer', name: 'Shimmer', lang: 'en-US', gender: 'female' },
      { id: 'verse',   name: 'Verse',   lang: 'en-US', gender: 'male' }
    ],
    okVoice(v) { return this.fixed.some((x) => x.id === v); },
    async voices() { return this.fixed.slice(); },
    async synth(seg, o, key) {
      const ask = async (withSpeed) => {
        const body = {
          model: o.model, input: seg.text, voice: seg.voice, response_format: 'mp3'
        };
        if (withSpeed) body.speed = o.speed;
        const rr = await fetch('https://api.openai.com/v1/audio/speech', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        return rr;
      };
      /* speed 를 안 받는 모델이 있다. 그 한 필드 때문에 합성이 멈추면 안 되므로,
         거절당하면 속도만 떼고 한 번 더 부른다 — 속도를 잃는 편이 낫다. */
      let r = await ask(o.speed !== 1);
      if (!r.ok && r.status === 400 && o.speed !== 1) r = await ask(false);
      if (!r.ok) throw await fail(r);
      return Buffer.from(await r.arrayBuffer());
    }
  },

  /* Google Cloud Text-to-Speech — 억양 폭이 가장 넓다(en-US·GB·AU·IN). 리스닝에서
     화자마다 다른 억양을 주고 싶을 때 쓴다. 키는 API 키 하나면 되고(서비스 계정 불필요),
     Cloud Console 에서 texttospeech.googleapis.com 로 제한해 두는 것이 좋다. */
  google: {
    label: 'Google Cloud TTS',
    envVar: 'GOOGLE_TTS_API_KEY',
    /* Google 은 "모델" 대신 목소리 이름이 등급을 들고 있다(Chirp3-HD > Neural2 > WaveNet >
       Standard). 그래서 모델 칸은 API 버전 하나뿐이고, 품질은 목소리를 고를 때 정해진다. */
    models: ['v1'],
    defaultModel: 'v1',
    langs: ['en-US', 'en-GB', 'en-AU', 'en-IN'],
    speed: { min: 0.25, max: 4 },
    free: '월 100만자 무료(Standard) · Neural2 는 100만자 $16',
    note2: '억양이 가장 넓다 — 목소리 이름이 등급을 들고 있다(Chirp3-HD · Neural2 · Standard)',
    okVoice: (v) => /^[a-z]{2}-[A-Z]{2}-[A-Za-z0-9]+(-[A-Za-z0-9]+)*$/.test(v),
    async voices(key) {
      const r = await fetch('https://texttospeech.googleapis.com/v1/voices?key=' + encodeURIComponent(key));
      if (!r.ok) throw await fail(r);
      const j = await r.json();
      return (j.voices || [])
        .filter((v) => (v.languageCodes || []).some((l) => /^en-/.test(l)))
        .map((v) => ({
          id: v.name, name: v.name, lang: (v.languageCodes || [])[0] || '',
          gender: String(v.ssmlGender || '').toLowerCase(),
          family: (String(v.name).split('-')[2] || '')
        }))
        .sort((a, b) => (a.lang + a.name).localeCompare(b.lang + b.name));
    },
    async synth(seg, o, key) {
      // 언어는 목소리 이름 앞머리에서 되찾는다 — en-GB-Neural2-A → en-GB.
      const lang = String(seg.voice).split('-').slice(0, 2).join('-');
      const r = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize?key=' +
          encodeURIComponent(key), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { text: seg.text },
          voice: { languageCode: lang, name: seg.voice },
          audioConfig: { audioEncoding: 'MP3', speakingRate: o.speed }
        })
      });
      if (!r.ok) throw await fail(r);
      const j = await r.json();
      if (!j.audioContent) throw new Error('Google returned no audio.');
      return Buffer.from(j.audioContent, 'base64');
    }
  },

  /* Deepgram Aura — 가장 싸고 빠르다. 여기서는 **목소리가 곧 모델이다**
     (aura-2-thalia-en 하나가 모델 이름이자 목소리 이름). 그래서 모델 칸은 세대를
     고르는 것뿐이고, 실제로 보내는 것은 고른 목소리다. 속도 조절은 지원하지 않는다. */
  deepgram: {
    label: 'Deepgram Aura',
    envVar: 'DEEPGRAM_API_KEY',
    models: ['aura-2', 'aura'],
    defaultModel: 'aura-2',
    langs: [],
    speed: { min: 1, max: 1 },     // 속도 파라미터가 없다 — 접어서 1 로 보낸다
    free: '가입 시 $200 크레딧 · 1M자 $30',
    note2: '가장 싸고 빠르다 · 목소리가 곧 모델이다(속도 조절 없음)',
    fallback: [
      { id: 'aura-2-thalia-en',    name: 'Thalia',    lang: 'en-US', gender: 'female', family: 'aura-2' },
      { id: 'aura-2-andromeda-en', name: 'Andromeda', lang: 'en-US', gender: 'female', family: 'aura-2' },
      { id: 'aura-2-apollo-en',    name: 'Apollo',    lang: 'en-US', gender: 'male',   family: 'aura-2' },
      { id: 'aura-2-arcas-en',     name: 'Arcas',     lang: 'en-US', gender: 'male',   family: 'aura-2' },
      { id: 'aura-asteria-en',     name: 'Asteria',   lang: 'en-US', gender: 'female', family: 'aura' },
      { id: 'aura-luna-en',        name: 'Luna',      lang: 'en-US', gender: 'female', family: 'aura' },
      { id: 'aura-orion-en',       name: 'Orion',     lang: 'en-US', gender: 'male',   family: 'aura' },
      { id: 'aura-athena-en',      name: 'Athena',    lang: 'en-GB', gender: 'female', family: 'aura' },
      { id: 'aura-helios-en',      name: 'Helios',    lang: 'en-GB', gender: 'male',   family: 'aura' }
    ],
    okVoice: (v) => /^aura(-2)?-[a-z]+-en$/.test(v),
    async voices(key) {
      const r = await fetch('https://api.deepgram.com/v1/models', {
        headers: { Authorization: 'Token ' + key }
      });
      if (!r.ok) throw await fail(r);
      const j = await r.json();
      const list = (j.tts || [])
        .filter((m) => (m.languages || ['en']).some((l) => /^en/.test(l)))
        .map((m) => {
          const id = m.canonical_name || m.name;
          const meta = m.metadata || {};
          return {
            id: id, name: m.name || id,
            lang: (m.languages || [])[0] || (meta.accent ? 'en' : ''),
            gender: String(meta.tags && meta.tags.find
              ? (meta.tags.find((t) => /female|male/i.test(t)) || '') : '').toLowerCase(),
            family: /^aura-2/.test(id) ? 'aura-2' : 'aura'
          };
        })
        .filter((v) => ENGINES.deepgram.okVoice(v.id));
      return list.length ? list : ENGINES.deepgram.fallback.slice();
    },
    async synth(seg, o, key) {
      // 모델 칸이 아니라 목소리가 모델이다 — 고른 목소리를 그대로 보낸다.
      const r = await fetch('https://api.deepgram.com/v1/speak?model=' +
          encodeURIComponent(seg.voice) + '&encoding=mp3', {
        method: 'POST',
        headers: { Authorization: 'Token ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: seg.text })
      });
      if (!r.ok) throw await fail(r);
      return Buffer.from(await r.arrayBuffer());
    }
  },

  /* Qwen TTS (Alibaba Model Studio · DashScope) — 무료 한도가 있는 유일한 엔진이다.
     새 계정은 모델마다 100만 토큰이 90일간 공짜라, 세트를 통째로 지어 보는 동안 청구서가
     안 나온다. 그래서 화면이 이 엔진에 FREE 표시를 붙인다.

     둘을 조심할 것.
       ① mp3 가 아니라 **WAV** 로 내준다. 토막을 그냥 이어 붙이면 재생기가 첫 토막에서
          멈추므로 assets/wav-join.js 로 제대로 잇는다(머리표를 다시 적는다).
       ② 속도 파라미터가 없다 — 접어서 1 로 보낸다(Deepgram 과 같다).

     목소리 목록 API 가 없어서 여기 적어 둔다. 중국 방언 전용 목소리(Dylan·Sunny 등)는
     싣지 않는다 — 영어 시험 음성에 쓸 자리가 없다. qwen-tts(구버전)는 앞의 넷만 받는다. */
  qwen: {
    label: 'Qwen TTS',
    envVar: 'DASHSCOPE_API_KEY',
    models: ['qwen3-tts-flash', 'qwen-tts'],
    defaultModel: 'qwen3-tts-flash',
    langs: [],
    speed: { min: 1, max: 1 },     // 속도 파라미터가 없다 — 접어서 1 로 보낸다
    mime: 'audio/wav',
    ext: 'wav',
    free: '신규 계정 무료 한도(모델당 100만 토큰 · 90일) · 이후 1M자 약 $15',
    freeTier: true,
    note2: '무료 한도가 있다 · WAV 로 내준다(mp3 아님) · 속도 조절 없음',
    fixed: [
      { id: 'Cherry',   name: 'Cherry',   lang: 'en', gender: 'female', family: 'qwen-tts' },
      { id: 'Serena',   name: 'Serena',   lang: 'en', gender: 'female', family: 'qwen-tts' },
      { id: 'Chelsie',  name: 'Chelsie',  lang: 'en', gender: 'female', family: 'qwen-tts' },
      { id: 'Ethan',    name: 'Ethan',    lang: 'en', gender: 'male',   family: 'qwen-tts' },
      { id: 'Jennifer', name: 'Jennifer', lang: 'en', gender: 'female', family: 'qwen3-tts-flash' },
      { id: 'Katerina', name: 'Katerina', lang: 'en', gender: 'female', family: 'qwen3-tts-flash' },
      { id: 'Vivian',   name: 'Vivian',   lang: 'en', gender: 'female', family: 'qwen3-tts-flash' },
      { id: 'Bella',    name: 'Bella',    lang: 'en', gender: 'female', family: 'qwen3-tts-flash' },
      { id: 'Mia',      name: 'Mia',      lang: 'en', gender: 'female', family: 'qwen3-tts-flash' },
      { id: 'Ryan',     name: 'Ryan',     lang: 'en', gender: 'male',   family: 'qwen3-tts-flash' },
      { id: 'Nofish',   name: 'Nofish',   lang: 'en', gender: 'male',   family: 'qwen3-tts-flash' },
      { id: 'Aiden',    name: 'Aiden',    lang: 'en', gender: 'male',   family: 'qwen3-tts-flash' },
      { id: 'Kai',      name: 'Kai',      lang: 'en', gender: 'male',   family: 'qwen3-tts-flash' },
      { id: 'Moon',     name: 'Moon',     lang: 'en', gender: 'male',   family: 'qwen3-tts-flash' }
    ],
    okVoice(v) { return this.fixed.some((x) => x.id === v); },
    async voices() { return this.fixed.slice(); },
    join(parts) { return Buffer.from(WAV.join(parts)); },
    async synth(seg, o, key) {
      const base = (env('DASHSCOPE_BASE_URL') || 'https://dashscope-intl.aliyuncs.com').replace(/\/+$/, '');
      const r = await fetch(base + '/api/v1/services/aigc/multimodal-generation/generation', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: o.model,
          input: { text: seg.text, voice: seg.voice, language_type: 'English' }
        })
      });
      if (!r.ok) throw await fail(r);
      const j = await r.json();
      /* DashScope 는 실패를 200 에 담아 보내기도 한다 — code 가 있으면 실패다. */
      if (j && j.code) throw new Error(j.code + (j.message ? ': ' + j.message : ''));
      const a = (j && j.output && j.output.audio) || {};
      if (a.data) return Buffer.from(a.data, 'base64');
      if (!a.url) throw new Error('Qwen returned no audio.');
      const rr = await fetch(a.url);          // url 은 24시간짜리 임시 주소다
      if (!rr.ok) throw await fail(rr);
      return Buffer.from(await rr.arrayBuffer());
    }
  }
};

const DEFAULT_PROVIDER = 'elevenlabs';
const IDS = Object.keys(ENGINES);

/* 자격증명 해석.
 *
 * 키는 원래 서버 환경변수에만 뒀다. 정적 사이트라 프런트에 두면 그대로 공개되기
 * 때문이다. 그 원칙은 그대로 두되, 환경변수가 없는 기기에서도 관리자가 자기 키를
 * 붙여넣어 쓸 수 있게 요청 헤더(x-sg-key)를 하나 더 받는다.
 *
 * 헤더 키는 **이 요청이 쓰는 엔진** 의 것으로만 본다. 엔진이 여러 개가 되면서 이게
 * 중요해졌다 — ElevenLabs 키를 보낸 요청이 Google 을 열어 주면 안 된다.
 *
 * 요청 키는 이 호출 안에서만 살고 어디에도 저장·기록하지 않는다. 로그에 남기지 말 것 —
 * 그 순간 공유 자원이 된다. 전역이 아니라 인자로 넘기는 이유: 서버리스 런타임은 한
 * 인스턴스에서 요청을 동시에 처리할 수 있어, 모듈 전역에 담으면 다른 관리자의 키로 샌다.
 */
function credsFrom(req, pid) {
  const h = String((req && req.headers && req.headers['x-sg-key']) || '').trim();
  return { key: h, for: pid || '' };
}
function keyFor(pid, C) {
  if (C && C.key && C.for === pid) return C.key;
  return env(ENGINES[pid].envVar);
}

function json(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function readBody(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 200000) { reject(new Error('body too large')); req.destroy(); }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error('body is not JSON')); }
    });
    req.on('error', reject);
  });
}

/** 화면이 그릴 수 있는 모양으로 한 엔진을 적는다. 키 값은 절대 싣지 않는다. */
function describe(pid, C) {
  const E = ENGINES[pid];
  const envReady = !!env(E.envVar);
  const ready = !!keyFor(pid, C);
  return {
    id: pid, label: E.label,
    mp3: E.mime && E.mime !== 'audio/mpeg' ? 'no' : 'native',
    mime: E.mime || 'audio/mpeg',
    ext: E.ext || 'mp3',
    gap: false,                    // 서버에 ffmpeg 이 없어 무음을 못 만든다
    free: E.free,
    freeTier: !!E.freeTier,        // 화면이 FREE 표시를 붙이는 근거
    note: ready ? (E.note2 || '') : (E.envVar + ' 미설정'),
    models: E.models, defaultModel: E.defaultModel,
    langs: E.langs, speed: E.speed,
    acceptsKey: true, envVar: E.envVar,
    ready, envReady,
    why: E.envVar + ' 미설정'
  };
}

/* ── 핸들러 ─────────────────────────────────────────────── */

module.exports = async function handler(req, res) {
  const token = env('SG_TTS_TOKEN');
  if (!token) return json(res, 503, { error: 'SG_TTS_TOKEN is not configured — the endpoint stays closed.' });
  if ((req.headers['x-sg-token'] || '') !== token) return json(res, 401, { error: 'Bad or missing x-sg-token.' });

  if (req.method === 'GET') {
    /* ?provider=<id> 를 주면 그 엔진 하나만 본다. 화면이 방금 붙여넣은 키로 목소리
       목록을 받아 올 때 쓰는 길이다 — 서버는 그 키를 모르므로 그때만 헤더를 본다. */
    const url = new URL(req.url, 'http://x');
    const want = String(url.searchParams.get('provider') || '').toLowerCase();
    const C = credsFrom(req, want && ENGINES[want] ? want : '');

    const providers = IDS.map((pid) => describe(pid, C));
    const out = { providers, voices: {}, langs: [] };

    /* 목소리 목록은 열린 엔진만, 그리고 병렬로 받는다. 하나가 느리거나 거절해도
       나머지 화면은 서야 한다 — 목록을 못 받아도 합성은 되는 경우가 많다(키에
       읽기 권한만 없는 경우가 대표적이다). */
    const targets = want && ENGINES[want] ? [want] : IDS;
    await Promise.all(targets.map(async (pid) => {
      const key = keyFor(pid, C);
      if (!key) return;
      try { out.voices[pid] = await ENGINES[pid].voices(key); }
      catch (e) {
        out.voices[pid] = [];
        out.voicesError = (out.voicesError ? out.voicesError + ' · ' : '') +
          ENGINES[pid].label + ': ' + String(e.message || e);
      }
    }));
    return json(res, 200, out);
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return json(res, 405, { error: 'Use POST.' });
  }

  let body;
  try { body = await readBody(req); }
  catch (e) { return json(res, 400, { error: String(e.message || e) }); }

  /* 모르는 엔진 이름을 조용히 기본값으로 바꾸지 않는다 — 화면이 잘못된 엔진을 고른
     채로도 성공한 것처럼 보이면, 목소리가 튄 뒤에야 알게 된다. */
  const pid = String(body.provider || DEFAULT_PROVIDER).toLowerCase();
  if (!ENGINES[pid]) {
    return json(res, 400, { error: 'Unknown audio engine: ' + pid + ' (known: ' + IDS.join(', ') + ').' });
  }
  const E = ENGINES[pid];
  const C = credsFrom(req, pid);
  const key = keyFor(pid, C);
  if (!key) {
    return json(res, 503, { error: E.label + ' 키가 없다 (' + E.envVar +
      ' 미설정). 서버 환경변수에 넣거나 화면에서 키를 붙여넣어라.' });
  }

  const model = body.model && E.models.indexOf(String(body.model)) >= 0
    ? String(body.model) : E.defaultModel;

  const segments = Array.isArray(body.segments) ? body.segments : null;
  if (!segments || !segments.length) return json(res, 400, { error: 'segments[] is required.' });
  if (segments.length > MAX_SEGMENTS) {
    return json(res, 400, { error: 'Too many segments (max ' + MAX_SEGMENTS + '). Split the script.' });
  }

  let total = 0;
  for (const s of segments) {
    if (!s || typeof s.text !== 'string' || !s.text.trim()) {
      return json(res, 400, { error: 'Every segment needs non-empty text.' });
    }
    if (s.text.length > MAX_CHARS_PER_SEGMENT) {
      return json(res, 400, { error: 'A segment is longer than ' + MAX_CHARS_PER_SEGMENT + ' characters.' });
    }
    if (!E.okVoice(String(s.voice || ''))) {
      return json(res, 400, { error: 'Unknown ' + E.label + ' voice: ' + s.voice });
    }
    total += s.text.length;
  }
  if (total > MAX_CHARS_TOTAL) {
    return json(res, 400, { error: 'Script is longer than ' + MAX_CHARS_TOTAL + ' characters.' });
  }

  // 엔진마다 받는 속도 범위가 다르다. 화면은 0.5–1.5 를 받지만 그대로 보내면 튕기는
  // 곳이 있어서 여기서 접는다 — 접은 값은 응답에 실려 나가므로 화면이 알 수 있다.
  const opts = {
    model,
    speed: Math.max(E.speed.min, Math.min(E.speed.max, Number(body.rate) || 1))
  };

  try {
    // 세그먼트는 병렬로 합성하고 순서대로 이어 붙인다(함수 실행시간 제한 대비).
    const parts = await Promise.all(segments.map((seg) => E.synth(seg, opts, key)));
    /* mp3 는 그냥 붙여도 되지만 WAV 는 머리표를 다시 적어야 한다 — 그냥 붙이면
       재생기가 첫 토막에서 멈춘다. 엔진이 자기 방식을 들고 있다(qwen.join). */
    const mp3 = E.join ? E.join(parts) : Buffer.concat(parts);
    return json(res, 200, {
      audio: mp3.toString('base64'), mime: E.mime || 'audio/mpeg', ext: E.ext || 'mp3',
      bytes: mp3.length,
      chars: total, segments: segments.length, provider: pid, model,
      speed: opts.speed,
      gapApplied: false
    });
  } catch (e) {
    return json(res, e.status || 502, { error: String(e.message || e) });
  }
};
