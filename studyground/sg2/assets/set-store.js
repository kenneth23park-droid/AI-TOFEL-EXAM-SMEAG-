/* SMEAG StudyGround — set-store.js : 업로드로 만든 콘텐츠 팩 보관소.
 *
 * assets/set1.js · set9.js 는 저장소에 커밋된 파일이다. 업로드로 만든 세트는 그럴 수 없어서
 * 브라우저에 둔다. 오프라인 모드가 기본이라 localStorage 가 이 앱의 1차 저장소이고,
 * 여기 담긴 팩은 set9.js 와 **똑같은 모양**이라 시험 화면·문항 편집기가 구분 없이 쓴다.
 *
 * 키 규칙
 *   sg2:set:<slug>        팩 본문(JSON)
 *   sg2:set-index         [{slug, title, savedAt, total}] — 목록 화면용
 *
 * 전역 이름은 set9.js 의 관례를 따른다 — slug 'set10' → window.SMEAG_SET10.
 * ES5 문법만 쓴다(빌드 단계 없음).
 */
(function (root, factory) {
  var api = factory();
  root.SG_SET_STORE = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var PREFIX = 'sg2:set:';
  var INDEX = 'sg2:set-index';

  function store() {
    try { return typeof localStorage !== 'undefined' ? localStorage : null; }
    catch (e) { return null; }   /* 시크릿 모드 등 */
  }

  function readIndex() {
    var s = store();
    if (!s) return [];
    try { return JSON.parse(s.getItem(INDEX) || '[]') || []; }
    catch (e) { return []; }
  }

  function writeIndex(list) {
    var s = store();
    if (!s) return;
    try { s.setItem(INDEX, JSON.stringify(list)); } catch (e) {}
  }

  function globalName(slug) {
    return 'SMEAG_' + String(slug || '').toUpperCase();
  }

  function countQuestions(pack) {
    var n = 0;
    (pack.sections || []).forEach(function (sec) {
      (sec.modules || []).forEach(function (mod) {
        (mod.blocks || []).forEach(function (b) { n += (b.questions || []).length; });
      });
    });
    return n;
  }

  /** 팩 하나의 지문 — 문항 수·문항 id·정답·듣기 음원 경로. 저장 전후를 이것으로 맞댄다. */
  function fingerprint(pack) {
    var qs = [], audio = [];
    (pack && pack.sections || []).forEach(function (sec) {
      (sec.modules || []).forEach(function (mod) {
        (mod.blocks || []).forEach(function (b) {
          if (b.audio) audio.push(b.audio);
          (b.questions || []).forEach(function (q) {
            if (q.audio) audio.push(q.audio);
            qs.push(q.id + '=' + JSON.stringify(q.answer === undefined ? null : q.answer));
          });
        });
      });
    });
    return { total: qs.length, questions: qs, audio: audio };
  }

  /**
   * 저장된 것이 저장하려던 것과 같은지 되읽어 확인한다.
   * localStorage 는 조용히 실패하는 자리가 많다 — 용량이 모자라 잘리거나, 시크릿 모드에서
   * setItem 이 통째로 버려지거나, 다른 탭이 같은 키를 덮어쓴다. put 이 ok 를 돌려준 것만
   * 믿고 "저장됐다" 고 말하면 정답이 빠진 세트로 시험을 볼 수 있다.
   * @return {{ok:boolean, problems:string[]}}
   */
  function verify(slug, pack) {
    var problems = [];
    var back = API.get(slug);
    if (!back) return { ok: false, problems: ['저장된 세트를 다시 읽지 못했습니다.'] };

    var want = fingerprint(pack), got = fingerprint(back);
    if (want.total !== got.total) {
      problems.push('문항 수가 다릅니다 — 저장하려던 ' + want.total + ', 저장된 ' + got.total + '.');
    }
    var lost = want.questions.filter(function (k, i) { return got.questions[i] !== k; });
    if (lost.length) {
      problems.push(lost.length + ' 문항의 정답이 저장본과 다릅니다: '
        + lost.slice(0, 5).join(', ') + (lost.length > 5 ? ' 외' : '') + '.');
    }
    if (want.audio.length !== got.audio.length) {
      problems.push('듣기 음원 경로 수가 다릅니다 — ' + want.audio.length + ' → ' + got.audio.length + '.');
    }
    var row = null;
    readIndex().forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) problems.push('저장 목록에 이 세트가 없습니다.');
    else if (row.total !== want.total) problems.push('저장 목록의 문항 수(' + row.total + ')가 팩과 다릅니다.');

    return { ok: problems.length === 0, problems: problems };
  }

  var API = {
    PREFIX: PREFIX,
    globalName: globalName,
    fingerprint: fingerprint,
    verify: function (slug, pack) { return verify(String(slug || '').toLowerCase().replace(/[^a-z0-9]/g, ''), pack); },

    /** 저장된 세트 목록(최근 저장 순). */
    list: function () {
      return readIndex().slice().sort(function (a, b) {
        return String(b.savedAt || '').localeCompare(String(a.savedAt || ''));
      });
    },

    get: function (slug) {
      var s = store();
      if (!s) return null;
      try { return JSON.parse(s.getItem(PREFIX + slug) || 'null'); }
      catch (e) { return null; }
    },

    /**
     * 팩을 저장한다. 같은 slug 가 있으면 덮어쓴다 — 덮어쓰기 전에 부르는 쪽에서
     * 확인을 받는다(이 함수는 묻지 않는다).
     * @return {{ok:boolean, error?:string}}
     */
    put: function (slug, pack, meta) {
      var s = store();
      if (!s) return { ok: false, error: '이 브라우저에서는 저장소를 쓸 수 없습니다(시크릿 모드일 수 있습니다).' };
      slug = String(slug || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!slug) return { ok: false, error: '세트 코드가 비어 있습니다.' };

      var body = JSON.stringify(pack);
      try { s.setItem(PREFIX + slug, body); }
      catch (e) {
        return { ok: false, error: '저장 공간이 부족합니다 (' + Math.round(body.length / 1024) + 'KB). 쓰지 않는 세트를 지우고 다시 시도해 주세요.' };
      }

      var list = readIndex().filter(function (r) { return r.slug !== slug; });
      list.push({
        slug: slug,
        title: (meta && meta.title) || pack.title || slug.toUpperCase(),
        savedAt: (meta && meta.savedAt) || new Date().toISOString(),
        total: countQuestions(pack),
        bytes: body.length
      });
      writeIndex(list);

      /* 저장했다고 말하기 전에 되읽어 본다 — 여기서 걸러야 시험장에서 안 걸린다. */
      var v = verify(slug, pack);
      if (!v.ok) {
        /* 본문이 아예 들어가지 않았으면 목록만 남는다 — 없는 세트를 목록이 광고하지
           않도록 그 줄은 걷어낸다. 본문이 있는데 내용이 다른 경우는 손대지 않는다:
           덮어쓰기가 반만 된 것이라 지우면 이전 세트까지 사라진다. */
        if (!API.get(slug)) writeIndex(readIndex().filter(function (r) { return r.slug !== slug; }));
        return { ok: false, slug: slug, error: '저장이 끝나지 않았습니다: ' + v.problems.join(' '), problems: v.problems };
      }
      return { ok: true, slug: slug, verified: true };
    },

    remove: function (slug) {
      var s = store();
      if (s) { try { s.removeItem(PREFIX + slug); } catch (e) {} }
      writeIndex(readIndex().filter(function (r) { return r.slug !== slug; }));
      try { delete window[globalName(slug)]; } catch (e) {}
    },

    /** 팩에 helper 를 붙이고 window.SMEAG_<SLUG> 로 올린다. */
    activate: function (slug, pack) {
      pack = pack || API.get(slug);
      if (!pack) return null;
      if (typeof SG_SET_IMPORT !== 'undefined' && SG_SET_IMPORT.withHelpers) SG_SET_IMPORT.withHelpers(pack);
      try { window[globalName(slug)] = pack; } catch (e) {}
      return pack;
    },

    /** 저장된 세트를 전부 전역으로 올린다 — 시험 화면이 부팅할 때 한 번 부른다. */
    activateAll: function () {
      var out = [];
      API.list().forEach(function (r) {
        var p = API.activate(r.slug);
        if (p) out.push(r.slug);
      });
      return out;
    }
  };

  /* 이 파일이 실려 있으면 저장된 세트는 언제나 전역에 있다. 시험 화면이 별도 배선 없이
     ?set=set10 을 그대로 쓸 수 있어야 하기 때문이다. */
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try { API.activateAll(); } catch (e) {}
  }

  return API;
});
