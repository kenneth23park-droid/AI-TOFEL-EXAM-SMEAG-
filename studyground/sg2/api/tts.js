/* SMEAG StudyGround — /api/tts : 문항 스크립트 → 음성(mp3) 생성.
 *
 * 왜 서버가 필요한가
 *   정적 사이트라 프런트에 TTS API 키를 두면 그대로 공개된다. 그래서 키는 Vercel
 *   환경변수에만 두고, 브라우저는 이 함수에 스크립트만 보낸다.
 *
 * 여기 실린 엔진은 전부 **mp3 를 그대로 내주는** 것들이다. 서버리스에는 ffmpeg 이 없어
 * wav→mp3 변환을 할 수 없으므로, mp3 네이티브가 아닌 엔진은 애초에 넣지 않았다.
 *
 *   google      Google Cloud TTS      MP3          GOOGLE_TTS_API_KEY   월 100만자 무료 티어
 *   elevenlabs  ElevenLabs            MP3          ELEVENLABS_API_KEY   무료 크레딧 후 유료
 *   azure       Azure AI Speech       MP3          AZURE_TTS_KEY(+REGION) 월 50만자 무료 티어
 *   openai      OpenAI TTS            MP3          OPENAI_API_KEY       유료
 *   kokoro      Kokoro-82M (Apache-2.0, 오픈소스)  — 로컬 전용. tools/tts_kokoro.py 로
 *               이 기기에서 돌린다(키·비용 없음). 브라우저에서는 호출할 수 없어 목록에만 뜬다.
 *
 * 키가 설정된 엔진만 목록에 나오고, 나머지는 화면에서 잠긴 채로 이유가 표시된다.
 *
 * 필요한 환경변수 (Vercel → Project → Settings → Environment Variables)
 *   SG_TTS_TOKEN  이 엔드포인트를 열 수 있는 공용 토큰. 없으면 함수는 503 으로 닫힌다
 *                 (열린 채로 두면 남의 요청이 그대로 과금된다).
 *   + 쓰려는 엔진의 키 하나 이상.
 *
 * 계약
 *   GET  /api/tts[?lang=en-US,en-GB]
 *        → { providers:[{id,label,ready,mp3,free,note,models,langs,gap}], voices:{provider:[…]} }
 *   POST /api/tts { provider?, model?, lang?, gapMs?, rate?, pitch?,
 *                   segments:[{text, voice, lang?}] }   헤더 x-sg-token
 *        → { audio:<base64 mp3>, mime:'audio/mpeg', bytes, chars, segments, provider, model }
 *
 * 화자별로 다른 voice 를 줄 수 있고, 세그먼트를 각각 합성해 mp3 를 이어 붙인다.
 * 화자 사이 간격은 SSML <break> 를 쓰는 엔진(google·azure)에서만 적용된다.
 */

'use strict';

const G_SYNTH = 'https://texttospeech.googleapis.com/v1/text:synthesize';
const G_VOICES = 'https://texttospeech.googleapis.com/v1/voices';
const XI_TTS = 'https://api.elevenlabs.io/v1/text-to-speech/';
const XI_VOICES = 'https://api.elevenlabs.io/v1/voices';
const OA_TTS = 'https://api.openai.com/v1/audio/speech';

/* 비용·지연 상한. 시험 한 문항 분량은 넉넉히 들어가고, 실수로 책 한 권을 보내면 막힌다. */
const MAX_SEGMENTS = 20;
const MAX_CHARS_PER_SEGMENT = 1200;
const MAX_CHARS_TOTAL = 6000;

