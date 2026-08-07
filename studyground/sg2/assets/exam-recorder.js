/* SMEAG · StudyGround — exam-recorder.js
 * 목적: MediaRecorder 래퍼. Speaking record phase 의 녹음 시작/정지와
 *       Blob 저장(= SG_STORE 의 IndexedDB 경로)만 담당한다.
 * 의존 전역: (선택) window.SG_STORE — 없으면 저장을 건너뛰고 Blob 만 돌려준다.
 * 노출 전역: window.SG_RECORDER
 *
 * 절대 규칙 (FR14 / Story 2.5 AC8):
 *   미지원·권한거부·장치오류 어느 경우에도 예외를 밖으로 던지지 않는다.
 *   호출자는 err 를 받고 해당 문항을 "NOT SUBMIT" 으로 마킹한 뒤 시험을 계속한다.
 *
 * IndexedDB 직접 접근 금지 — 반드시 SG_STORE.putMedia() 를 통과한다.
 *   store: 'recordings' / key: '{session}/{questionId}'
 *   value: { questionKey, blob, mime, durationMs, recordedAt }   (AC5)
 *
 * ES5 문법만 사용한다(var / function / 문자열 연결). Promise·MediaRecorder 는
 * 문법이 아니라 런타임 API 이므로 사용 가능하되, 없으면 콜백으로 degrade 한다.
 */
