/* SMEAG StudyGround — book-store.js : 교재 챕터 원고의 보관소(브라우저 1차 저장소).
 *
 * 왜 있나
 *   교재("TOEFL Practice Book — B2 Level Up")의 원고는 챕터 JSON 한 벌뿐이고, 학생용 PDF ·
 *   교사판 PDF · 응시 세트 · 음원 · 색인이 전부 거기서 나온다(docs/bmad/book-schema.md §1-1).
 *   그 한 벌이 어디에 어떤 이름으로 앉는지를 여기서 못 박는다. 편집 화면마다 제 나름의
 *   키로 저장하면 "어제 쓴 챕터가 오늘 목록에 없다"가 반드시 일어난다.
 *
 * 왜 set-store.js 와 따로인가
 *   키 접두어를 'sg2:set:' 이 아니라 'sg2:book:' 으로 **일부러** 갈랐다(§6). 교재 챕터가
 *   세트 목록에 섞여 뜨면 관리자가 시험 세트인 줄 알고 학생에게 배정한다. 챕터를 시험으로
 *   돌리려면 publishAsSet() 을 거쳐 명시적으로 세트를 만들어야 한다.
 *
 * 키 규칙 (docs/bmad/book-schema.md §6)
 *   sg2:book:<slug>   챕터 본문(JSON). slug 는 '{book}-{NN}' — 예: sg2:book:reading-03
 *   sg2:book-index    [{book,chapterNo,slug,title,status,total,savedAt,version,bytes}]
 *
 * 상태(status) 는 원고가 아니라 목록에 산다. 챕터 JSON 은 산출물의 원본이고,
 * "검토했나 / PDF 를 뽑았나"는 원고의 내용이 아니라 작업 진행이기 때문이다.
 *   draft → gated → reviewed → built
 * 앞으로는 한 칸씩만 간다. 두 칸을 건너뛰면(draft → built) "검토받지 않은 원고로 인쇄본이
 * 나갔다"가 기록상 정상으로 보인다 — 그 사고를 setStatus() 가 gate 로 막는다.
 * 뒤로는 몇 칸이든 자유롭다. 잘못을 발견해 되돌리는 길까지 막을 이유는 없다.
 *
 * gate 모양은 set-import.js · book-schema.js 와 **완전히 같다**:
 *   { level:'stop'|'warn', scope:string, message:string }   메시지는 영어(화면에 그대로 뜬다).
 *
 * 노출 전역: window.SG_BOOK_STORE
 * ES5 문법만 쓴다(빌드 단계 없음). node 에서도 require() 로 그대로 불린다(테스트용).
 */
