/* =============================================================
 * SMEAG TOEFL — 마이크 녹음 (담당 A) → window.SMEAG_REC
 *
 *   SMEAG_REC.available()          -> boolean
 *   SMEAG_REC.requestPermission()  -> Promise<boolean>
 *   SMEAG_REC.start()              -> Promise<void>
 *   SMEAG_REC.stop()               -> Promise<{blob, durationMs, mime}>
 *   SMEAG_REC.release()            -> void
 *
 * ★ 어떤 경우에도 throw 하지 않는다.
 *   미지원/권한 거부 → available()/requestPermission() 이 false,
 *   start() 는 조용히 resolve, stop() 은 blob:null 로 resolve.
 *   호출 측(speaking.js)은 {recorded:false, skipped:true} 로 기록하고 시험을 계속한다.
 * ============================================================= */
(function () {
  'use strict';

  var REC = {};

  var stream = null;        // MediaStream
  var mr = null;            // MediaRecorder
  var chunks = [];
  var startedAt = 0;
  var activeMime = '';
  var recording = false;
  var permissionState = null;  // null=미확인, true=허용, false=거부/불가

  /* 우선순위: webm(opus) → webm → mp4 → ogg → 브라우저 기본 */
  var MIME_CANDIDATES = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
    'audio/ogg'
  ];

  function pickMime() {
    if (typeof window.MediaRecorder === 'undefined') return '';
    if (typeof window.MediaRecorder.isTypeSupported !== 'function') return '';
    for (var i = 0; i < MIME_CANDIDATES.length; i++) {
      try {
        if (window.MediaRecorder.isTypeSupported(MIME_CANDIDATES[i])) return MIME_CANDIDATES[i];
      } catch (e) { /* 다음 후보 */ }
    }
    return '';  // 빈 문자열 = 브라우저 기본값 사용
  }

  function getUM() {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      return function (c) { return navigator.mediaDevices.getUserMedia(c); };
    }
    return null;
  }

  function warn(msg, e) {
    try {
      if (window.SMEAG_CONFIG && window.SMEAG_CONFIG.debug && window.console) {
        console.warn('[SMEAG_REC] ' + msg, e || '');
      }
    } catch (e2) { /* 무시 */ }
  }

  /* MediaRecorder + getUserMedia 지원 여부 */
  REC.available = function () {
    try {
      return typeof window.MediaRecorder !== 'undefined' && !!getUM();
    } catch (e) {
      return false;
    }
  };

  /* 마이크 권한 요청. 절대 throw 하지 않는다. */
  REC.requestPermission = function () {
    if (!REC.available()) {
      permissionState = false;
      return Promise.resolve(false);
    }
    if (stream && stream.active) {
      permissionState = true;
      return Promise.resolve(true);
    }
    var um = getUM();
    try {
      return um({ audio: true, video: false }).then(function (s) {
        stream = s;
        permissionState = true;
        return true;
      }).catch(function (e) {
        warn('마이크 권한 거부/실패', e);
        stream = null;
        permissionState = false;
        return false;
      });
    } catch (e) {
      warn('getUserMedia 호출 실패', e);
      permissionState = false;
      return Promise.resolve(false);
    }
  };

  /* 녹음 시작. 실패해도 조용히 resolve. */
  REC.start = function () {
    if (recording) return Promise.resolve();
    return REC.requestPermission().then(function (ok) {
      if (!ok || !stream) return;
      var mime = pickMime();
      try {
        mr = mime ? new window.MediaRecorder(stream, { mimeType: mime })
                  : new window.MediaRecorder(stream);
      } catch (e) {
        warn('MediaRecorder 생성 실패 — 기본 설정으로 재시도', e);
        try {
          mr = new window.MediaRecorder(stream);
        } catch (e2) {
          warn('MediaRecorder 사용 불가', e2);
          mr = null;
          return;
        }
      }
      chunks = [];
      activeMime = (mr && mr.mimeType) || mime || 'audio/webm';
      mr.ondataavailable = function (ev) {
        if (ev && ev.data && ev.data.size > 0) chunks.push(ev.data);
      };
      mr.onerror = function (ev) { warn('녹음 중 오류', ev); };
      try {
        mr.start(250);   // 250ms 단위로 chunk 확보 (중간에 끊겨도 앞부분은 남는다)
        recording = true;
        startedAt = Date.now();
      } catch (e3) {
        warn('녹음 시작 실패', e3);
        mr = null;
        recording = false;
      }
    }).catch(function (e) {
      warn('start() 예외', e);
    });
  };

  /* 녹음 종료 → {blob, durationMs, mime}. 실패 시 blob:null. */
  REC.stop = function () {
    var durationMs = startedAt ? (Date.now() - startedAt) : 0;
    if (!mr || !recording) {
      recording = false;
      return Promise.resolve({ blob: null, durationMs: 0, mime: activeMime || '' });
    }
    var rec = mr;
    mr = null;
    recording = false;
    return new Promise(function (resolve) {
      var settled = false;
      function finish() {
        if (settled) return;
        settled = true;
        var blob = null;
        try {
          if (chunks.length) blob = new Blob(chunks, { type: activeMime || 'audio/webm' });
        } catch (e) {
          warn('Blob 생성 실패', e);
          blob = null;
        }
        chunks = [];
        startedAt = 0;
        resolve({ blob: blob, durationMs: durationMs, mime: activeMime || '' });
      }
      rec.onstop = finish;
      // 브라우저가 onstop 을 안 주는 예외 상황 대비 안전망
      setTimeout(finish, 1500);
      try {
        if (rec.state !== 'inactive') rec.stop();
        else finish();
      } catch (e) {
        warn('stop() 실패', e);
        finish();
      }
    });
  };

  /* 마이크 트랙 종료 (녹음 표시등 끄기) */
  REC.release = function () {
    try {
      if (mr && recording) {
        try { mr.stop(); } catch (e) { /* 무시 */ }
      }
    } catch (e2) { /* 무시 */ }
    mr = null;
    recording = false;
    chunks = [];
    startedAt = 0;
    try {
      if (stream) {
        var tracks = stream.getTracks ? stream.getTracks() : [];
        for (var i = 0; i < tracks.length; i++) {
          try { tracks[i].stop(); } catch (e3) { /* 무시 */ }
        }
      }
    } catch (e4) { /* 무시 */ }
    stream = null;
  };

  /* 현재 녹음 중인가 (계약서 외 편의용) */
  REC.isRecording = function () { return !!recording; };
  /* 마지막 권한 확인 결과 (null=미확인) */
  REC.permission = function () { return permissionState; };

  window.SMEAG_REC = REC;
})();
