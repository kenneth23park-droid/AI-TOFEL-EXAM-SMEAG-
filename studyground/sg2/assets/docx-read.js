/* SMEAG StudyGround — docx-read.js : .docx 를 문단 스트림으로 푼다.
 *
 * 왜 브라우저에서 푸는가
 *   세트를 만드는 사람은 관리자이지 파이썬 사용자가 아니다. tools/extract_set9_*.py 가
 *   하던 일을 업로드 화면 안으로 옮기려면 파서가 브라우저에서 돌아야 한다.
 *   .docx 는 zip 이고 zip 은 DecompressionStream('deflate-raw') 로 풀린다 —
 *   외부 라이브러리 없이 표준 API 만으로 끝난다(오프라인 모드에서도 동작해야 한다).
 *
 * 같은 파일이 node 에서도 그대로 돈다(node 20+ 에 DecompressionStream 이 있다).
 * tools/import_selftest.mjs 가 이 파일을 그대로 require 해서 SET 9 원본으로 회귀 검사한다.
 *
 * 계약
 *   SG_DOCX.read(arrayBuffer) -> Promise<{
 *     paragraphs: [{ i, style, listed, ilvl, text, images:[url], table, row, cell, box }],
 *     media: { 'image1.png': Uint8Array, ... },     // word/media/*
 *     rels:  { rId4: 'media/image1.png', ... }
 *   }>
 *
 * 문단 하나가 무엇인가에 대한 두 가지 함정을 여기서 처리한다 —
 *   1) w:p 는 중첩된다. 텍스트박스(w:txbxContent) 안에 또 문단이 있다.
 *   2) mc:AlternateContent 는 같은 내용을 mc:Choice / mc:Fallback 두 벌로 싣는다.
 *      Fallback 을 그대로 읽으면 지문이 통째로 두 번 나온다(SET 9 도서관 지문이 그랬다).
 *      여기서는 Fallback 을 통째로 버린다.
 *
 * ES5 문법만 쓴다(빌드 단계 없음). Promise 는 런타임 기능이라 허용.
 */
