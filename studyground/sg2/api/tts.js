/* SMEAG StudyGround — /api/tts : 문항 스크립트 → 음성(mp3) 생성.
 *
 * 엔진은 ElevenLabs 하나다.
 *   SET 9 의 시험 음성 정본(media/audio/set9/)이 전부 ElevenLabs 로 만들어졌고,
 *   배역표(config/set9-voice-casting.json)의 13인도 그 계정의 voice_id 다. 관리자
 *   화면에서 한 문항만 다시 만들 때 다른 엔진을 쓰면 그 문항만 목소리가 튄다 —
 *   리스닝은 "누가 말하는가" 가 문항의 일부라, 목소리가 튀는 것은 취향이 아니라 결함이다.
 *   그래서 여기서는 다른 엔진을 아예 두지 않는다(2026-08-12, 사용자 지시).
 *
 * 왜 서버가 필요한가
 *   정적 사이트라 프런트에 TTS API 키를 두면 그대로 공개된다. 그래서 키는 Vercel
 *   환경변수에만 두고, 브라우저는 이 함수에 스크립트만 보낸다.
 *
 * 서버리스에는 ffmpeg 이 없다. ElevenLabs 가 내주는 mp3 를 그대로 이어 붙이므로
 * 화자 사이 무음(gap)은 넣지 못한다 — 무음이 필요한 시험 정본은 로컬
 * tools/tts_multivoice.py 로 만든다(거기엔 ffmpeg 이 있다).
 *
 * 필요한 환경변수 (Vercel → Project → Settings → Environment Variables)
 *   SG_TTS_TOKEN        이 엔드포인트를 열 수 있는 공용 토큰. 없으면 함수는 503 으로 닫힌다
 *                       (열린 채로 두면 남의 요청이 그대로 과금된다).
 *   ELEVENLABS_API_KEY  ElevenLabs 키. 없으면 관리자가 화면에서 자기 키를 붙여넣을 수 있다.
 *
 * 계약
 *   GET  /api/tts
 *        → { providers:[{id,label,ready,mp3,free,note,models,langs,gap}], voices:{elevenlabs:[…]} }
 *   POST /api/tts { model?, gapMs?, rate?, segments:[{text, voice}] }   헤더 x-sg-token
 *        → { audio:<base64 mp3>, mime:'audio/mpeg', bytes, chars, segments, provider, model }
 *
 * 화자별로 다른 voice 를 줄 수 있고, 세그먼트를 각각 합성해 mp3 를 이어 붙인다.
 */

'use strict';

const XI_TTS = 'https://api.elevenlabs.io/v1/text-to-speech/';
const XI_VOICES = 'https://api.elevenlabs.io/v1/voices';

/* 시험 정본과 같은 규격. tools/tts_multivoice.py 의 MODEL·OUTPUT 과 맞춰 둔다 —
   같은 문항을 화면에서 다시 만들어도 나머지 트랙과 같은 소리가 나야 한다. */
const XI_OUTPUT = 'mp3_44100_128';
const XI_MODELS = ['eleven_flash_v2_5', 'eleven_multilingual_v2', 'eleven_turbo_v2_5', 'eleven_v3'];
const XI_DEFAULT_MODEL = 'eleven_flash_v2_5';

/* 비용·지연 상한. 시험 한 문항 분량은 넉넉히 들어가고, 실수로 책 한 권을 보내면 막힌다. */
const MAX_SEGMENTS = 20;
const MAX_CHARS_PER_SEGMENT = 1200;
const MAX_CHARS_TOTAL = 6000;

/* 임의 문자열이 그대로 공급자에게 넘어가지 않게 하는 허용 규칙. */
const RE_VOICE = /^[A-Za-z0-9]{15,32}$/;      // ElevenLabs voice_id

const PROVIDER_ID = 'elevenlabs';

function env(n) { return process.env[n] || ''; }

/* 자격증명 해석.
 *
 * 키는 원래 서버 환경변수에만 뒀다. 정적 사이트라 프런트에 두면 그대로 공개되기
 * 때문이다. 그 원칙은 그대로 두되, 환경변수가 없는 기기에서도 관리자가 자기 키를
 * 붙여넣어 쓸 수 있게 요청 헤더(x-sg-key)를 하나 더 받는다.
 *
 * 요청 키가 오면 그것을, 없으면 환경변수를 쓴다. 요청 키는 이 호출 안에서만 살고
 * 어디에도 저장·기록하지 않는다. 로그에 남기지 말 것 — 그 순간 공유 자원이 된다.
 *
 * 전역이 아니라 인자로 넘기는 이유: 서버리스 런타임은 한 인스턴스에서 요청을 동시에
 * 처리할 수 있다. 모듈 전역에 담아 두면 다른 관리자의 키로 합성될 수 있다.
 */
function credsFrom(req) {
  const h = String((req && req.headers && req.headers['x-sg-key']) || '').trim();
  return { key: h };
}
function xiKey(C) { return (C && C.key) || env('ELEVENLABS_API_KEY'); }

const PROVIDER = {
  id: PROVIDER_ID,
  label: 'ElevenLabs',
  mp3: 'native',
  gap: false,                      // 서버에 ffmpeg 이 없어 무음을 못 만든다
  free: '가입 시 무료 크레딧, 이후 유료',
  models: XI_MODELS,
  defaultModel: XI_DEFAULT_MODEL,
  langs: [],                       // 다국어 모델이 언어를 자동 판별한다
  acceptsKey: true,
  envVar: 'ELEVENLABS_API_KEY',
  why: 'ELEVENLABS_API_KEY 미설정'
};

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

