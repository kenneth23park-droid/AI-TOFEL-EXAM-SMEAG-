/* SMEAG StudyGround — 콘텐츠 팩에 들어 있는 모든 오디오 슬롯의 목록.
 *
 * 관리자 화면 세 곳(admin-audio.html · admin-audio-files.html · admin-questions.html)이
 * 같은 목록을 봐야 하므로 열거 규칙을 여기 한 곳에만 둔다.
 *
 * 경로는 SG_MEDIA.resolveMedia() 로 배포 경로까지 풀어 둔다 — 이 값이 곧
 * SG_AUDIO 오버라이드의 키이자 <audio src> 이므로, 여기서 어긋나면 교체가 걸리지 않는다.
 *
 * 노출 전역: window.SG_AUDIO_INDEX
 */
(function () {
  'use strict';

  var PACKS = [
    { set: 'set1', label: 'SET 1', global: 'SMEAG_SET1' },
    { set: 'set9', label: 'SET 9', global: 'SMEAG_SET9' }
  ];

  /* SG_MEDIA 가 없는 화면(관리자 페이지)에서도 같은 리맵을 쓴다. */
  function resolve(p) {
    if (!p) return '';
    if (window.SG_MEDIA && window.SG_MEDIA.resolveMedia) return window.SG_MEDIA.resolveMedia(p);
    return encodeURI(String(p)
      .replace('TOEFL MOCK TEST  SET 1/SET 1 AUDIO/', 'media/audio/')
      .replace('TOEFL LISTENING & WRITING PICTURES/', 'media/pictures/')
      .replace('app/assets/speaking/', 'media/speaking/'));
  }

  /** 한 팩의 오디오 슬롯 목록. */
  function itemsOf(pack, setId) {
    var out = [], seen = {};
    if (!pack || !pack.sections) return out;
    function add(raw, meta) {
      if (!raw) return;
      var path = resolve(raw);
      var dupKey = path + '|' + (meta.qid || meta.title);
      if (seen[dupKey]) return;
      seen[dupKey] = 1;
      out.push({
        set: setId, section: meta.section, sectionLabel: meta.sectionLabel,
        module: meta.module, block: meta.block, title: meta.title,
        qid: meta.qid || null, no: meta.no || null, raw: raw, path: path
      });
    }
    pack.sections.forEach(function (sec) {
      (sec.modules || []).forEach(function (mod) {
        var mlab = mod.label || mod.id || '';
        (mod.blocks || []).forEach(function (block) {
          var blab = block.heading || '';
          var base = { section: sec.id, sectionLabel: sec.label || sec.id, module: mlab, block: blab };
          if (block.introAudio) add(block.introAudio, Object.assign({}, base, { title: mlab + ' · Instructions' }));
          if (block.audio) add(block.audio, Object.assign({}, base, { title: mlab + ' · ' + (blab || 'Audio') }));
          (block.questions || []).forEach(function (q) {
            // set1 의 단답형 문항에는 no 가 없다 — 그럴 때는 문항 id 를 그대로 보여준다.
            if (q.audio) add(q.audio, Object.assign({}, base, {
              title: mlab + ' · ' + (q.no ? 'Q' + q.no : (q.id || 'Audio')), qid: q.id, no: q.no
            }));
          });
        });
      });
    });
    return out;
  }

  /** [{set,label,items:[…]}] — 로드된 팩만 담는다. */
  function groups() {
    var out = [];
    PACKS.forEach(function (p) {
      var pack = window[p.global];
      if (!pack) return;
      var items = itemsOf(pack, p.set);
      if (items.length) out.push({ set: p.set, label: p.label, items: items });
    });
    // SET 9 미리듣기 클립(set9-audio.js) — 시험 팩에 없는 별도 음원.
    var D = window.SMEAG_SET9_AUDIO;
    if (D && D.modules) {
      var items = [];
      D.modules.forEach(function (mod) {
        (mod.items || []).forEach(function (it) {
          items.push({
            set: 'set9', section: 'listening', sectionLabel: 'Listening (preview)',
            module: mod.label || mod.id, block: '', title: it.title || it.id,
            voices: it.voices || [], qid: null, no: null, raw: it.audio, path: resolve(it.audio)
          });
        });
      });
      if (items.length) out.push({ set: 'set9', label: 'SET 9 · preview clips', items: items, preview: true });
    }
    return out;
  }

  /** 평평한 한 줄 목록. setId 를 주면 그 SET 만. */
  function all(setId) {
    var flat = [];
    groups().forEach(function (g) {
      if (setId && g.set !== setId) return;
      flat = flat.concat(g.items);
    });
    return flat;
  }

  window.SG_AUDIO_INDEX = { PACKS: PACKS, groups: groups, all: all, itemsOf: itemsOf, resolve: resolve };
})();
