/* SMEAG StudyGround — 좌석 설정을 학생 화면에 입힌다.
 *
 * assets/sg-seats.js 가 들고 있는 이 PC 의 좌석 설정(관리자가 admin-seats.html 에서
 * 지정한 것)을 읽어, 화면에 그대로 적용한다:
 *
 *   · 시험 전용 모드 — 강의·연습·커뮤니티 메뉴를 숨겨 시험과 로그인만 남긴다.
 *   · 오디오 배속 — SG_AUDIO 가 있는 화면이면 좌석 값으로 전체 배속을 건다.
 *   · 좌석 배지 — [data-seat-badge] 자리에 "컴퓨터 12" 를 그린다.
 *   · 배정 시험 주소 — examUrl() 이 exam-runtime.html?… 을 만들어 준다.
 *
 * 각인(이 PC 가 몇 번인지)은 seat-setup.html 에서 한다. 각인 전이면 이 파일은
 * 아무것도 하지 않는다 — 집에서 쓰는 브라우저는 좌석과 무관해야 하기 때문이다.
 *
 * 의존: assets/sg-seats.js (필수, 먼저 로드)
 * 노출 전역: window.SG_SEAT_RT
 */
(function () {
  'use strict';

  var S = window.SG_SEATS;
  if (!S) return;

  var seat = S.forThisDevice();          // 각인 전이면 null

  /* ── 시험 전용 모드 ─────────────────────────────────────────
   * 학습·연습·커뮤니티로 새는 길을 막는다. 시험과 로그인만 남긴다. */
  function kiosk() {
    if (!seat || !seat.kiosk) return;
    document.documentElement.setAttribute('data-sg-kiosk', '1');
    css('[data-sg-kiosk] .nav-center,' +
        '[data-sg-kiosk] .foot-links a:not([href="tests.html"]):not([href="login.html"]),' +
        '[data-sg-kiosk] .nav-right a[href="signup.html"],' +
        '[data-sg-kiosk] .nav-right a[href="purchase.html"],' +
        '[data-sg-kiosk] .auth-alt{display:none!important}');
  }

  function css(text) {
    var s = document.createElement('style');
    s.textContent = text;
    (document.head || document.documentElement).appendChild(s);
  }

  /* ── 오디오 배속 ────────────────────────────────────────────
   * 두 층(전체 / 클립 하나) 중 아래층에만 얹는다 — 관리자가 특정 클립만 따로
   * 조정해 둔 것은 그대로 살려 둔다. */
  function applyRate() {
    if (!seat || !window.SG_AUDIO || !SG_AUDIO.setRate) return;
    var r = Number(seat.audioRate) || 1;
    if (r < 0.5 || r > 1.5) return;
    try { SG_AUDIO.setRate(r); } catch (e) {}
  }

  /* ── 배정 시험 주소 ─────────────────────────────────────────
   * module 이 full 이면 전 과정, 아니면 그 섹션만. 코스는 제한시간·점수 척도를 가른다. */
  function examUrl() {
    if (!seat || !seat.setId) return '';
    var q = seat.module && seat.module !== 'full'
      ? 'mode=section&section=' + encodeURIComponent(seat.module)
      : 'mode=exam';
    q += '&set=' + encodeURIComponent(seat.setId);
    q += '&exam=' + encodeURIComponent(seat.course || 'toefl');
    if (seat.items) q += '&items=' + encodeURIComponent(seat.items);
    return 'exam-runtime.html?' + q;
  }

  /* ── 배지 ───────────────────────────────────────────────────
   * 자리를 잘못 앉았는지 학생이 한눈에 알아야 한다. 값은 바꿀 수 없다. */
  function paintBadges() {
    var hosts = document.querySelectorAll('[data-seat-badge]');
    if (!hosts.length) return;
    for (var i = 0; i < hosts.length; i++) {
      if (!seat) { hosts[i].hidden = true; continue; }
      hosts[i].hidden = false;
      hosts[i].innerHTML =
        '<span class="sg-seat-badge">◉ <span data-en>Computer ' + seat.no + '</span>' +
        '<span data-ko>컴퓨터 ' + seat.no + '</span></span>';
    }
    css('.sg-seat-badge{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--brand);' +
        'color:var(--brand-ink);background:var(--brand-soft);border-radius:999px;padding:5px 12px;' +
        'font:800 12px/1 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.04em}');
  }

  var RT = {
    /** 이 PC 의 좌석 설정(각인 전이면 null). 사본이라 고쳐도 저장되지 않는다. */
    seat: function () { return seat ? S.get(seat.no) : null; },
    /** 각인됐는가. */
    bound: function () { return !!seat; },
    /** 배정된 시험이 있는가 — 없으면 화면은 "배정 대기 중"을 띄우면 된다. */
    assigned: function () { return !!(seat && seat.setId); },
    examUrl: examUrl,
    /** 좌석 설정을 다시 읽는다(관리자가 같은 기기에서 바꾼 뒤 등). */
    refresh: function () { seat = S.forThisDevice(); return seat; }
  };

  kiosk();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { paintBadges(); applyRate(); });
  } else {
    paintBadges(); applyRate();
  }
  // SG_AUDIO 가 늦게 준비되는 화면(시험 셸)도 있어 한 번 더 건다.
  if (window.addEventListener) window.addEventListener('load', applyRate);

  window.SG_SEAT_RT = RT;
})();