(function (root, factory) {
  var api = factory();
  root.SG_DOCX = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ---------------------------------------------------------------- zip */

  var SIG_EOCD = 0x06054b50;
  var SIG_CDIR = 0x02014b50;

  function findEocd(view) {
    /* 코멘트가 붙어 있을 수 있어 뒤에서부터 훑는다(최대 64KB + 22B). */
    var max = Math.min(view.byteLength, 65557);
    for (var i = 22; i <= max; i++) {
      var at = view.byteLength - i;
      if (view.getUint32(at, true) === SIG_EOCD) return at;
    }
    return -1;
  }

  function inflateRaw(bytes) {
    /* Node's DecompressionStream currently does not expose deflate-raw on all
       supported runtimes. Keep the browser path dependency-free, but use the
       built-in zlib path for the import regression tests and CLI tools. */
    if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
      try {
        var zlib = require('node:zlib');
        return new Promise(function (resolve, reject) {
          zlib.inflateRaw(Buffer.from(bytes), function (err, out) {
            if (err) reject(err);
            else resolve(new Uint8Array(out));
          });
        });
      } catch (e) { /* use the browser implementation below */ }
    }
    if (typeof DecompressionStream !== 'function') {
      return Promise.reject(new Error('이 브라우저는 DecompressionStream 을 지원하지 않습니다 — 최신 Chrome/Edge/Safari 에서 열어 주세요.'));
    }
    var ds = new DecompressionStream('deflate-raw');
    var writer = ds.writable.getWriter();
    writer.write(bytes);
    writer.close();
    return new Response(ds.readable).arrayBuffer().then(function (buf) {
      return new Uint8Array(buf);
    });
  }

  /** zip 바이트 → { name: Uint8Array }. 필요한 항목만 골라 푼다. */
  function unzip(arrayBuffer, wanted) {
    var bytes = new Uint8Array(arrayBuffer);
    var view = new DataView(arrayBuffer);
    var eocd = findEocd(view);
    if (eocd < 0) return Promise.reject(new Error('zip 구조를 찾지 못했습니다 — .docx 파일이 맞는지 확인해 주세요.'));

    var count = view.getUint16(eocd + 10, true);
    var cdOffset = view.getUint32(eocd + 16, true);
    var utf8 = new TextDecoder('utf-8');

    var jobs = [];
    var p = cdOffset;
    for (var n = 0; n < count; n++) {
      if (view.getUint32(p, true) !== SIG_CDIR) break;
      var method = view.getUint16(p + 10, true);
      var compSize = view.getUint32(p + 20, true);
      var nameLen = view.getUint16(p + 28, true);
      var extraLen = view.getUint16(p + 30, true);
      var commentLen = view.getUint16(p + 32, true);
      var localAt = view.getUint32(p + 42, true);
      var name = utf8.decode(bytes.subarray(p + 46, p + 46 + nameLen));
      p += 46 + nameLen + extraLen + commentLen;

      if (wanted && !wanted(name)) continue;

      /* 로컬 헤더의 이름/extra 길이는 중앙 디렉터리와 다를 수 있다 — 반드시 다시 읽는다. */
      var lNameLen = view.getUint16(localAt + 26, true);
      var lExtraLen = view.getUint16(localAt + 28, true);
      var dataAt = localAt + 30 + lNameLen + lExtraLen;
      var raw = bytes.subarray(dataAt, dataAt + compSize);

      jobs.push({ name: name, method: method, raw: raw });
    }

    var out = {};
    var chain = Promise.resolve();
    jobs.forEach(function (job) {
      chain = chain.then(function () {
        if (job.method === 0) { out[job.name] = job.raw; return; }
        if (job.method !== 8) throw new Error('지원하지 않는 압축 방식입니다 (' + job.name + ')');
        return inflateRaw(job.raw).then(function (u8) { out[job.name] = u8; });
      });
    });
    return chain.then(function () { return out; });
  }

  /* ---------------------------------------------------------------- xml */

  var ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

  function unescapeXml(s) {
    if (s.indexOf('&') < 0) return s;
    return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, function (m, body) {
      if (body.charAt(0) === '#') {
        var code = body.charAt(1) === 'x' || body.charAt(1) === 'X'
          ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
        return isNaN(code) ? m : String.fromCharCode(code);
      }
      return Object.prototype.hasOwnProperty.call(ENTITIES, body) ? ENTITIES[body] : m;
    });
  }

  /** 태그 하나를 { name, attrs, close, selfClose } 로. OOXML 은 CDATA 를 쓰지 않고
   *  속성값의 '>' 는 &gt; 로 이스케이프되므로 이 수준의 토크나이저로 충분하다. */
  function parseTag(src) {
    var close = src.charAt(0) === '/';
    if (close) src = src.slice(1);
    var selfClose = src.charAt(src.length - 1) === '/';
    if (selfClose) src = src.slice(0, -1);
    var sp = src.search(/[\s]/);
    var name = sp < 0 ? src : src.slice(0, sp);
    var attrs = null;
    if (sp > 0) {
      attrs = {};
      var rest = src.slice(sp);
      var re = /([\w:.-]+)\s*=\s*"([^"]*)"/g, m;
      while ((m = re.exec(rest))) attrs[m[1]] = unescapeXml(m[2]);
    }
    return { name: name, attrs: attrs, close: close, selfClose: selfClose };
  }

  /** 태그/텍스트를 순서대로 콜백에 흘린다. */
  function walkXml(xml, onTag, onText) {
    var i = 0, len = xml.length;
    while (i < len) {
      var lt = xml.indexOf('<', i);
      if (lt < 0) { onText(xml.slice(i)); break; }
      if (lt > i) onText(xml.slice(i, lt));
      var gt = xml.indexOf('>', lt + 1);
      if (gt < 0) break;
      var body = xml.slice(lt + 1, gt);
      /* 주석·선언·처리명령은 통째로 건너뛴다. */
      if (body.charAt(0) !== '?' && body.charAt(0) !== '!') onTag(parseTag(body));
      i = gt + 1;
    }
  }

  /* ------------------------------------------------------- 문단 스트림 */

  function newPara(ctx) {
    return {
      i: -1, style: '', listed: false, ilvl: 0, text: '', textRaw: '',
      images: [], table: ctx.tbl > 0, row: ctx.row, cell: ctx.cell, box: ctx.box > 0
    };
  }

  /**
   * word/document.xml → 문단 배열.
   * @param {string} xml
   * @param {Object} rels  rId → 'media/image1.png'
   */
  function paragraphsFrom(xml, rels) {
    var out = [];
    var stack = [];                      /* 열려 있는 w:p (중첩 가능) */
    var ctx = { tbl: 0, row: -1, cell: -1, box: 0 };
    var fallback = 0;                    /* mc:Fallback 안이면 > 0 — 전부 버린다 */
    var inText = false;
    var top = null;

    walkXml(xml, function (t) {
      var n = t.name;

      if (fallback > 0) {
        if (n === 'mc:Fallback') { if (t.close) fallback--; else if (!t.selfClose) fallback++; }
        return;
      }
      if (n === 'mc:Fallback' && !t.close) { if (!t.selfClose) fallback++; return; }

      if (n === 'w:tbl') { if (t.close) { ctx.tbl--; if (ctx.tbl === 0) { ctx.row = -1; ctx.cell = -1; } } else if (!t.selfClose) ctx.tbl++; return; }
      if (n === 'w:tr' && !t.close && !t.selfClose) { ctx.row++; ctx.cell = -1; return; }
      if (n === 'w:tc' && !t.close && !t.selfClose) { ctx.cell++; return; }
      if (n === 'w:txbxContent') { if (t.close) ctx.box--; else if (!t.selfClose) ctx.box++; return; }

      if (n === 'w:p') {
        if (t.selfClose) { var empty = newPara(ctx); empty.i = out.length; out.push(empty); return; }
        if (t.close) {
          var done = stack.pop();
          top = stack.length ? stack[stack.length - 1] : null;
          if (done) {
            done.i = out.length;
            /* textRaw 는 칸을 접기 전의 글. 라이팅 타일 줄('had dropped     two courses')은
               낱말 사이 한 칸과 타일 사이 여러 칸으로만 나뉘어 있어, 접고 나면 어디까지가
               한 타일인지 되살릴 길이 없다. 본문은 지금까지처럼 접은 text 를 쓴다. */
            done.textRaw = done.text.replace(/[ \t]+$/, '').replace(/^[ \t]+/, '');
            done.text = done.text.replace(/[ \t]+/g, ' ').trim();
            out.push(done);
          }
          return;
        }
        top = newPara(ctx);
        stack.push(top);
        return;
      }

      if (!top) return;

      if (n === 'w:pStyle' && t.attrs) { top.style = t.attrs['w:val'] || ''; return; }
      if (n === 'w:numPr' && !t.close) { top.listed = true; return; }
      if (n === 'w:ilvl' && t.attrs) { top.ilvl = parseInt(t.attrs['w:val'], 10) || 0; return; }
      if (n === 'w:tab' || n === 'w:ptab') { top.text += '\t'; return; }
      if (n === 'w:br' || n === 'w:cr') { top.text += '\n'; return; }
      if (n === 'w:t') { inText = !t.close && !t.selfClose; return; }

      if ((n === 'a:blip' || n === 'v:imagedata') && t.attrs) {
        var id = t.attrs['r:embed'] || t.attrs['r:id'] || t.attrs['r:link'];
        if (id && rels[id]) top.images.push(rels[id]);
        return;
      }
    }, function (text) {
      if (fallback > 0 || !inText || !top) return;
      top.text += unescapeXml(text);
    });

    return out;
  }

  function relsFrom(xml) {
    var map = {};
    walkXml(xml, function (t) {
      if (t.name === 'Relationship' && t.attrs && t.attrs.Id && t.attrs.Target) {
        map[t.attrs.Id] = String(t.attrs.Target).replace(/^\.?\//, '');
      }
    }, function () {});
    return map;
  }

  /* ---------------------------------------------------------------- api */

  function read(arrayBuffer) {
    return unzip(arrayBuffer, function (name) {
      return name === 'word/document.xml'
        || name === 'word/_rels/document.xml.rels'
        || name.indexOf('word/media/') === 0;
    }).then(function (files) {
      var doc = files['word/document.xml'];
      if (!doc) throw new Error('word/document.xml 이 없습니다 — .docx 가 아니거나 손상된 파일입니다.');
      var utf8 = new TextDecoder('utf-8');

      var rels = files['word/_rels/document.xml.rels']
        ? relsFrom(utf8.decode(files['word/_rels/document.xml.rels'])) : {};

      var media = {};
      Object.keys(files).forEach(function (name) {
        if (name.indexOf('word/media/') === 0) media[name.slice('word/'.length)] = files[name];
      });

      return {
        paragraphs: paragraphsFrom(utf8.decode(doc), rels),
        media: media,
        rels: rels
      };
    });
  }

  return {
    read: read,
    /* 테스트에서 부분만 쓰고 싶을 때 */
    _unzip: unzip,
    _paragraphsFrom: paragraphsFrom,
    _walkXml: walkXml
  };
});