/* 임의 문자열이 그대로 공급자에게 넘어가지 않게 하는 허용 규칙. */
const RE = {
  gVoice: /^[a-z]{2,3}-[A-Z]{2}-[A-Za-z0-9]+(-[A-Za-z0-9]+){0,2}$/,   // en-US-Neural2-C, ko-KR-Wavenet-A
  xiVoice: /^[A-Za-z0-9]{15,32}$/,                                     // ElevenLabs voice_id
  azVoice: /^[a-z]{2,3}-[A-Z]{2}-[A-Za-z0-9]+$/,                       // en-US-JennyNeural
  oaVoice: /^[a-z]{3,10}$/,                                            // alloy, nova, …
  lang: /^[a-z]{2,3}-[A-Z]{2}$/
};

const DEFAULT_LANGS = ['en-US', 'en-GB', 'en-AU'];
const ALL_LANGS = ['en-US', 'en-GB', 'en-AU', 'en-IN', 'ko-KR', 'ja-JP', 'zh-CN'];

const OA_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'];

function env(n) { return process.env[n] || ''; }

/* 자격증명 해석.
 *
 * 키는 원래 서버 환경변수에만 뒀다. 정적 사이트라 프런트에 두면 그대로 공개되기
 * 때문이다. 그 원칙은 그대로 두되, 환경변수가 없는 기기에서도 관리자가 자기 키를
 * 붙여넣어 쓸 수 있게 요청 헤더를 하나 더 받는다.
 *
 *   x-sg-key      선택한 엔진의 API 키
 *   x-sg-region   Azure 전용 리전
 *
 * 요청 키가 오면 그것을, 없으면 환경변수를 쓴다. 요청 키는 이 호출 안에서만 살고
 * 어디에도 저장·기록하지 않는다. 로그에 남기지 말 것 — 그 순간 공유 자원이 된다.
 *
 * 전역이 아니라 인자로 넘기는 이유: 서버리스 런타임은 한 인스턴스에서 요청을 동시에
 * 처리할 수 있다. 모듈 전역에 담아 두면 다른 관리자의 키로 합성될 수 있다.
 */
function credsFrom(req) {
  const h = (n) => String((req && req.headers && req.headers[n]) || '').trim();
  return { key: h('x-sg-key'), region: h('x-sg-region') };
}
function googleKey(C) { return (C && C.key) || env('GOOGLE_TTS_API_KEY') || env('GOOGLE_API_KEY'); }
function xiKey(C) { return (C && C.key) || env('ELEVENLABS_API_KEY'); }
function oaKey(C) { return (C && C.key) || env('OPENAI_API_KEY'); }
function azKey(C) { return (C && C.key) || env('AZURE_TTS_KEY'); }
function azRegion(C) { return (C && C.region) || env('AZURE_TTS_REGION'); }

/* ── 엔진 정의 ─────────────────────────────────────────────
   models 는 화면의 "언어 모델" 드롭다운 값이다. Google/Azure 는 모델 계열이 목소리
   이름에 들어 있어(Neural2·Wavenet·…) 목록을 거르는 필터로 쓰이고, ElevenLabs·OpenAI 는
   실제 요청의 model_id 로 나간다. */
