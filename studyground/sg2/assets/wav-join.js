/* SMEAG StudyGround — wav-join.js : WAV 토막 여럿을 한 파일로 잇는다.
 *
 * 왜 필요한가 — mp3 는 토막을 그냥 이어 붙여도 재생된다. WAV 는 아니다. 파일 앞머리에
 * 길이가 적힌 머리표(RIFF)가 있어서, 두 파일을 그대로 붙이면 재생기는 첫 토막만 듣고
 * 멈춘다. Qwen(DashScope)이 WAV 로 내주기 때문에 이 자리가 생겼다.
 *
 * 서버(api/tts.js)와 화면(admin-set-import.html)이 **같은 코드**를 쓴다. 한쪽에만
 * 두면 서버에서 이은 것과 화면에서 이은 것이 다른 파일이 되는 날이 온다.
 *
 * 하는 일은 하나다: 머리표는 첫 토막 것을 쓰고, data 덩어리만 모아 붙인 뒤 길이를
 * 다시 적는다. 형식(채널·샘플레이트·비트)이 서로 다르면 잇지 않고 던진다 — 소리가
 * 반만 빨라지거나 잡음이 되는 것보다 낫다.
 *
 * ES5 문법만 쓴다(빌드 단계 없음). tts-plan.js 와 같은 UMD 껍데기.
 */
(function (root, factory) {
  var api = factory();
  root.SG_WAV = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function u8(b) {
    if (b instanceof Uint8Array) return b;
    if (typeof ArrayBuffer !== 'undefined' && b instanceof ArrayBuffer) return new Uint8Array(b);
    if (b && b.buffer) return new Uint8Array(b.buffer, b.byteOffset || 0, b.byteLength);
    return new Uint8Array(b || 0);
  }
  function tag(a, at) {
    return String.fromCharCode(a[at], a[at + 1], a[at + 2], a[at + 3]);
  }
  function u32(a, at) {
    return (a[at] | (a[at + 1] << 8) | (a[at + 2] << 16)) + a[at + 3] * 16777216;
  }
  function put32(a, at, v) {
    a[at] = v & 255; a[at + 1] = (v >>> 8) & 255; a[at + 2] = (v >>> 16) & 255; a[at + 3] = (v >>> 24) & 255;
  }
  function putTag(a, at, s) { for (var i = 0; i < 4; i++) a[at + i] = s.charCodeAt(i); }

  function isWav(buf) {
    var a = u8(buf);
    return a.length > 12 && tag(a, 0) === 'RIFF' && tag(a, 8) === 'WAVE';
  }

  /** WAV 하나 → { fmt, data }. 머리표가 아닌 덩어리(LIST 등)는 버린다. */
  function parse(buf) {
    var a = u8(buf);
    if (!isWav(a)) throw new Error('WAV 가 아니다');
    var at = 12, fmt = null, data = null;
    while (at + 8 <= a.length) {
      var id = tag(a, at), size = u32(a, at + 4), body = at + 8;
      if (size < 0 || body + size > a.length) size = a.length - body;   // 길이가 틀린 파일도 산다
      if (id === 'fmt ') fmt = a.subarray(body, body + size);
      else if (id === 'data') data = a.subarray(body, body + size);
      at = body + size + (size % 2);                                    // 덩어리는 짝수로 정렬된다
      if (fmt && data) break;
    }
    if (!fmt || !data) throw new Error('WAV 에 fmt/data 덩어리가 없다');
    return { fmt: fmt, data: data };
  }

  function sameFmt(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  /** WAV 여럿 → WAV 하나(Uint8Array). 하나뿐이면 그대로 돌려준다. */
  function join(list) {
    var bufs = (list || []).map(u8).filter(function (b) { return b.length; });
    if (!bufs.length) throw new Error('이을 것이 없다');
    if (bufs.length === 1) return bufs[0];

    var parts = bufs.map(parse);
    var fmt = parts[0].fmt, total = 0, i;
    for (i = 0; i < parts.length; i++) {
      if (!sameFmt(fmt, parts[i].fmt)) throw new Error('WAV 형식이 서로 다르다 — 잇지 않는다');
      total += parts[i].data.length;
    }

    var fmtLen = fmt.length + (fmt.length % 2);
    var out = new Uint8Array(12 + 8 + fmtLen + 8 + total);
    putTag(out, 0, 'RIFF'); put32(out, 4, out.length - 8); putTag(out, 8, 'WAVE');
    putTag(out, 12, 'fmt '); put32(out, 16, fmt.length);
    out.set(fmt, 20);
    var at = 20 + fmtLen;
    putTag(out, at, 'data'); put32(out, at + 4, total);
    at += 8;
    for (i = 0; i < parts.length; i++) { out.set(parts[i].data, at); at += parts[i].data.length; }
    return out;
  }

  /** mime 을 보고 알아서 — WAV 면 제대로 잇고, 아니면(mp3) 그냥 붙인다. */
  function joinAuto(list, mime) {
    var bufs = (list || []).map(u8);
    if (/wav|x-wav|wave/i.test(String(mime || '')) || (bufs.length && isWav(bufs[0]))) return join(bufs);
    var total = 0, i;
    for (i = 0; i < bufs.length; i++) total += bufs[i].length;
    var out = new Uint8Array(total), at = 0;
    for (i = 0; i < bufs.length; i++) { out.set(bufs[i], at); at += bufs[i].length; }
    return out;
  }

  return { join: join, joinAuto: joinAuto, isWav: isWav, parse: parse };
});
