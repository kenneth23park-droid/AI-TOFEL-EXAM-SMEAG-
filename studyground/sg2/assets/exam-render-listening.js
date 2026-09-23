/* SMEAG · StudyGround — exam-render-listening.js
 * 목적: Listening 문항 화면 렌더러. Story 2.2 / FR8·FR9·FR10·FR21·FR27·FR28·FR29.
 * 의존 전역: window.SG_RENDER (필수), window.SG_STORE, window.SG_MEDIA,
 *            window.SMEAG_SET1(문항 본문), window.SG_INSTRUCTION(선택 — 볼륨 값)
 * 노출 전역: window.SG_LISTEN  — 1회재생 오디오 유닛 + 순수 헬퍼(테스트용)
 *            window.SG_QRENDER — screenType:"question" 의 blockKind 서브 디스패처
 *
 * ★ 후속 담당자(Story 2.3 reading / 2.4 writing)에게 —
 *   screenType 'question' 은 listening/reading/writing 이 공유한다. SG_RENDER 의 등록표는
 *   screenType 하나당 함수 하나라서 각자 register('question', fn) 을 하면 마지막 파일이
 *   앞의 렌더러를 덮어쓴다. 그래서 이 파일이 blockKind 서브 디스패처를 설치한다:
 *
 *     window.SG_QRENDER.register('cloze', fn);   // 권장
 *
 *   호환을 위해 SG_RENDER.register('question', fn) 도 계속 동작한다 — 그 호출은
 *   디스패처를 덮어쓰지 않고 "알 수 없는 blockKind" 폴백 체인에 추가된다.
 *
 * FR8(1회 재생) 구현 근거:
 *   재생 소진은 DOM 이 아니라 SG_STORE.meta().audioSpent 에 남긴다. 새로고침·재진입 후에도
 *   같은 화면으로 돌아오면 오디오 엘리먼트를 아예 만들지 않는다. 되감기는 seeking 훅에서
 *   차단하고, ended 시 엘리먼트를 DOM 과 src 양쪽에서 제거한다.
 */