const PROVIDERS = {
  google: {
    label: 'Google Cloud TTS', mp3: 'native', gap: true,
    free: '월 100만자 무료 티어 (WaveNet 100만자)',
    models: ['Neural2', 'Wavenet', 'Standard', 'Studio', 'Journey', 'Polyglot', 'Chirp3'],
    langs: ALL_LANGS,
    ready: (C) => !!googleKey(C),
    envVar: 'GOOGLE_TTS_API_KEY', acceptsKey: true,
    why: 'GOOGLE_TTS_API_KEY 미설정'
  },
  elevenlabs: {
    label: 'ElevenLabs', mp3: 'native', gap: false,
    free: '가입 시 무료 크레딧, 이후 유료',
    models: ['eleven_multilingual_v2', 'eleven_flash_v2_5', 'eleven_turbo_v2_5', 'eleven_v3'],
    defaultModel: 'eleven_multilingual_v2',
    langs: [],                       // 다국어 모델이 언어를 자동 판별한다
    ready: (C) => !!xiKey(C),
    envVar: 'ELEVENLABS_API_KEY', acceptsKey: true,
    why: 'ELEVENLABS_API_KEY 미설정'
  },
  azure: {
    label: 'Azure AI Speech', mp3: 'native', gap: true,
    free: '월 50만자 무료 티어 (F0)',
    models: ['Neural'],
    langs: ALL_LANGS,
    ready: (C) => !!(azKey(C) && azRegion(C)),
    envVar: 'AZURE_TTS_KEY', acceptsKey: true, needsRegion: true,
    why: 'AZURE_TTS_KEY / AZURE_TTS_REGION 미설정'
  },
  openai: {
    label: 'OpenAI TTS', mp3: 'native', gap: false,
    free: '무료 티어 없음',
    models: ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd'],
    defaultModel: 'gpt-4o-mini-tts',
    langs: [],
    ready: (C) => !!oaKey(C),
    envVar: 'OPENAI_API_KEY', acceptsKey: true,
    why: 'OPENAI_API_KEY 미설정'
  },
  kokoro: {
    label: 'Kokoro-82M (오픈소스)', mp3: 'local', gap: true,
    free: '완전 무료 · Apache-2.0 · 키 없음',
    models: ['kokoro-82m'], langs: ALL_LANGS, local: true,
    ready: () => false,
    why: '로컬 전용 — 이 기기에서 tools/tts_kokoro.py 로 생성합니다(서버 호출 불가)'
  }
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

function xml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function langOf(voice, given, fallback) {
  if (given && RE.lang.test(given)) return given;
  const m = /^([a-z]{2,3}-[A-Z]{2})-/.exec(voice || '');
  return m ? m[1] : (fallback || 'en-US');
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

/* ── 엔진별 합성 (모두 mp3 바이트를 돌려준다) ───────────── */

async function synthGoogle(seg, o, C) {
  const ssml = '<speak>' + xml(seg.text) + (o.gapMs > 0 ? '<break time="' + o.gapMs + 'ms"/>' : '') + '</speak>';
  const r = await fetch(G_SYNTH + '?key=' + encodeURIComponent(googleKey(C)), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: { ssml },
      voice: { languageCode: langOf(seg.voice, seg.lang || o.lang), name: seg.voice },
      audioConfig: { audioEncoding: 'MP3', speakingRate: o.rate, pitch: o.pitch, sampleRateHertz: 24000 }
    })
  });
  if (!r.ok) throw await fail(r);
  const j = await r.json();
  if (!j.audioContent) throw new Error('empty audio from Google');
  return Buffer.from(j.audioContent, 'base64');
}

async function synthEleven(seg, o, C) {
  const r = await fetch(XI_TTS + encodeURIComponent(seg.voice) + '?output_format=mp3_44100_128', {
    method: 'POST',
    headers: { 'xi-api-key': xiKey(C), 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text: seg.text, model_id: o.model })
  });
  if (!r.ok) throw await fail(r);
  return Buffer.from(await r.arrayBuffer());
}

async function synthAzure(seg, o, C) {
  const region = azRegion(C);
  const lang = langOf(seg.voice, seg.lang || o.lang);
  const ssml =
    '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="' + lang + '">' +
      '<voice name="' + xml(seg.voice) + '">' +
        '<prosody rate="' + Math.round((o.rate - 1) * 100) + '%">' + xml(seg.text) + '</prosody>' +
        (o.gapMs > 0 ? '<break time="' + o.gapMs + 'ms"/>' : '') +
      '</voice></speak>';
  const r = await fetch('https://' + region + '.tts.speech.microsoft.com/cognitiveservices/v1', {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': azKey(C),
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-96kbitrate-mono-mp3',
      'User-Agent': 'smeag-studyground'
    },
    body: ssml
  });
  if (!r.ok) throw await fail(r);
  return Buffer.from(await r.arrayBuffer());
}

