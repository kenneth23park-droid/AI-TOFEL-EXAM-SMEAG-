/* SMEAG StudyGround — xlsx-read.js : .xlsx 첫 시트를 표(문자열 2차원 배열)로 푼다.
 *
 * 왜 브라우저에서 푸는가
 *   명단은 늘 엑셀로 온다. 관리자에게 "CSV 로 다시 저장하세요" 를 시키지 않으려면
 *   파서가 이 화면 안에 있어야 한다. .xlsx 는 zip 이고 zip 은
 *   DecompressionStream('deflate-raw') 로 풀린다 — 외부 라이브러리 없이 끝난다
 *   (오프라인 시험장에서도 CDN 없이 열려야 한다). docx-read.js 와 같은 수법이다.
 *
 * 계약
 *   SG_XLSX.read(arrayBuffer) -> Promise<string[][]>     // 첫 시트, 빈 칸은 ''
 *
 * 필요한 만큼만 읽는다 — 서식·수식·병합은 보지 않는다. 명단 한 장을 읽는 데
 * 필요한 건 셀의 글자뿐이다. 그래서 다루는 셀 종류도 넷이다:
 *   t="s"          공유 문자열 표(sharedStrings.xml)의 번호
 *   t="inlineStr"  셀 안에 박힌 <is><t>
 *   t="str"        수식 결과 문자열
 *   그 밖         <v> 를 그대로 (숫자·날짜는 저장된 값 그대로 나온다)
 *
 * 빈 칸이 있어도 열이 밀리지 않도록 셀 주소(r="B3")로 열 번호를 되짚는다 —
 * 이름 칸을 비워 둔 줄이 아이디 열을 이름으로 만들어 버리는 일을 막는다.
 *
 * ES5 문법만 쓴다(빌드 단계 없음). Promise 는 런타임 기능이라 허용.
 */
