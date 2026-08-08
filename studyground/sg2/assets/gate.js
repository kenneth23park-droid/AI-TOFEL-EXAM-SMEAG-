/* SMEAG · StudyGround — 내부용 접근 게이트.
 *
 * 모든 페이지의 <head> 최상단에서 동기로 돌아, 통과 기록이 없으면 본문이 그려지기 전에
 * gate.html 로 보낸다. 원래 주소는 ?next= 로 넘겨 로그인 후 그대로 이어가게 한다.
 *
 * 주의 — 이건 "내부용" 가림막이지 인증이 아니다. 정적 사이트라 서버가 없고, 자격증명은
 * gate.html 안에 그대로 들어 있다. 외부에 공개할 때는 서버/프록시(Vercel Password
 * Protection, Basic Auth 등) 인증으로 바꿔야 한다.
 */
(function () {
  'use strict';

  var KEY = 'sg2_gate';
  var TTL_MS = 12 * 60 * 60 * 1000;   // 12시간 — 하루 수업이 끊기지 않는 길이.

  function passed() {
    try {
      var t = parseInt(localStorage.getItem(KEY) || '', 10);
      if (!t) return false;
      if (Date.now() - t >= TTL_MS) { localStorage.removeItem(KEY); return false; }
      return true;
    } catch (e) {
      return false;   // 프라이빗 모드 등 localStorage 가 막힌 환경은 매번 로그인.
    }
  }

  if (passed()) return;

  var next = location.pathname + location.search + location.hash;
  // gate.html 은 문서 base 기준으로 풀린다 — /en/test-nt/* 라우트 페이지는 <base href="../../../">
  // 를 두고 있어 같은 한 줄로 sg2 루트의 gate.html 을 가리킨다.
  location.replace('gate.html?next=' + encodeURIComponent(next));
})();
