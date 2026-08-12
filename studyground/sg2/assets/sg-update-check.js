/* SMEAG · StudyGround — 내려받은 사본의 판올림 확인.
 *
 * 웹으로 들어오는 학생은 이 파일이 할 일이 없다. 서비스워커가 VERSION 이 바뀐 것을
 * 보고 셸 캐시를 통째로 갈아 끼우기 때문이다(sw.js). 문제는 사본 쪽이다 —
 * USB 번들(dist/*.zip)과 데스크톱 앱은 구운 그날에 멈춘다. 실제로 번들은 v25,
 * 데스크톱은 v1 에 머문 채로 v45 가 나갔고, 그 기기의 학생만 전체화면 잠금도
 * 리딩 복기 카드도 없는 화면을 봤다. 사본은 자기가 낡은 줄을 모른다.
 *
 * 그래서 사본이 켜질 때 라이브에 한 번 물어본다.
 *   · 오프라인이면 조용히 지나간다 — 시험장에서 회선이 없는 것은 정상이다.
 *   · 새 판이 있으면 구석에 알림을 띄운다. 학생을 막지 않는다.
 *   · 같은 판에 대해 한 번 닫으면 다시 뜨지 않는다. 매번 뜨는 알림은 곧 안 읽힌다.
 *
 * 판 번호는 assets/build-version.js(사본)와 /version.json(라이브)에 있고, 둘 다
 * sg2/tools/build_version.py 가 sw.js 의 VERSION 하나에서 만든다.
 */
(function () {
  'use strict';

  var B = window.SG_BUILD;
  // 웹 사본에는 알릴 것이 없다. 표가 아예 없는 옛 사본도 여기서 조용히 끝난다.
  if (!B || B.channel === 'web' || !B.origin) return;

  var GAP = 6 * 60 * 60 * 1000;      // 라이브에 묻는 간격 — 하루에 몇 번이면 충분하다.
  var TIMEOUT = 5000;                // 회선이 죽은 시험장에서 5 초 넘게 기다리지 않는다.
  var K_ASKED = 'sg2_update_asked';  // 마지막으로 물어본 시각
  var K_HIDDEN = 'sg2_update_hidden';// 학생이 닫은 판 번호

  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  var last = parseInt(get(K_ASKED) || '0', 10) || 0;
  if (Date.now() - last < GAP) return;

  // 시험 중에는 묻지 않는다. 응시 화면은 이 스크립트를 부르지 않지만, 나중에
  // 누가 넣더라도 답안을 쓰는 위에 알림이 뜨는 일은 없어야 한다.
  if (/exam-runtime|\/test-nt\//.test(location.pathname)) return;

  var ctl = window.AbortController ? new window.AbortController() : null;
  var timer = setTimeout(function () { if (ctl) ctl.abort(); }, TIMEOUT);

  // cache: 'no-store' 만으로는 부족하다 — 번들의 서비스워커가 중간에서 답할 수 있어서
  // sw.js 도 /version.json 은 지나가게 열어 두었다.
  fetch(B.origin + '/version.json', {
    cache: 'no-store',
    mode: 'cors',
    credentials: 'omit',
    signal: ctl ? ctl.signal : undefined
  }).then(function (res) {
    return res.ok ? res.json() : null;
  }).then(function (live) {
    clearTimeout(timer);
    if (!live || typeof live.n !== 'number') return;
    set(K_ASKED, String(Date.now()));
    if (live.n <= (B.n || 0)) return;             // 이미 최신이다
    if (get(K_HIDDEN) === live.version) return;   // 이 판은 학생이 닫았다
    show(live);
  }).catch(function () {
    clearTimeout(timer);
    // 오프라인·차단·시간 초과 — 아무것도 하지 않는다. 다음에 켤 때 다시 묻는다.
    // 물어본 시각을 남기지 않으므로, 회선이 돌아온 첫 순간에 곧바로 확인된다.
  });

  function show(live) {
    var el = document.createElement('div');
    el.className = 'sg-prep sg-update';
    el.setAttribute('role', 'status');
    el.innerHTML =
      '<div class="sg-prep-row">' +
        '<span class="sg-prep-dot"></span>' +
        '<b class="sg-prep-title">A newer version is available</b>' +
        '<button type="button" class="sg-prep-x" aria-label="Dismiss">&times;</button>' +
      '</div>' +
      '<div class="sg-prep-sub">' +
        'This copy is <b>' + esc(B.version) + '</b>. The current version is ' +
        '<b>' + esc(live.version) + '</b>. Ask your teacher for the latest copy, ' +
        'or open MockTest in a browser.' +
      '</div>' +
      '<a class="sg-prep-go" target="_blank" rel="noopener">Open the online version</a>';

    el.querySelector('.sg-prep-go').href = live.download || B.origin;
    el.querySelector('.sg-prep-x').addEventListener('click', function () {
      set(K_HIDDEN, live.version);
      el.classList.remove('on');
      setTimeout(function () { el.remove(); }, 250);
    });

    document.body.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('on'); });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
})();
