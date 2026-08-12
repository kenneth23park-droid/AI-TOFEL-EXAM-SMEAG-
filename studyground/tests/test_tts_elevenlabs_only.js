/* /api/tts 는 ElevenLabs 로만 만든다 — 그 계약 검증.
 * 실행: node studyground/tests/test_tts_elevenlabs_only.js
 *
 * 왜 하나로 묶었나: 시험 음성 정본(media/audio/set9/)이 전부 ElevenLabs 로 만들어졌고
 * 배역표의 voice_id 도 그 계정 것이다. 관리자 화면에서 한 문항만 다른 엔진으로 다시
 * 만들면 그 문항만 목소리가 튀는데, 리스닝은 "누가 말하는가" 가 문항의 일부다.
 * 그래서 다른 엔진 이름은 조용히 넘어가지 않고 400 으로 거절해야 한다.
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

var seen = [];                       // 가로챈 ElevenLabs 요청들
function stubFetch(kind) {
  global.fetch = function (url, init) {
    seen.push({ url: String(url), init: init || {} });
    if (kind === 'voices') {
      return Promise.resolve({ ok: true, json: function () {
        return Promise.resolve({ voices: [{ voice_id: 'FGY2WhTYpPnrIDTdsKH5', name: 'Laura',
                                            labels: { accent: 'en-US', gender: 'female' } }] });
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

(async function () {
  /* 토큰이 없으면 함수는 아예 닫혀 있다 — 열린 채로 두면 남의 요청이 그대로 과금된다. */
  delete process.env.SG_TTS_TOKEN;
  delete process.env.ELEVENLABS_API_KEY;
  var r = await call({});
  check('토큰 미설정이면 503', r.status, 503);

  process.env.SG_TTS_TOKEN = TOKEN;
  r = await call({});
  check('토큰이 틀리면 401', r.status, 401);

  /* 목록: 엔진은 하나뿐이고, 키가 없으면 이유를 말한다. */
  stubFetch('voices');
  r = await call({ headers: { 'x-sg-token': TOKEN } });
  check('GET 은 200', r.status, 200);
  check('엔진은 하나다', r.body.providers.length, 1);
  check('그 하나는 ElevenLabs', r.body.providers[0].id, 'elevenlabs');
  check('키가 없으면 ready 아니다', r.body.providers[0].ready, false);
  check('이유를 적어 준다', r.body.providers[0].note, 'ELEVENLABS_API_KEY 미설정');
  check('기본 모델은 시험 정본과 같다', r.body.providers[0].defaultModel, 'eleven_flash_v2_5');
  check('무음(gap)은 지원하지 않는다고 밝힌다', r.body.providers[0].gap, false);
  check('키가 없으면 목소리 목록도 부르지 않는다', seen.length, 0);

  /* 이 기기 키(x-sg-key)로도 열린다 — 서버 환경변수가 없는 기기를 위한 길이다. */
  seen = [];
  r = await call({ headers: { 'x-sg-token': TOKEN, 'x-sg-key': 'sk_local' } });
  check('보내 준 키로 ready 가 된다', r.body.providers[0].ready, true);
  check('서버 환경변수로는 아직 아니다', r.body.providers[0].envReady, false);
  check('목소리 목록을 ElevenLabs 에서 받는다', seen[0].url, 'https://api.elevenlabs.io/v1/voices');
  check('그 키로 부른다', seen[0].init.headers['xi-api-key'], 'sk_local');
  check('목소리는 voice_id 로 온다', r.body.voices.elevenlabs[0].id, VOICE);

  /* 합성: 다른 엔진 이름은 거절한다. */
  process.env.ELEVENLABS_API_KEY = 'sk_server';
  stubFetch('tts');
  seen = [];
  r = await post({ provider: 'google', segments: [{ text: 'hi', voice: VOICE }] });
  check('google 은 400', r.status, 400);
  r = await post({ provider: 'openai', segments: [{ text: 'hi', voice: VOICE }] });
  check('openai 도 400', r.status, 400);
  check('거절한 요청은 밖으로 나가지 않는다', seen.length, 0);

  /* 목소리 id 는 ElevenLabs 형식이어야 한다 — 옛 Google 이름이 그대로 나가지 않게. */
  r = await post({ segments: [{ text: 'hi', voice: 'en-US-Neural2-C' }] });
  check('Google 목소리 이름은 400', r.status, 400);

  /* 정상 경로. */
  seen = [];
  r = await post({ segments: [{ text: 'Where is the student lounge?', voice: VOICE }], rate: 0.75 });
  check('합성은 200', r.status, 200);
  check('provider 를 그대로 알려준다', r.body.provider, 'elevenlabs');
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

  /* 속도는 ElevenLabs 범위(0.7–1.2)로 접는다. 그대로 보내면 422 로 튕긴다. */
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

  /* 알 수 없는 모델 이름은 기본값으로 되돌린다 — 임의 문자열이 그대로 나가지 않게. */
  seen = [];
  await post({ model: 'gpt-4o-mini-tts', segments: [{ text: 'hi', voice: VOICE }] });
  check('낯선 모델은 기본값으로', JSON.parse(seen[0].init.body).model_id, 'eleven_flash_v2_5');

  console.log(fails.length ? '\nFAILED: ' + fails.join(', ') : '\nall ok');
  process.exit(fails.length ? 1 : 0);
})();