async function synthOpenAI(seg, o, C) {
  const r = await fetch(OA_TTS, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + oaKey(C), 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: o.model, voice: seg.voice, input: seg.text, response_format: 'mp3', speed: o.rate })
  });
  if (!r.ok) throw await fail(r);
  return Buffer.from(await r.arrayBuffer());
}

const SYNTH = { google: synthGoogle, elevenlabs: synthEleven, azure: synthAzure, openai: synthOpenAI };
const VOICE_OK = { google: RE.gVoice, elevenlabs: RE.xiVoice, azure: RE.azVoice, openai: RE.oaVoice };

/* ── 엔진별 목소리 목록 ─────────────────────────────────── */

async function voicesGoogle(langs, C) {
  const out = [], seen = new Set();
  for (const lc of langs) {
    const r = await fetch(G_VOICES + '?key=' + encodeURIComponent(googleKey(C)) + '&languageCode=' + lc);
    if (!r.ok) continue;
    const j = await r.json();
    (j.voices || []).forEach((v) => {
      if (!RE.gVoice.test(v.name)) return;
      // 다국어 목소리는 여러 로케일 조회에 함께 나온다 — 이름 자체가 그 로케일인 것만, 한 번씩.
      if (v.name.indexOf(lc + '-') !== 0 || seen.has(v.name)) return;
      seen.add(v.name);
      const parts = v.name.split('-');
      out.push({ id: v.name, name: v.name, lang: lc, gender: v.ssmlGender || '',
                 family: parts.slice(2, parts.length - 1).join('-') || parts[2] });
    });
  }
  return out;
}
async function voicesEleven(C) {
  const r = await fetch(XI_VOICES, { headers: { 'xi-api-key': xiKey(C) } });
  if (!r.ok) throw await fail(r);
  const j = await r.json();
  return (j.voices || []).map((v) => ({
    id: v.voice_id, name: v.name, lang: (v.labels && v.labels.accent) || '',
    gender: (v.labels && v.labels.gender) || '', family: (v.labels && v.labels.use_case) || v.category || ''
  }));
}
async function voicesAzure(langs, C) {
  const region = azRegion(C);
  const r = await fetch('https://' + region + '.tts.speech.microsoft.com/cognitiveservices/voices/list',
    { headers: { 'Ocp-Apim-Subscription-Key': azKey(C) } });
  if (!r.ok) throw await fail(r);
  const j = await r.json();
  return j.filter((v) => langs.indexOf(v.Locale) >= 0 && RE.azVoice.test(v.ShortName))
    .map((v) => ({ id: v.ShortName, name: v.DisplayName || v.ShortName, lang: v.Locale,
                   gender: v.Gender || '', family: v.VoiceType || 'Neural' }));
}
function voicesOpenAI() {
  return OA_VOICES.map((v) => ({ id: v, name: v, lang: '', gender: '', family: 'gpt-4o' }));
}

/* ── 핸들러 ─────────────────────────────────────────────── */

