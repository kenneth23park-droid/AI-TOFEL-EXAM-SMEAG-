/* SMEAG StudyGround — 시험 셸 안의 관리자 화면 이동 + 문항 편집 패널.
 *
 * 전체화면 시험 셸(exam-runtime.html · en/test-nt/* · set9*.html)에서
 *   · 화면을 앞뒤로(◀ Before / Next ▶) 자유롭게 넘기고
 *   · 지금 보이는 문항을 그 자리에서 고쳐 바로 확인한다.
 * 저장은 assets/question-config.js 의 오버라이드 스토어로 간다 — 콘텐츠 팩
 * (assets/set1.js · set9.js)은 건드리지 않으며, admin-questions.html 에서 저장한 것과
 * 완전히 같은 저장소다. 되돌리기를 누르면 원문이 그대로 복원된다.
 *
 * 학생 화면에는 아무 것도 그리지 않는다 — SG_ADMIN.can(set) 이 참일 때만 패널이 뜬다
 * (로그인은 좌하단 ⚙ 또는 Ctrl+Alt+A, assets/admin-entry.js).
 *
 * 의존: SG_ADMIN(필수) · SG_QUESTIONS(필수) · SG_RUNTIME(셸이 mount 시 넘겨준다)
 * 노출 전역: window.SG_EXAM_ADMIN
 */
