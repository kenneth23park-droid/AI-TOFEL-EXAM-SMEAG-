/* SMEAG · StudyGround — exam-render.js
 * 목적: screenType 디스패처의 "골격". 실제 화면 렌더러는 Epic 2 에서
 *       exam-render-{listening,reading,writing,speaking}.js 가 register() 로 붙인다.
 *       이 파일은 등록표·마운트·미등록 폴백만 담당한다.
 * 의존 전역: 없음
 * 노출 전역: window.SG_RENDER
 *
 * 후속 담당자 규칙:
 *   - 이 파일에 screenType 별 DOM 생성 코드를 직접 넣지 않는다.
 *   - 각 렌더러 파일에서 SG_RENDER.register('question', fn) 형태로만 등록한다.
 *   - 렌더러는 다음 화면을 결정하지 않는다(상태머신은 exam-engine.js 소유).
 */
(function (root) {
  'use strict';

  var doc = root.document || null;
  var registry = {};
  var mountEl = null;

  function register(screenType, fn) {
    if (!screenType || typeof fn !== 'function') return false;
    registry[screenType] = fn;
    return true;
  }

  function has(screenType) { return typeof registry[screenType] === 'function'; }

  function types() { var o = [], k; for (k in registry) { if (registry.hasOwnProperty(k)) o.push(k); } return o; }

  function setMount(el) { mountEl = el || null; return mountEl; }

  function mount() {
    if (mountEl) return mountEl;
    if (doc) mountEl = doc.getElementById('screen-mount');
    return mountEl;
  }

  function clear() {
    var m = mount();
    if (!m) return;
    while (m.firstChild) m.removeChild(m.firstChild);
  }

  // EN/KO 이중 표기 (coding standards F5). 한국어 하드코딩 없이 span 두 개.
  function bilingual(tag, en, ko) {
    var el = doc.createElement(tag || 'p');
    var a = doc.createElement('span'); a.setAttribute('data-en', ''); a.textContent = en;
    var b = doc.createElement('span'); b.setAttribute('data-ko', ''); b.textContent = ko;
    el.appendChild(a); el.appendChild(b);
    return el;
  }

  /* 미등록 screenType 폴백. 예외를 던져 시험을 멈추지 않는다(F12). */
  function placeholder(screen) {
    var box = doc.createElement('div');
    box.className = 'screen-placeholder';
    box.appendChild(bilingual('h2', 'Renderer not loaded', '렌더러가 로드되지 않았습니다'));
    var code = doc.createElement('p');
    code.className = 'screen-placeholder-code';
    code.textContent = (screen && screen.screenType ? screen.screenType : 'unknown') +
      ' · ' + (screen && screen.id ? screen.id : '-');
    box.appendChild(code);
    box.appendChild(bilingual('p',
      'This screen type has no renderer registered yet. The exam engine keeps running.',
      '이 화면 유형의 렌더러가 아직 등록되지 않았습니다. 시험 엔진은 계속 동작합니다.'));
    return box;
  }

  /* 단일 진입점. 엔진은 항상 이 함수만 호출한다.
     반환값은 삽입된 루트 엘리먼트(없으면 null). */
  function render(screen, ctx) {
    if (!doc) return null;
    var m = mount();
    if (!m) return null;
    clear();
    var node = null;
    var fn = screen ? registry[screen.screenType] : null;
    if (typeof fn === 'function') {
      try {
        node = fn(screen, ctx || {});
      } catch (e) {
        if (root.console && root.console.warn) root.console.warn('[SG_RENDER] renderer failed:', e);
        node = null;
      }
    }
    if (!node) node = placeholder(screen);
    m.appendChild(node);
    m.setAttribute('data-screen-type', screen && screen.screenType ? screen.screenType : '');
    m.setAttribute('data-screen-id', screen && screen.id ? screen.id : '');
    return node;
  }

  root.SG_RENDER = {
    register: register, has: has, types: types,
    setMount: setMount, mount: mount, clear: clear,
    bilingual: bilingual, placeholder: placeholder, render: render
  };
})(typeof window !== 'undefined' ? window : this);