module.exports = async function handler(req, res) {
  const token = env('SG_TTS_TOKEN');
  if (!token) return json(res, 503, { error: 'SG_TTS_TOKEN is not configured — the endpoint stays closed.' });
  if ((req.headers['x-sg-token'] || '') !== token) return json(res, 401, { error: 'Bad or missing x-sg-token.' });

  // 어떤 엔진이 준비돼 있고, 각각 무슨 모델·언어를 고를 수 있는지.
  if (req.method === 'GET') {
    const CRED = credsFrom(req);
    const url = new URL(req.url, 'http://x');
    const want = (url.searchParams.get('provider') || '').toLowerCase();
    const langs = (url.searchParams.get('lang') || DEFAULT_LANGS.join(','))
      .split(',').map((s) => s.trim()).filter((s) => RE.lang.test(s)).slice(0, 8);

    const providers = Object.keys(PROVIDERS).map((id) => {
      const p = PROVIDERS[id];
      // ready  : 지금 이 요청으로 합성 가능한가(서버 키 또는 방금 보낸 키)
      // envReady: 서버 환경변수만으로 가능한가 — 화면이 "서버에 설정됨"과
      //           "이 기기의 키로 동작 중"을 구분해 보여줄 수 있어야 한다.
      return { id, label: p.label, mp3: p.mp3, gap: !!p.gap, free: p.free, local: !!p.local,
               models: p.models, defaultModel: p.defaultModel || p.models[0], langs: p.langs,
               acceptsKey: !!p.acceptsKey, envVar: p.envVar || '', needsRegion: !!p.needsRegion,
               ready: p.ready(CRED), envReady: p.ready(null), note: p.ready(CRED) ? '' : p.why };
    });

    const voices = {};
    const ask = want && PROVIDERS[want] ? [want] : Object.keys(PROVIDERS).filter((id) => PROVIDERS[id].ready(CRED));
    for (const id of ask) {
      if (!PROVIDERS[id] || !PROVIDERS[id].ready(CRED)) continue;
      try {
        voices[id] = id === 'google' ? await voicesGoogle(langs, CRED)
                   : id === 'elevenlabs' ? await voicesEleven(CRED)
                   : id === 'azure' ? await voicesAzure(langs, CRED)
                   : voicesOpenAI();
      } catch (e) { voices[id] = []; }
    }
    return json(res, 200, { providers, voices, langs: ALL_LANGS });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return json(res, 405, { error: 'Use POST.' });
  }

  let body;
  try { body = await readBody(req); }
  catch (e) { return json(res, 400, { error: String(e.message || e) }); }

  const CRED = credsFrom(req);
  const pid = String(body.provider || 'google').toLowerCase();
  const P = PROVIDERS[pid];
  if (!P) return json(res, 400, { error: 'Unknown provider: ' + pid });
  if (P.local) return json(res, 400, { error: P.label + ' runs locally — use tools/tts_kokoro.py, then upload the mp3.' });
  if (!P.ready(CRED)) return json(res, 503, { error: P.label + ' 키가 없다 (' + P.why + '). 서버 환경변수에 넣거나 화면에서 키를 붙여넣어라.' });

  const model = body.model && P.models.indexOf(String(body.model)) >= 0
    ? String(body.model) : (P.defaultModel || P.models[0]);
  const lang = RE.lang.test(String(body.lang || '')) ? String(body.lang) : '';

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
    if (!VOICE_OK[pid].test(String(s.voice || ''))) {
      return json(res, 400, { error: 'Unknown voice for ' + P.label + ': ' + s.voice });
    }
    total += s.text.length;
  }
  if (total > MAX_CHARS_TOTAL) {
    return json(res, 400, { error: 'Script is longer than ' + MAX_CHARS_TOTAL + ' characters.' });
  }

  const opts = {
    model: model,
    lang: lang,
    gapMs: P.gap ? Math.max(0, Math.min(2000, Number(body.gapMs == null ? 400 : body.gapMs) || 0)) : 0,
    rate: Math.max(0.5, Math.min(1.5, Number(body.rate) || 1)),
    pitch: Math.max(-10, Math.min(10, Number(body.pitch) || 0))
  };

  try {
    // 세그먼트는 병렬로 합성하고 순서대로 이어 붙인다(함수 실행시간 제한 대비).
    const parts = await Promise.all(segments.map((seg, i) =>
      SYNTH[pid](seg, Object.assign({}, opts, { gapMs: i === segments.length - 1 ? 0 : opts.gapMs }), CRED)));
    const mp3 = Buffer.concat(parts);
    return json(res, 200, {
      audio: mp3.toString('base64'), mime: 'audio/mpeg', bytes: mp3.length,
      chars: total, segments: segments.length, provider: pid, model: model,
      gapApplied: !!P.gap
    });
  } catch (e) {
    return json(res, e.status || 502, { error: String(e.message || e) });
  }
};