(function (root) {
  'use strict';

  /* Safari 대응 mime 협상 순서 (AC10). 빈 문자열 = 브라우저 기본값에 위임. */
  var MIME_CANDIDATES = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
    'audio/ogg;codecs=opus'
  ];

  var NOT_SUBMIT = 'NOT SUBMIT';

  var stream = null;        // 현재 보유한 MediaStream
  var streamAdopted = false; // hardwareCheck 에서 넘겨받은 스트림인가
  var rec = null;           // MediaRecorder
  var chunks = [];
  var curQid = null;
  var curMime = '';
  var startedAt = 0;
  var state = 'idle';       // idle|requesting|starting|recording|stopping|denied|unsupported
  var lastErr = null;

  var actx = null;          // AudioContext
  var analyser = null;
  var srcNode = null;
  var levelBuf = null;

  function storeApi() { return root.SG_STORE || null; }

  function warn(msg, e) {
    if (root.console && root.console.warn) root.console.warn('[SG_RECORDER] ' + msg, e || '');
  }

  function err(code, message) {
    var e = new Error(message);
    e.code = code;
    lastErr = e;
    return e;
  }

  /* ── 지원 여부 ───────────────────────────────────────────── */

  function hasGum() {
    return !!(root.navigator && root.navigator.mediaDevices &&
              typeof root.navigator.mediaDevices.getUserMedia === 'function');
  }

  function isSupported() {
    return !!(typeof root.MediaRecorder !== 'undefined' && root.MediaRecorder && hasGum());
  }

  /* 실제로 쓸 mimeType 을 고른다. 지원 판정 API 가 없으면 ''(브라우저 기본). */
  function pickMime() {
    var MR = root.MediaRecorder;
    if (!MR || typeof MR.isTypeSupported !== 'function') return '';
    for (var i = 0; i < MIME_CANDIDATES.length; i++) {
      try { if (MR.isTypeSupported(MIME_CANDIDATES[i])) return MIME_CANDIDATES[i]; } catch (e) {}
    }
    return '';
  }

  /* ── 스트림 ──────────────────────────────────────────────── */

  /* hardwareCheck 화면(Story 2.1)이 이미 getUserMedia 를 통과했으면 그 스트림을
     그대로 넘겨준다. 권한 프롬프트를 두 번 띄우지 않기 위한 유일한 경로다. */
  function adoptStream(s) {
    if (!s) return false;
    if (stream && stream !== s) releaseStream();
    stream = s;
    streamAdopted = true;
    attachAnalyser(s);
    if (state === 'denied' || state === 'unsupported') state = 'idle';
    return true;
  }

  function getStream() { return stream; }

  function liveStream() {
    if (!stream) return null;
    // 트랙이 죽은 스트림을 재사용하면 무음 파일이 나온다.
    if (typeof stream.getAudioTracks === 'function') {
      var ts = stream.getAudioTracks();
      if (!ts.length) return null;
      if (ts[0].readyState === 'ended') return null;
    }
    return stream;
  }

  function releaseStream() {
    detachAnalyser();
    if (stream && typeof stream.getTracks === 'function') {
      var ts = stream.getTracks();
      for (var i = 0; i < ts.length; i++) { try { ts[i].stop(); } catch (e) {} }
    }
    stream = null;
    streamAdopted = false;
  }

  /* 권한 요청. 이미 살아있는 스트림이 있으면 재사용하고 재요청하지 않는다. */
  function requestPermission(cb) {
    var done = typeof cb === 'function' ? cb : function () {};
    var live = liveStream();
    if (live) { done(null, live); return; }
    if (!isSupported()) {
      state = 'unsupported';
      done(err('unsupported', 'MediaRecorder or getUserMedia is not available in this browser.'), null);
      return;
    }
    state = 'requesting';
    var p;
    try { p = root.navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (e) { state = 'denied'; done(err('denied', 'Microphone request failed.'), null); return; }
    p.then(function (s) {
      stream = s;
      streamAdopted = false;
      state = 'idle';
      attachAnalyser(s);
      done(null, s);
    })['catch'](function (e) {
      state = 'denied';
      warn('getUserMedia rejected', e);
      done(err('denied', 'Microphone permission was denied or no input device was found.'), null);
    });
  }

  /* ── 입력 레벨 (AnalyserNode) ────────────────────────────── */

  function attachAnalyser(s) {
    detachAnalyser();
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC || !s) return false;
    try {
      actx = new AC();
      srcNode = actx.createMediaStreamSource(s);
      analyser = actx.createAnalyser();
      analyser.fftSize = 1024;
      levelBuf = new Uint8Array(analyser.fftSize);
      srcNode.connect(analyser);   // destination 에 연결하지 않는다 — 하울링 방지
      return true;
    } catch (e) {
      warn('analyser unavailable', e);
      analyser = null; srcNode = null; levelBuf = null;
      return false;
    }
  }

  function detachAnalyser() {
    try { if (srcNode) srcNode.disconnect(); } catch (e) {}
    try { if (actx && typeof actx.close === 'function') actx.close(); } catch (e) {}
    actx = null; srcNode = null; analyser = null; levelBuf = null;
  }

  function getAnalyser() { return analyser; }

  /* 0..1 정규화된 입력 레벨(RMS). 레벨미터 UI 전용 — 실패해도 0 을 돌려준다. */
  function level() {
    if (!analyser || !levelBuf) return 0;
    try {
      analyser.getByteTimeDomainData(levelBuf);
      var sum = 0, i, v;
      for (i = 0; i < levelBuf.length; i++) { v = (levelBuf[i] - 128) / 128; sum += v * v; }
      var rms = Math.sqrt(sum / levelBuf.length);
      var out = rms * 3;                 // 말소리(RMS 0.05~0.3)를 눈에 보이게 증폭
      return out > 1 ? 1 : out;
    } catch (e) { return 0; }
  }

  /* ── 녹음 ────────────────────────────────────────────────── */

  function _start(questionId, done) {
    if (!questionId) { done(err('no_question', 'start() requires a questionId.'), null); return; }
    if (state === 'recording' || state === 'starting') {
      done(err('busy', 'A recording is already in progress.'), null);
      return;
    }
    state = 'starting';
    requestPermission(function (e, s) {
      if (e) { state = e.code === 'unsupported' ? 'unsupported' : 'denied'; done(e, null); return; }
      var mime = pickMime();
      var opts = mime ? { mimeType: mime } : {};
      try { rec = new root.MediaRecorder(s, opts); }
      catch (e2) {
        // mimeType 거부 → 옵션 없이 1회 재시도(Safari 구버전)
        try { rec = new root.MediaRecorder(s); mime = ''; }
        catch (e3) { state = 'idle'; rec = null; done(err('recorder_init', 'MediaRecorder could not be created.'), null); return; }
      }
      chunks = [];
      curQid = questionId;
      curMime = mime || (rec.mimeType || '');
      rec.ondataavailable = function (ev) { if (ev && ev.data && ev.data.size) chunks.push(ev.data); };
      rec.onerror = function (ev) { warn('recorder error', ev); };
      try { rec.start(); }
      catch (e4) { state = 'idle'; rec = null; done(err('recorder_start', 'MediaRecorder.start() failed.'), null); return; }
      startedAt = Date.now();
      state = 'recording';
      done(null, { questionId: questionId, mime: curMime, startedAt: startedAt });
    });
  }

  /* 정지 → Blob 조립 → SG_STORE.putMedia (IndexedDB). 저장 실패해도 Blob 은 돌려준다. */
  function _stop(done) {
    if (state !== 'recording' || !rec) {
      done(err('not_recording', 'stop() called while not recording.'), null);
      return;
    }
    state = 'stopping';
    var qid = curQid;
    var mime = curMime;
    var dur = Date.now() - startedAt;
    var finished = false;

    function finish() {
      if (finished) return;
      finished = true;
      state = 'idle';
      var blob = null;
      try { blob = new root.Blob(chunks, mime ? { type: mime } : undefined); } catch (e) { blob = null; }
      chunks = [];
      rec = null;
      curQid = null;
      if (!blob || !blob.size) { done(err('empty', 'Recording produced no audio data.'), null); return; }
      var record = {
        questionKey: qid,
        blob: blob,
        mime: mime || blob.type || '',
        durationMs: dur,
        recordedAt: Date.now()
      };
      var st = storeApi();
      if (!st || typeof st.putMedia !== 'function') {
        done(null, { questionId: qid, blob: blob, mime: record.mime, durationMs: dur, saved: false, ref: null });
        return;
      }
      st.putMedia(qid, record, function (e2, ref) {
        if (e2) warn('putMedia failed; keeping blob in memory only', e2);
        done(null, {
          questionId: qid, blob: blob, mime: record.mime, durationMs: dur,
          saved: !e2, ref: ref || null
        });
      });
    }

    rec.onstop = finish;
    try { rec.stop(); }
    catch (e) { finish(); }        // 이미 inactive 인 경우에도 조립은 수행한다
  }

  /* 콜백 + (가능하면)Promise 양쪽을 지원한다. Promise 는 런타임 API 라 ES5 문법과 무관. */
  function wrap(runner, cb) {
    if (typeof root.Promise === 'function') {
      return new root.Promise(function (resolve, reject) {
        runner(function (e, v) {
          if (typeof cb === 'function') { try { cb(e, v); } catch (x) {} }
          if (e) reject(e); else resolve(v);
        });
      });
    }
    runner(function (e, v) { if (typeof cb === 'function') { try { cb(e, v); } catch (x) {} } });
    return null;
  }

  function start(questionId, cb) {
    return wrap(function (done) { _start(questionId, done); }, cb);
  }

  /* Promise<{blob,...}> 를 돌려준다. blob 만 필요하면 .then(function(r){return r.blob;}). */
  function stop(cb) {
    return wrap(function (done) { _stop(done); }, cb);
  }

  /* 녹음 중이 아닐 때도 안전하게 부를 수 있는 취소(화면 이탈·dispose 용). */
  function abort() {
    if (state === 'recording' && rec) {
      try { rec.onstop = null; rec.stop(); } catch (e) {}
    }
    chunks = [];
    rec = null;
    curQid = null;
    if (state === 'recording' || state === 'stopping' || state === 'starting') state = 'idle';
    return true;
  }

  function isRecording() { return state === 'recording'; }
  function currentQuestion() { return curQid; }
  function getState() { return state; }
  function lastError() { return lastErr; }

  /* FR14: 녹음이 불가능한 문항을 "NOT SUBMIT" 으로 남긴다.
     관리자 상세화면(Story 4.3/4.4)이 그대로 출력하는 문자열이므로 바꾸지 않는다. */
  function markNotSubmit(questionId, reason) {
    var st = storeApi();
    if (!st || typeof st.upsertAnswer !== 'function' || !questionId) return false;
    st.upsertAnswer(questionId, NOT_SUBMIT, {
      notSubmit: true, recorded: false, media: '', reason: reason || 'recorder_unavailable'
    });
    if (typeof st.flushAnswers === 'function') st.flushAnswers();
    return true;
  }

  root.SG_RECORDER = {
    NOT_SUBMIT: NOT_SUBMIT,
    MIME_CANDIDATES: MIME_CANDIDATES,
    isSupported: isSupported,
    pickMime: pickMime,
    requestPermission: requestPermission,
    adoptStream: adoptStream,
    getStream: getStream,
    releaseStream: releaseStream,
    getAnalyser: getAnalyser,
    level: level,
    start: start,
    stop: stop,
    abort: abort,
    isRecording: isRecording,
    currentQuestion: currentQuestion,
    state: getState,
    lastError: lastError,
    markNotSubmit: markNotSubmit
  };
})(typeof window !== 'undefined' ? window : this);
