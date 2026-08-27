/* SMEAG StudyGround — audio-match.js : 고른 녹음 파일 ↔ 팩의 음원 자리 짝짓기.
 *
 * 세트를 만들면 팩은 "media/audio/set10/l1-q01.mp3" 같은 자리를 가리키지만, 실제
 * 녹음 파일은 선생님 컴퓨터 폴더에 "SET10 L1 Q1.mp3" 처럼 사람 손으로 붙인 이름으로
 * 들어 있다. 그 둘을 이어 주는 판정만 여기 떼어 둔다 — 화면 안에 두면 브라우저를
 * 띄워야 확인할 수 있는데, 여기가 틀리면 **다른 문항의 음원이 걸린 채** 시험이 나간다.
 * 검산은 tests/test_audio_match.js 다.
 *
 * 짝짓는 순서 — 확실한 것부터. 한 번 짝지어진 자리와 파일은 다음 단계로 넘어가지 않는다.
 *   1. 파일 이름(확장자 뺀)이 자리 이름과 글자 그대로 같다.
 *   2. 숫자 앞의 0 만 다르다.            l1-q1.mp3      ↔ l1-q01.mp3
 *   3. 한쪽 이름이 다른 쪽으로 끝난다.   SET10 L1 Q01.mp3 ↔ l1-q01.mp3
 *
 * 3단계에서 후보가 둘 이상이면 짝짓지 않고 ambiguous 로 돌려준다. 반쯤 맞는 이름을
 * 찍어서 거는 것보다, 어느 것인지 사람이 고르는 편이 낫다.
 *
 * ES5 문법만 쓴다(빌드 단계 없음). tts-plan.js 와 같은 UMD 껍데기.
 */
(function (root, factory) {
  var api = factory();
  root.SG_AUDIO_MATCH = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var AUDIO_RE = /\.(mp3|m4a|mp4|aac|wav|ogg|oga|opus|webm|flac)$/i;

  /** 폴더째 고르면 이름에 경로가 붙는다("SET 10/audio/l1.mp3") — 마지막 칸만 쓴다. */
  function base(name) {
    var s = String(name || '').replace(/\\/g, '/');
    return s.slice(s.lastIndexOf('/') + 1);
  }

  function isAudio(name) { return AUDIO_RE.test(base(name)); }

  function stem(name) { return base(name).replace(AUDIO_RE, ''); }

  /** 글자 그대로 비교할 이름 — 대소문자·구분기호만 지운다. */
  function tight(name) {
    return stem(name).toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  /** 숫자 앞의 0 을 떼어낸 이름. q01 과 q1 을 같은 것으로 본다.
      숫자 덩어리의 **맨 앞** 0 만 떼어낸다 — q100 은 q10 이 아니다. */
  function loose(name) {
    return tight(name).replace(/(\D|^)0+(\d)/g, '$1$2');
  }

  function fileName(f) {
    if (!f) return '';
    return base(f.webkitRelativePath || f.relativePath || f.name || f);
  }

  function slotName(s) {
    if (!s) return '';
    return base((typeof s === 'string' ? s : (s.path || s.raw || s.key)) || '');
  }

  /**
   * slots: [{path,…}] (문자열도 받는다) · files: [File] (또는 {name})
   * -> { pairs:[{slot,file,how}], slotsLeft:[], filesLeft:[], ambiguous:[{file,slots:[]}], skipped:[File] }
   *
   * skipped 는 소리 파일이 아닌 것들이다 — 폴더를 통째로 고르면 .DS_Store 나 docx 가
   * 함께 딸려 온다. 짝짓기에서 빼되, 몇 개를 버렸는지는 말해 준다.
   */
  function match(slots, files) {
    var openSlots = (slots || []).slice(0);
    var openFiles = [], skipped = [];
    (files || []).forEach(function (f) {
      if (isAudio(fileName(f))) openFiles.push(f); else skipped.push(f);
    });

    var pairs = [], ambiguous = [];

    function pass(how, keyOf, hit) {
      var left = [];
      openFiles.forEach(function (f) {
        var fk = keyOf(fileName(f));
        if (!fk) { left.push(f); return; }
        var cand = [];
        openSlots.forEach(function (s) {
          var sk = keyOf(slotName(s));
          if (sk && hit(fk, sk)) cand.push(s);
        });
        if (cand.length !== 1) { left.push(f); return; }
        pairs.push({ slot: cand[0], file: f, how: how });
        openSlots.splice(openSlots.indexOf(cand[0]), 1);
      });
      openFiles = left;
    }

    function same(a, b) { return a === b; }
    function tail(a, b) {
      if (a === b) return true;
      return a.length > b.length ? a.slice(-b.length) === b : b.slice(-a.length) === a;
    }

    pass('exact', tight, same);
    pass('zeros', loose, same);
    pass('tail', loose, tail);

    /* 남은 파일 중 "후보가 여럿이라" 남은 것은 따로 알려 준다 — 이름을 고치면 걸린다. */
    openFiles.forEach(function (f) {
      var fk = loose(fileName(f));
      var cand = openSlots.filter(function (s) { return fk && tail(fk, loose(slotName(s))); });
      if (cand.length > 1) ambiguous.push({ file: f, slots: cand });
    });

    return {
      pairs: pairs, slotsLeft: openSlots, filesLeft: openFiles,
      ambiguous: ambiguous, skipped: skipped
    };
  }

  return { match: match, isAudio: isAudio, tight: tight, loose: loose, base: base, stem: stem };
});
