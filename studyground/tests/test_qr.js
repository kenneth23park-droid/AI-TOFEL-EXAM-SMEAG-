/* sg2 assets/sg-qr.js 구조 검증.
 *
 * 이 환경에는 참조 QR 구현이 없다(네트워크·zbar·qrencode 모두 없음). 그래서 규격대로
 * "되읽는" 경로를 따로 짜서 왕복시킨다 — 마스크 해제 · 데이터 비트 추출 · 블록 역교차 ·
 * 코드워드 비교. 배치/마스킹/교차 배치의 오류는 여기서 잡힌다.
 * 진짜 디코더(카메라)로 읽히는지는 admin-qr.html 이 브라우저에서 자체 검증한다.
 *
 * 실행: node studyground/tests/test_qr.js
 */
'use strict';

var fs = require('fs');
var path = require('path');

global.window = global;
require(path.join(__dirname, '..', 'sg2', 'assets', 'sg-qr.js'));
var QR = window.SG_QR;

var fails = 0;
function ok(cond, msg) {
  if (!cond) { fails++; console.error('  ✗ ' + msg); } else { console.log('  ✓ ' + msg); }
}

/* 규격 표 — sg-qr.js 와 같은 값이지만 되읽기 경로는 독립적으로 다시 쓴다. */
var VER = {
  1: { total: 26,  blocks: 1, ec: 10, align: [] },
  2: { total: 44,  blocks: 1, ec: 16, align: [6, 18] },
  3: { total: 70,  blocks: 1, ec: 26, align: [6, 22] },
  4: { total: 100, blocks: 2, ec: 18, align: [6, 26] }
};
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

function functionMap(version) {
  var size = 17 + 4 * version, m = [], i, j;
  for (i = 0; i < size; i++) { m[i] = []; for (j = 0; j < size; j++) m[i][j] = false; }
  function block(r, c, h, w) {
    for (var a = 0; a < h; a++) for (var b = 0; b < w; b++) {
      if (r + a >= 0 && c + b >= 0 && r + a < size && c + b < size) m[r + a][c + b] = true;
    }
  }
  block(0, 0, 8, 8); block(0, size - 8, 8, 8); block(size - 8, 0, 8, 8);   // 파인더+분리자
  for (i = 0; i < size; i++) { m[6][i] = true; m[i][6] = true; }           // 타이밍
  var pos = VER[version].align;
  for (i = 0; i < pos.length; i++) for (j = 0; j < pos.length; j++) {
    var r = pos[i], c = pos[j];
    if ((r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8)) continue;
    block(r - 2, c - 2, 5, 5);
  }
  m[size - 8][8] = true;                                                   // 항상 검은 모듈
  for (i = 0; i <= 8; i++) { m[8][i] = true; m[i][8] = true; }             // 포맷 영역
  for (i = 0; i < 8; i++) { m[8][size - 1 - i] = true; m[size - 1 - i][8] = true; }
  return m;
}

/** 포맷 정보에서 마스크 번호를 되읽는다(좌상단 사본). */
function readMask(m) {
  var bits = 0, i;
  for (i = 0; i < 15; i++) {
    var b;
    if (i < 6) b = m[8][i];
    else if (i < 8) b = m[8][i + 1];
    else if (i === 8) b = m[7][8];
    else b = m[14 - i][8];
    bits |= (b << i);
  }
  bits ^= 0x5412;
  return (bits >>> 10) & 0x07;
}

function readCodewords(q) {
  var size = q.size, m = q.modules, version = q.version;
  var fixed = functionMap(version), mask = readMask(m);
  var bits = [], col = size - 1, up = true, n, k, row, c;

  while (col > 0) {
    if (col === 6) col--;
    for (n = 0; n < size; n++) {
      row = up ? size - 1 - n : n;
      for (k = 0; k < 2; k++) {
        c = col - k;
        if (fixed[row][c]) continue;
        var v = m[row][c];
        if (MASK[mask](row, c)) v ^= 1;
        bits.push(v);
      }
    }
    up = !up;
    col -= 2;
  }

  var out = [], i, j;
  for (i = 0; i + 8 <= bits.length; i += 8) {
    var b = 0;
    for (j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    out.push(b);
  }
  return out.slice(0, VER[version].total);
}

/** 교차 배치를 풀어 데이터 코드워드만 원래 순서로 되돌린다. */
function deinterleave(words, version) {
  var v = VER[version], dataLen = v.total - v.blocks * v.ec, per = dataLen / v.blocks;
  var blocks = [], i, j;
  for (i = 0; i < v.blocks; i++) blocks.push([]);
  var idx = 0;
  for (j = 0; j < per; j++) for (i = 0; i < v.blocks; i++) blocks[i].push(words[idx++]);
  var out = [];
  for (i = 0; i < v.blocks; i++) out = out.concat(blocks[i]);
  return out;
}

function decodePayload(q) {
  var data = deinterleave(readCodewords(q), q.version);
  // 모드 4비트 + 길이 8비트 + 본문
  var mode = data[0] >> 4;
  var len = ((data[0] & 0x0f) << 4) | (data[1] >> 4);
  var bytes = [], i;
  for (i = 0; i < len; i++) {
    bytes.push(((data[1 + i] & 0x0f) << 4) | (data[2 + i] >> 4));
  }
  return { mode: mode, text: Buffer.from(bytes).toString('utf8') };
}

console.log('sg-qr: 인코딩 → 규격 되읽기 왕복');
[
  'SG2|smeag007|2026-08-10',
  'SG2|smeag000|2026-08-10',
  'SG2|smeag999|2026-12-31',
  'A',
  'SG2|smeag123|2026-08-10|0123456789'
].forEach(function (text) {
  var q = QR.encode(text);
  ok(!!q, 'encode: ' + text);
  if (!q) return;
  var got = decodePayload(q);
  ok(got.mode === 4, '  바이트 모드(4) — 받은 값 ' + got.mode);
  ok(got.text === text, '  왕복 일치: ' + JSON.stringify(got.text));
  ok(q.size === 17 + 4 * q.version, '  크기 = 17+4*v (' + q.size + ', v' + q.version + ')');
});

console.log('sg-qr: 경계');
ok(QR.encode(new Array(80).join('x')) === null, '64바이트 초과는 null');
ok(QR.svg('SG2|smeag007|2026-08-10').indexOf('<svg') === 0, 'svg() 가 SVG 를 낸다');
ok(QR.svg('SG2|smeag007|2026-08-10').indexOf('fill="#fff"') > 0, '흰 배경을 깐다');

console.log(fails ? '\n실패 ' + fails + '건' : '\n전부 통과');
process.exit(fails ? 1 : 0);
