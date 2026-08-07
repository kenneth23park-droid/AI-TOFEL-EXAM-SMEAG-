/* SMEAG · StudyGround 2.0 — exam-media.js
 * 목적: set1.js 원본 미디어 경로 → 배포된 sg2/media/** 경로로 바꾸는 단일 지점.
 * 의존 전역: 없음 (순수 문자열 처리)
 * 노출 전역: window.SG_MEDIA
 *
 * 왜 한 곳인가 (architecture.md C3):
 *   set1.js 의 paths.audio 는 'TOEFL MOCK TEST  SET 1/SET 1 AUDIO/' 로 "TEST" 뒤 공백이 2칸이다.
 *   이 리터럴이 여러 파일에 복제되면 한 곳만 고쳐도 404 가 남는다(위험대장 R3).
 *   그래서 리맵 테이블은 이 파일에만 존재하고, exam.html 의 audioSrc()/imgSrc() 규칙을 그대로 옮겨왔다.
 */
(function () {
  'use strict';

  /* 리맵 테이블. 앞에서부터 첫 일치 규칙 하나만 적용한다.
   * from 은 set1.js 의 paths.* 리터럴과 바이트 단위로 동일해야 한다(공백 2칸 포함). */
  var PREFIX_MAP = [
    { from: 'TOEFL MOCK TEST  SET 1/SET 1 AUDIO/', to: 'media/audio/' },
    { from: 'TOEFL LISTENING & WRITING PICTURES/', to: 'media/pictures/' },
    { from: 'app/assets/speaking/', to: 'media/speaking/' }
  ];

  /* 이미 배포 경로인 것으로 간주하는 접두어들. */
  var LOCAL_PREFIXES = ['media/', './media/', '/media/', 'data:', 'blob:'];

  var AUDIO_EXT = ['.mp3', '.m4a', '.wav', '.ogg'];
  var IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];
  var VIDEO_EXT = ['.mp4', '.webm', '.mov'];

  function endsWithAny(s, list) {
    var lower = String(s).toLowerCase();
    for (var i = 0; i < list.length; i++) {
      if (lower.length >= list[i].length &&
          lower.lastIndexOf(list[i]) === lower.length - list[i].length) return true;
    }
    return false;
  }

  function startsWithAny(s, list) {
    for (var i = 0; i < list.length; i++) {
      if (String(s).indexOf(list[i]) === 0) return true;
    }
    return false;
  }

  /* 리맵만 수행(퍼센트 인코딩 없음). sw.js precache 목록 생성이나 fs 존재검사에 쓴다. */
  function rawPath(src) {
    if (!src) return '';
    var s = String(src);
    for (var i = 0; i < PREFIX_MAP.length; i++) {
      if (s.indexOf(PREFIX_MAP[i].from) === 0) {
        return PREFIX_MAP[i].to + s.slice(PREFIX_MAP[i].from.length);
      }
    }
    return s;
  }

  /* 렌더러가 <audio src>/<img src> 에 그대로 넣을 수 있는 최종 경로.
   * 파일명에 공백이 많아 encodeURI 가 필수다(exam.html 기존 동작과 동일). */
  function resolveMedia(src) {
    if (!src) return '';
    return encodeURI(rawPath(src));
  }

  /* 리맵이 끝났는지 판정. false 면 호출자가 warnings[] 에 담는다(throw 금지, F12). */
  function isMapped(src) {
    if (!src) return true;
    return startsWithAny(rawPath(src), LOCAL_PREFIXES);
  }

  /* MediaSpec.kind 추론. 확장자만 본다. */
  function kindOf(src) {
    if (!src) return null;
    var s = rawPath(src);
    if (endsWithAny(s, AUDIO_EXT)) return 'audio';
    if (endsWithAny(s, IMAGE_EXT)) return 'image';
    if (endsWithAny(s, VIDEO_EXT)) return 'video';
    return null;
  }

  window.SG_MEDIA = {
    PREFIX_MAP: PREFIX_MAP,
    resolveMedia: resolveMedia,
    rawPath: rawPath,
    isMapped: isMapped,
    kindOf: kindOf
  };
})();
