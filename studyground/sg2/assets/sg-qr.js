/* SMEAG · StudyGround 2.0 — QR 코드 생성/인식. 의존성 없음, CDN 없음.
 *
 * 왜 직접 짰나: sg2 는 무네트워크 현장에서 돌아야 해서 외부 스크립트를 붙일 수 없다.
 * 필요한 건 "SG2|smeag007|2026-08-10" 같은 30자 안쪽 ASCII 한 줄뿐이라, 바이트 모드
 * 오류정정 M, 버전 1~4 만 지원한다(최대 64바이트). 그 이상은 encode 가 null 을 낸다.
 *
 * 인식은 브라우저 내장 BarcodeDetector 를 쓴다 — 디코더까지 손으로 짜면 수천 줄이고,
 * 어차피 수동 입력이 항상 병행되므로 지원 안 되는 브라우저는 그쪽으로 보낸다.
 *
 * 노출 전역: window.SG_QR
 *   SG_QR.encode(text)            → { size, modules[][] } | null
 *   SG_QR.svg(text, opts)         → '<svg …>' 문자열 (인쇄용, 배경 흰색 고정)
 *   SG_QR.canScan()               → BarcodeDetector 를 쓸 수 있나
 *   SG_QR.scan(video, onFound)    → stop()  카메라를 열고 QR 이 잡히면 onFound(text)
 */
