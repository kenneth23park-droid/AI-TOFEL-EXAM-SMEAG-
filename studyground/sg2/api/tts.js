/* SMEAG StudyGround — /api/tts : 문항 스크립트 → 음성(mp3) 생성.
 *
 * 왜 서버가 필요한가
 *   정적 사이트라 프런트에 TTS API 키를 두면 그대로 공개된다. 그래서 키는 Vercel
 *   환경변수에만 두고, 브라우저는 이 함수에 스크립트만 보낸다.
 *
 * 필요한 환경변수 (Vercel → Project → Settings → Environment Variables)
 *   GOOGLE_TTS_API_KEY  Google Cloud Text-to-Speech API 키 (tools/tts_google.py 와 같은 키)
 *   SG_TTS_TOKEN        이 엔드포인트를 열 수 있는 공용 토큰. 없으면 함수는 503 으로 닫힌다
 *                       (열린 채로 두면 남의 요청이 그대로 과금된다).
 *
 * 계약
 *   POST /api/tts   { segments: [{ text, voice, lang? }], gapMs?, rate?, pitch? }
 *                   헤더 x-sg-token: <SG_TTS_TOKEN>
 *        → 200 { audio: <base64 mp3>, mime:'audio/mpeg', chars, segments }
 *   GET  /api/tts?voices=1   → 200 { voices:[{name, lang, gender}] }  (en-* 만)
 *
 * 여러 화자는 세그먼트마다 따로 합성한 뒤 mp3 를 이어 붙인다. 화자 사이 간격은
 * ffmpeg 무음 파일이 아니라 SSML <break> 로 넣는다 — 서버리스에는 ffmpeg 이 없다.
 * (tools/tts_google.py 는 ffmpeg 로 stitch 하며, 결과물 성격은 같다.)
 */

'use strict';

const SYNTH = 'https://texttospeech.googleapis.com/v1/text:synthesize';
const VOICES = 'https://texttospeech.googleapis.com/v1/voices';

/* 비용·지연 상한. 시험 한 문항 분량은 넉넉히 들어가고, 실수로 책 한 권을 보내면 막힌다. */
const MAX_SEGMENTS = 20;
const MAX_CHARS_PER_SEGMENT = 1200;
const MAX_CHARS_TOTAL = 6000;

/* 목소리 이름 허용 규칙 — 임의 문자열이 그대로 구글로 넘어가지 않게 한다. */
const VOICE_RE = /^en-(US|GB|AU|IN)-(Neural2|Wavenet|Standard|Studio|Journey|Polyglot)-[A-Z]$/;

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

function langOf(voice, given) {
  if (given && /^[a-z]{2}-[A-Z]{2}$/.test(given)) return given;
  const m = /^([a-z]{2}-[A-Z]{2})-/.exec(voice);
  return m ? m[1] : 'en-US';
}

async function google(url, init) {
  const r = await fetch(url, init);
  const text = await r.text();
  let body = null;
  try { body = JSON.parse(text); } catch (e) { /* 비-JSON 오류 본문 */ }
  if (!r.ok) {
    const msg = (body && body.error && body.error.message) || text.slice(0, 300) || ('HTTP ' + r.status);
    const err = new Error(msg);
    err.status = r.status;
    throw err;
  }
  return body;
}

async function synthSegment(key, seg, gapMs, rate, pitch) {
  const ssml = '<speak>' + xml(seg.text) +
    (gapMs > 0 ? '<break time="' + gapMs + 'ms"/>' : '') + '</speak>';
  const body = {
    input: { ssml },
    voice: { languageCode: langOf(seg.voice, seg.lang), name: seg.voice },
    audioConfig: {
      audioEncoding: 'MP3',
      speakingRate: rate,
      pitch: pitch,
      sampleRateHertz: 24000      // 세그먼트를 이어 붙이려면 포맷이 같아야 한다.
    }
  };
  const out = await google(SYNTH + '?key=' + encodeURIComponent(key), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!out || !out.audioContent) throw new Error('empty audio from provider');
  return Buffer.from(out.audioContent, 'base64');
}

module.exports = async function handler(req, res) {
  const key = process.env.GOOGLE_TTS_API_KEY || process.env.GOOGLE_API_KEY || '';
  const token = process.env.SG_TTS_TOKEN || '';

  if (!token) {
    return json(res, 503, { error: 'SG_TTS_TOKEN is not configured — the endpoint stays closed.' });
  }
  if ((req.headers['x-sg-token'] || '') !== token) {
    return json(res, 401, { error: 'Bad or missing x-sg-token.' });
  }
  if (!key) {
    return json(res, 503, { error: 'GOOGLE_TTS_API_KEY is not configured on the server.' });
  }

  // 목소리 목록 — 관리자 화면의 드롭다운이 쓴다.
  if (req.method === 'GET') {
    try {
      const out = await google(VOICES + '?key=' + encodeURIComponent(key) + '&languageCode=en-US');
      const all = [];
      for (const lc of ['en-US', 'en-GB', 'en-AU']) {
        const r = lc === 'en-US' ? out : await google(VOICES + '?key=' + encodeURIComponent(key) + '&languageCode=' + lc);
        (r.voices || []).forEach((v) => {
          if (VOICE_RE.test(v.name)) all.push({ name: v.name, lang: lc, gender: v.ssmlGender });
        });
      }
      return json(res, 200, { voices: all });
    } catch (e) {
      return json(res, e.status || 502, { error: String(e.message || e) });
    }
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return json(res, 405, { error: 'Use POST.' });
  }

  let body;
  try { body = await readBody(req); }
  catch (e) { return json(res, 400, { error: String(e.message || e) }); }

  const segments = Array.isArray(body.segments) ? body.segments : null;
  if (!segments || !segments.length) {
    return json(res, 400, { error: 'segments[] is required.' });
  }
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
    if (!VOICE_RE.test(String(s.voice || ''))) {
      return json(res, 400, { error: 'Unknown voice: ' + s.voice });
    }
    total += s.text.length;
  }
  if (total > MAX_CHARS_TOTAL) {
    return json(res, 400, { error: 'Script is longer than ' + MAX_CHARS_TOTAL + ' characters.' });
  }

  const gapMs = Math.max(0, Math.min(2000, Number(body.gapMs == null ? 400 : body.gapMs) || 0));
  const rate = Math.max(0.5, Math.min(1.5, Number(body.rate) || 1));
  const pitch = Math.max(-10, Math.min(10, Number(body.pitch) || 0));

  try {
    // 세그먼트는 병렬로 합성하고 순서대로 이어 붙인다(함수 실행시간 제한 대비).
    const parts = await Promise.all(
      segments.map((seg, i) =>
        synthSegment(key, seg, i === segments.length - 1 ? 0 : gapMs, rate, pitch))
    );
    const mp3 = Buffer.concat(parts);
    return json(res, 200, {
      audio: mp3.toString('base64'),
      mime: 'audio/mpeg',
      bytes: mp3.length,
      chars: total,
      segments: segments.length
    });
  } catch (e) {
    return json(res, e.status || 502, { error: String(e.message || e) });
  }
};
