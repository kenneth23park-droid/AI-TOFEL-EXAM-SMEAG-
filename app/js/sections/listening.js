/* =============================================================
 * SMEAG TOEFL — 리스닝 섹션 렌더러
 * window.SMEAG_SECTIONS.listening = { renderBlock(ctx) -> {destroy()} }
 *
 * 처리하는 block.kind : 'audio-set'
 *   ① block.perQuestionAudio === true
 *      문항마다 q.audio 가 따로 있다 → 한 문항씩 순차 진행
 *      (오디오 재생 → 종료 후 선택지 활성화 → 답 선택 → '다음 문항')
 *      블록의 모든 문항을 마쳐야 ctx.onReady()
 *   ② 그 외
 *      block.audio 를 먼저 끝까지 듣고(그 동안 선택지 비활성 + block.image 표시),
 *      재생 완료 후 블록의 전체 문항을 한 화면에 표시하고 ctx.onReady()
 *
 * 오디오는 반드시 SMEAG_AUDIO.create({src, playKey, onEnded, onBlocked}) 로 만든다.
 * playKey = 'aud:' + question.id  또는  'aud:' + block.heading
 *
 * ES module 아님 — <script src> 로 로드되는 클래식 스크립트.
 * ============================================================= */
(function () {
  'use strict';

  window.SMEAG_SECTIONS = window.SMEAG_SECTIONS || {};

  /* ---------------------------------------------------------------
   * 공용 미니 헬퍼
   * --------------------------------------------------------------- */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }
  function letter(i) { return String.fromCharCode(65 + i); }

  /* 미디어 경로에 공백이 있으므로 반드시 인코딩해서 src 에 넣는다 */
  function srcOf(p) {
    if (!p) return '';
    if (window.SMEAG && typeof window.SMEAG.encodePath === 'function') {
      return window.SMEAG.encodePath(p);
    }
    return encodeURI(p);   /* util.js 가 아직 없을 때의 안전망 */
  }

  /* SMEAG_AUDIO.create 가 준비되지 않은 경우를 위한 최소 대체 플레이어.
     (audio.js 가 로드되면 이 경로는 절대 타지 않는다) */
  function fallbackPlayer(opt) {
    var box = el('div', 'audio-box ls-audio');
    var a = document.createElement('audio');
    a.src = srcOf(opt.src);
    a.preload = 'auto';
    var status = el('span', 'ls-audio-txt', '오디오를 재생하고 있습니다…');
    var btn = el('button', 'ls-btn ghost', '재생');
    btn.type = 'button';
    btn.style.display = 'none';
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      status.textContent = '재생이 끝났습니다.';
      if (opt.onEnded) opt.onEnded();
    }
    a.addEventListener('ended', finish);
    a.addEventListener('error', function () {
      status.textContent = '오디오를 불러오지 못했습니다. 선택지를 바로 여는 중…';
      finish();
    });
    btn.addEventListener('click', function () {
      btn.style.display = 'none';
      a.play();
    });
    box.appendChild(el('span', 'ls-audio-icon', '🔊'));
    box.appendChild(status);
    box.appendChild(btn);
    box.appendChild(a);
    return {
      element: box,
      play: function () {
        var pr = a.play();
        if (pr && typeof pr.catch === 'function') {
          pr.catch(function () {
            btn.style.display = '';
            status.textContent = '브라우저가 자동재생을 막았습니다. [재생] 을 눌러 주세요.';
            if (opt.onBlocked) opt.onBlocked();
          });
        }
      },
      stop: function () { try { a.pause(); } catch (e) { /* 무시 */ } },
      isDone: function () { return done; }
    };
  }

  function makePlayer(opt) {
    if (window.SMEAG_AUDIO && typeof window.SMEAG_AUDIO.create === 'function') {
      return window.SMEAG_AUDIO.create(opt);
    }
    return fallbackPlayer(opt);
  }

  /* ---------------------------------------------------------------
   * 스타일 주입 — app.css(담당 A) 가 이기도록 <head> 맨 앞에 삽입
   * --------------------------------------------------------------- */
  var STYLE_ID = 'smeag-listening-style';
  var CSS = [
    '.ls-wrap{max-width:860px;margin:0 auto;padding:4px 2px 24px}',
    '.ls-head{margin-bottom:14px;display:flex;justify-content:space-between;align-items:flex-end;gap:12px}',
    '.ls-heading{font-size:20px;font-weight:800;color:var(--brand,#5b5ef4)}',
    '.ls-instruction{font-size:14px;color:var(--muted,#8a8aa0);margin-top:4px}',
    '.ls-progress{flex:0 0 auto;font-size:13px;font-weight:800;color:var(--muted,#8a8aa0);',
    '  background:var(--brand-soft,#eef0ff);color:var(--brand,#5b5ef4);border-radius:999px;padding:5px 12px}',
    '.ls-card{background:var(--card,#fff);border:1px solid var(--line,#ececf4);',
    '  border-radius:var(--radius,16px);padding:18px 20px;margin-bottom:14px}',
    '.ls-figure{text-align:center;margin-bottom:14px}',
    '.ls-figure img{max-width:100%;max-height:320px;border-radius:12px}',
    '.ls-audio{display:flex;align-items:center;gap:10px;flex-wrap:wrap;',
    '  border:1px solid var(--line,#ececf4);border-radius:12px;background:#f7f7fc;padding:10px 14px}',
    '.ls-audio-icon{font-size:18px}',
    '.ls-audio-txt{font-size:14px;color:var(--text,#1c1c28)}',
    '.ls-note{font-size:13px;color:var(--muted,#8a8aa0);margin-top:8px}',
    '.ls-note.warn{color:var(--warn,#f5a524);font-weight:700}',
    '.ls-btn{border:0;border-radius:12px;padding:11px 20px;font:inherit;font-weight:800;',
    '  cursor:pointer;background:var(--brand,#5b5ef4);color:#fff}',
    '.ls-btn:disabled{opacity:.45;cursor:not-allowed}',
    '.ls-btn.ghost{background:#fff;color:var(--brand,#5b5ef4);border:1px solid var(--brand,#5b5ef4);padding:7px 14px}',
    '.ls-foot{display:flex;justify-content:flex-end;margin-top:6px}',
    /* --- 문항 --- */
    '.ls-q{border-bottom:1px solid var(--line,#ececf4);padding:14px 0}',
    '.ls-q:first-child{padding-top:0}',
    '.ls-q:last-child{border-bottom:0;padding-bottom:0}',
    '.ls-q-head{display:flex;gap:9px;align-items:flex-start;margin-bottom:10px}',
    '.ls-q-no{flex:0 0 auto;min-width:24px;height:24px;border-radius:8px;font-size:12px;',
    '  font-weight:800;display:inline-flex;align-items:center;justify-content:center;',
    '  color:#fff;background:var(--brand,#5b5ef4);padding:0 6px}',
    '.ls-q-prompt{font-size:15px;font-weight:600;line-height:1.6}',
    '.ls-choices{display:flex;flex-direction:column;gap:8px;margin-left:33px}',
    '@media (max-width:680px){.ls-choices{margin-left:0}}',
    '.ls-choices.locked{opacity:.45;pointer-events:none}',
    '.ls-choices .choice{display:flex;gap:10px;align-items:flex-start;cursor:pointer;',
    '  border:1px solid var(--line,#ececf4);border-radius:12px;padding:10px 12px;background:#fff}',
    '.ls-choices .choice:hover{border-color:#c9caf8}',
    '.ls-choices .choice.sel{border-color:var(--brand,#5b5ef4);background:var(--brand-soft,#eef0ff)}',
    '.ls-choices .choice input{margin-top:3px;accent-color:var(--brand,#5b5ef4)}',
    '.ls-choice-letter{font-weight:800;color:var(--muted,#8a8aa0);flex:0 0 auto}',
    '.ls-choices .choice.sel .ls-choice-letter{color:var(--brand,#5b5ef4)}',
    '.ls-choice-text{font-size:14.5px;line-height:1.6}'
  ].join('\n');

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = CSS;
    var head = document.head || document.getElementsByTagName('head')[0];
    if (head.firstChild) head.insertBefore(s, head.firstChild);
    else head.appendChild(s);
  }

  /* ---------------------------------------------------------------
   * 객관식 문항 카드
   * 반환값 { node, lock(bool), answered() }
   * --------------------------------------------------------------- */
  function choiceCard(ctx, q, onPick) {
    var wrap = el('div', 'ls-q');
    wrap.setAttribute('data-qid', q.id);

    var head = el('div', 'ls-q-head');
    head.appendChild(el('span', 'ls-q-no', q.no));
    head.appendChild(el('div', 'ls-q-prompt', q.prompt || ''));
    wrap.appendChild(head);

    var list = el('div', 'ls-choices locked');
    var radios = [];
    var labels = [];
    var name = 'q_' + q.id;
    var saved = ctx.getAnswer(q.id);

    (q.choices || []).forEach(function (text, i) {
      var lab = el('label', 'choice');
      var radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = name;
      radio.value = String(i);
      radio.disabled = true;
      if (saved === i) { radio.checked = true; lab.className = 'choice sel'; }
      radio.addEventListener('change', function () {
        if (!radio.checked) return;
        labels.forEach(function (l, k) { l.className = (k === i) ? 'choice sel' : 'choice'; });
        ctx.setAnswer(q.id, i);
        if (onPick) onPick(i);
      });
      lab.appendChild(radio);
      lab.appendChild(el('span', 'ls-choice-letter', letter(i) + '.'));
      lab.appendChild(el('span', 'ls-choice-text', text));
      list.appendChild(lab);
      radios.push(radio);
      labels.push(lab);
    });
    wrap.appendChild(list);

    return {
      node: wrap,
      unlock: function () {
        list.className = 'ls-choices';
        radios.forEach(function (r) { r.disabled = false; });
      },
      lock: function () {
        list.className = 'ls-choices locked';
        radios.forEach(function (r) { r.disabled = true; });
      },
      answered: function () {
        return typeof ctx.getAnswer(q.id) === 'number';
      }
    };
  }

  /* ---------------------------------------------------------------
   * 그림 (있을 때만)
   * --------------------------------------------------------------- */
  function figure(path) {
    if (!path) return null;
    var box = el('div', 'ls-figure');
    var img = document.createElement('img');
    img.src = srcOf(path);
    img.alt = '';
    img.addEventListener('error', function () { box.style.display = 'none'; });
    box.appendChild(img);
    return box;
  }

  /* ===============================================================
   * 렌더러
   * =============================================================== */
  window.SMEAG_SECTIONS.listening = {
    renderBlock: function (ctx) {
      injectStyle();

      var block = ctx.block || {};
      var questions = block.questions || [];
      var players = [];      /* destroy 시 전부 정지 */
      var destroyed = false;

      var wrap = el('div', 'ls-wrap');
      var head = el('div', 'ls-head');
      var titles = el('div', '');
      if (block.heading) titles.appendChild(el('div', 'ls-heading', block.heading));
      if (block.instruction) titles.appendChild(el('div', 'ls-instruction', block.instruction));
      head.appendChild(titles);
      var progress = el('div', 'ls-progress', '');
      head.appendChild(progress);
      wrap.appendChild(head);

      var stage = el('div', '');
      wrap.appendChild(stage);
      ctx.root.appendChild(wrap);

      function ready() {
        if (!destroyed && typeof ctx.onReady === 'function') ctx.onReady();
      }
      function stopAll() {
        players.forEach(function (p) {
          try { if (p && p.stop) p.stop(); } catch (e) { /* 무시 */ }
        });
        players.length = 0;
      }

      if (block.perQuestionAudio) {
        renderSequential();
      } else {
        renderShared();
      }

      /* -----------------------------------------------------------
       * ① 문항별 오디오 — 한 문항씩 순차 진행
       * ----------------------------------------------------------- */
      function renderSequential() {
        /* 이어하기: 아직 답하지 않은 첫 문항부터 시작 */
        var start = 0;
        for (var i = 0; i < questions.length; i++) {
          if (typeof ctx.getAnswer(questions[i].id) !== 'number') { start = i; break; }
          start = i + 1;
        }
        if (start >= questions.length) start = questions.length - 1;
        step(Math.max(0, start));

        function step(index) {
          if (destroyed) return;
          stopAll();
          stage.textContent = '';
          progress.textContent = '문항 ' + (index + 1) + ' / ' + questions.length;

          var q = questions[index];
          var card = el('div', 'ls-card');

          var fig = figure(q.image);
          if (fig) card.appendChild(fig);

          var key = 'aud:' + q.id;
          var already = typeof ctx.hasPlayed === 'function' && ctx.hasPlayed(key);
          var qc = choiceCard(ctx, q, function () { showNext(); });

          if (already || !q.audio) {
            var box = el('div', 'audio-box ls-audio');
            box.appendChild(el('span', 'ls-audio-icon', '🔇'));
            box.appendChild(el('span', 'ls-audio-txt',
              already ? '이미 재생한 오디오입니다. (다시 들을 수 없습니다)' : '오디오가 없는 문항입니다.'));
            card.appendChild(box);
            card.appendChild(qc.node);
            qc.unlock();
            showNext();   /* 무응답이어도 진행은 막지 않는다 */
          } else {
            var p = makePlayer({
              src: srcOf(q.audio),
              playKey: key,
              autoplay: true,
              onEnded: function () {
                if (destroyed) return;
                if (typeof ctx.markPlayed === 'function') ctx.markPlayed(key);
                qc.unlock();
                showNext();   /* 재생이 끝나면 무응답이어도 진행 가능 */
                hint.textContent = '재생이 끝났습니다. 알맞은 응답을 고르세요.';
                hint.className = 'ls-note';
              },
              onBlocked: function () {
                if (destroyed) return;
                hint.textContent = '브라우저가 자동재생을 막았습니다. 재생 버튼을 눌러 주세요.';
                hint.className = 'ls-note warn';
              }
            });
            players.push(p);
            if (p.element) card.appendChild(p.element);
            var hint = el('div', 'ls-note', '오디오가 끝나면 선택지가 열립니다.');
            card.appendChild(hint);
            card.appendChild(qc.node);
            if (typeof p.play === 'function') p.play();
          }

          stage.appendChild(card);

          /* '다음 문항' 버튼 (마지막 문항은 표시하지 않는다) */
          var foot = el('div', 'ls-foot');
          var nextBtn = el('button', 'ls-btn', '다음 문항 →');
          nextBtn.type = 'button';
          nextBtn.style.display = 'none';
          nextBtn.addEventListener('click', function () { step(index + 1); });
          foot.appendChild(nextBtn);
          stage.appendChild(foot);

          function showNext() {
            if (index + 1 < questions.length) nextBtn.style.display = '';
            else finish();
          }
          /* 이어하기로 이미 답이 있는 문항이면 버튼을 바로 노출 */
          if (qc.answered()) showNext();

          var finished = false;
          function finish() {
            if (finished) return;   /* 선택지를 바꿔도 안내가 중복 append 되지 않게 */
            finished = true;
            progress.textContent = '마지막 문항 · ' + questions.length + ' / ' + questions.length;
            var done = el('div', 'ls-note', '이 블록의 마지막 문항입니다. [다음] 으로 진행하세요.');
            stage.appendChild(done);
            ready();
          }
        }
      }

      /* -----------------------------------------------------------
       * ② 블록 공용 오디오 — 다 듣고 나서 전체 문항 표시
       * ----------------------------------------------------------- */
      function renderShared() {
        progress.textContent = '문항 ' + questions.length + '개';

        var listenCard = el('div', 'ls-card');
        var fig = figure(block.image);
        if (fig) listenCard.appendChild(fig);

        var key = 'aud:' + (block.heading || (block.audio || 'block'));
        var already = typeof ctx.hasPlayed === 'function' && ctx.hasPlayed(key);

        var qcards = questions.map(function (q) { return choiceCard(ctx, q, null); });
        var qbox = el('div', 'ls-card');
        qcards.forEach(function (c) { qbox.appendChild(c.node); });

        function openAll() {
          qcards.forEach(function (c) { c.unlock(); });
          qbox.style.display = '';
          ready();
        }

        if (already || !block.audio) {
          listenCard.appendChild((function () {
            var box = el('div', 'audio-box ls-audio');
            box.appendChild(el('span', 'ls-audio-icon', '🔇'));
            box.appendChild(el('span', 'ls-audio-txt',
              already ? '이미 재생한 오디오입니다. (다시 들을 수 없습니다)' : '오디오가 없는 블록입니다.'));
            return box;
          })());
          stage.appendChild(listenCard);
          stage.appendChild(qbox);
          openAll();
          return;
        }

        var hint = el('div', 'ls-note', '오디오를 끝까지 들은 뒤에 문항이 나타납니다.');
        var p = makePlayer({
          src: srcOf(block.audio),
          playKey: key,
          autoplay: true,
          onEnded: function () {
            if (destroyed) return;
            if (typeof ctx.markPlayed === 'function') ctx.markPlayed(key);
            hint.textContent = '재생이 끝났습니다. 문항에 답하세요.';
            hint.className = 'ls-note';
            openAll();
          },
          onBlocked: function () {
            if (destroyed) return;
            hint.textContent = '브라우저가 자동재생을 막았습니다. 재생 버튼을 눌러 주세요.';
            hint.className = 'ls-note warn';
          }
        });
        players.push(p);
        if (p.element) listenCard.appendChild(p.element);
        listenCard.appendChild(hint);

        qbox.style.display = 'none';   /* 재생 중에는 문항을 감춘다 */
        stage.appendChild(listenCard);
        stage.appendChild(qbox);
        if (typeof p.play === 'function') p.play();
      }

      return {
        destroy: function () {
          destroyed = true;
          stopAll();
          if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
        }
      };
    }
  };
})();