(function (root, factory) {
  var api = factory();
  root.SG_BOOK_STORE = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var PREFIX = 'sg2:book:';
  var INDEX = 'sg2:book-index';

  /* 상태 사다리. 배열 순서가 곧 규칙이다. */
  var STATUS = ['draft', 'gated', 'reviewed', 'built'];

  /* 시크릿 모드·정책 차단에서는 localStorage 가 객체로는 보이면서 getItem 에서 throw 한다.
     존재만 보고 넘기면 나중에 setItem 이 터져 "저장 공간 부족"이라는 엉뚱한 안내가 나간다.
     그래서 한 번 읽어 본 뒤에야 쓸 수 있다고 판단한다. */
  function store() {
    try {
      if (typeof localStorage === 'undefined' || !localStorage) return null;
      localStorage.getItem(INDEX);
      return localStorage;
    } catch (e) { return null; }
  }

  var NO_STORE = 'This browser will not let the page store data (private mode?). Nothing was saved.';

  /* book-schema.js 는 별도 파일이라 로드 순서가 어긋날 수 있다. 부를 때마다 찾는다 —
     이 파일이 먼저 실린 화면에서 조용히 undefined 를 잡고 죽는 것을 막는다. */
  function schema() {
    if (typeof SG_BOOK_SCHEMA !== 'undefined' && SG_BOOK_SCHEMA) return SG_BOOK_SCHEMA;
    if (typeof globalThis !== 'undefined' && globalThis.SG_BOOK_SCHEMA) return globalThis.SG_BOOK_SCHEMA;
    return null;
  }

  function setStore() {
    if (typeof SG_SET_STORE !== 'undefined' && SG_SET_STORE) return SG_SET_STORE;
    if (typeof globalThis !== 'undefined' && globalThis.SG_SET_STORE) return globalThis.SG_SET_STORE;
    return null;
  }

  function gate(level, scope, message) {
    return { level: level, scope: scope, message: message };
  }

  /* gate 모양의 실패. UI 는 error 를 띄우고 gates 를 목록으로 편다 — set-import.js 와 같다. */
  function fail(scope, message) {
    return { ok: false, error: message, gates: [gate('stop', scope, message)] };
  }

  function str(v) { return v === undefined || v === null ? '' : String(v); }

  function cleanSlug(v) {
    return str(v).toLowerCase().replace(/[^a-z0-9-]/g, '');
  }

  function readIndex() {
    var s = store();
    if (!s) return [];
    try {
      var raw = JSON.parse(s.getItem(INDEX) || '[]');
      return raw && raw.length !== undefined ? raw : [];
    } catch (e) { return []; }
  }

  function writeIndex(list) {
    var s = store();
    if (!s) return false;
    try { s.setItem(INDEX, JSON.stringify(list)); return true; }
    catch (e) { return false; }
  }

  function rowOf(slug) {
    var hit = null;
    readIndex().forEach(function (r) { if (r && r.slug === slug) hit = r; });
    return hit;
  }

  function byNewest(a, b) {
    return str(b && b.savedAt).localeCompare(str(a && a.savedAt));
  }

  function countOf(chapter) {
    var sc = schema();
    if (sc && sc.countQuestions) { try { return sc.countQuestions(chapter) || 0; } catch (e) {} }
    var n = 0;
    (chapter.modules || []).forEach(function (m) {
      (m.blocks || []).forEach(function (b) { n += (b.questions || []).length; });
    });
    return n;
  }

  /* 원고가 실제로 바뀐 뒤에도 status 가 'built' 로 남으면, 인쇄본은 옛 원고인데 기록은
     최신인 것처럼 보인다. 내용이 달라졌으면 검토 이후 단계는 내려놓는다. put() 이
     validate 를 통과시킨 직후이므로 내려놓는 자리는 'gated' 다. */
  function statusAfterEdit(prev, changed) {
    if (!prev) return 'draft';
    if (!changed) return prev;
    if (prev === 'reviewed' || prev === 'built') return 'gated';
    return prev;
  }

  var API = {
    PREFIX: PREFIX,
    INDEX: INDEX,
    STATUS: STATUS,

    /**
     * 저장된 챕터 목록. 최근 저장 순.
     * @param {string} [book] 주면 그 권만 거른다.
     * @return {Array<{book,chapterNo,slug,title,status,total,savedAt,version,bytes}>}
     */
    list: function (book) {
      var want = str(book);
      return readIndex().filter(function (r) {
        return r && r.slug && (!want || str(r.book) === want);
      }).map(function (r) {
        return {
          book: str(r.book),
          chapterNo: Number(r.chapterNo) || 0,
          slug: str(r.slug),
          title: str(r.title),
          status: STATUS.indexOf(str(r.status)) >= 0 ? str(r.status) : 'draft',
          total: Number(r.total) || 0,
          savedAt: str(r.savedAt),
          version: str(r.version),
          bytes: Number(r.bytes) || 0
        };
      }).sort(byNewest);
    },

    /** 챕터 본문. 없으면 null. */
    get: function (slug) {
      var s = store();
      if (!s) return null;
      try { return JSON.parse(s.getItem(PREFIX + cleanSlug(slug)) || 'null'); }
      catch (e) { return null; }
    },

    /**
     * 챕터를 저장한다. 같은 slug 는 덮어쓴다 — 확인은 부르는 쪽에서 받는다.
     *
     * 저장 전에 SG_BOOK_SCHEMA.validate() 를 돌리고 'stop' 이 하나라도 있으면 **거절**한다.
     * 이유: 여기 담긴 원고에서 PDF·세트·음원이 전부 나온다. 깨진 원고를 받아 두면
     * 그 사실은 인쇄한 뒤나 시험 당일에야 드러난다. 'warn' 만 있으면 저장한다.
     *
     * @return {{ok:true, slug:string, gates:Array}|{ok:false, error:string, gates:Array}}
     */
    put: function (chapter) {
      if (!chapter || typeof chapter !== 'object') {
        return fail('chapter', 'No chapter was given.');
      }
      var s = store();
      if (!s) return fail('storage', NO_STORE);

      var sc = schema();
      if (!sc) return fail('schema', 'book-schema.js is not loaded, so the chapter could not be checked. Nothing was saved.');

      var slug = cleanSlug(chapter.slug || (sc.slugOf ? sc.slugOf(chapter.book, chapter.chapterNo) : ''));
      if (!slug) return fail('chapter', 'The chapter has no slug, so there is no place to store it.');

      var report = sc.validate(chapter) || { ok: false, gates: [] };
      var gates = report.gates || [];
      var stops = gates.filter(function (g) { return g && g.level === 'stop'; });
      if (stops.length) {
        return {
          ok: false,
          error: 'This chapter has ' + stops.length + ' blocking problem' + (stops.length === 1 ? '' : 's') + '. Fix them before saving.',
          gates: gates
        };
      }

      var body;
      try { body = JSON.stringify(chapter); }
      catch (e) { return fail('chapter', 'The chapter could not be turned into JSON (it may contain a circular reference).'); }

      var before = null;
      try { before = s.getItem(PREFIX + slug); } catch (e) {}

      try { s.setItem(PREFIX + slug, body); }
      catch (e) {
        return fail('storage',
          'Out of storage space (' + Math.round(body.length / 1024) + 'KB). ' +
          'Export and remove chapters you are no longer editing, then try again.');
      }

      var prev = rowOf(slug);
      var list = readIndex().filter(function (r) { return r && r.slug !== slug; });
      list.push({
        book: str(chapter.book),
        chapterNo: Number(chapter.chapterNo) || 0,
        slug: slug,
        title: str(chapter.title),
        status: statusAfterEdit(prev && prev.status, before !== body),
        total: countOf(chapter),
        savedAt: new Date().toISOString(),
        version: str(chapter.schemaVersion || sc.SCHEMA_VERSION),
        bytes: body.length
      });

      if (!writeIndex(list)) {
        /* 본문은 들어갔는데 목록이 못 들어가면 그 챕터는 화면에서 사라진 것처럼 보인다.
           본문을 되돌려 "반쯤 저장된" 상태를 남기지 않는다. */
        try { if (before === null) s.removeItem(PREFIX + slug); else s.setItem(PREFIX + slug, before); } catch (e) {}
        return fail('storage', 'The chapter list could not be updated, so the save was rolled back. Free some storage space and try again.');
      }

      return { ok: true, slug: slug, gates: gates };
    },

    /** 챕터를 지운다. 본문과 목록 양쪽에서. */
    remove: function (slug) {
      slug = cleanSlug(slug);
      var s = store();
      if (s) { try { s.removeItem(PREFIX + slug); } catch (e) {} }
      writeIndex(readIndex().filter(function (r) { return r && r.slug !== slug; }));
      return { ok: true, slug: slug };
    },

    /**
     * 진행 상태를 바꾼다. draft → gated → reviewed → built 를 한 칸씩만 올라간다.
     * 건너뛰기는 gate 모양의 실패로 돌려준다 — throw 하지 않는다. 편집 화면이
     * try/catch 없이 결과만 보고 메시지를 띄울 수 있어야 하기 때문이다.
     *
     * @return {{ok:true, slug, status, from}|{ok:false, error, gates}}
     */
    setStatus: function (slug, status) {
      slug = cleanSlug(slug);
      status = str(status);

      var row = rowOf(slug);
      if (!row) return fail('chapter', 'No saved chapter named "' + slug + '".');

      var to = STATUS.indexOf(status);
      if (to < 0) {
        return fail('status', 'Unknown status "' + status + '". Use one of: ' + STATUS.join(', ') + '.');
      }

      var fromName = STATUS.indexOf(str(row.status)) >= 0 ? str(row.status) : 'draft';
      var from = STATUS.indexOf(fromName);

      if (to > from + 1) {
        return {
          ok: false,
          error: 'Cannot jump from "' + fromName + '" to "' + status + '".',
          gates: [gate('stop', 'status',
            'Cannot jump from "' + fromName + '" to "' + status + '". The next step is "' + STATUS[from + 1] + '".')]
        };
      }

      var list = readIndex().map(function (r) {
        if (!r || r.slug !== slug) return r;
        r.status = status;
        return r;
      });
      if (!writeIndex(list)) return fail('storage', NO_STORE);
      return { ok: true, slug: slug, status: status, from: fromName };
    },

    /**
     * 챕터를 응시 가능한 세트로 내보낸다. 챕터 객체 배열도, slug 문자열 배열도 받는다.
     * 변환은 SG_BOOK_SCHEMA.toPack 이 하고, 보관은 SG_SET_STORE 가 한다 — 이 함수가
     * 팩을 직접 만들지 않는 이유는 세트 모양의 정본을 두 곳에 두지 않기 위해서다.
     *
     * @param {Array} chapters 챕터 객체 또는 slug
     * @param {string} slug    만들 세트 코드 (예: 'bookr03')
     */
    publishAsSet: function (chapters, slug) {
      var sc = schema();
      if (!sc || !sc.toPack) return fail('schema', 'book-schema.js is not loaded, so no set could be built.');
      var ss = setStore();
      if (!ss || !ss.put) return fail('storage', 'set-store.js is not loaded, so the set could not be stored.');

      var list = [];
      var missing = [];
      (chapters && chapters.length !== undefined ? chapters : (chapters ? [chapters] : []))
        .forEach(function (c) {
          if (!c) return;
          if (typeof c === 'string') {
            var got = API.get(c);
            if (got) list.push(got); else missing.push(c);
            return;
          }
          list.push(c);
        });

      if (missing.length) return fail('chapter', 'These chapters are not saved: ' + missing.join(', ') + '.');
      if (!list.length) return fail('chapter', 'No chapters were given, so there is nothing to publish.');

      /* 세트 코드는 세트 목록의 규칙(영숫자)을 따른다. 챕터 슬러그의 '-' 는 여기서 떨어진다. */
      var code = str(slug || (list.length === 1 ? list[0].slug : 'book')).toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!code) return fail('chapter', 'The set code is empty.');

      var titles = list.map(function (c) { return str(c.title) || str(c.slug); }).join(' · ');
      var pack;
      try {
        pack = sc.toPack(list, { code: code, codeSlug: list.length === 1 ? str(list[0].slug) : code });
      } catch (e) {
        return fail('chapter', 'The chapters could not be turned into a set: ' + (e && e.message ? e.message : 'unknown error') + '.');
      }
      pack.title = titles;

      var res = ss.put(code, pack, { title: titles });
      if (!res || !res.ok) {
        return { ok: false, error: (res && res.error) || 'The set could not be stored.', gates: [gate('stop', 'storage', (res && res.error) || 'The set could not be stored.')] };
      }
      return { ok: true, slug: code, questions: (pack.summary && pack.summary.questions) || 0, chapters: list.length };
    },

    /**
     * 검색 사이드카(config/_book/{slug}.index.json 의 내용)를 만든다.
     * 용어는 chapter.indexTerms 와 glossary[].term 을 합친다 — 어휘 페이지에 인쇄된 말은
     * 책 뒤 색인에서도 찾혀야 하기 때문에 둘을 따로 관리하지 않는다.
     * 대소문자만 다른 같은 말은 하나로 묶고, 표기는 처음 나온 것을 남긴다.
     *
     * @return {{book,builtAt,terms:[{term,chapters:[number]}],chapters:[{no,title,questions}]}}
     */
    buildIndex: function (book) {
      book = str(book);
      var rows = API.list(book).slice().sort(function (a, b) { return a.chapterNo - b.chapterNo; });
      var bag = {};       /* 소문자 키 → {term, seen:{no:1}} */
      var chapters = [];

      rows.forEach(function (r) {
        var c = API.get(r.slug);
        if (!c) return;
        var no = Number(c.chapterNo) || r.chapterNo || 0;
        chapters.push({ no: no, title: str(c.title) || r.title, questions: countOf(c) });

        var terms = [];
        (c.indexTerms || []).forEach(function (t) { terms.push(t); });
        (c.glossary || []).forEach(function (g) { if (g && g.term) terms.push(g.term); });

        terms.forEach(function (t) {
          var name = str(t).replace(/^\s+|\s+$/g, '');
          if (!name) return;
          var key = name.toLowerCase();
          if (!bag[key]) bag[key] = { term: name, seen: {} };
          bag[key].seen[no] = 1;
        });
      });

      var keys = [];
      for (var k in bag) { if (Object.prototype.hasOwnProperty.call(bag, k)) keys.push(k); }
      keys.sort();

      var terms = keys.map(function (k) {
        var nos = [];
        for (var n in bag[k].seen) { if (Object.prototype.hasOwnProperty.call(bag[k].seen, n)) nos.push(Number(n)); }
        nos.sort(function (a, b) { return a - b; });
        return { term: bag[k].term, chapters: nos };
      });

      return {
        book: book,
        builtAt: new Date().toISOString(),
        terms: terms,
        chapters: chapters
      };
    },

    /**
     * 한 권(또는 인자 없이 전부)을 한 덩어리 JSON 으로 내보낸다.
     * 브라우저 저장소는 캐시 지우기 한 번에 사라진다 — 백업 경로가 없으면 원고가 사라진다.
     */
    exportAll: function (book) {
      var sc = schema();
      var rows = API.list(book);
      var out = [];
      rows.forEach(function (r) {
        var c = API.get(r.slug);
        if (c) out.push({ slug: r.slug, status: r.status, savedAt: r.savedAt, chapter: c });
      });
      return {
        kind: 'sg2-book-export',
        schemaVersion: (sc && sc.SCHEMA_VERSION) || '',
        book: str(book),
        exportedAt: new Date().toISOString(),
        count: out.length,
        chapters: out
      };
    },

    /**
     * exportAll() 이 만든 덩어리를 되읽는다. 문자열도 객체도 받는다.
     * 한 장이 막혀도 나머지는 들여온다 — 열 장 중 한 장 때문에 전부 되돌리면
     * 복구하려던 사람이 무엇을 고쳐야 하는지 알 수 없다.
     *
     * @return {{ok, imported:number, skipped:number, errors:[{slug,error,gates}]}}
     */
    importAll: function (json) {
      var data = json;
      if (typeof data === 'string') {
        try { data = JSON.parse(data); }
        catch (e) { return { ok: false, imported: 0, skipped: 0, error: 'That file is not valid JSON.', errors: [] }; }
      }
      if (!data || typeof data !== 'object') {
        return { ok: false, imported: 0, skipped: 0, error: 'That file does not look like a book export.', errors: [] };
      }

      /* 내보낸 덩어리도, 챕터 배열도, 챕터 하나도 받는다. 복구하는 사람이 파일 모양을
         맞추느라 시간을 쓰게 하지 않는다. */
      var raw = data.chapters !== undefined ? data.chapters : data;
      var items = raw && raw.length !== undefined ? raw : [raw];

      var imported = 0, errors = [];
      items.forEach(function (it) {
        if (!it) return;
        var chapter = it.chapter ? it.chapter : it;
        var res = API.put(chapter);
        if (res.ok) {
          imported++;
          var want = str(it.status);
          /* 상태는 사다리를 한 칸씩만 올라가므로, 내보낼 때의 자리까지 차례로 되짚는다. */
          if (STATUS.indexOf(want) > 0) {
            for (var i = 1; i <= STATUS.indexOf(want); i++) API.setStatus(res.slug, STATUS[i]);
          }
        } else {
          errors.push({ slug: str(chapter && chapter.slug), error: res.error, gates: res.gates || [] });
        }
      });

      return { ok: errors.length === 0, imported: imported, skipped: errors.length, errors: errors };
    }
  };

  return API;
});
