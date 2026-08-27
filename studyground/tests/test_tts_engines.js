/* /api/tts 의 엔진 계약 검증.
 * 실행: node studyground/tests/test_tts_engines.js
 *
 * 엔진은 다섯이고 기본은 ElevenLabs 다. 시험 음성 정본(media/audio/set9/)이 전부
 * ElevenLabs 로 만들어졌고 배역표의 voice_id 도 그 계정 것이라, **이미 있는 세트의 한
 * 문항**을 다른 엔진으로 다시 만들면 그 문항만 목소리가 튄다 — 리스닝은 "누가
 * 말하는가" 가 문항의 일부다. 새 세트를 통째로 지을 때만 다른 엔진을 쓴다.
 *
 * 그래서 여기서 고정하는 것은 두 가지다.
 *   1. ElevenLabs 로 가는 요청은 예전과 **글자 하나 다르지 않다** (정본과 같은 소리).
 *   2. 엔진마다 목소리 이름·속도 범위가 다르고, 그 검사가 서버에서 끝난다 —
 *      모르는 엔진 이름도, 남의 엔진 목소리 이름도 조용히 나가지 않는다.
 *
 * 네트워크는 타지 않는다 — fetch 를 가로채 요청 모양만 본다.
 */
var path = require('path');

var fails = [];
function check(name, actual, expected) {
  var a = typeof actual === 'object' ? JSON.stringify(actual) : String(actual);
  var e = typeof expected === 'object' ? JSON.stringify(expected) : String(expected);
  var ok = a === e;
  console.log((ok ? '  ok   ' : '  FAIL ') + name + ': ' + a + (ok ? '' : '  (expected ' + e + ')'));
  if (!ok) fails.push(name);
}

var handler = require(path.join(__dirname, '..', 'sg2', 'api', 'tts.js'));

/* 서버리스 req/res 흉내. body 는 이미 객체로 실어 준다(플랫폼이 그렇게 준다). */
function call(opts) {
  var req = { method: opts.method || 'GET', url: opts.url || '/api/tts',
              headers: opts.headers || {}, body: opts.body };
  return new Promise(function (resolve) {
    var res = {
      statusCode: 200,
      setHeader: function () {},
      end: function (text) {
        var j = null; try { j = JSON.parse(text); } catch (e) {}
        resolve({ status: res.statusCode, body: j });
      }
    };
    handler(req, res);
  });
}

