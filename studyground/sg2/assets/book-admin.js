/* SMEAG StudyGround — book-admin.js : admin-books.html 화면 하나를 그리는 코드 전부.
 *
 * 왜 화면과 코드를 갈랐나
 *   admin-set-import.html 은 마크업과 1400줄짜리 스크립트가 한 파일에 있어서, 검산 규칙
 *   한 줄을 고칠 때마다 페이지 전체를 다시 읽어야 했다. 교재 화면은 앞으로 챕터 편집기와
 *   로직을 나눠 쓰게 되므로 처음부터 파일을 가른다. 노출 전역은 window.SG_BOOK_ADMIN 하나다.
 *
 * 이 파일이 지키는 세 가지
 *   1) 검산은 여기서 하지 않는다. 판정은 전부 SG_BOOK_SCHEMA.validate() 가 낸 gate 배열이고,
 *      여기는 그것을 { level, scope, message } 모양 그대로 그린다. 화면이 규칙을 한 줄이라도
 *      따로 갖는 순간 파이프라인(build_book.py)과 판정이 갈라지고, 통과한 챕터가 CI 에서 막힌다.
 *   2) 'stop' 이 하나라도 있으면 build·publish 버튼을 잠근다. 잠그기만 하고 이유를 안 쓰면
 *      관리자가 버튼을 계속 누른다 — 그래서 잠긴 버튼 옆에 사유를 문장으로 붙인다
 *      (set-import.js 와 같은 처리).
 *   3) PDF 를 만들지 않는다. 브라우저 인쇄로 뽑은 PDF 는 기기마다 폰트·페이지 나눔이 달라
 *      색인 페이지 번호가 어긋난다. 이 화면은 실행할 명령을 정확히 보여 주는 데서 멈춘다.
 *
 * 저장은 전부 window.SG_BOOK_STORE 가 한다(트랙 D 소유). 계약:
 *   list(book?) · get(slug) · put(chapter) · remove(slug) · setStatus(slug,status)
 *   publishAsSet(chapters, slug) · buildIndex(book) · exportAll(book) · importAll(json)
 * 전역이 없으면 예외를 던지지 않고 화면에 안내를 그린다 — 스크립트 한 줄이 빠졌다고
 * 관리자가 빈 화면 앞에서 원인을 추측하게 두지 않는다.
 *
 * ES5 문법만 쓴다(빌드 단계 없음).
 */
