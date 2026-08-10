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

  var API = {
    PREFIX: PREFIX,
    globalName: globalName,

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
      return { ok: true, slug: slug };
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