window.SG_QR = (function () {
  'use strict';

  /* ── GF(256) — 리드-솔로몬용 지수/로그 표 ─────────────────── */
  var EXP = new Array(512), LOG = new Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x; LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;          // 원시 다항식 x^8+x^4+x^3+x^2+1
    }
    for (i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();
  function mul(a, b) { return (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]]; }

  /** 생성 다항식 g(x) = ∏ (x - α^i) */
  function genPoly(n) {
    var g = [1], i, j, next;
    for (i = 0; i < n; i++) {
      next = new Array(g.length + 1);
      for (j = 0; j < next.length; j++) next[j] = 0;
      for (j = 0; j < g.length; j++) {
        next[j] ^= g[j];
        next[j + 1] ^= mul(g[j], EXP[i]);
      }
      g = next;
    }
    return g;
  }

  function ecBytes(data, ecLen) {
    var g = genPoly(ecLen), res = data.slice(), i, j, factor;
    for (i = 0; i < ecLen; i++) res.push(0);
    for (i = 0; i < data.length; i++) {
      factor = res[i];
      if (factor === 0) continue;
      for (j = 0; j < g.length; j++) res[i + j] ^= mul(g[j], factor);
    }
    return res.slice(data.length);
  }

  /* ── 버전 표 (오류정정 M 전용) ─────────────────────────────
   * [총 코드워드, 블록 수, 블록당 EC 코드워드]. 데이터 코드워드 = 총 - 블록수*EC. */
  var VER = {
    1: { total: 26,  blocks: 1, ec: 10, align: [] },
    2: { total: 44,  blocks: 1, ec: 16, align: [6, 18] },
    3: { total: 70,  blocks: 1, ec: 26, align: [6, 22] },
    4: { total: 100, blocks: 2, ec: 18, align: [6, 26] }
  };
  function dataCapacity(v) { return VER[v].total - VER[v].blocks * VER[v].ec; }

  /* ── 비트 버퍼 ─────────────────────────────────────────── */
  function BitBuf() { this.bits = []; }
  BitBuf.prototype.put = function (value, len) {
    for (var i = len - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  };
  BitBuf.prototype.bytes = function () {
    var out = [], i;
    for (i = 0; i < this.bits.length; i += 8) {
      var b = 0;
      for (var j = 0; j < 8; j++) b = (b << 1) | (this.bits[i + j] || 0);
      out.push(b);
    }
    return out;
  };

  /** 문자열 → UTF-8 바이트. 아이디/날짜만 담으므로 사실상 ASCII 다. */
  function utf8(text) {
    var out = [], i, c;
    for (i = 0; i < text.length; i++) {
      c = text.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) { out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)); }
      else { out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)); }
    }
    return out;
  }

  function codewords(text, version) {
    var data = utf8(text), cap = dataCapacity(version), buf = new BitBuf(), i;
    if (data.length + 2 > cap) return null;             // 모드 4비트 + 길이 8비트 ≈ 2바이트

    buf.put(4, 4);                                      // 바이트 모드
    buf.put(data.length, 8);                            // 버전 1~9 는 길이 8비트
    for (i = 0; i < data.length; i++) buf.put(data[i], 8);

    var maxBits = cap * 8;
    if (buf.bits.length > maxBits) return null;
    buf.put(0, Math.min(4, maxBits - buf.bits.length));  // 종단자
    while (buf.bits.length % 8) buf.bits.push(0);

    var bytes = buf.bytes(), pad = [0xec, 0x11], k = 0;
    while (bytes.length < cap) bytes.push(pad[k++ % 2]);
    return bytes;
  }

  /** 데이터/EC 블록을 규격대로 교차 배치한다. */
  function interleave(bytes, version) {
    var v = VER[version], per = dataCapacity(version) / v.blocks;
    var dataBlocks = [], ecBlocks = [], i, j;
    for (i = 0; i < v.blocks; i++) {
      var d = bytes.slice(i * per, (i + 1) * per);
      dataBlocks.push(d);
      ecBlocks.push(ecBytes(d, v.ec));
    }
    var out = [];
    for (j = 0; j < per; j++) for (i = 0; i < v.blocks; i++) out.push(dataBlocks[i][j]);
    for (j = 0; j < v.ec; j++) for (i = 0; i < v.blocks; i++) out.push(ecBlocks[i][j]);
    return out;
  }

  /* ── 매트릭스 ──────────────────────────────────────────── */
  function blank(size) {
    var m = [], i, j;
    for (i = 0; i < size; i++) { m[i] = []; for (j = 0; j < size; j++) m[i][j] = null; }
    return m;
  }

  function placeFinder(m, r, c) {
    for (var i = -1; i <= 7; i++) {
      for (var j = -1; j <= 7; j++) {
        var rr = r + i, cc = c + j;
        if (rr < 0 || cc < 0 || rr >= m.length || cc >= m.length) continue;
        var on = (i >= 0 && i <= 6 && (j === 0 || j === 6)) ||
                 (j >= 0 && j <= 6 && (i === 0 || i === 6)) ||
                 (i >= 2 && i <= 4 && j >= 2 && j <= 4);
        m[rr][cc] = on ? 1 : 0;
      }
    }
  }

  function placeAlign(m, version) {
    var pos = VER[version].align, i, j, r, c, dr, dc;
    for (i = 0; i < pos.length; i++) {
      for (j = 0; j < pos.length; j++) {
        r = pos[i]; c = pos[j];
        if (m[r][c] !== null) continue;                  // 파인더와 겹치는 자리는 건너뛴다
        for (dr = -2; dr <= 2; dr++) {
          for (dc = -2; dc <= 2; dc++) {
            var on = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
            m[r + dr][c + dc] = on ? 1 : 0;
          }
        }
      }
    }
  }

  function skeleton(version) {
    var size = 17 + 4 * version, m = blank(size), i;
    placeFinder(m, 0, 0);
    placeFinder(m, 0, size - 7);
    placeFinder(m, size - 7, 0);
    for (i = 8; i < size - 8; i++) {                     // 타이밍 패턴
      var on = (i % 2 === 0) ? 1 : 0;
      if (m[6][i] === null) m[6][i] = on;
      if (m[i][6] === null) m[i][6] = on;
    }
    placeAlign(m, version);
    m[size - 8][8] = 1;                                  // 항상 검은 모듈
    return m;
  }

  /** 포맷 정보가 들어갈 자리 — 데이터를 놓을 때 피해야 한다. */
  function isFormat(size, r, c) {
    return (r === 8 && (c <= 8 || c >= size - 8)) ||
           (c === 8 && (r <= 8 || r >= size - 8));
  }

  function placeData(m, bytes) {
    var size = m.length, bit = 0, total = bytes.length * 8;
    var col = size - 1, row = size - 1, up = true;
    function next() {
      if (bit >= total) return 0;
      var b = (bytes[bit >> 3] >>> (7 - (bit & 7))) & 1;
      bit++;
      return b;
    }
    while (col > 0) {
      if (col === 6) col--;                              // 세로 타이밍 열은 건너뛴다
      for (var n = 0; n < size; n++) {
        row = up ? size - 1 - n : n;
        for (var k = 0; k < 2; k++) {
          var c = col - k;
          if (m[row][c] !== null || isFormat(size, row, c)) continue;
          m[row][c] = next();
        }
      }
      up = !up;
      col -= 2;
    }
  }

  var MASK = [
    function (r, c) { return (r + c) % 2 === 0; },
    function (r) { return r % 2 === 0; },
    function (r, c) { return c % 3 === 0; },
    function (r, c) { return (r + c) % 3 === 0; },
    function (r, c) { return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; },
    function (r, c) { return (r * c) % 2 + (r * c) % 3 === 0; },
    function (r, c) { return ((r * c) % 2 + (r * c) % 3) % 2 === 0; },
    function (r, c) { return ((r + c) % 2 + (r * c) % 3) % 2 === 0; }
  ];

  function penalty(m) {
    var size = m.length, p = 0, r, c, i, run, dark = 0;
    // 규칙 1: 같은 색 5개 이상 연속
    for (r = 0; r < size; r++) {
      run = 1;
      for (c = 1; c < size; c++) {
        if (m[r][c] === m[r][c - 1]) { run++; if (run === 5) p += 3; else if (run > 5) p += 1; }
        else run = 1;
      }
    }
    for (c = 0; c < size; c++) {
      run = 1;
      for (r = 1; r < size; r++) {
        if (m[r][c] === m[r - 1][c]) { run++; if (run === 5) p += 3; else if (run > 5) p += 1; }
        else run = 1;
      }
    }
    // 규칙 2: 2x2 동색 블록
    for (r = 0; r < size - 1; r++) {
      for (c = 0; c < size - 1; c++) {
        var v = m[r][c];
        if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) p += 3;
      }
    }
    // 규칙 3: 1:1:3:1:1 파인더 유사 패턴
    var pat = [1, 0, 1, 1, 1, 0, 1];
    function matches(get, i, len) {
      if (i + 7 > len) return false;
      for (var k = 0; k < 7; k++) if (get(i + k) !== pat[k]) return false;
      return true;
    }
    for (r = 0; r < size; r++) {
      for (c = 0; c < size; c++) {
        if (matches(function (x) { return m[r][x]; }, c, size)) p += 40;
        if (matches(function (x) { return m[x][c]; }, r, size)) p += 40;
      }
    }
    // 규칙 4: 검은 모듈 비율
    for (r = 0; r < size; r++) for (c = 0; c < size; c++) if (m[r][c]) dark++;
    var ratio = dark * 100 / (size * size);
    p += Math.floor(Math.abs(ratio - 50) / 5) * 10;
    return p;
  }

  /** 포맷 정보 15비트 = EC 레벨(M=00) + 마스크 + BCH, 마지막에 0x5412 로 XOR. */
  function formatBits(mask) {
    var data = (0x00 << 3) | mask, rem = data << 10, i;
    for (i = 0; i < 5; i++) if (rem & (1 << (14 - i))) rem ^= 0x537 << (4 - i);
    return ((data << 10) | rem) ^ 0x5412;
  }

  function placeFormat(m, mask) {
    var size = m.length, bits = formatBits(mask), i, b;
    for (i = 0; i < 15; i++) {
      b = (bits >>> i) & 1;
      // 좌상단
      if (i < 6) m[8][i] = b;
      else if (i < 8) m[8][i + 1] = b;
      else if (i === 8) m[7][8] = b;
      else m[14 - i][8] = b;
      // 우상단 / 좌하단 사본
      if (i < 8) m[size - 1 - i][8] = b;
      else m[8][size - 15 + i] = b;
    }
  }

  function copy(m) { return m.map(function (row) { return row.slice(); }); }

  function encode(text) {
    var version, bytes = null, v;
    for (v = 1; v <= 4; v++) {
      bytes = codewords(String(text), v);
      if (bytes) { version = v; break; }
    }
    if (!bytes) return null;                             // 64바이트를 넘겼다

    var fixed = skeleton(version);          // 기능 패턴 지도 — 마스킹에서 제외할 자리
    var base = copy(fixed);
    placeData(base, interleave(bytes, version));

    var best = null, bestScore = Infinity, mask, m, r, c;
    for (mask = 0; mask < 8; mask++) {
      m = copy(base);
      for (r = 0; r < m.length; r++) {
        for (c = 0; c < m.length; c++) {
          if (isFormat(m.length, r, c)) continue;
          if (fixed[r][c] !== null) continue;
          if (MASK[mask](r, c)) m[r][c] ^= 1;
        }
      }
      placeFormat(m, mask);
      var s = penalty(m);
      if (s < bestScore) { bestScore = s; best = m; }
    }
    return { size: best.length, modules: best, version: version };
  }

  /** 인쇄용 SVG. 흰 배경을 반드시 깔아야 어두운 테마에서도 스캔된다. */
  function svg(text, opts) {
    opts = opts || {};
    var q = encode(text);
    if (!q) return '';
    var quiet = opts.quiet == null ? 4 : opts.quiet;
    var box = q.size + quiet * 2;
    var px = opts.size || 160;
    var d = '', r, c;
    for (r = 0; r < q.size; r++) {
      for (c = 0; c < q.size; c++) {
        if (q.modules[r][c]) d += 'M' + (c + quiet) + ' ' + (r + quiet) + 'h1v1h-1z';
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + px + '" height="' + px +
      '" viewBox="0 0 ' + box + ' ' + box + '" shape-rendering="crispEdges" role="img" aria-label="' +
      String(text).replace(/[<>&"]/g, '') + '">' +
      '<rect width="' + box + '" height="' + box + '" fill="#fff"/>' +
      '<path d="' + d + '" fill="#000"/></svg>';
  }

  /* ── 인식 (브라우저 내장) ───────────────────────────────── */

  function canScan() {
    return typeof window.BarcodeDetector === 'function';
  }

  /** 카메라를 열어 QR 을 찾는다. 돌려주는 함수를 부르면 카메라를 끈다. */
  function scan(video, onFound, onError) {
    if (!canScan() || !navigator.mediaDevices) {
      if (onError) onError(new Error('no_scanner'));
      return function () {};
    }
    var detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    var stream = null, timer = null, stopped = false;

    function stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    }

    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      .then(function (s) {
        if (stopped) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
        stream = s;
        video.srcObject = s;
        video.setAttribute('playsinline', '');
        return video.play();
      })
      .then(function () {
        if (stopped) return;
        timer = setInterval(function () {
          detector.detect(video).then(function (codes) {
            if (codes && codes.length) { stop(); onFound(codes[0].rawValue); }
          }).catch(function () { /* 프레임 한 장 실패는 무시한다 */ });
        }, 250);
      })
      .catch(function (e) { stop(); if (onError) onError(e); });

    return stop;
  }

  return { encode: encode, svg: svg, canScan: canScan, scan: scan };
})();