(function (root) {
  'use strict';

  var doc = root.document || null;

  var DEFAULT_VOLUME = 0.8;
  var SEEK_TOLERANCE_SEC = 0.35;  // timeupdate 지연을 감안한 되감기 판정 여유

  /* set1.js 의 하드코딩 한국어 prompt → EN 기본 문구 매핑(FR29).
   * set1.js 는 수정하지 않는다. 렌더 계층에서만 EN 우선으로 바꾼다. */
  var KO_PROMPT_EN = {
    '오디오를 듣고 가장 알맞은 응답을 고르세요.': 'Choose the best response.'
  };
  var GENERIC_SHORT_RESPONSE_EN = 'Choose the best response.';
  var HANGUL = /[ㄱ-ㆎ가-힣]/;

  function warn(msg, e) { if (root.console && root.console.warn) root.console.warn('[SG_LISTEN] ' + msg, e || ''); }
  function store() { return root.SG_STORE || null; }

  function el(tag, cls) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }

  function biInto(node, en, ko) {
    var a = el('span'); a.setAttribute('data-en', ''); a.textContent = en;
    var b = el('span'); b.setAttribute('data-ko', ''); b.textContent = (ko === undefined || ko === null) ? en : ko;
    node.appendChild(a); node.appendChild(b);
    return node;
  }

  function bi(tag, en, ko) { return biInto(el(tag), en, ko); }

  function volume() {
    if (root.SG_INSTRUCTION && typeof root.SG_INSTRUCTION.readVolume === 'function') {
      return root.SG_INSTRUCTION.readVolume();
    }
    return DEFAULT_VOLUME;
  }

  /* ── 순수 헬퍼 ──────────────────────────────────────────── */

  // 재생 잔여시간 표기. 상단 빨간 pill(MM:SS)과 헷갈리지 않게 M:SS 한 자리 분으로 쓴다.
  function fmtRemain(sec) {
    var s = (typeof sec === 'number' && isFinite(sec) && sec > 0) ? Math.floor(sec) : 0;
    var m = Math.floor(s / 60);
    var r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }

  function spentKey(screenId, src) { return String(screenId || '') + '|' + String(src || ''); }

  /* FR29 — 한국어 하드코딩 prompt 를 EN 기본 / KO 토글로 분리한다. */
  function promptPair(q) {
    var raw = (q && q.prompt) || '';
    if (!raw) return null;
    if (KO_PROMPT_EN[raw]) return { en: KO_PROMPT_EN[raw], ko: raw, remapped: true };
    if (HANGUL.test(raw)) {
      var en = (q && q.layout === 'short-response') ? GENERIC_SHORT_RESPONSE_EN : 'Answer the question.';
      return { en: en, ko: raw, remapped: true };
    }
    return { en: raw, ko: raw, remapped: false };
  }

  // "Question n of N" — N 은 screen.progress.total(컴파일러가 콘텐츠에서 산출).
  function progressPair(screen) {
    var p = screen && screen.progress;
    if (!p || typeof p.index !== 'number' || typeof p.total !== 'number') return null;
    return { en: 'Question ' + p.index + ' of ' + p.total, ko: '문항 ' + p.index + ' / ' + p.total };
  }

  /* ── 재생 소진 플래그 (§5, FR8) ─────────────────────────── */

  function spentMap() {
    var st = store();
    if (!st || typeof st.meta !== 'function') return {};
    var m = st.meta() || {};
    return m.audioSpent || {};
  }

  function isAudioSpent(key) {
    var m = spentMap();
    return !!m[key];
  }

  function markAudioSpent(key) {
    var st = store();
    if (!st || typeof st.patchMeta !== 'function') return false;
    var m = spentMap();
    if (m[key]) return true;
    var next = {}, k;
    for (k in m) { if (m.hasOwnProperty(k)) next[k] = m[k]; }
    next[key] = Date.now();
    st.patchMeta({ audioSpent: next });
    if (typeof st.pushEvent === 'function') st.pushEvent('audio_spent', '', { key: key });
    return true;
  }

  /* ── 1회재생 오디오 유닛 (FR8/FR9) ──────────────────────── */

  /**
   * 기존 exam.html makeAudioUnit() 의 화자 일러스트 + 재생 잔여시간 카운터 연출을 계승하되
   * <audio controls> 를 쓰지 않는다. 재생 컨트롤은 브라우저가 자동재생을 막았을 때만
   * "Play audio" 버튼 하나로 나타나고, 재생이 끝나면 엘리먼트째 사라진다.
   *
   * @param {Object} o {media, image, screenId, captionEn, captionKo, engine, onEnded}
   * @returns {HTMLElement} data-audio-state = 'spent' | 'idle' | 'playing' | 'done'
   */
  function makeAudioUnit(o) {
    var opts = o || {};
    var media = opts.media || null;
    var wrap = el('div', 'lst-au');
    var key = spentKey(opts.screenId, media && media.src);

    var stage = el('div', 'lst-au-stage');
    if (opts.image && opts.image.src) {
      var img = el('img', 'lst-au-speaker');
      img.src = opts.image.src;
      img.alt = 'speaker';
      img.setAttribute('loading', 'lazy');
      stage.appendChild(img);
    }

    var meta = el('div', 'lst-au-meta');
    var counter = el('div', 'lst-au-count');
    counter.textContent = '0:00';
    var cap = el('div', 'lst-au-cap');
    meta.appendChild(counter);
    meta.appendChild(cap);
    stage.appendChild(meta);
    wrap.appendChild(stage);

    function caption(en, ko) {
      while (cap.firstChild) cap.removeChild(cap.firstChild);
      biInto(cap, en, ko);
    }

    // 재진입/새로고침 — 이미 소진된 오디오는 엘리먼트를 만들지 않는다.
    if (!media || !media.src) {
      wrap.setAttribute('data-audio-state', 'done');
      caption('No audio for this question.', '이 문항에는 오디오가 없습니다.');
      counter.textContent = '—';
      return wrap;
    }
    if (isAudioSpent(key)) {
      wrap.setAttribute('data-audio-state', 'spent');
      wrap.className = 'lst-au is-spent';
      caption('Audio already played. It cannot be played again.', '오디오가 이미 재생되었습니다. 다시 재생할 수 없습니다.');
      counter.textContent = '0:00';
      return wrap;
    }

    wrap.setAttribute('data-audio-state', 'idle');
    caption(opts.captionEn || 'Audio plays once', opts.captionKo || '오디오는 1회만 재생됩니다');

    var audio = doc.createElement('audio');
    audio.className = 'lst-au-audio';
    audio.preload = 'metadata';
    audio.src = media.src;
    try { audio.volume = volume(); } catch (e) {}
    wrap.appendChild(audio);

    var playBtn = el('button', 'exam-btn primary lst-au-play');
    playBtn.type = 'button';
    biInto(playBtn, 'Play audio', '오디오 재생');
    playBtn.style.display = 'none';
    wrap.appendChild(playBtn);

    var started = false, finished = false, maxT = 0, duration = 0;

    function finish(reason) {
      if (finished) return;
      finished = true;
      wrap.setAttribute('data-audio-state', 'done');
      wrap.className = 'lst-au is-done';
      counter.textContent = '0:00';
      caption(reason === 'error' ? 'Audio unavailable. Continue with the question.' : 'Audio finished.',
              reason === 'error' ? '오디오를 재생할 수 없습니다. 문항을 이어서 진행하세요.' : '오디오 재생이 끝났습니다.');
      markAudioSpent(key);
      // AC2 — 컨트롤과 소스를 함께 제거한다. 콘솔에서 play() 를 불러도 재생될 소스가 없다.
      try { audio.pause(); } catch (e) {}
      try { audio.removeAttribute('src'); audio.load(); } catch (e2) {}
      if (audio.parentNode) audio.parentNode.removeChild(audio);
      if (playBtn.parentNode) playBtn.parentNode.removeChild(playBtn);
      if (typeof opts.onEnded === 'function') { try { opts.onEnded(reason || 'ended'); } catch (e3) { warn('onEnded threw', e3); } }
    }

    audio.addEventListener('loadedmetadata', function () {
      if (isFinite(audio.duration)) { duration = audio.duration; counter.textContent = fmtRemain(duration); }
    });
    audio.addEventListener('play', function () {
      started = true;
      wrap.setAttribute('data-audio-state', 'playing');
      wrap.className = 'lst-au is-playing';
      playBtn.style.display = 'none';
    });
    audio.addEventListener('timeupdate', function () {
      if (audio.currentTime > maxT) maxT = audio.currentTime;
      var d = isFinite(audio.duration) ? audio.duration : duration;
      counter.textContent = fmtRemain(d - audio.currentTime);
    });
    // 되감기 차단(FR8). 앞으로 건너뛰는 것도 되돌린다 — 재생 위치는 자연 진행만 허용.
    audio.addEventListener('seeking', function () {
      if (finished) return;
      if (Math.abs(audio.currentTime - maxT) > SEEK_TOLERANCE_SEC) {
        try { audio.currentTime = maxT; } catch (e) {}
      }
    });
    // 일시정지 후 재개는 허용하지 않는다 — 실제 시험은 멈추지 않는다.
    audio.addEventListener('pause', function () {
      if (finished) return;
      if (started && !audio.ended) { var p = audio.play(); if (p && p['catch']) p['catch'](function () {}); }
    });
    audio.addEventListener('ended', function () { finish('ended'); });
    audio.addEventListener('error', function () { warn('audio load failed: ' + media.src); finish('error'); });

    playBtn.onclick = function () {
      var p = audio.play();
      if (p && p['catch']) p['catch'](function (e) { warn('manual play rejected', e); finish('error'); });
    };

    // autoplay 는 config(sections.listening.audio.autoPlay)에서 온다. 브라우저가 막으면
    // 버튼 1개로 폴백한다 — 아직 재생된 적이 없으므로 재생 횟수를 쓰지 않는다.
    if (media.autoplay) {
      var pr = null;
      try { pr = audio.play(); } catch (e4) { pr = null; }
      if (pr && pr['catch']) {
        pr['catch'](function () { playBtn.style.display = ''; caption('Press Play to start the audio. It plays once.', '재생을 눌러 오디오를 시작하세요. 1회만 재생됩니다.'); });
      }
    } else {
      playBtn.style.display = '';
    }

    return wrap;
  }

  /* ── 문항 카드 ──────────────────────────────────────────── */

  function lookup(qid) {
    var set = root.SMEAG_SET1;
    if (!set || typeof set.findQuestion !== 'function') return null;
    try { return set.findQuestion(qid); } catch (e) { return null; }
  }

  function savedAnswer(qid) {
    var st = store();
    if (!st || typeof st.getAnswer !== 'function') return null;
    var rec = st.getAnswer(qid);
    return rec ? rec.v : null;
  }

  /* 선택지 라디오. 답 기록은 engine.answer() 하나로만 흐른다(store 직접 쓰기 금지). */
  function choiceList(q, screen, ctx, disabled) {
    var box = el('div', 'lst-opts');
    var choices = (q && q.choices) || [];
    var prev = savedAnswer(q.id);
    for (var i = 0; i < choices.length; i++) {
      (function (idx) {
        var lab = el('label', 'opt');
        var input = el('input');
        input.type = 'radio';
        input.name = q.id;
        input.value = String(idx);
        input.disabled = !!disabled;
        if (prev === idx) { input.checked = true; lab.className = 'opt is-selected'; }
        input.onchange = function () {
          var all = box.querySelectorAll('label.opt');
          for (var k = 0; k < all.length; k++) all[k].className = 'opt';
          lab.className = 'opt is-selected';
          if (ctx && ctx.engine && typeof ctx.engine.answer === 'function') {
            try { ctx.engine.answer(q.id, idx); } catch (e) { warn('answer rejected', e); }
          }
        };
        var sp = el('span', 'opt-text');
        sp.textContent = choices[idx];
        lab.appendChild(input);
        lab.appendChild(sp);
        box.appendChild(lab);
      })(i);
    }
    return box;
  }

  function setChoicesEnabled(box, on) {
    var inputs = box.querySelectorAll('input[type="radio"]');
    for (var i = 0; i < inputs.length; i++) inputs[i].disabled = !on;
    box.className = on ? 'lst-opts' : 'lst-opts is-locked';
  }

  /**
   * audio-set 화면 렌더. §4.2 의 2종을 모두 처리한다.
   *  - perQuestionAudio:true  → 화면마다 오디오+문항별 삽화 (short-response)
   *  - 블록 audio            → 블록 첫 화면에만 screen.audio 가 있고, 삽화는 블록 내내 유지
   */
  function renderListeningQuestion(screen, ctx) {
    var qid = (screen.questionIds && screen.questionIds[0]) || null;
    var hit = qid ? lookup(qid) : null;
    var q = hit ? hit.q : null;
    var block = hit ? hit.block : null;

    var wrap = el('article', 'lst-screen');
    if (q && q.layout === 'short-response') wrap.className = 'lst-screen lst-short';

    /* 상단 진행 표시(FR21). 상단바 빨간 pill(문항 20초)과 다른 줄에 둔다. */
    var head = el('header', 'lst-head');
    var pp = progressPair(screen);
    if (pp) {
      var prog = bi('span', pp.en, pp.ko);
      prog.className = 'lst-progress';
      head.appendChild(prog);
    }
    if (block && block.heading) {
      var hd = el('span', 'lst-heading');
      hd.textContent = block.heading;
      head.appendChild(hd);
    }
    wrap.appendChild(head);

    if (block && block.instruction) {
      var ins = el('p', 'lst-instruction');
      ins.textContent = block.instruction;
      wrap.appendChild(ins);
    }

    var card = el('section', 'qcard lst-card');

    /* 오디오. 이 화면에 audio 가 없으면(블록 2번째 이후 문항) 삽화만 유지한다. */
    var hasLiveAudio = false;
    var optsBox = null;

    if (screen.audio && screen.audio.src) {
      var key = spentKey(screen.id, screen.audio.src);
      hasLiveAudio = !isAudioSpent(key);
      var unit = makeAudioUnit({
        media: screen.audio,
        image: screen.image || null,
        screenId: screen.id,
        captionEn: 'Audio plays once',
        captionKo: '오디오는 1회만 재생됩니다',
        engine: ctx && ctx.engine,
        onEnded: function () {
          if (optsBox) setChoicesEnabled(optsBox, true);
          if (qwrap) qwrap.className = 'lst-q';
        }
      });
      card.appendChild(unit);
    } else if (screen.image && screen.image.src) {
      // 블록 오디오 방식의 후속 문항 — 화자 삽화를 계속 보여준다(AC3).
      var illus = el('div', 'lst-illus');
      var im = el('img', 'lst-au-speaker');
      im.src = screen.image.src;
      im.alt = 'speaker';
      im.setAttribute('loading', 'lazy');
      illus.appendChild(im);
      card.appendChild(illus);
    }

    /* 문항 본문 — 오디오 재생 중에는 가려 둔다(AC1). */
    var qwrap = el('div', hasLiveAudio ? 'lst-q is-waiting' : 'lst-q');

    if (q) {
      var pair = promptPair(q);
      if (pair) {
        var pnode = bi('p', (q.no ? 'Q' + q.no + ' · ' : '') + pair.en, (q.no ? 'Q' + q.no + ' · ' : '') + pair.ko);
        pnode.className = 'prompt lst-prompt';
        qwrap.appendChild(pnode);
      }
      if (q.choices && q.choices.length) {
        optsBox = choiceList(q, screen, ctx, hasLiveAudio);
        qwrap.appendChild(optsBox);
      } else {
        var na = bi('p', 'This question type is not supported here.', '이 문항 유형은 여기서 지원되지 않습니다.');
        na.className = 'muted';
        qwrap.appendChild(na);
        warn('listening question without choices: ' + qid);
      }
    } else {
      var miss = bi('p', 'Question content is unavailable.', '문항 내용을 불러올 수 없습니다.');
      miss.className = 'muted';
      qwrap.appendChild(miss);
      warn('question not found in content pack: ' + qid);
    }

    if (hasLiveAudio) {
      var waiting = bi('p', 'Listen to the audio. The choices unlock when it ends.',
        '오디오를 들으세요. 재생이 끝나면 선택지가 활성화됩니다.');
      waiting.className = 'muted lst-waiting';
      qwrap.appendChild(waiting);
    }

    card.appendChild(qwrap);
    wrap.appendChild(card);
    return wrap;
  }

  /* ── screenType:"question" 서브 디스패처 ────────────────── */

  function installQuestionDispatcher() {
    var R = root.SG_RENDER;
    if (!R || typeof R.register !== 'function') return null;
    if (root.SG_QRENDER) return root.SG_QRENDER;

    var byKind = {};
    var chain = [];   // register('question', fn) 로 들어온 다른 스토리의 렌더러들

    function dispatch(screen, ctx) {
      var fn = (screen && screen.blockKind) ? byKind[screen.blockKind] : null;
      if (typeof fn === 'function') {
        try { return fn(screen, ctx); } catch (e) { warn('blockKind renderer failed: ' + screen.blockKind, e); return null; }
      }
      for (var i = 0; i < chain.length; i++) {
        try {
          var node = chain[i](screen, ctx);
          if (node) return node;
        } catch (e2) { warn('chained question renderer failed', e2); }
      }
      return null;  // SG_RENDER 가 placeholder 로 degrade 한다(F12)
    }

    var orig = R.register;
    R.register = function (screenType, fn) {
      // 'question' 재등록은 디스패처를 덮어쓰지 않고 폴백 체인에 붙인다.
      if (screenType === 'question' && fn !== dispatch && typeof fn === 'function') {
        chain.push(fn);
        return true;
      }
      return orig.call(R, screenType, fn);
    };
    orig.call(R, 'question', dispatch);

    root.SG_QRENDER = {
      register: function (blockKind, fn) {
        if (!blockKind || typeof fn !== 'function') return false;
        byKind[blockKind] = fn;
        return true;
      },
      has: function (blockKind) { return typeof byKind[blockKind] === 'function'; },
      kinds: function () { var o = [], k; for (k in byKind) { if (byKind.hasOwnProperty(k)) o.push(k); } return o; },
      chainLength: function () { return chain.length; },
      dispatch: dispatch
    };
    return root.SG_QRENDER;
  }

  if (doc) {
    var Q = installQuestionDispatcher();
    if (Q) Q.register('audio-set', renderListeningQuestion);
    else warn('SG_RENDER unavailable; listening renderer not registered');
  }

  root.SG_LISTEN = {
    makeAudioUnit: makeAudioUnit,
    renderListeningQuestion: renderListeningQuestion,
    // 순수 헬퍼 — node/셀프테스트에서 직접 검증한다
    fmtRemain: fmtRemain,
    spentKey: spentKey,
    promptPair: promptPair,
    progressPair: progressPair,
    KO_PROMPT_EN: KO_PROMPT_EN,
    // 소진 플래그
    isAudioSpent: isAudioSpent,
    markAudioSpent: markAudioSpent,
    spentMap: spentMap
  };
})(typeof window !== 'undefined' ? window : this);