/** 16bit mono PCM WAV 한 개 — Qwen 이 내주는 모양을 흉내 낸다. */
function wavOf(bytes) {
  var b = Buffer.alloc(44 + bytes.length);
  b.write('RIFF', 0); b.writeUInt32LE(36 + bytes.length, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(24000, 24); b.writeUInt32LE(48000, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(bytes.length, 40);
  Buffer.from(bytes).copy(b, 44);
  return b;
}

var seen = [];                       // 가로챈 요청들
function stubFetch(kind) {
  global.fetch = function (url, init) {
    seen.push({ url: String(url), init: init || {} });
    if (kind === 'voices') {
      var u = String(url);
      if (u.indexOf('elevenlabs') >= 0) {
        return Promise.resolve({ ok: true, json: function () {
          return Promise.resolve({ voices: [{ voice_id: 'FGY2WhTYpPnrIDTdsKH5', name: 'Laura',
                                              labels: { accent: 'en-US', gender: 'female' } }] });
        } });
      }
      if (u.indexOf('texttospeech.googleapis.com') >= 0) {
        return Promise.resolve({ ok: true, json: function () {
          return Promise.resolve({ voices: [
            { name: 'en-GB-Neural2-A', languageCodes: ['en-GB'], ssmlGender: 'FEMALE' },
            { name: 'ko-KR-Neural2-A', languageCodes: ['ko-KR'], ssmlGender: 'FEMALE' }
          ] });
        } });
      }
      return Promise.resolve({ ok: true, json: function () {
        return Promise.resolve({ tts: [{ name: 'aura-2-thalia-en', canonical_name: 'aura-2-thalia-en',
                                         languages: ['en'], metadata: {} }] });
      } });
    }
    if (kind === 'qwen') {
      /* DashScope 는 오디오를 base64(또는 24시간짜리 임시 URL)로 준다. 여기서는
         토막마다 다른 WAV 를 돌려줘 이어 붙인 결과를 확인한다. */
      var n = seen.length;                       // 첫 요청 1,2 · 두 번째 3,4
      return Promise.resolve({ ok: true, json: function () {
        return Promise.resolve({ output: { audio: { data: wavOf([n * 2 - 1, n * 2]).toString('base64') } } });
      } });
    }
    if (kind === 'google-tts') {
      return Promise.resolve({ ok: true, json: function () {
        return Promise.resolve({ audioContent: Buffer.from([0xff, 0xfb, 0, 0]).toString('base64') });
      } });
    }
    return Promise.resolve({ ok: true, arrayBuffer: function () {
      return Promise.resolve(new Uint8Array([0xff, 0xfb, 0, 0]).buffer);
    } });
  };
}

var TOKEN = 'test-token';
var VOICE = 'FGY2WhTYpPnrIDTdsKH5';       // SET 9 배역표의 실제 voice_id (US-Ava)

function post(body, headers) {
  var h = { 'x-sg-token': TOKEN };
  Object.keys(headers || {}).forEach(function (k) { h[k] = headers[k]; });
  return call({ method: 'POST', headers: h, body: body });
}
function pick(list, id) { return list.filter(function (p) { return p.id === id; })[0]; }

var ENV = ['ELEVENLABS_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_TTS_API_KEY', 'DEEPGRAM_API_KEY'];
function clearKeys() { ENV.forEach(function (n) { delete process.env[n]; }); }

(async function () {
  /* 토큰이 없으면 함수는 아예 닫혀 있다 — 열린 채로 두면 남의 요청이 그대로 과금된다. */
  delete process.env.SG_TTS_TOKEN;
  clearKeys();
  var r = await call({});
  check('토큰 미설정이면 503', r.status, 503);

  process.env.SG_TTS_TOKEN = TOKEN;
  r = await call({});
  check('토큰이 틀리면 401', r.status, 401);

  /* 목록: 엔진 다섯이 모두 보이고, 키가 없는 것은 이유를 달고 잠긴 채로 보인다.
     "안 보인다" 와 "키가 없다" 는 다른 말이다 — 화면이 그 둘을 구분해 줘야 한다. */
  stubFetch('voices');
  seen = [];
  r = await call({ headers: { 'x-sg-token': TOKEN } });
  check('GET 은 200', r.status, 200);
  check('엔진은 다섯', r.body.providers.map(function (p) { return p.id; }),
    ['elevenlabs', 'openai', 'google', 'deepgram', 'qwen']);
  /* 무료 한도가 있는 엔진은 그렇다고 말해야 한다 — 화면이 그것만 보고 FREE 를 붙인다. */
  check('무료 한도가 있는 엔진은 Qwen 뿐',
    r.body.providers.filter(function (p) { return p.freeTier; }).map(function (p) { return p.id; }),
    ['qwen']);
  check('Qwen 은 WAV 로 내준다고 미리 밝힌다', pick(r.body.providers, 'qwen').mime, 'audio/wav');
  check('나머지는 mp3', pick(r.body.providers, 'elevenlabs').mime, 'audio/mpeg');
  check('키가 없으면 ready 아니다', pick(r.body.providers, 'elevenlabs').ready, false);
  check('이유를 적어 준다', pick(r.body.providers, 'google').why, 'GOOGLE_TTS_API_KEY 미설정');
  check('기본 모델은 시험 정본과 같다', pick(r.body.providers, 'elevenlabs').defaultModel, 'eleven_flash_v2_5');
  check('무음(gap)은 어느 엔진도 못 만든다',
    r.body.providers.every(function (p) { return p.gap === false; }), true);
  check('Deepgram 은 속도를 못 바꾼다고 밝힌다', pick(r.body.providers, 'deepgram').speed, { min: 1, max: 1 });
  check('키가 없으면 목소리 목록도 부르지 않는다', seen.length, 0);

  /* 이 기기 키(x-sg-key)로도 열린다 — 서버 환경변수가 없는 기기를 위한 길이다.
     그 키는 **요청이 지목한 엔진** 의 것으로만 본다. ElevenLabs 키가 Google 을 열면 안 된다. */
  seen = [];
  r = await call({ url: '/api/tts?provider=elevenlabs',
                   headers: { 'x-sg-token': TOKEN, 'x-sg-key': 'sk_local' } });
  check('보내 준 키로 ready 가 된다', pick(r.body.providers, 'elevenlabs').ready, true);
  check('다른 엔진까지 열어 주지는 않는다', pick(r.body.providers, 'google').ready, false);
  check('서버 환경변수로는 아직 아니다', pick(r.body.providers, 'elevenlabs').envReady, false);
  check('목소리 목록을 ElevenLabs 에서 받는다', seen[0].url, 'https://api.elevenlabs.io/v1/voices');
  check('그 키로 부른다', seen[0].init.headers['xi-api-key'], 'sk_local');
  check('목소리는 voice_id 로 온다', r.body.voices.elevenlabs[0].id, VOICE);

  /* Google 목록은 영어만 남긴다 — 시험은 영어로 치른다. */
  seen = [];
  r = await call({ url: '/api/tts?provider=google',
                   headers: { 'x-sg-token': TOKEN, 'x-sg-key': 'g_local' } });
  check('Google 목소리는 영어만', r.body.voices.google.map(function (v) { return v.id; }),
    ['en-GB-Neural2-A']);

  /* 목소리 목록만 막힌 키(voices_read 권한 없음)는 흔하다. 합성은 되므로 화면은
     SET 9 배역표로 서야 하고, 왜 계정 목소리가 안 보이는지는 말해 줘야 한다. */
  global.fetch = function () {
    return Promise.resolve({ ok: false, status: 401, text: function () {
      return Promise.resolve(JSON.stringify({ detail: { message: 'missing the permission voices_read' } }));
    } });
  };
  r = await call({ url: '/api/tts?provider=elevenlabs',
                   headers: { 'x-sg-token': TOKEN, 'x-sg-key': 'sk_scoped' } });
  check('목록이 막혀도 200', r.status, 200);
  check('그래도 ready 는 유지', pick(r.body.providers, 'elevenlabs').ready, true);
  check('목소리는 빈 목록', r.body.voices.elevenlabs, []);
  check('이유를 함께 싣는다', /voices_read/.test(r.body.voicesError || ''), true);

  /* ── 합성 ── */
  process.env.ELEVENLABS_API_KEY = 'sk_server';
  stubFetch('tts');

  /* 모르는 엔진 이름은 조용히 기본값으로 바뀌지 않는다 — 화면이 잘못 고른 채로도
     성공한 것처럼 보이면, 목소리가 튄 뒤에야 알게 된다. */
  seen = [];
  r = await post({ provider: 'azure', segments: [{ text: 'hi', voice: VOICE }] });
  check('모르는 엔진은 400', r.status, 400);
  check('거절한 요청은 밖으로 나가지 않는다', seen.length, 0);

  /* 남의 엔진 목소리 이름도 나가지 않는다. */
  r = await post({ segments: [{ text: 'hi', voice: 'en-US-Neural2-C' }] });
  check('ElevenLabs 에 Google 목소리는 400', r.status, 400);
  r = await post({ provider: 'openai', segments: [{ text: 'hi', voice: VOICE }] },
                 { 'x-sg-key': 'sk_openai' });
  check('OpenAI 에 ElevenLabs voice_id 는 400', r.status, 400);

  /* 키가 없는 엔진은 503 — 400(내 요청이 틀렸다)과 구분되어야 고칠 데를 안다. */
  r = await post({ provider: 'deepgram', segments: [{ text: 'hi', voice: 'aura-2-thalia-en' }] });
  check('키 없는 엔진은 503', r.status, 503);

  /* ElevenLabs 정상 경로 — 정본을 만든 요청과 같아야 한다. */
  seen = [];
  r = await post({ segments: [{ text: 'Where is the student lounge?', voice: VOICE }], rate: 0.75 });
  check('합성은 200', r.status, 200);
  check('provider 를 그대로 알려준다', r.body.provider, 'elevenlabs');
  check('provider 를 안 적으면 ElevenLabs 다', r.body.provider, 'elevenlabs');
  check('모델은 기본값', r.body.model, 'eleven_flash_v2_5');
  check('무음은 넣지 않았다고 알린다', r.body.gapApplied, false);
  check('mp3 가 base64 로 돌아온다', r.body.mime, 'audio/mpeg');
  check('요청은 ElevenLabs 로 간다',
    seen[0].url.indexOf('https://api.elevenlabs.io/v1/text-to-speech/' + VOICE), 0);
  check('서버 키를 쓴다', seen[0].init.headers['xi-api-key'], 'sk_server');
  var sent = JSON.parse(seen[0].init.body);
  check('모델 id 를 싣는다', sent.model_id, 'eleven_flash_v2_5');
  check('출력 규격은 정본과 같다', sent.output_format, 'mp3_44100_128');
  check('속도를 voice_settings 로 보낸다', sent.voice_settings.speed, 0.75);

  /* 속도는 엔진 범위로 접는다. 그대로 보내면 튕기는 곳이 있다(ElevenLabs 는 422). */
  seen = [];
  await post({ segments: [{ text: 'hi', voice: VOICE }], rate: 1.5 });
  check('빠른 쪽은 1.2 로 접힌다', JSON.parse(seen[0].init.body).voice_settings.speed, 1.2);
  seen = [];
  await post({ segments: [{ text: 'hi', voice: VOICE }], rate: 0.3 });
  check('느린 쪽은 0.7 로 접힌다', JSON.parse(seen[0].init.body).voice_settings.speed, 0.7);

  /* 화자가 여럿이면 각각 만들어 순서대로 이어 붙인다. */
  seen = [];
  r = await post({ segments: [{ text: 'A line.', voice: VOICE },
                              { text: 'B line.', voice: 'TX3LPaxmHKxFdv7VOQHJ' }] });
  check('세그먼트 수를 그대로 돌려준다', r.body.segments, 2);
  check('두 번 부른다', seen.length, 2);
  check('두 번째는 다른 목소리로', seen[1].url.indexOf('TX3LPaxmHKxFdv7VOQHJ') > 0, true);

  /* 알 수 없는 모델 이름은 그 엔진의 기본값으로 되돌린다 — 임의 문자열이 그대로 나가지 않게.
     엔진을 넘나드는 모델 이름도 마찬가지다(gpt-4o-mini-tts 는 ElevenLabs 모델이 아니다). */
  seen = [];
  await post({ model: 'gpt-4o-mini-tts', segments: [{ text: 'hi', voice: VOICE }] });
  check('낯선 모델은 기본값으로', JSON.parse(seen[0].init.body).model_id, 'eleven_flash_v2_5');

  /* ── 다른 엔진들 — 요청 모양이 각자의 API 와 맞는가 ── */
  process.env.OPENAI_API_KEY = 'sk_openai_server';
  seen = [];
  r = await post({ provider: 'openai', model: 'gpt-4o-mini-tts', rate: 1.1,
                   segments: [{ text: 'hi', voice: 'nova' }] });
  check('OpenAI 는 200', r.status, 200);
  check('OpenAI 엔드포인트', seen[0].url, 'https://api.openai.com/v1/audio/speech');
  var oa = JSON.parse(seen[0].init.body);
  check('mp3 로 달라고 한다', oa.response_format, 'mp3');
  check('목소리를 그대로 싣는다', oa.voice, 'nova');
  check('속도를 싣는다', oa.speed, 1.1);

  process.env.GOOGLE_TTS_API_KEY = 'g_server';
  stubFetch('google-tts');
  seen = [];
  r = await post({ provider: 'google', rate: 0.9,
                   segments: [{ text: 'hi', voice: 'en-GB-Neural2-A' }] });
  check('Google 은 200', r.status, 200);
  check('키는 쿼리로 간다', seen[0].url.indexOf('key=g_server') > 0, true);
  var gb = JSON.parse(seen[0].init.body);
  check('언어는 목소리 이름에서 되찾는다', gb.voice.languageCode, 'en-GB');
  check('MP3 로 달라고 한다', gb.audioConfig.audioEncoding, 'MP3');
  check('속도는 speakingRate', gb.audioConfig.speakingRate, 0.9);

  process.env.DEEPGRAM_API_KEY = 'dg_server';
  stubFetch('tts');
  seen = [];
  r = await post({ provider: 'deepgram', rate: 1.4,
                   segments: [{ text: 'hi', voice: 'aura-2-thalia-en' }] });
  check('Deepgram 은 200', r.status, 200);
  check('목소리가 곧 모델이다', seen[0].url.indexOf('model=aura-2-thalia-en') > 0, true);
  check('토큰 인증', seen[0].init.headers.Authorization, 'Token dg_server');
  check('속도는 아예 안 받는다 — 1 로 접힌다', r.body.speed, 1);

  /* ── Qwen(DashScope) ── 무료 한도가 있는 엔진. mp3 가 아니라 WAV 로 내주기 때문에,
     토막이 여럿이면 **머리표를 다시 적어** 이어야 한다. 그냥 붙이면 재생기가 첫 토막에서
     멈추고, 그 사실은 학생이 듣는 자리에서야 드러난다. */
  process.env.DASHSCOPE_API_KEY = 'ds_server';
  stubFetch('qwen');
  seen = [];
  r = await post({ provider: 'qwen', rate: 1.4,
                   segments: [{ text: 'hello', voice: 'Cherry' }, { text: 'again', voice: 'Ethan' }] });
  check('Qwen 은 200', r.status, 200);
  check('DashScope 로 간다',
    seen[0].url, 'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation');
  check('Bearer 로 붙는다', seen[0].init.headers.Authorization, 'Bearer ds_server');
  var qb = JSON.parse(seen[0].init.body);
  check('모델은 기본값', qb.model, 'qwen3-tts-flash');
  check('목소리를 그대로 싣는다', qb.input.voice, 'Cherry');
  check('영어로 읽으라고 못 박는다', qb.input.language_type, 'English');
  check('속도는 안 받는다 — 1 로 접힌다', r.body.speed, 1);
  check('WAV 라고 알려준다', r.body.mime, 'audio/wav');
  check('확장자도 알려준다', r.body.ext, 'wav');

  /* 두 토막을 이었으니 WAV 하나여야 한다 — 소리는 둘 다 들어 있고 머리표는 하나다. */
  var out = Buffer.from(r.body.audio, 'base64');
  var WAV = require(path.join(__dirname, '..', 'sg2', 'assets', 'wav-join.js'));
  check('이어 붙인 결과도 WAV', WAV.isWav(out), true);
  check('두 토막의 소리가 다 있다', Array.from(WAV.parse(out).data).join(','), '1,2,3,4');
  check('머리표는 하나다', out.length, 44 + 4);

  /* 목소리 이름은 서버에서 걸러진다 — 방언 전용 목소리를 영어 시험에 싣지 않는다. */
  seen = [];
  r = await post({ provider: 'qwen', segments: [{ text: 'hi', voice: 'Sichuan - Sunny' }] });
  check('모르는 Qwen 목소리는 400', r.status, 400);
  check('그 요청은 밖으로 나가지 않는다', seen.length, 0);

  console.log(fails.length ? '\nFAILED: ' + fails.join(', ') : '\nall ok');
  process.exit(fails.length ? 1 : 0);
})();