/* ── 합성 ────────────────────────────────────────────────
   speed 는 ElevenLabs 의 낭독 속도(0.7 가장 느림 … 1.2 가장 빠름)다. Flash v2.5 는
   짧은 문장을 시험 페이스보다 훨씬 빠르게 읽어서(측정 220wpm, 리스닝 대역 150–180wpm)
   SET 9 정본도 0.75 로 만들었다. 화면의 rate 칸이 이 값으로 간다. */
async function synth(seg, o, C) {
  const body = { text: seg.text, model_id: o.model, output_format: XI_OUTPUT };
  if (o.speed !== 1) body.voice_settings = { speed: o.speed };
  const r = await fetch(XI_TTS + encodeURIComponent(seg.voice) + '?output_format=' + XI_OUTPUT, {
    method: 'POST',
    headers: { 'xi-api-key': xiKey(C), 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw await fail(r);
  return Buffer.from(await r.arrayBuffer());
}

async function voices(C) {
  const r = await fetch(XI_VOICES, { headers: { 'xi-api-key': xiKey(C) } });
  if (!r.ok) throw await fail(r);
  const j = await r.json();
  return (j.voices || []).map((v) => ({
    id: v.voice_id, name: v.name, lang: (v.labels && v.labels.accent) || '',
    gender: (v.labels && v.labels.gender) || '', family: (v.labels && v.labels.use_case) || v.category || ''
  }));
}

/* ── 핸들러 ─────────────────────────────────────────────── */

module.exports = async function handler(req, res) {
  const token = env('SG_TTS_TOKEN');
  if (!token) return json(res, 503, { error: 'SG_TTS_TOKEN is not configured — the endpoint stays closed.' });
  if ((req.headers['x-sg-token'] || '') !== token) return json(res, 401, { error: 'Bad or missing x-sg-token.' });

  const CRED = credsFrom(req);
  // ready  : 지금 이 요청으로 합성 가능한가(서버 키 또는 방금 보낸 키)
  // envReady: 서버 환경변수만으로 가능한가 — 화면이 "서버에 설정됨"과
  //           "이 기기의 키로 동작 중"을 구분해 보여줄 수 있어야 한다.
  const ready = !!xiKey(CRED);
  const envReady = !!env('ELEVENLABS_API_KEY');

  if (req.method === 'GET') {
    const p = Object.assign({}, PROVIDER, { ready, envReady, note: ready ? '' : PROVIDER.why });
    const out = { providers: [p], voices: {}, langs: [] };
    if (ready) {
      try { out.voices[PROVIDER_ID] = await voices(CRED); }
      catch (e) {
        /* 목록을 못 받아도 합성은 되는 경우가 있다 — 키에 voices_read 권한만 없는 것이
           대표적이다. 그때 화면은 SET 9 배역표 13인으로 서므로 일은 되지만, 이유를
           말해 주지 않으면 "내 계정 목소리가 왜 안 보이지" 로 끝난다. */
        out.voices[PROVIDER_ID] = [];
        out.voicesError = String(e.message || e);
      }
    }
    return json(res, 200, out);
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return json(res, 405, { error: 'Use POST.' });
  }

  let body;
  try { body = await readBody(req); }
  catch (e) { return json(res, 400, { error: String(e.message || e) }); }

  // provider 를 굳이 보내 왔다면 ElevenLabs 여야 한다. 다른 이름을 조용히 ElevenLabs 로
  // 바꿔 처리하면, 화면이 잘못된 엔진을 고른 채로도 성공한 것처럼 보인다.
  const pid = String(body.provider || PROVIDER_ID).toLowerCase();
  if (pid !== PROVIDER_ID) {
    return json(res, 400, { error: 'This endpoint only speaks ElevenLabs (got: ' + pid + ').' });
  }
  if (!ready) {
    return json(res, 503, { error: 'ElevenLabs 키가 없다 (' + PROVIDER.why +
      '). 서버 환경변수에 넣거나 화면에서 키를 붙여넣어라.' });
  }

  const model = body.model && XI_MODELS.indexOf(String(body.model)) >= 0
    ? String(body.model) : XI_DEFAULT_MODEL;

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
    if (!RE_VOICE.test(String(s.voice || ''))) {
      return json(res, 400, { error: 'Unknown ElevenLabs voice id: ' + s.voice });
    }
    total += s.text.length;
  }
  if (total > MAX_CHARS_TOTAL) {
    return json(res, 400, { error: 'Script is longer than ' + MAX_CHARS_TOTAL + ' characters.' });
  }

  // ElevenLabs 의 speed 범위는 0.7–1.2 다. 화면은 0.5–1.5 를 받지만 그대로 보내면
  // 422 로 튕기므로 여기서 접는다.
  const opts = { model, speed: Math.max(0.7, Math.min(1.2, Number(body.rate) || 1)) };

  try {
    // 세그먼트는 병렬로 합성하고 순서대로 이어 붙인다(함수 실행시간 제한 대비).
    const parts = await Promise.all(segments.map((seg) => synth(seg, opts, CRED)));
    const mp3 = Buffer.concat(parts);
    return json(res, 200, {
      audio: mp3.toString('base64'), mime: 'audio/mpeg', bytes: mp3.length,
      chars: total, segments: segments.length, provider: PROVIDER_ID, model,
      speed: opts.speed,
      gapApplied: false
    });
  } catch (e) {
    return json(res, e.status || 502, { error: String(e.message || e) });
  }
};
