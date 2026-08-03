/* =============================================================
 * SMEAG TOEFL — 공통 유틸리티 (담당 A) → window.SMEAG
 * 빌드/번들러 없음. 클래식 <script src> 로 로드된다.
 * ============================================================= */
(function () {
  'use strict';

  var SMEAG = {};

  /* ---------------------------------------------------------------
   * encodePath(p)
   * 공백이 들어간 미디어 경로를 src 에 안전하게 넣기 위한 인코딩.
   * 이미 인코딩된 문자열(%20 등)이 다시 %2520 이 되지 않도록 중복 방지.
   * --------------------------------------------------------------- */
  SMEAG.encodePath = function (p) {
    if (p === null || p === undefined) return '';
    var s = String(p);
    // 이미 인코딩되어 있으면(디코드했을 때 달라지고, 그 결과를 다시 인코딩하면 원본과 같으면) 그대로 둔다.
    try {
      var dec = decodeURI(s);
      if (dec !== s && encodeURI(dec) === s) return s;
    } catch (e) {
      /* 잘못된 % 시퀀스 — 그냥 아래에서 인코딩 */
    }
    try {
      return encodeURI(s);
    } catch (e2) {
      return s;
    }
  };

  /* ---------------------------------------------------------------
   * el(tag, attrs, kids) — 엘리먼트 생성 헬퍼
   *   attrs.class / className : 클래스
   *   attrs.text              : textContent
   *   attrs.html              : innerHTML (직접 만든 안전한 마크업만)
   *   attrs.style             : 문자열 또는 {prop:value}
   *   attrs.dataset           : {키:값}
   *   attrs.onXxx (함수)      : addEventListener('xxx', fn)
   *   그 외                   : setAttribute
   * kids: 엘리먼트 / 문자열 / 배열 / null (중첩 배열 허용)
   * --------------------------------------------------------------- */
  SMEAG.el = function (tag, attrs, kids) {
    var node = document.createElement(tag || 'div');
    var k;
    if (attrs) {
      for (k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class' || k === 'className') {
          node.className = String(v);
        } else if (k === 'text') {
          node.textContent = String(v);
        } else if (k === 'html') {
          node.innerHTML = String(v);
        } else if (k === 'style') {
          if (typeof v === 'string') {
            node.setAttribute('style', v);
          } else {
            for (var sp in v) {
              if (Object.prototype.hasOwnProperty.call(v, sp)) node.style[sp] = v[sp];
            }
          }
        } else if (k === 'dataset') {
          for (var dk in v) {
            if (Object.prototype.hasOwnProperty.call(v, dk)) node.dataset[dk] = v[dk];
          }
        } else if (k.length > 2 && k.slice(0, 2) === 'on' && typeof v === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (v === true) {
          node.setAttribute(k, '');
        } else {
          node.setAttribute(k, String(v));
        }
      }
    }
    appendKids(node, kids);
    return node;
  };

  function appendKids(node, kids) {
    if (kids === null || kids === undefined || kids === false) return;
    if (Array.isArray(kids)) {
      for (var i = 0; i < kids.length; i++) appendKids(node, kids[i]);
      return;
    }
    if (kids && kids.nodeType) {
      node.appendChild(kids);
      return;
    }
    node.appendChild(document.createTextNode(String(kids)));
  }

  /* HTML 이스케이프 */
  var ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  SMEAG.esc = function (s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, function (c) { return ESC_MAP[c]; });
  };

  /* 754 -> '12:34' (1시간 넘으면 'H:MM:SS') */
  SMEAG.fmtTime = function (sec) {
    var n = Math.max(0, Math.floor(Number(sec) || 0));
    var h = Math.floor(n / 3600);
    var m = Math.floor((n % 3600) / 60);
    var s = n % 60;
    function p2(x) { return (x < 10 ? '0' : '') + x; }
    if (h > 0) return h + ':' + p2(m) + ':' + p2(s);
    return p2(m) + ':' + p2(s);
  };

  /* ISO -> '2026-08-03' */
  SMEAG.fmtDate = function (iso) {
    if (!iso) return '';
    var d = (iso instanceof Date) ? iso : new Date(iso);
    if (isNaN(d.getTime())) return String(iso).slice(0, 10);
    function p2(x) { return (x < 10 ? '0' : '') + x; }
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  };

  /* 10자리 짧은 ID */
  SMEAG.uid = function () {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID().replace(/-/g, '').slice(0, 10);
      }
      if (window.crypto && window.crypto.getRandomValues) {
        var a = new Uint8Array(5);
        window.crypto.getRandomValues(a);
        var out = '';
        for (var i = 0; i < a.length; i++) out += ('0' + a[i].toString(16)).slice(-2);
        return out;
      }
    } catch (e) { /* 아래 폴백 */ }
    return (Math.random().toString(36).slice(2, 7) + Math.random().toString(36).slice(2, 7)).slice(0, 10);
  };

  /* ---------------------------------------------------------------
   * tokenize(s) — 문장 채점용 토큰 배열
   * 소문자화 · 스마트따옴표 정규화 · 구두점 제거 · 공백 분리
   * 축약형의 아포스트로피는 유지한다 (don't ≠ dont 판정 방지를 위해
   * 아포스트로피를 표준 ' 로 통일한 뒤 남겨 둔다).
   * --------------------------------------------------------------- */
  SMEAG.tokenize = function (s) {
    if (s === null || s === undefined) return [];
    var t = String(s);
    t = t.replace(/[‘’ʼ‛]/g, "'");      // 스마트 작은따옴표
    t = t.replace(/[“”„]/g, '"');            // 스마트 큰따옴표
    t = t.replace(/[‒–—―]/g, ' ');                     // 긴 대시는 구분자로
    t = t.replace(/[‐‑]/g, '-');                          // 유니코드 하이픈 → ASCII
    t = t.toLowerCase();
    t = t.replace(/[.,!?;:"()\[\]{}<>/\\|~`@#$%^&*_+=]/g, ' ');
    t = t.replace(/\s-\s/g, ' ');                           // 독립 하이픈
    t = t.replace(/\s+/g, ' ').trim();
    if (!t) return [];
    return t.split(' ');
  };

  /* 빈칸 채점용: trim + 소문자 + 내부 공백 제거 */
  SMEAG.normWord = function (s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/[‘’ʼ]/g, "'")
      .toLowerCase()
      .replace(/\s+/g, '')
      .trim();
  };

  /* location.search 파라미터 */
  SMEAG.qs = function (name) {
    try {
      var m = new RegExp('[?&]' + String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^&#]*)')
        .exec(window.location.search);
      return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : null;
    } catch (e) {
      return null;
    }
  };

  /* 디버그 로그 (config.debug 가 true 일 때만) */
  SMEAG.log = function () {
    try {
      if (window.SMEAG_CONFIG && window.SMEAG_CONFIG.debug && window.console) {
        console.log.apply(console, ['[SMEAG]'].concat(Array.prototype.slice.call(arguments)));
      }
    } catch (e) { /* 무시 */ }
  };

  window.SMEAG = SMEAG;
})();