(function (root, factory) {
  var api = factory();
  root.SG_XLSX = api;
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

  /** zip 전체를 { 경로: Uint8Array } 로. wanted(name) 가 false 면 그 항목은 건너뛴다. */
  function unzip(arrayBuffer, wanted) {
    var bytes = new Uint8Array(arrayBuffer);
    var view = new DataView(arrayBuffer);
    var eocd = findEocd(view);
    if (eocd < 0) return Promise.reject(new Error('zip 구조를 찾지 못했습니다 — .xlsx 파일이 맞는지 확인해 주세요.'));

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

  var ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

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

  function parseTag(src) {
    var close = src.charAt(0) === '/';
    if (close) src = src.slice(1);
    var selfClose = src.charAt(src.length - 1) === '/';
    if (selfClose) src = src.slice(0, -1);
    var sp = src.search(/\s/);
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

  function walkXml(xml, onTag, onText) {
    var i = 0, len = xml.length;
    while (i < len) {
      var lt = xml.indexOf('<', i);
      if (lt < 0) { onText(xml.slice(i)); break; }
      if (lt > i) onText(xml.slice(i, lt));
      var gt = xml.indexOf('>', lt + 1);
      if (gt < 0) break;
      var body = xml.slice(lt + 1, gt);
      if (body.charAt(0) !== '?' && body.charAt(0) !== '!') onTag(parseTag(body));
      i = gt + 1;
    }
  }

  /** 네임스페이스 접두사를 뗀다 — x:row 도 row 로 본다. */
  function bare(name) {
    var i = name.indexOf(':');
    return i < 0 ? name : name.slice(i + 1);
  }

  var utf8 = new TextDecoder('utf-8');
  function text(u8) { return u8 ? utf8.decode(u8) : ''; }

  /* ------------------------------------------------------- 공유 문자열 */

  /* sharedStrings 의 한 항목(si)은 서식 때문에 <r><t> 로 여러 조각이 될 수 있다.
     조각을 이어 붙여야 "HUANG PIN JUI" 가 "HUANG"·" PIN JUI" 로 갈라지지 않는다. */
  function sharedStrings(xml) {
    if (!xml) return [];
    var out = [], cur = null, inT = false;
    walkXml(xml, function (t) {
      var n = bare(t.name);
      if (n === 'si') {
        if (t.close) { out.push(cur == null ? '' : cur); cur = null; }
        else { cur = ''; if (t.selfClose) { out.push(''); cur = null; } }
      } else if (n === 't') {
        inT = !t.close && !t.selfClose;
      }
    }, function (s) {
      if (inT && cur !== null) cur += unescapeXml(s);
    });
    return out;
  }

  /* ------------------------------------------------------------ 첫 시트 */

  /** A1 → 0, B1 → 1, AA1 → 26. 주소가 없으면 -1 (그 줄의 다음 칸으로 본다). */
  function colOf(ref) {
    if (!ref) return -1;
    var n = 0, i = 0;
    for (; i < ref.length; i++) {
      var c = ref.charCodeAt(i);
      if (c < 65 || c > 90) break;
      n = n * 26 + (c - 64);
    }
    return i ? n - 1 : -1;
  }

  function sheetRows(xml, strings) {
    var rows = [], row = null, at = 0;
    var cell = null, want = null, buf = '';

    function flush() {
      if (!cell) return;
      var v = buf;
      if (cell.type === 's') {
        var k = parseInt(v, 10);
        v = isNaN(k) ? '' : (strings[k] || '');
      }
      var c = cell.col >= 0 ? cell.col : at;
      while (row.length < c) row.push('');
      row[c] = String(v).trim();
      at = c + 1;
      cell = null; buf = ''; want = null;
    }

    walkXml(xml, function (t) {
      var n = bare(t.name);
      if (n === 'row') {
        if (t.close) { rows.push(row || []); row = null; }
        else { row = []; at = 0; if (t.selfClose) { rows.push(row); row = null; } }
        return;
      }
      if (!row) return;
      if (n === 'c') {
        if (t.close) { flush(); return; }
        var a = t.attrs || {};
        cell = { col: colOf(a.r), type: a.t || '' };
        buf = ''; want = null;
        if (t.selfClose) flush();
        return;
      }
      if (!cell) return;
      /* 값이 실린 자리는 <v> 와 (inlineStr 의) <is><t>. 나머지 태그의 글자는 버린다 —
         특히 <f>(수식)는 읽으면 셀 값 자리에 수식이 들어앉는다. */
      if (n === 'v' || n === 't') want = (!t.close && !t.selfClose) ? n : null;
      else if (n === 'f') want = null;
    }, function (s) {
      if (cell && want) buf += unescapeXml(s);
    });

    if (row) rows.push(row);
    return rows;
  }

  /* 첫 시트가 sheet1.xml 이라는 보장은 없다 — 워크북이 부르는 순서를 따라간다.
     시트를 지웠다 만든 파일은 sheet2.xml 이 첫 장인 일이 흔하다. */
  function firstSheetPath(files) {
    var wb = text(files['xl/workbook.xml']);
    var rid = '';
    walkXml(wb, function (t) {
      if (rid || bare(t.name) !== 'sheet' || t.close) return;
      var a = t.attrs || {};
      rid = a['r:id'] || a.id || '';
    }, function () {});

    if (rid) {
      var rels = text(files['xl/_rels/workbook.xml.rels']);
      var target = '';
      walkXml(rels, function (t) {
        if (target || bare(t.name) !== 'Relationship' || t.close) return;
        var a = t.attrs || {};
        if (a.Id === rid) target = a.Target || '';
      }, function () {});
      if (target) {
        target = target.replace(/^\/xl\//, '').replace(/^\.\//, '');
        var path = target.indexOf('xl/') === 0 ? target : 'xl/' + target;
        if (files[path]) return path;
      }
    }

    var names = Object.keys(files).filter(function (n) {
      return /^xl\/worksheets\/[^/]+\.xml$/.test(n);
    }).sort();
    return names[0] || '';
  }

  function read(arrayBuffer) {
    return unzip(arrayBuffer, function (n) {
      return n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' ||
             n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/[^/]+\.xml$/.test(n);
    }).then(function (files) {
      var path = firstSheetPath(files);
      if (!path) throw new Error('시트를 찾지 못했습니다 — .xlsx 파일이 맞는지 확인해 주세요.');
      var strings = sharedStrings(text(files['xl/sharedStrings.xml']));
      return sheetRows(text(files[path]), strings);
    });
  }

  return { read: read };
});