(function () {
  'use strict';

  var SCHEMA = window.SG_BOOK_SCHEMA;
  var STORE = window.SG_BOOK_STORE;
  var ADMIN = window.SG_ADMIN;

  var BOOKS = ['reading', 'listening', 'speaking', 'writing'];
  var LABEL = { reading: 'Reading', listening: 'Listening', speaking: 'Speaking', writing: 'Writing' };
  var FAMILY = {
    reading: 'Cloze · Passage',
    listening: 'Audio sets',
    speaking: 'Listen and Repeat · Interview',
    writing: 'Build a Sentence · Email · Discussion'
  };
  var PER_BOOK = 10;
  var STATUS = ['draft', 'gated', 'reviewed', 'built'];
  var KEYS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

  var state = { book: 'reading', slug: '', query: '' };
  var HAY = {};      /* slug -> {stamp, text} 검색용 본문 사본 */

  /* ------------------------------------------------------------------ 유틸 */

  function $(id) { return document.getElementById(id); }
  function esc(t) { var d = document.createElement('div'); d.textContent = t == null ? '' : t; return d.innerHTML; }
  function isArr(v) { return Object.prototype.toString.call(v) === '[object Array]'; }
  function str(v) { return v === null || v === undefined ? '' : String(v); }
  function has(v) { return str(v).replace(/^\s+|\s+$/g, '') !== ''; }
  function each(list, fn) { Array.prototype.forEach.call(list || [], fn); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /** 'reading' + 3 -> 'reading-03'. 스키마가 있으면 스키마의 규칙이 정본이다. */
  function slugOf(book, no) { return SCHEMA ? SCHEMA.slugOf(book, no) : book + '-' + pad2(no); }

  /* 저장소가 없을 때도 화면이 그려지도록, 모든 접근은 이 얇은 층을 통한다. */
  function listOf(book) {
    if (!STORE || typeof STORE.list !== 'function') return [];
    try { return STORE.list(book) || []; } catch (e) { return []; }
  }
  function getChapter(slug) {
    if (!STORE || typeof STORE.get !== 'function' || !slug) return null;
    try { return STORE.get(slug) || null; } catch (e) { return null; }
  }

  /* ------------------------------------------------------------------ 검산 */

  /** 선택된 챕터의 gate 배열. 챕터가 없으면 빈 배열이다(빈 자리는 '아직 없음'이지 오류가 아니다). */
  function gatesOf(chapter) {
    if (!chapter || !SCHEMA || typeof SCHEMA.validate !== 'function') return [];
    var r;
    try { r = SCHEMA.validate(chapter); } catch (e) {
      /* 검산기가 터져도 화면은 살아 있어야 한다. 터진 사실 자체를 하나의 gate 로 바꾼다. */
      return [{ level: 'stop', scope: 'validate', message: 'The checker itself failed: ' + str(e && e.message) }];
    }
    return (r && r.gates) || [];
  }
  function countStops(gates) {
    var n = 0;
    each(gates, function (g) { if (g.level === 'stop') n++; });
    return n;
  }

  /* ------------------------------------------------------------------ 검색 */

  /* 챕터 본문을 한 덩어리 소문자 문자열로 눌러 둔다. 40챕터를 매 입력마다 다시 펴면
     타이핑이 눈에 띄게 끊긴다 — savedAt 이 바뀌기 전까지는 사본을 다시 쓴다. */
  function haystack(entry) {
    var cached = HAY[entry.slug];
    var stamp = str(entry.savedAt) + '|' + str(entry.version);
    if (cached && cached.stamp === stamp) return cached.text;

    var ch = getChapter(entry.slug);
    var parts = [str(entry.title), str(entry.slug)];
    if (ch) {
      each(ch.indexTerms || [], function (t) { parts.push(str(t && t.term ? t.term : t)); });
      each(ch.glossary || [], function (g) { parts.push(str(g && g.term) + ' ' + str(g && g.gloss)); });
      each(ch.targetSkills || [], function (s) { parts.push(str(s)); });
      each(ch.modules || [], function (mod) {
        each(mod.blocks || [], function (blk) {
          parts.push(str(blk.heading), str(blk.instruction), str(blk.title), str(blk.template), str(blk.introScript));
          each(blk.paragraphs || [], function (p) { parts.push(str(p)); });
          each(blk.questions || [], function (q) {
            parts.push(str(q.prompt), str(q.script), str(q.sentence), str(q.context), str(q.answer), str(q.hint));
            each(q.choices || [], function (c) { parts.push(str(c)); });
            each(q.tiles || [], function (c) { parts.push(str(c)); });
            each(q.bullets || [], function (c) { parts.push(str(c)); });
            each(q.posts || [], function (p) { parts.push(str(p && p.text ? p.text : p)); });
          });
        });
      });
    }
    var text = parts.join(' \n ').toLowerCase();
    HAY[entry.slug] = { stamp: stamp, text: text };
    return text;
  }

  /* 사이드카 색인이 있으면 그쪽 term 도 검색어에 걸리게 한다. 색인은 챕터 본문에 없는
     상위 개념어(예: "inference")를 담고 있어서, 본문 훑기만으로는 놓친다. */
  function indexHits(book, q) {
    if (!STORE || typeof STORE.buildIndex !== 'function' || !q) return {};
    var idx;
    try { idx = STORE.buildIndex(book); } catch (e) { return {}; }
    var hit = {};
    each((idx && idx.terms) || [], function (t) {
      if (str(t && t.term).toLowerCase().indexOf(q) < 0) return;
      each((t && t.chapters) || [], function (n) { hit[Number(n)] = 1; });
    });
    return hit;
  }

  /* ------------------------------------------------------------------ 책 카드 */

  function paintBooks() {
    var html = BOOKS.map(function (b) {
      var rows = listOf(b);
      var byNo = {};
      each(rows, function (r) { byNo[Number(r.chapterNo)] = r; });

      var made = 0, built = 0, cells = '', i, r;
      for (i = 1; i <= PER_BOOK; i++) {
        r = byNo[i];
        if (r) { made++; if (r.status === 'built') built++; }
        cells += '<i class="' + (r ? 's-' + esc(str(r.status) || 'draft') : '') + '" title="Chapter ' + i +
          (r ? ' — ' + esc(str(r.status) || 'draft') : ' — not created') + '">' + i + '</i>';
      }
      return '<button class="bookcard' + (b === state.book ? ' on' : '') + '" data-book="' + b + '" type="button">' +
        '<b>' + LABEL[b] + '</b><span class="bsub">' + esc(FAMILY[b]) + '</span>' +
        '<span class="bcount">' + made + ' / ' + PER_BOOK + '</span>' +
        '<span class="bnote">chapters created · ' + built + ' built</span>' +
        '<span class="track">' + cells + '</span>' +
      '</button>';
    }).join('');
    $('books').innerHTML = html;
  }

  /* ------------------------------------------------------------------ 챕터 표 */

  function paintRows() {
    var rows = listOf(state.book);
    var byNo = {};
    each(rows, function (r) { byNo[Number(r.chapterNo)] = r; });

    var q = state.query;
    var termHit = q ? indexHits(state.book, q) : {};
    var out = '', i, r, keep, slug;

    for (i = 1; i <= PER_BOOK; i++) {
      r = byNo[i];
      slug = r ? str(r.slug) : slugOf(state.book, i);

      keep = true;
      if (q) keep = r ? (haystack(r).indexOf(q) >= 0 || termHit[i] === 1) : false;
      if (!keep) continue;

      if (!r) {
        out += '<tr class="empty" data-no="' + i + '">' +
          '<td class="no">' + i + '</td>' +
          '<td class="ti">Not created</td>' +
          '<td class="qn">—</td>' +
          '<td><span class="badge none">empty</span></td>' +
          '<td class="ver">—</td>' +
          '<td class="act"><button class="mini" data-make="' + i + '">Blank JSON</button></td>' +
        '</tr>';
        continue;
      }
      out += '<tr' + (slug === state.slug ? ' class="on"' : '') + ' data-slug="' + esc(slug) + '">' +
        '<td class="no">' + i + '</td>' +
        '<td class="ti">' + (has(r.title) ? esc(r.title) : '<span class="muted">Untitled</span>') + '</td>' +
        '<td class="qn">' + (r.total == null ? '—' : esc(r.total)) + '</td>' +
        '<td><span class="badge ' + esc(str(r.status) || 'draft') + '">' + esc(str(r.status) || 'draft') + '</span></td>' +
        '<td class="ver">' + (r.version == null ? '—' : 'v' + esc(r.version)) + '</td>' +
        '<td class="act">' +
          '<button class="mini" data-open="' + esc(slug) + '">Open</button>' +
          '<button class="mini" data-dl="' + esc(slug) + '">JSON</button>' +
          '<button class="mini" data-rm="' + esc(slug) + '">Remove</button>' +
        '</td>' +
      '</tr>';
    }

    if (!out) {
      out = '<tr class="empty"><td colspan="6">No chapter in ' + LABEL[state.book] +
        ' matches that search.</td></tr>';
    }
    $('rows').innerHTML = out;
  }

  /* ------------------------------------------------------------------ 게이트 패널 */

  function paintGates(chapter) {
    var host = $('gates');
    if (!chapter) {
      host.innerHTML = '<div class="gt pass"><span class="lv">Idle</span>' +
        '<span>Select a chapter to run the checks against it.</span></div>';
      $('acts').innerHTML = '';
      $('why').hidden = true;
      return;
    }
    var gates = gatesOf(chapter);
    var stops = countStops(gates);

    /* stop 을 먼저, 그다음 warn. 고칠 수 없는 것부터 읽게 한다. */
    var ordered = gates.filter(function (g) { return g.level === 'stop'; })
      .concat(gates.filter(function (g) { return g.level !== 'stop'; }));

    host.innerHTML = ordered.length
      ? ordered.map(function (g) {
          return '<div class="gt ' + esc(g.level === 'stop' ? 'stop' : 'warn') + '">' +
            '<span class="lv">' + (g.level === 'stop' ? 'Stop' : 'Check') + '</span>' +
            '<span>' + esc(g.message) + ' <span class="sc">' + esc(g.scope) + '</span></span>' +
          '</div>';
        }).join('')
      : '<div class="gt pass"><span class="lv">Pass</span><span>Nothing was caught by the checks.</span></div>';

    var st = statusOf(chapter.slug);
    var at = STATUS.indexOf(st);
    var locked = stops > 0;

    /* 상태는 한 칸씩만 올라간다(저장소 규칙). 건너뛰는 버튼을 눌러 보게 두면
       관리자는 "안 되는 이유"를 실패 메시지로만 알게 된다 — 아예 잠가 둔다. */
    function stepBtn(name, label) {
      var to = STATUS.indexOf(name);
      var off = to !== at + 1 || (name === 'built' && locked);
      return '<button class="mini" data-do="status:' + name + '"' + (off ? ' disabled' : '') + '>' + label + '</button>';
    }

    $('acts').innerHTML =
      '<button class="mini" data-do="validate">Validate again</button>' +
      '<button class="mini" data-do="download">Download chapter JSON</button>' +
      '<button class="mini" data-do="upload">Upload chapter JSON</button>' +
      '<span class="sep"></span>' +
      stepBtn('gated', 'Mark gated') +
      stepBtn('reviewed', 'Mark reviewed') +
      stepBtn('built', 'Mark built') +
      '<button class="mini" data-do="publish"' + (locked ? ' disabled' : '') + '>Publish as exam set</button>';

    var why = $('why');
    why.hidden = !locked;
    if (locked) {
      why.textContent = stops + (stops === 1 ? ' stop check' : ' stop checks') +
        ' must be cleared before this chapter can be built or published.';
    }
  }

  function statusOf(slug) {
    var hit = '';
    each(listOf(state.book), function (r) { if (str(r.slug) === str(slug)) hit = str(r.status); });
    return hit || 'draft';
  }

  /* ------------------------------------------------------------------ 챕터 미리보기 */

  function questionHtml(q) {
    var kind = str(q.kind);
    var head = '<div class="q-h">' + esc(str(q.id)) + (q.no ? ' · Q' + esc(q.no) : '') +
      ' · ' + esc(kind || '?') + '</div>';
    var body = '';

    if (kind === 'blank') {
      body = '<p class="q-p">Blank ' + esc(q.no) + ' — hint <b>' + esc(q.hint) + '…</b></p>' +
        '<div class="keyonly">Answer: <b>' + esc(q.answer) + '</b></div>';
    } else if (kind === 'mcq' || kind === 'insert') {
      body = (has(q.prompt) ? '<p class="q-p">' + esc(q.prompt) + '</p>' : '') +
        (q.choices || []).map(function (c, i) {
          return '<span class="opt' + (i === q.answer ? ' is-key' : '') + '">' +
            '<span class="k">' + (KEYS[i] || i) + '</span>' + esc(c) + '</span>';
        }).join('');
    } else if (kind === 'build') {
      body = (has(q.context) ? '<p class="q-p">' + esc(q.context) + '</p>' : '') +
        '<div class="tiles">' + (q.tiles || []).map(function (t) { return '<span>' + esc(t) + '</span>'; }).join('') + '</div>' +
        '<div class="keyonly">Target sentence: <b>' + esc(q.sentence || q.answer) + '</b></div>';
    } else if (kind === 'email') {
      body = '<p class="q-p">' + esc(q.prompt) + '</p>' +
        (has(q.to) ? '<p class="q-p"><b>' + esc(q.situationLabel || 'SITUATION') + '</b> — ' + esc(q.situation) + '</p>' : '') +
        '<ul class="bul">' + (q.bullets || []).map(function (b) { return '<li>' + esc(b) + '</li>'; }).join('') + '</ul>';
    } else if (kind === 'discussion') {
      body = '<p class="q-p">' + esc(q.prompt) + '</p>' +
        (has(q.professor) ? '<div class="body">' + esc(q.professor) + '</div>' : '') +
        '<ul class="bul">' + (q.posts || []).map(function (p) {
          return '<li>' + esc(p && p.name ? p.name + ': ' : '') + esc(p && p.text ? p.text : p) + '</li>';
        }).join('') + '</ul>';
    } else if (kind === 'repeat' || kind === 'interview') {
      body = (has(q.script) ? '<div class="body">' + esc(q.script) + '</div>' : '') +
        '<p class="q-p">Prep ' + esc(q.prepSec) + 's · Respond ' + esc(q.respondSec) + 's' +
        (has(q.audioRef) ? ' · track ' + esc(q.audioRef) : '') + '</p>';
    } else {
      body = has(q.prompt) ? '<p class="q-p">' + esc(q.prompt) + '</p>' : '';
    }
    return '<div class="q">' + head + body + '</div>';
  }

  function blockHtml(blk) {
    var qs = blk.questions || [];
    var pre = '';
    if (blk.kind === 'cloze' && has(blk.template)) pre = '<div class="body">' + esc(blk.template) + '</div>';
    if (blk.kind === 'passage') {
      pre = (has(blk.title) ? '<p class="q-p"><b>' + esc(blk.title) + '</b></p>' : '') +
        '<div class="body">' + (blk.paragraphs || []).map(function (p) { return esc(p); }).join('\n\n') + '</div>';
    }
    if (blk.kind === 'record-set' && has(blk.introScript)) pre = '<div class="body">' + esc(blk.introScript) + '</div>';

    var audioTag = (blk.kind === 'audio-set' || blk.kind === 'record-set')
      ? '<span class="tagx aud">' + esc(blk.perQuestionAudio ? 'audio per question' : str(blk.audioRef) || 'audio') + '</span>' : '';

    return '<div class="blk">' +
      '<div class="blk-h"><b>' + esc(blk.heading || blk.kind) + '</b>' +
        '<span class="tagx">' + esc(blk.kind) + '</span>' +
        (qs.length ? '<span class="tagx">' + qs.length + ' Q</span>' : '') + audioTag + '</div>' +
      (has(blk.instruction) ? '<p class="blk-i">' + esc(blk.instruction) + '</p>' : '') +
      pre +
      qs.map(questionHtml).join('') +
    '</div>';
  }

  function paintDetail(chapter) {
    var host = $('detail');
    if (!chapter) {
      host.innerHTML = '<p class="muted" style="font-size:12.5px">No chapter selected. Pick a row above, or create a ' +
        'blank chapter to start from the blueprint structure.</p>';
      return;
    }
    var total = SCHEMA && SCHEMA.countQuestions ? SCHEMA.countQuestions(chapter) : 0;
    var t = chapter.teaching || {};
    host.innerHTML =
      '<div class="ch-h"><b>Chapter ' + esc(chapter.chapterNo) + ' — ' + esc(chapter.title || 'Untitled') + '</b>' +
        '<span>' + esc(LABEL[str(chapter.book)] || chapter.book) + ' · ' + esc(chapter.cefr) +
        ' · edition ' + esc(chapter.edition) + ' · ' + total + ' questions · schema ' + esc(chapter.schemaVersion) + '</span></div>' +
      (has(t.objective) ? '<p class="blk-i"><b>Objective</b> — ' + esc(t.objective) + '</p>' : '') +
      (chapter.modules || []).map(function (mod) {
        return '<div class="mod"><h3>' + esc(mod.label || mod.id) + '</h3>' +
          (mod.blocks || []).map(blockHtml).join('') + '</div>';
      }).join('');
  }

  /* ------------------------------------------------------------------ 빌드 패널 */

  function paintBuild(chapter) {
    var book = state.book;
    var lines = [];
    if (chapter) {
      lines.push('python3 studyground/sg2/tools/build_book.py build \\');
      lines.push('    --book ' + book + ' --chapter ' + str(chapter.chapterNo) + ' \\');
      lines.push('    --edition student --edition answerKey --edition teacher');
    } else {
      lines.push('python3 studyground/sg2/tools/build_book.py build --book ' + book);
    }
    $('buildCmd').textContent = lines.join('\n');
  }

  function checkCommand() {
    return 'python3 studyground/sg2/tools/build_book.py check --book ' + state.book;
  }

  /* ------------------------------------------------------------------ 그리기 */

  function render() {
    var chapter = state.slug ? getChapter(state.slug) : null;
    if (state.slug && !chapter) state.slug = '';
    paintBooks();
    paintRows();
    paintGates(chapter);
    paintDetail(chapter);
    paintBuild(chapter);
  }

  /* ------------------------------------------------------------------ 동작 */

  function download(name, text) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name;
    a.click();
  }

  /** gate 배열을 사람이 읽는 몇 줄로 줄인다. 55개를 통째로 alert 에 붓지 않는다. */
  function stopLines(gates) {
    var stops = (gates || []).filter(function (g) { return g && g.level === 'stop'; });
    if (!stops.length) return '';
    return '\n\n' + stops.slice(0, 4).map(function (g) { return '· ' + str(g.message); }).join('\n') +
      (stops.length > 4 ? '\n· …and ' + (stops.length - 4) + ' more.' : '');
  }

  function saveChapter(chapter) {
    if (!STORE || typeof STORE.put !== 'function') { alert('Chapter storage is not available on this page.'); return false; }
    var r;
    try { r = STORE.put(chapter); } catch (e) { r = { ok: false, error: str(e && e.message) }; }
    if (!r || !r.ok) {
      alert('Could not save the chapter: ' + str(r && r.error || 'unknown reason') + stopLines(r && r.gates));
      return false;
    }
    delete HAY[str(chapter.slug)];
    return true;
  }

  /* 빈 챕터는 저장하지 않고 파일로 내려 준다.
     저장소는 'stop' 이 하나라도 있는 원고를 거절한다 — 그런데 blueprint 뼈대는 내용이
     전부 비어 있으므로 항상 stop 이다. "만들기"라고 써 놓고 매번 거절당하게 두면
     관리자는 저장소가 고장 난 줄 안다. 그래서 여기서는 채워 넣을 서식을 준다. */
  function doCreate(no) {
    if (!SCHEMA || typeof SCHEMA.blankChapter !== 'function') { alert('The chapter schema is not available on this page.'); return; }
    var ch;
    try { ch = SCHEMA.blankChapter(state.book, no); } catch (e) { alert('Could not build a blank chapter: ' + str(e && e.message)); return; }
    download(str(ch.slug) + '.blank.json', JSON.stringify(ch, null, 2));
  }

  function doDownload(slug) {
    var ch = getChapter(slug);
    if (!ch) { alert('That chapter is no longer in storage.'); return; }
    download(slug + '.json', JSON.stringify(ch, null, 2));
  }

  function doRemove(slug) {
    if (!STORE || typeof STORE.remove !== 'function') return;
    if (!window.confirm('Remove ' + slug + ' from this browser? The chapter JSON is not recoverable here — download it first if you need it.')) return;
    try { STORE.remove(slug); } catch (e) { /* 지우기 실패는 조용히 넘기지 않고 아래 render 로 실제 상태를 다시 보여 준다. */ }
    if (state.slug === slug) state.slug = '';
    delete HAY[slug];
    render();
  }

  function doStatus(next) {
    if (!state.slug) return;
    if (!STORE || typeof STORE.setStatus !== 'function') { alert('Chapter storage is not available on this page.'); return; }
    var r;
    try { r = STORE.setStatus(state.slug, next); } catch (e) { r = { ok: false, error: str(e && e.message) }; }
    if (!r || !r.ok) { alert('Could not change the status: ' + str(r && r.error || 'unknown reason')); return; }
    render();
  }

  function doPublish() {
    var ch = getChapter(state.slug);
    if (!ch) return;
    if (countStops(gatesOf(ch))) return;               /* 버튼은 이미 잠겨 있지만, 키보드 경로도 막는다. */
    if (!STORE || typeof STORE.publishAsSet !== 'function') { alert('Chapter storage is not available on this page.'); return; }
    var setSlug = 'book-' + str(ch.slug);
    var r;
    try { r = STORE.publishAsSet([ch], setSlug); } catch (e) { r = { ok: false, error: str(e && e.message) }; }
    if (!r || !r.ok) { alert('Could not publish this chapter as a set: ' + str(r && r.error || 'unknown reason')); return; }
    /* 세트 코드는 저장소가 영숫자로 다듬는다 — 화면에는 실제로 저장된 이름을 보여 준다. */
    alert('Published as the exam set "' + str(r.slug || setSlug) + '". Open it from the set list to run it.');
  }

  /* 업로드는 두 갈래다 — 챕터 한 장(book/chapterNo 가 있는 객체)이면 그 자리에 넣고,
     내보내기 파일이면 importAll 로 넘긴다. 파일을 잘못 골랐을 때 조용히 아무 일도
     일어나지 않는 것이 가장 나쁘므로, 어느 쪽도 아니면 이유를 말한다. */
  var uploadMode = 'chapter';
  function readFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var json;
      try { json = JSON.parse(String(reader.result)); }
      catch (e) { alert('That file is not valid JSON: ' + str(e && e.message)); return; }

      if (uploadMode === 'book') {
        if (!STORE || typeof STORE.importAll !== 'function') { alert('Chapter storage is not available on this page.'); return; }
        var ir;
        try { ir = STORE.importAll(json); } catch (e2) { ir = { ok: false, error: str(e2 && e2.message) }; }
        HAY = {};
        render();
        /* 일부만 들어온 경우가 가장 위험하다 — "됐다"고만 말하면 빠진 챕터를 아무도 못 찾는다. */
        if (!ir || ir.ok === false) {
          var lost = (ir && ir.errors) || [];
          alert('Import finished with problems: ' + str(ir && ir.error || (lost.length + ' chapter(s) were rejected')) +
            (lost.length ? '\n\n' + lost.slice(0, 5).map(function (x) { return str(x.slug) + ' — ' + str(x.error); }).join('\n') : ''));
          return;
        }
        alert('Imported ' + str(ir.imported) + ' chapter(s).');
        return;
      }

      if (!json || typeof json !== 'object' || isArr(json) || !json.book || json.chapterNo == null) {
        alert('That file does not look like a chapter — a chapter JSON has "book" and "chapterNo" at the top level.');
        return;
      }
      /* 저장소는 stop 이 있는 원고를 받지 않는다. 여기서 먼저 말해 주지 않으면
         업로드한 사람은 저장 실패만 보고 파일이 잘못된 줄 안다. */
      var gates = gatesOf(json);
      var stops = countStops(gates);
      if (stops) {
        alert('This chapter cannot be saved yet — ' + stops + ' stop check(s) must be cleared first.' + stopLines(gates));
        return;
      }
      if (!saveChapter(json)) return;
      state.book = str(json.book);
      state.slug = str(json.slug || slugOf(json.book, json.chapterNo));
      render();
    };
    reader.readAsText(file);
  }

  function doExport() {
    if (!STORE || typeof STORE.exportAll !== 'function') { alert('Chapter storage is not available on this page.'); return; }
    var data;
    try { data = STORE.exportAll(state.book); } catch (e) { data = null; }
    if (!data) { alert('Nothing to export for ' + LABEL[state.book] + '.'); return; }
    download('book-' + state.book + '.json', typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  }

  function copy(text, btn, label) {
    function done() { btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = label; }, 1400); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () {});
      return;
    }
    /* 구형 사파리·file:// 에서는 clipboard API 가 없다. 명령을 복사하지 못하면
       관리자가 손으로 옮겨 적다 오타를 내므로, 선택 가능한 상태로라도 만들어 준다. */
    var ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { /* 그래도 안 되면 화면의 pre 를 직접 긁으면 된다. */ }
    document.body.removeChild(ta);
  }

  /* ------------------------------------------------------------------ 이벤트 */

  function wire() {
    $('books').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-book]') : null;
      if (!b) return;
      state.book = b.getAttribute('data-book');
      state.slug = '';
      render();
    });

    $('rows').addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.getAttribute) return;
      if (t.getAttribute('data-make')) { doCreate(Number(t.getAttribute('data-make'))); return; }
      if (t.getAttribute('data-dl')) { doDownload(t.getAttribute('data-dl')); return; }
      if (t.getAttribute('data-rm')) { doRemove(t.getAttribute('data-rm')); return; }
      var open = t.getAttribute('data-open');
      if (!open) {
        var row = t.closest ? t.closest('tr[data-slug]') : null;
        open = row ? row.getAttribute('data-slug') : '';
      }
      if (!open) return;
      state.slug = state.slug === open ? '' : open;
      render();
    });

    $('acts').addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.getAttribute) return;
      var act = t.getAttribute('data-do');
      if (!act || t.disabled) return;
      if (act === 'validate') { render(); return; }
      if (act === 'download') { doDownload(state.slug); return; }
      if (act === 'upload') { uploadMode = 'chapter'; $('file').value = ''; $('file').click(); return; }
      if (act === 'publish') { doPublish(); return; }
      if (act.indexOf('status:') === 0) { doStatus(act.slice(7)); return; }
    });

    $('file').addEventListener('change', function () {
      if (this.files && this.files[0]) readFile(this.files[0]);
    });

    $('q').addEventListener('input', function () {
      state.query = this.value.replace(/^\s+|\s+$/g, '').toLowerCase();
      paintRows();
    });

    $('showKey').addEventListener('change', function () {
      document.body.classList.toggle('hide-key', !this.checked);
    });

    $('importBtn').addEventListener('click', function () { uploadMode = 'book'; $('file').value = ''; $('file').click(); });
    $('exportBtn').addEventListener('click', doExport);
    $('printBtn').addEventListener('click', function () { window.print(); });
    $('copyCmd').addEventListener('click', function () { copy($('buildCmd').textContent, this, 'Copy command'); });
    $('checkCmd').addEventListener('click', function () { copy(checkCommand(), this, 'Copy check command'); });
  }

  /* ------------------------------------------------------------------ 진입 */

  /** 전역이 빠진 채로 열렸을 때 무엇이 없는지 이름으로 말한다. */
  function missing() {
    var out = [];
    if (!SCHEMA) out.push('SG_BOOK_SCHEMA (assets/book-schema.js)');
    if (!STORE) out.push('SG_BOOK_STORE (assets/book-store.js)');
    return out;
  }

  function open() {
    $('gate').hidden = true;
    $('main').hidden = false;

    var gone = missing();
    if (gone.length) {
      $('deps').innerHTML = '<div class="note"><b>This page is not available.</b><br>' +
        'It needs ' + esc(gone.join(' and ')) + '. The script did not load, so there is nothing to read or check here. ' +
        'Reload the page; if it keeps failing, the file is missing from this deployment.</div>';
      return;
    }
    $('deps').innerHTML = '';
    $('workspace').hidden = false;

    /* 구조의 정본은 config/blueprint.book.json 이다. 못 읽으면 스키마 안의 사본으로
       계속 간다 — 검산이 조금 낡을 수는 있어도 화면이 멈추지는 않게 한다. */
    if (window.fetch && SCHEMA.useBlueprint) {
      fetch('config/blueprint.book.json')
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { if (j) { SCHEMA.useBlueprint(j); render(); } })
        .catch(function () {});
    }

    wire();
    render();
  }

  window.SG_BOOK_ADMIN = {
    state: state,
    render: render,
    gatesOf: gatesOf,
    open: open
  };

  if (!ADMIN) {
    /* 관리자 게이트 자체가 없으면 본문을 열지 않는다. 권한 확인이 없는 상태에서
       정답이 실린 화면을 그리는 것이 최악이다. */
    document.addEventListener('DOMContentLoaded', function () {
      var g = $('gate');
      if (g) g.innerHTML = '<p class="muted">Admin sign-in is not available on this page.</p>';
    });
    return;
  }

  function boot() {
    var setId = ADMIN.pageSet ? ADMIN.pageSet() : '';
    $('signin').addEventListener('click', function () { ADMIN.openLogin(setId, open); });
    if (ADMIN.can(setId)) open(); else ADMIN.openLogin(setId, open);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