(function () {
  'use strict';

  var A = window.SG_ADMIN, Q = window.SG_QUESTIONS;
  if (!A || !Q) return;

  var RT = null;          // SG_RUNTIME
  var setId = '';
  var panel = null;
  var editing = false;    // 편집 영역 펼침 상태 — 화면을 넘겨도 유지한다.
  var msg = '';

  function esc(t) { var d = document.createElement('div'); d.textContent = t == null ? '' : t; return d.innerHTML; }
  function machine() { return RT && RT.machine ? RT.machine() : null; }
  function screens() { return (RT && RT.screens ? RT.screens() : []) || []; }
  function pack() { return window.SG_CONTENT_PACK || null; }

  /* 문항 id → 콘텐츠 팩의 문항 객체. 오버라이드가 이미 얹힌 상태로 돌아온다. */
  function questionOf(qid) {
    var p = pack(), found = null;
    if (!p) return null;
    Q.eachQuestion(p, function (q) { if (q.id === qid) found = q; });
    return found;
  }

  /* 되돌리기 기준 원문 — question-config.js 가 문항마다 한 번 떠 둔 스냅샷. */
  function originalOf(q) { return (q && q.__sgOrig) || q || {}; }

  /* ── CSS ─────────────────────────────────────────────────── */

  function css() {
    if (document.getElementById('sgnav-css')) return;
    var s = document.createElement('style');
    s.id = 'sgnav-css';
    s.textContent =
      '.sgnav{position:fixed;right:14px;bottom:14px;z-index:8500;width:min(390px,calc(100vw - 28px));' +
        'max-height:calc(100vh - 28px);display:flex;flex-direction:column;' +
        'background:#241d1a;color:#f7f1ec;border-radius:14px;box-shadow:0 16px 40px rgba(0,0,0,.35);' +
        'font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:12.5px;overflow:hidden}' +
      '.sgnav[hidden]{display:none}' +
      '.sgnav-h{display:flex;align-items:center;gap:7px;padding:9px 11px;background:#2f6f4f;font-weight:800;' +
        'font-size:11.5px;letter-spacing:.05em;text-transform:uppercase;cursor:pointer;user-select:none;flex:none}' +
      '.sgnav-h .pos{margin-left:auto;font-weight:750;text-transform:none;letter-spacing:0;opacity:.92}' +
      '.sgnav-b{padding:11px;overflow:auto}' +
      '.sgnav.is-min .sgnav-b{display:none}' +
      '.sgnav-row{display:flex;gap:6px;align-items:center;margin-bottom:9px}' +
      '.sgnb{font:inherit;font-size:12px;font-weight:750;color:#f7f1ec;background:#3a2f2a;border:1px solid #50423b;' +
        'border-radius:9px;padding:7px 11px;cursor:pointer;line-height:1.1;text-decoration:none;display:inline-block}' +
      '.sgnb:hover:not(:disabled){background:#4a3b34}' +
      '.sgnb:disabled{opacity:.4;cursor:default}' +
      '.sgnb.wide{flex:1;text-align:center}' +
      '.sgnb.go{background:#2f6f4f;border-color:#3a8a62}' +
      '.sgnav select,.sgnav textarea,.sgnav input[type=text],.sgnav input[type=number]{width:100%;font:inherit;' +
        'font-size:12px;padding:7px 9px;border-radius:8px;border:1px solid #50423b;background:#180f0c;color:#f7f1ec}' +
      '.sgnav textarea{resize:vertical;line-height:1.5}' +
      '.sgnav-id{font-size:11px;color:#cbbdb4;word-break:break-all;margin-bottom:9px;line-height:1.5}' +
      '.sgnav-id b{color:#f7f1ec}' +
      '.sgnav-sec{border-top:1px solid #3a2f2a;padding-top:9px;margin-top:9px}' +
      '.sgnav-sec>p{margin:0 0 7px;font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#a2938b}' +
      '.sgnav-f{margin-bottom:8px}' +
      '.sgnav-f>label{display:block;font-size:10.5px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;' +
        'color:#a2938b;margin-bottom:4px}' +
      '.sgnav-msg{font-size:11.5px;font-weight:700;background:#1f5c3a;border-radius:8px;padding:6px 9px;margin-bottom:9px}' +
      '.sgnav-msg.warn{background:#7a5a12}' +
      '.sgnav-none{font-size:11.5px;color:#a2938b;line-height:1.6}';
    document.head.appendChild(s);
  }

  /* ── 패널 ────────────────────────────────────────────────── */

  function build() {
    css();
    panel = document.createElement('div');
    panel.className = 'sgnav';
    panel.innerHTML =
      '<div class="sgnav-h" data-act="min">✎ <span data-en>Admin · screens</span><span data-ko>관리자 · 화면 이동</span>' +
        '<span class="pos"></span></div>' +
      '<div class="sgnav-b"></div>';
    document.body.appendChild(panel);
    panel.addEventListener('click', onClick);
    panel.addEventListener('change', function (e) {
      if (e.target.getAttribute('data-act') === 'pick') jump(Number(e.target.value));
    });
    return panel;
  }

  function bodyHtml() {
    var m = machine(), list = screens();
    if (!m) return '<div class="sgnav-none">Exam shell is not ready yet.</div>';
    var i = m.currentIndex(), sc = m.current() || {};
    var opts = list.map(function (s, n) {
      return '<option value="' + n + '"' + (n === i ? ' selected' : '') + '>' +
        esc((n + 1) + '. ' + (s.id || '')) + '</option>';
    }).join('');

    var h =
      (msg ? '<div class="sgnav-msg">' + esc(msg) + '</div>' : '') +
      '<div class="sgnav-row">' +
        '<button class="sgnb wide" data-act="prev"' + (i <= 0 ? ' disabled' : '') + '>◀ <span data-en>Before</span><span data-ko>이전</span></button>' +
        '<button class="sgnb wide" data-act="next"' + (i >= list.length - 1 ? ' disabled' : '') + '><span data-en>Next</span><span data-ko>다음</span> ▶</button>' +
      '</div>' +
      '<div class="sgnav-row"><select data-act="pick">' + opts + '</select></div>' +
      '<div class="sgnav-id"><b>' + esc(sc.id || '') + '</b>' +
        esc((sc.screenType || '') + (sc.section ? ' · ' + sc.section : '') +
            (sc.moduleId ? ' · ' + sc.moduleId : '')) + '</div>';

    var ids = (sc.questionIds || []);
    h += '<div class="sgnav-sec"><p><span data-en>Edit questions on this screen</span><span data-ko>이 화면의 문항 편집</span></p>';
    if (!ids.length) {
      h += '<div class="sgnav-none"><span data-en>This screen has no question of its own (directions, audio or module end).</span>' +
           '<span data-ko>이 화면에는 문항이 없습니다(안내·오디오·모듈 종료 화면).</span></div>';
    } else if (!editing) {
      h += '<button class="sgnb go" data-act="edit">✎ <span data-en>Edit ' + ids.length + ' question(s)</span>' +
           '<span data-ko>문항 ' + ids.length + '개 편집</span></button>';
    } else {
      h += ids.map(fieldsHtml).join('');
      h += '<div class="sgnav-row">' +
             '<button class="sgnb wide go" data-act="save"><span data-en>Save</span><span data-ko>저장</span></button>' +
             '<button class="sgnb wide" data-act="revert"><span data-en>Revert</span><span data-ko>원문으로</span></button>' +
             '<button class="sgnb" data-act="close">✕</button>' +
           '</div>' +
           '<div class="sgnav-none"><span data-en>Text changes redraw at once. Audio and image changes need a reload.</span>' +
           '<span data-ko>본문·보기 수정은 즉시 반영되고, 음원·이미지 교체는 새로고침 후 반영됩니다.</span></div>';
    }
    h += '<div class="sgnav-row" style="margin-top:9px">' +
           '<a class="sgnb" data-role="lnk-q" target="_blank">↗ <span data-en>Question editor</span><span data-ko>문항 교체 페이지</span></a>' +
           '<button class="sgnb" data-act="reload">⟳ <span data-en>Reload here</span><span data-ko>이 화면으로 새로고침</span></button>' +
         '</div>';
    return h + '</div>';
  }

  function fieldsHtml(qid) {
    var q = questionOf(qid);
    if (!q) return '<div class="sgnav-none">' + esc(qid) + ' — not found in the content pack.</div>';
    var ovr = Q.isOverridden(setId, qid);
    var choices = Array.isArray(q.choices) ? q.choices : [];
    var f = '<div data-qid="' + esc(qid) + '" class="sgnav-q">' +
      '<div class="sgnav-id"><b>' + esc(qid) + '</b>' + (ovr ? 'replaced · 교체됨' : 'original · 원문') + '</div>' +
      '<div class="sgnav-f"><label>Prompt</label><textarea rows="3" data-f="prompt">' + esc(q.prompt || '') + '</textarea></div>';
    if (choices.length) {
      f += '<div class="sgnav-f"><label>Choices — one per line</label>' +
             '<textarea rows="' + Math.min(8, choices.length + 1) + '" data-f="choices">' + esc(choices.join('\n')) + '</textarea></div>' +
           '<div class="sgnav-f"><label>Answer — 1-based line number</label>' +
             '<input type="number" min="1" max="' + choices.length + '" data-f="answer" value="' +
             (typeof q.answer === 'number' ? (q.answer + 1) : '') + '"></div>';
    }
    f += '<div class="sgnav-f"><label>Audio path</label><input type="text" data-f="audio" value="' + esc(q.audio || '') + '"></div>' +
         '<div class="sgnav-f"><label>Image path</label><input type="text" data-f="image" value="' + esc(q.image || '') + '"></div>' +
         '<div class="sgnav-f"><label>Note</label><input type="text" data-f="note" value="' + esc(q.note || '') + '"></div>' +
         '</div>';
    return f;
  }

  function paint() {
    if (!panel) return;
    var m = machine(), list = screens();
    panel.querySelector('.pos').textContent = m ? ((m.currentIndex() + 1) + ' / ' + list.length) : '';
    panel.querySelector('.sgnav-b').innerHTML = bodyHtml();
    var lnk = panel.querySelector('[data-role=lnk-q]');
    if (lnk) lnk.href = (window.SG_ROUTE && window.SG_ROUTE.base ? window.SG_ROUTE.base : '') +
      'admin-questions.html' + (setId ? '?set=' + encodeURIComponent(setId) : '');
  }

  function flash(t) { msg = t || ''; paint(); if (t) setTimeout(function () { if (msg === t) { msg = ''; paint(); } }, 2600); }

  /* ── 동작 ────────────────────────────────────────────────── */

  function jump(index) {
    var m = machine();
    if (!m || typeof m.adminJumpTo !== 'function') return;
    if (!m.adminJumpTo(index, 'admin_jump')) { paint(); return; }
    m.syncHash();
    paint();
  }

  function readEdits() {
    var out = [];
    panel.querySelectorAll('.sgnav-q').forEach(function (box) {
      var patch = {}, qid = box.getAttribute('data-qid');
      box.querySelectorAll('[data-f]').forEach(function (el) {
        var f = el.getAttribute('data-f'), v = el.value;
        if (f === 'choices') patch.choices = String(v).split('\n').map(function (x) { return x.trim(); }).filter(function (x) { return x !== ''; });
        else if (f === 'answer') patch.answer = v === '' ? null : (Number(v) - 1);
        else patch[f] = v;
      });
      out.push({ qid: qid, patch: patch });
    });
    return out;
  }

  /* 저장 — 원문과 같은 필드는 오버라이드로 남기지 않는다(빈 문자열은 "원문 유지"라
     스토어가 지우므로, 원문 자체가 빈 값인 필드도 같은 결과가 된다). */
  function save() {
    var edits = readEdits(), reload = false, n = 0;
    edits.forEach(function (e) {
      var q = questionOf(e.qid); if (!q) return;
      var orig = originalOf(q), patch = {};
      Q.FIELDS.forEach(function (f) {
        if (e.patch[f] === undefined) return;
        var same = JSON.stringify(e.patch[f]) === JSON.stringify(orig[f] === undefined ? '' : orig[f]);
        patch[f] = same ? null : e.patch[f];
        if (!same && (f === 'audio' || f === 'image')) reload = true;
      });
      Q.set(setId, e.qid, patch);
      n++;
    });
    if (RT && RT.rerender) RT.rerender();
    flash(reload ? ('Saved ' + n + ' · reload to hear/see the new media')
                 : ('Saved ' + n + ' question(s)'));
  }

  function revert() {
    var ids = (machine() && machine().current() && machine().current().questionIds) || [];
    ids.forEach(function (qid) { Q.reset(setId, qid); });
    if (RT && RT.rerender) RT.rerender();
    flash('Reverted to the original text');
  }

  function reloadHere() {
    var sc = machine() && machine().current();
    if (!sc) return;
    window.location.hash = '#screen=' + encodeURIComponent(sc.id);
    window.location.reload();
  }

  function onClick(e) {
    var t = e.target.closest('[data-act]'); if (!t) return;
    var act = t.getAttribute('data-act');
    if (act === 'min') { panel.classList.toggle('is-min'); return; }
    if (act === 'prev') jump(machine().currentIndex() - 1);
    else if (act === 'next') jump(machine().currentIndex() + 1);
    else if (act === 'edit') { editing = true; paint(); }
    else if (act === 'close') { editing = false; paint(); }
    else if (act === 'save') save();
    else if (act === 'revert') revert();
    else if (act === 'reload') reloadHere();
  }

  /* ── mount ───────────────────────────────────────────────── */

  var API = {
    mount: function (opts) {
      opts = opts || {};
      RT = opts.runtime || window.SG_RUNTIME || null;
      setId = String(opts.set || A.pageSet() || '').toLowerCase();
      sync();
      A.onChange(sync);
      var m = machine();
      // 화면이 바뀌면(학생 Continue 포함) 패널의 위치 표시도 따라간다.
      if (m && m.onTransition) m.onTransition(function () { if (panel && !panel.hidden) paint(); });
    },
    paint: paint
  };

  function sync() {
    if (!A.can(setId)) { if (panel) panel.hidden = true; return; }
    if (!panel) build();
    panel.hidden = false;
    paint();
  }

  window.SG_EXAM_ADMIN = API;
})();
