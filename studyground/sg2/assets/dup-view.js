/* SMEAG StudyGround — dup-view.js : 겹침 목록 UI.
 *
 * 판정이 dup-core.js 한 벌인 것과 같은 이유로, 겹침을 **보여 주는 방식**도 한 벌이다.
 * 두 화면이 이 파일을 쓴다.
 *   · admin-set-import.html — 세트를 만드는 순간 그 자리에서
 *   · admin-dup.html        — 커밋된 팩 전체의 검사 결과
 *
 * 계약
 *   SG_DUP_VIEW.render(hostEl, pairs)   목록을 그린다(클릭 펼치기까지 배선한다)
 *   SG_DUP_VIEW.highlight(a, b)         a 중 b 와 겹치는 부분만 <mark> 로 감싼 HTML
 *
 * 한 줄을 누르면 두 문항을 나란히 펼치고, 실제로 일치한 4-gram 에 든 토큰만 칠한다.
 * 숫자만 보여 주고 "어디가 같은지"를 안 보여 주면 사람이 판정을 되짚을 수 없다.
 * "이 문항 열기"는 admin-questions.html 의 해당 문항으로 바로 보낸다.
 *
 * ES5 문법만 쓴다(빌드 단계 없음). 의존: assets/dup-core.js
 */
(function (root, factory) {
  var api = factory();
  root.SG_DUP_VIEW = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var CSS = [
    '.dupv .prow{background:var(--card);border:1px solid var(--line);border-radius:13px;margin-bottom:10px}',
    '.dupv .prow.sev-high{border-color:#e0796a}.dupv .prow.sev-watch{border-color:#e6c15a}',
    '.dupv .phead{display:flex;align-items:center;gap:9px;flex-wrap:wrap;cursor:pointer;padding:13px 15px}',
    '.dupv .phead .ids{font-size:13px;font-weight:800}',
    '.dupv .phead .ids .arrow{color:var(--muted);margin:0 5px;font-weight:600}',
    '.dupv .phead .why{flex:1;min-width:170px;font-size:12px;color:var(--muted);overflow:hidden;',
      'text-overflow:ellipsis;white-space:nowrap}',
    '.dupv .phead .chev{flex:none;color:var(--muted);font-size:12px;transition:transform .15s}',
    '.dupv .prow.open .phead .chev{transform:rotate(90deg)}',
    '.dupv .tagx{font-size:10px;font-weight:800;padding:2px 7px;border-radius:999px;',
      'text-transform:uppercase;letter-spacing:.04em;flex:none}',
    '.dupv .tagx.high{background:#fdeceb;color:#c62828}',
    '.dupv .tagx.watch{background:#faeec4;color:#8a6212}',
    '.dupv .tagx.info{background:var(--surface-2);color:var(--muted)}',
    '.dupv .tagx.same{background:var(--surface-2);color:var(--muted)}',
    '.dupv .tagx.cross{background:#dde8f7;color:#28527f}',
    '.dupv .pbody{display:none;border-top:1px solid var(--line);padding:14px 15px 16px}',
    '.dupv .prow.open .pbody{display:block}',
    '.dupv .reasons{margin:0 0 13px;padding:10px 12px;background:var(--surface-2);border-radius:9px}',
    '.dupv .reasons li{font-size:12.5px;line-height:1.65;color:var(--ink-2);margin-left:16px}',
    '.dupv .metrics{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:13px}',
    '.dupv .metrics span{font-size:11px;font-weight:750;color:var(--muted);background:var(--surface-2);',
      'border-radius:7px;padding:4px 8px}',
    '.dupv .sides{display:grid;grid-template-columns:1fr 1fr;gap:12px}',
    '@media (max-width:760px){.dupv .sides{grid-template-columns:1fr}}',
    '.dupv .side{border:1px solid var(--line-2);border-radius:11px;padding:11px 13px;background:var(--paper,#fff)}',
    '.dupv .side h4{margin:0 0 3px;font-size:12.5px;font-weight:800}',
    '.dupv .side .loc{font-size:11px;color:var(--muted);margin-bottom:9px}',
    '.dupv .side .txt{font-size:12.5px;line-height:1.7;white-space:pre-wrap;word-break:break-word}',
    '.dupv .side .txt mark{background:#ffe89a;color:inherit;border-radius:3px;padding:0 1px}',
    '.dupv .side ol.ch{margin:9px 0 0 18px;padding:0}',
    '.dupv .side ol.ch li{font-size:12.5px;line-height:1.65}',
    '.dupv .side ol.ch li.same{background:#ffe89a;border-radius:4px;padding:0 3px}',
    '.dupv .side .ans{margin-top:9px;font-size:12px;font-weight:750;color:var(--brand-ink,#0a6b62)}',
    '.dupv .side .framed{margin-top:9px;font-size:11px;color:var(--dim);line-height:1.55}',
    '.dupv .side .acts{margin-top:11px}',
    '.dupv .empty{text-align:center;color:var(--muted);font-size:13px;padding:34px 0}'
  ].join('');

  function ensureCss() {
    if (typeof document === 'undefined' || document.getElementById('sg-dupv-css')) return;
    var s = document.createElement('style');
    s.id = 'sg-dupv-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function esc(t) {
    var d = document.createElement('div');
    d.textContent = t == null ? '' : t;
    return d.innerHTML;
  }

  function core() { return typeof SG_DUP !== 'undefined' ? SG_DUP : null; }
  function norm(s) { var C = core(); return C ? C.normalize(s) : String(s || '').toLowerCase(); }
  function K() { var C = core(); return (C && C.TH.shingleK) || 4; }

  /* ── 일치 구간 하이라이트 ─────────────────────────────────────────────────
   * 검사기와 같은 정규화·shingle 규칙으로 두 쪽의 공통 4-gram 을 구하고,
   * 그 4-gram 에 든 토큰만 칠한다. 원문 조각(공백·문장부호)은 그대로 흘려보낸다. */
  function split(text) {
    var out = [], re = /[A-Za-z0-9’']+/g, m, last = 0;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) out.push({ raw: text.slice(last, m.index), tok: null });
      out.push({ raw: m[0], tok: norm(m[0]) });
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push({ raw: text.slice(last), tok: null });
    return out;
  }

  function highlight(aText, bText) {
    var k = K();
    var pa = split(String(aText || '')), pb = split(String(bText || ''));
    var ta = pa.filter(function (p) { return p.tok; });
    var tb = pb.filter(function (p) { return p.tok; }).map(function (p) { return p.tok; });

    var bs = {}, i, j;
    if (tb.length < k) { if (tb.length) bs[tb.join(' ')] = 1; }
    else for (i = 0; i + k <= tb.length; i++) bs[tb.slice(i, i + k).join(' ')] = 1;

    var hit = [];
    for (i = 0; i < ta.length; i++) hit.push(false);
    if (ta.length >= k) {
      for (i = 0; i + k <= ta.length; i++) {
        var key = ta.slice(i, i + k).map(function (p) { return p.tok; }).join(' ');
        if (bs[key]) for (j = i; j < i + k; j++) hit[j] = true;
      }
    }

    var ti = 0, out = '', open = false;
    pa.forEach(function (p) {
      if (!p.tok) { if (open) { out += '</mark>'; open = false; } out += esc(p.raw); return; }
      var on = hit[ti++];
      if (on && !open) { out += '<mark>'; open = true; }
      if (!on && open) { out += '</mark>'; open = false; }
      out += esc(p.raw);
    });
    if (open) out += '</mark>';
    return out;
  }

  function sideHtml(u, other, label) {
    var otherChoices = (other.choices || []).map(norm);
    var ch = (u.choices || []).map(function (c) {
      var same = otherChoices.indexOf(norm(c)) >= 0;
      return '<li class="' + (same ? 'same' : '') + '">' + esc(c) + '</li>';
    }).join('');
    var framed = (u.framedOut || []).length
      ? '<div class="framed"><span data-en>Excluded as type boilerplate: </span>' +
        '<span data-ko>유형 정형문으로 제외: </span>' +
        u.framedOut.map(function (f) { return esc(f.line) + ' (' + f.df + ')'; }).join(' · ') + '</div>'
      : '';
    return '<div class="side">' +
      '<h4>' + esc(label) + ' — ' + esc(u.uid) + '</h4>' +
      '<div class="loc">' + esc(u.set + ' · ' + u.sectionLabel + ' · ' + u.moduleLabel + ' · ' + u.blockKind) +
        (u.qkind ? ' · ' + esc(u.qkind) : '') + '</div>' +
      '<div class="txt">' + highlight(u.text, other.text) + '</div>' +
      (ch ? '<ol class="ch">' + ch + '</ol>' : '') +
      (u.answerText ? '<div class="ans"><span data-en>Answer: </span><span data-ko>정답: </span>' +
        esc(u.answerText) + '</div>' : '') +
      framed +
      (u.href ? '<div class="acts"><a class="btn ghost sm" href="' + esc(u.href) + '">' +
        '<span data-en>Open this item</span><span data-ko>이 문항 열기</span></a></div>' : '') +
    '</div>';
  }

  function rowHtml(p, i) {
    var m = p.metrics;
    var chips = [
      '4-gram ' + Math.round(m.jaccard * 100) + '%',
      'containment ' + Math.round(m.containment * 100) + '%',
      '<span data-en>longest run</span><span data-ko>최장연속</span> ' + m.longestRun,
      '<span data-en>shared choices</span><span data-ko>선택지 일치</span> ' + m.sharedChoices
    ].map(function (t) { return '<span>' + t + '</span>'; }).join('');

    var hay = (p.key + ' ' + p.a.text + ' ' + p.b.text + ' ' + p.a.set + ' ' + p.b.set).toLowerCase();

    return '<div class="prow sev-' + p.severity + '" data-i="' + i + '" data-key="' + esc(p.key) +
        '" data-sev="' + p.severity + '" data-scope="' + p.scope + '" data-search="' + esc(hay) + '">' +
      '<div class="phead">' +
        '<span class="tagx ' + p.severity + '">' + p.severity + '</span>' +
        (p.scope === 'cross'
          ? '<span class="tagx cross"><span data-en>across sets</span><span data-ko>SET 간</span></span>'
          : '<span class="tagx same"><span data-en>same set</span><span data-ko>같은 SET</span></span>') +
        '<span class="ids">' + esc(p.a.uid) + '<span class="arrow">↔</span>' + esc(p.b.uid) + '</span>' +
        '<span class="why">' + esc(p.reasons[0] || '') + '</span>' +
        '<span class="chev">▶</span>' +
      '</div>' +
      '<div class="pbody">' +
        '<ul class="reasons">' + p.reasons.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul>' +
        '<div class="metrics">' + chips + '</div>' +
        '<div class="sides">' + sideHtml(p.a, p.b, 'A') + sideHtml(p.b, p.a, 'B') + '</div>' +
      '</div>' +
    '</div>';
  }

  /** 목록을 그리고 클릭 펼치기를 배선한다. host 는 한 번만 배선된다. */
  function render(host, pairs, emptyHtml) {
    ensureCss();
    if (!host) return;
    host.className = (host.className || '').indexOf('dupv') >= 0 ? host.className : (host.className + ' dupv').trim();
    host.innerHTML = (pairs && pairs.length)
      ? pairs.map(rowHtml).join('')
      : '<div class="empty">' + (emptyHtml ||
          '<span data-en>No overlaps.</span><span data-ko>겹침이 없습니다.</span>') + '</div>';
    bind(host);
  }

  function bind(host) {
    if (!host || host.__dupvBound) return;
    host.__dupvBound = true;
    host.addEventListener('click', function (e) {
      if (e.target.closest('a')) return;                 // "이 문항 열기" 는 그대로 통과
      var head = e.target.closest('.phead');
      if (!head) return;
      head.parentNode.classList.toggle('open');
    });
  }

  /** key 로 한 줄을 펼치고 화면 가운데로 보낸다(다른 화면에서 건너뛰어 올 때). */
  function openPair(host, key) {
    if (!host || !key) return false;
    var rows = host.querySelectorAll('.prow');
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].getAttribute('data-key') === key) {
        rows[i].classList.add('open');
        rows[i].scrollIntoView({ block: 'center' });
        return true;
      }
    }
    return false;
  }

  return { render: render, bind: bind, openPair: openPair, highlight: highlight, rowHtml: rowHtml, esc: esc };
});
