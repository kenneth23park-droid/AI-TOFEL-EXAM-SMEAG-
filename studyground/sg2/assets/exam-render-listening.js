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
 * ★ 2026-08-07 실측 반영 — 오디오 화면 / 답변 화면 분리
 *   녹화 700s(docs/reference/screens/listening-audio-700s.png)는 화자 사진 + 블록 제목만,
 *   900s(listening-question-900s.png)는 사진 좌 · 문항/선택지 우 + 서브바 30초 타이머다.
 *   컴파일러(exam-compile.js audioSetBlock)가 timerScope==='question' 일 때 오디오를
 *   blockKind 'audio-play' 화면으로 떼어낸다. 따라서 이 파일은 렌더러 두 개를 등록한다:
 *     'audio-play' → renderAudioPlay        (타이머 없음 · 오디오 끝나면 자동 전진)
 *     'audio-set'  → renderListeningQuestion (문항 + 선택지)
 *   'audio-set' 화면이 여전히 audio 를 들고 오는 프로필(IELTS: timerScope 'section',
 *   들으면서 답한다)에서는 종전처럼 답변 화면 안에서 오디오를 재생한다 — 그 경로는
 *   makeAudioUnit 으로 유지된다.
 *   진행 표시("Question 25 of 32")는 셸(exam-runtime.html 서브바)이 그린다. 렌더러는
 *   그리지 않는다 — progressPair 는 순수 헬퍼로만 남는다.
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

  /* ── 복수 선택 문항(mcq-multi) 순수 헬퍼 ────────────────────
   * TOEFL Listening 의 "Choose 2 answers." 유형. 콘텐츠 계약:
   *   { kind:'mcq-multi', choices:[...], answers:[1,3], selectCount:2 }
   * selectCount 가 없으면 answers 길이로, 그것도 없으면 2로 본다.
   * 블록 종류는 그대로 'audio-set' 이라 컴파일러는 손대지 않는다 — 화면 분기는
   * 문항 kind 로만 일어난다(오디오 화면 분리·1회재생·진행표기 전부 그대로). */
  function selectCountOf(q) {
    if (!q) return 0;
    if (typeof q.selectCount === 'number' && q.selectCount > 1) return q.selectCount;
    if (q.answers && q.answers.length > 1) return q.answers.length;
    return 2;
  }

  function isMultiQuestion(q) {
    if (!q) return false;
    if (q.kind === 'mcq-multi') return true;
    return typeof q.selectCount === 'number' && q.selectCount > 1;
  }

  /* 상한 도달 후 새 항목을 클릭했을 때의 정책. 한 곳에서만 바꾼다.
   *   'replace' — 가장 먼저 고른 답을 자동으로 해제하고 새 답을 넣는다(현재 설정)
   *   'lock'    — 클릭을 무시하고 "먼저 하나 해제" 를 요구한다
   * ETS 실제 클라이언트 동작을 이 환경에서 확인할 수 없어 기본값을 'replace' 로 둔다.
   * 확인되면 이 상수 하나만 'lock' 으로 되돌리면 된다 — 테스트도 이 값을 읽는다. */
  var CAP_POLICY = 'replace';

  /**
   * 선택 토글.
   * prev 는 **고른 순서**를 그대로 담은 배열이다(오름차순 아님). 'replace' 정책에서
   * "가장 먼저 고른 답" 을 알아야 하기 때문이다. 저장소로 나가는 값은 호출부에서
   * sortedPicks() 로 오름차순 정렬해 넘긴다 — 저장 계약은 종전과 같다.
   *
   * @param {number[]} prev 선택 순서 배열
   * @param {number}   idx  클릭한 선택지
   * @param {number}   cap  선택 상한
   * @param {string}   [policy] 미지정 시 CAP_POLICY
   * @returns {number[]} 새 선택 순서 배열(원본 불변)
   */
  function toggleSelection(prev, idx, cap, policy) {
    var mode = policy || CAP_POLICY;
    var cur = [], i;
    if (prev && prev.length) { for (i = 0; i < prev.length; i++) cur.push(prev[i]); }
    var at = -1;
    for (i = 0; i < cur.length; i++) { if (cur[i] === idx) { at = i; break; } }
    if (at >= 0) { cur.splice(at, 1); return cur; }   // 이미 고른 항목 → 해제
    if (cur.length >= cap) {
      if (mode !== 'replace') return cur;             // 'lock' — 클릭 무시
      cur.shift();                                    // 가장 먼저 고른 답을 밀어낸다
    }
    cur.push(idx);
    return cur;
  }

  // 저장소로 나가는 값. 화면 상태(선택 순서)와 분리한다.
  function sortedPicks(picked) {
    var out = (picked && picked.length) ? picked.slice(0) : [];
    out.sort(function (a, b) { return a - b; });
    return out;
  }

  /* "Choose 2 answers.  1 of 2 selected"
   * 상한을 채운 뒤에는 다음 클릭이 무슨 일을 하는지 미리 알려 준다 — 답이 소리 없이
   * 밀려나는 것처럼 보이지 않게 하기 위해서다. */
  function selectHintPair(picked, cap, policy) {
    var mode = policy || CAP_POLICY;
    var n = (typeof picked === 'number' && picked > 0) ? picked : 0;
    var en = 'Choose ' + cap + ' answers.  ' + n + ' of ' + cap + ' selected';
    var ko = cap + '개를 고르세요.  ' + n + ' / ' + cap + ' 선택';
    if (n >= cap && mode === 'replace') {
      en += '  ·  a new pick replaces your first';
      ko += '  ·  새로 고르면 처음 고른 답이 바뀝니다';
    }
    return { en: en, ko: ko };
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

  /* ── 오디오 재생 전용 화면 (blockKind 'audio-play') ──────── */

  /**
   * audio-play 화면은 questionIds 를 갖지 않는다(컴파일러 주석 참조). 그래서 블록을
   * questionId 로 찾을 수 없다 — 대신 progress.first(섹션 기준 문항 번호)로 콘텐츠 팩의
   * 블록을 순서대로 훑어 찾는다. 컴파일러의 블록 순회 순서와 같은 순서라 결정적이다.
   * @returns {Object|null} 콘텐츠 블록
   */
  function blockAtQuestionNo(sectionId, no) {
    var set = root.SG_CONTENT_PACK || root.SMEAG_SET1;
    if (!set || !set.sections || !(typeof no === 'number') || no < 1) return null;
    var i, j, k, sec = null;
    for (i = 0; i < set.sections.length; i++) {
      if (set.sections[i].id === sectionId) { sec = set.sections[i]; break; }
    }
    if (!sec || !sec.modules) return null;
    var seen = 0;
    for (j = 0; j < sec.modules.length; j++) {
      var blocks = sec.modules[j].blocks || [];
      for (k = 0; k < blocks.length; k++) {
        var n = (blocks[k].questions || []).length;
        if (no <= seen + n) return blocks[k];
        seen += n;
      }
    }
    return null;
  }

  /* 실측 700s 프레임의 큰 제목은 블록 지시문("Listen to an academic talk.")이다.
   * set1/set9 의 block.heading 은 "Questions 1-7" 이라 서브바 진행 표시와 중복되므로
   * 제목으로 쓰지 않는다. 지시문이 없을 때만 컴파일러 copy.titleEn 으로 폴백한다. */
  function playTitle(screen) {
    var p = screen && screen.progress;
    var block = blockAtQuestionNo(screen && screen.section, p ? p.first : null);
    if (block && block.instruction) return block.instruction;
    var copy = (screen && screen.copy) || {};
    return copy.titleEn || 'Listen to the audio.';
  }

  /**
   * 실측 700s 프레임 구조: 중앙 정렬 · 블록 제목(크게) · 화자 사진 · 안내문.
   * 타이머는 없다(컴파일러가 timer:null 로 만든다 — 셸이 서브바 우측을 비운다).
   * 오디오가 끝나면 engine.audioEnded() 로 자동 전진한다(screen.advance === 'auto').
   *
   * 1회 재생 강제는 답변 화면과 같은 저장소 플래그(SG_STORE.meta().audioSpent)를 쓴다.
   * 새로고침 후 같은 화면으로 돌아오면 <audio> 를 아예 만들지 않는다(FR8).
   */
  function renderAudioPlay(screen, ctx) {
    var copy = screen.copy || {};
    var media = (screen.audio && screen.audio.src) ? screen.audio : null;
    var key = spentKey(screen.id, media && media.src);
    var spent = media ? isAudioSpent(key) : true;

    var wrap = el('article', 'lst-play');
    wrap.setAttribute('data-audio-state', spent ? 'spent' : 'idle');

    /* 우상단 상태 배지 — 재생 중 'Audio Playing...' */
    var badge = el('div', 'lst-play-badge');
    biInto(badge, 'Audio Playing...', '오디오 재생 중...');
    wrap.appendChild(badge);

    var titleEn = playTitle(screen);
    var title = bi('h1', titleEn, copy.titleKo && copy.titleKo !== copy.titleEn ? copy.titleKo : titleEn);
    title.className = 'lst-play-title';
    wrap.appendChild(title);

    if (screen.image && screen.image.src) {
      var stage = el('div', 'lst-play-stage');
      var img = el('img', 'lst-play-speaker');
      img.src = screen.image.src;
      img.alt = 'speaker';
      img.setAttribute('loading', 'lazy');
      stage.appendChild(img);
      wrap.appendChild(stage);
    }

    var icon = el('div', 'lst-play-icon');   // 헤드폰 아이콘(CSS 배경, SVG 노드 없음)
    icon.setAttribute('aria-hidden', 'true');
    wrap.appendChild(icon);

    var lead = bi('p', copy.bodyEn || 'Listen carefully to the audio.',
                       copy.bodyKo || '오디오를 주의 깊게 들으세요.');
    lead.className = 'lst-play-lead';
    wrap.appendChild(lead);

    var sub = bi('p', 'The question will appear after the audio ends.',
                      '오디오가 끝나면 문항이 표시됩니다.');
    sub.className = 'lst-play-sub';
    wrap.appendChild(sub);

    function setBadge(en, ko) {
      while (badge.firstChild) badge.removeChild(badge.firstChild);
      biInto(badge, en, ko);
    }

    if (!media) {
      wrap.setAttribute('data-audio-state', 'done');
      setBadge('No audio', '오디오 없음');
      return wrap;
    }
    if (spent) {
      wrap.className = 'lst-play is-spent';
      setBadge('Audio finished', '오디오 재생 완료');
      return wrap;
    }

    var audio = doc.createElement('audio');
    audio.className = 'lst-au-audio';
    audio.preload = 'auto';
    audio.src = media.src;
    try { audio.volume = volume(); } catch (e) {}
    wrap.appendChild(audio);

    var playBtn = el('button', 'exam-btn primary lst-play-btn');
    playBtn.type = 'button';
    biInto(playBtn, 'Play audio', '오디오 재생');
    playBtn.style.display = 'none';
    wrap.appendChild(playBtn);

    var started = false, finished = false, maxT = 0;

    function advance() {
      var eng = ctx && ctx.engine;
      if (!eng) return;
      try {
        if (typeof eng.audioEnded === 'function') { eng.audioEnded(media.src); return; }
        if (typeof eng.next === 'function') eng.next('manual');
      } catch (e) { warn('advance after audio failed', e); }
    }

    function finish(reason) {
      if (finished) return;
      finished = true;
      wrap.setAttribute('data-audio-state', 'done');
      wrap.className = 'lst-play is-done';
      setBadge(reason === 'error' ? 'Audio unavailable' : 'Audio finished',
               reason === 'error' ? '오디오를 재생할 수 없습니다' : '오디오 재생 완료');
      markAudioSpent(key);
      try { audio.pause(); } catch (e) {}
      try { audio.removeAttribute('src'); audio.load(); } catch (e2) {}
      if (audio.parentNode) audio.parentNode.removeChild(audio);
      if (playBtn.parentNode) playBtn.parentNode.removeChild(playBtn);
      advance();   // advance:'auto' → 답변 화면으로
    }

    audio.addEventListener('play', function () {
      started = true;
      wrap.className = 'lst-play is-playing';
      wrap.setAttribute('data-audio-state', 'playing');
      playBtn.style.display = 'none';
      setBadge('Audio Playing...', '오디오 재생 중...');
    });
    audio.addEventListener('timeupdate', function () {
      if (audio.currentTime > maxT) maxT = audio.currentTime;
    });
    audio.addEventListener('seeking', function () {
      if (finished) return;
      if (Math.abs(audio.currentTime - maxT) > SEEK_TOLERANCE_SEC) {
        try { audio.currentTime = maxT; } catch (e) {}
      }
    });
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

    if (media.autoplay) {
      var pr = null;
      try { pr = audio.play(); } catch (e4) { pr = null; }
      if (pr && pr['catch']) {
        pr['catch'](function () {
          playBtn.style.display = '';
          setBadge('Press Play to start', '재생을 눌러 시작하세요');
        });
      }
    } else {
      playBtn.style.display = '';
      setBadge('Press Play to start', '재생을 눌러 시작하세요');
    }

    return wrap;
  }

  /* ── 문항 카드 ──────────────────────────────────────────── */

  function lookup(qid) {
    /* 활성 콘텐츠 팩(SG_CONTENT_PACK)이 있으면 그것을 쓰고, 없으면 SET 1 로 폴백한다.
       폴백 경로는 기존과 동일하므로 SET 1 동작은 변하지 않는다. */
    var set = root.SG_CONTENT_PACK || root.SMEAG_SET1;
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
        var kb = el('span', 'opt-key');   // 실측 900s 프레임의 A/B/C/D 원형 배지
        kb.setAttribute('aria-hidden', 'true');
        kb.textContent = String.fromCharCode(65 + idx);
        var sp = el('span', 'opt-text');
        sp.textContent = choices[idx];
        lab.appendChild(input);
        lab.appendChild(kb);
        lab.appendChild(sp);
        box.appendChild(lab);
      })(i);
    }
    return box;
  }

  /**
   * 복수 선택 목록(mcq-multi). 실측 900s 프레임의 A/B/C/D 배지 레이아웃을 그대로 쓰되
   * 배지를 사각형으로 바꿔(.is-multi) 라디오와 시각적으로 구분한다.
   *
   * 답은 항상 오름차순 인덱스 배열 하나로 engine.answer() 에 넘긴다 — 저장소에는
   * 문항당 레코드 1개만 남는다(단일선택과 동일한 계약).
   *
   * @returns {HTMLElement} div.lst-opts.is-multi — refresh() 를 노드에 달아 둔다(테스트용)
   */
  function multiChoiceList(q, screen, ctx, disabled) {
    var box = el('div', 'lst-opts is-multi');
    var choices = (q && q.choices) || [];
    var cap = selectCountOf(q);
    var prev = savedAnswer(q.id);
    var picked = (prev && prev.length) ? prev.slice(0) : [];
    var labels = [], inputs = [];

    var hint = el('p', 'lst-selecthint');
    box.appendChild(hint);

    function has(i) {
      for (var k = 0; k < picked.length; k++) { if (picked[k] === i) return true; }
      return false;
    }

    /* 상태 → DOM 단방향 반영.
     * 'replace' 정책에서는 상한에 닿아도 모든 항목이 계속 클릭 가능해야 하므로
     * 비활성(.is-capped)을 걸지 않는다. 대신 다음에 밀려날 답(가장 먼저 고른 것)에
     * .is-next-out 을 붙여, 무엇이 바뀔지 누르기 전에 보이게 한다. */
    function refresh() {
      var full = picked.length >= cap;
      var replacing = full && CAP_POLICY === 'replace' && !disabled;
      var oldest = replacing && picked.length ? picked[0] : -1;

      while (hint.firstChild) hint.removeChild(hint.firstChild);
      var pair = selectHintPair(picked.length, cap);
      biInto(hint, pair.en, pair.ko);
      hint.className = full ? 'lst-selecthint is-full' : 'lst-selecthint';

      for (var i = 0; i < labels.length; i++) {
        var on = has(i);
        inputs[i].checked = on;
        // 'lock' 정책에서만 미선택 항목을 잠근다.
        inputs[i].disabled = !!disabled || (!on && full && CAP_POLICY !== 'replace');
        var cls = 'opt';
        if (on) { cls += ' is-selected'; if (i === oldest) cls += ' is-next-out'; }
        else if (!disabled && full && CAP_POLICY !== 'replace') { cls += ' is-capped'; }
        labels[i].className = cls;
      }
    }

    for (var j = 0; j < choices.length; j++) {
      (function (idx) {
        var lab = el('label', 'opt');
        var input = el('input');
        input.type = 'checkbox';
        input.name = q.id;
        input.value = String(idx);
        input.onchange = function () {
          picked = toggleSelection(picked, idx, cap);
          refresh();
          if (ctx && ctx.engine && typeof ctx.engine.answer === 'function') {
            // 저장 값은 항상 오름차순 — 화면의 선택 순서를 저장소로 흘리지 않는다.
            try { ctx.engine.answer(q.id, sortedPicks(picked)); } catch (e) { warn('answer rejected', e); }
          }
        };
        var kb = el('span', 'opt-key');
        kb.setAttribute('aria-hidden', 'true');
        kb.textContent = String.fromCharCode(65 + idx);
        var sp = el('span', 'opt-text');
        sp.textContent = choices[idx];
        lab.appendChild(input);
        lab.appendChild(kb);
        lab.appendChild(sp);
        box.appendChild(lab);
        labels.push(lab); inputs.push(input);
      })(j);
    }

    refresh();
    box._refresh = function (nextDisabled) {
      if (typeof nextDisabled === 'boolean') disabled = nextDisabled;
      refresh();
    };
    return box;
  }

  function setChoicesEnabled(box, on) {
    if (typeof box._refresh === 'function') {
      // mcq-multi — 상한 규칙이 있으므로 disabled 를 일괄로 덮어쓰지 않는다.
      box._refresh(!on);
      box.className = on ? 'lst-opts is-multi' : 'lst-opts is-multi is-locked';
      return;
    }
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
    if (isMultiQuestion(q)) wrap.className += ' lst-multi';

    /* 진행 표시("Question 25 of 32")는 셸의 서브바가 그린다 — 여기서 중복 렌더하지 않는다.
     * 블록 제목/지시문도 답변 화면(900s 프레임)에는 없다. 오디오가 이 화면에 남아 있는
     * 프로필(IELTS: 들으면서 답한다)에서만 제목·지시문을 유지한다. */
    var onScreenAudio = !!(screen.audio && screen.audio.src);
    if (onScreenAudio) {
      if (block && block.heading) {
        var head = el('header', 'lst-head');
        var hd = el('span', 'lst-heading');
        hd.textContent = block.heading;
        head.appendChild(hd);
        wrap.appendChild(head);
      }
      if (block && block.instruction) {
        var ins = el('p', 'lst-instruction');
        ins.textContent = block.instruction;
        wrap.appendChild(ins);
      }
    }

    /* 실측 900s 프레임에는 바깥 카드 테두리가 없다 — 사진(좌) / 문항·선택지(우) 2열이다.
     * 오디오가 화면 안에 남는 프로필에서만 종전 qcard 를 유지한다. */
    var card = el('section', onScreenAudio ? 'qcard lst-card' : 'lst-card lst-split');

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
      var im = el('img', 'lst-au-speaker lst-illus-img');
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
        /* 문항 번호 접두("Q29 · ")는 붙이지 않는다 — 서브바가 'Question 29 of 32' 를
         * 이미 표시하고, 실측 900s 프레임의 문항 문구에도 번호가 없다. */
        var pnode = bi('p', pair.en, pair.ko);
        pnode.className = 'prompt lst-prompt';
        qwrap.appendChild(pnode);
      }
      if (q.choices && q.choices.length) {
        optsBox = isMultiQuestion(q)
          ? multiChoiceList(q, screen, ctx, hasLiveAudio)
          : choiceList(q, screen, ctx, hasLiveAudio);
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
    if (Q) {
      Q.register('audio-set', renderListeningQuestion);
      Q.register('audio-play', renderAudioPlay);
    }
    else warn('SG_RENDER unavailable; listening renderer not registered');
  }

  root.SG_LISTEN = {
    makeAudioUnit: makeAudioUnit,
    renderListeningQuestion: renderListeningQuestion,
    renderAudioPlay: renderAudioPlay,
    multiChoiceList: multiChoiceList,
    // 순수 헬퍼 — node/셀프테스트에서 직접 검증한다
    selectCountOf: selectCountOf,
    isMultiQuestion: isMultiQuestion,
    toggleSelection: toggleSelection,
    sortedPicks: sortedPicks,
    selectHintPair: selectHintPair,
    capPolicy: function () { return CAP_POLICY; },
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
