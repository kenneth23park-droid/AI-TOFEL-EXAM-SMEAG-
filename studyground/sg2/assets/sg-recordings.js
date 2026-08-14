/* SMEAG · StudyGround 2.0 — 스피킹 녹음의 회수. 의존성 없음, CDN 없음.
 *
 * 왜 이 파일이 따로 있는가.
 *
 * 스피킹은 채점되기 전에 관문을 하나 더 지난다. 채점 서버는 음성을 볼 수 없어서,
 * 비공개 버킷 toefl-recordings 의 {owner}/{session}/{qid}.{ext} 를 내려받아 전사한
 * 뒤에야 점수를 매긴다(api/score.js speechOf). 그 자리에 파일이 없으면 0 점이 아니라
 * 'no_transcript' 로 건너뛴다 — 채점을 몇 번 다시 걸어도 결과는 같다.
 *
 * 그 관문이 두 번 무너졌다.
 *   · 2026-08-12 시험: 녹음 61건이 전부 400(InvalidMimeType)으로 거절당했다.
 *     화면은 "계정에 저장되었습니다" 만 말했고, 원본은 그 PC 안에만 남았다.
 *   · 2026-08-14 응시: 버킷은 0개인데 응시 기기에는 11개가 그대로 있었다.
 *     올리는 일이 제출 화면과 대시보드에서만 돌아서, 성적 화면을 여는 선생님 쪽에서는
 *     아무 일도 일어나지 않았다.
 *
 * 그래서 이 모듈은 두 가지를 고집한다.
 *
 *   1. 먼저 손에 쥔다. 업로드가 되든 안 되든 녹음은 항상 파일 한 장으로 내려받는다
 *      (학생 1명 = 파일 1장). 회선·정책·로그인 어느 하나만 어긋나도 업로드는 멈추는데,
 *      그 사이 그 PC 를 떠나거나 캐시를 지우면 원본이 사라진다. 손에 쥐는 일이 먼저다.
 *
 *   2. "올렸다" 는 표를 믿지 않는다. sg-results.js 는 localStorage 의 표를 보고 이미
 *      올린 문항을 건너뛰는데, 그 표가 실제 버킷과 어긋나면 영영 다시 올리지 않는다.
 *      여기서는 버킷의 실제 목록을 물어보고 없는 것만 올린다.
 *
 * 노출 전역: window.SG_REC
 *   SG_REC.scan(session)         → Promise<[{key,session,qid,blob,mime,size}]>  이 기기의 녹음
 *   SG_REC.zipOf(files, meta)    → Promise<Blob>  무압축 ZIP 한 장(manifest.json 포함)
 *   SG_REC.saveLocal(files,meta) → Promise<{name,bytes}>  그 한 장을 내려받는다
 *   SG_REC.remote(session,owner) → Promise<[이름]>  버킷에 실제로 있는 파일
 *   SG_REC.ensure(row, opts)     → Promise<{found,saved,zipSaved,uploaded,already,failed,error}>
 *                                  스캔 → 한 장으로 묶어 로컬+Supabase 두 곳에 저장
 *                                  → 버킷 대조 → 아직 없는 녹음만 개별 업로드
 *
 * 파일 한 장의 이름은 아이디_이름_응시날짜_세션뒷자리.zip 이다 — 며칠 뒤 그 파일을
 * 집어 드는 사람이 아는 것은 누가 언제 친 시험인가뿐이기 때문이다.
 */
window.SG_REC = (function () {
  'use strict';

  var MEDIA_DB = 'sg2-media', MEDIA_STORE = 'recordings';
  var BUCKET = 'toefl-recordings';

  /* MediaRecorder 는 'audio/webm;codecs=opus' 를 내놓지만 버킷의 allowed_mime_types 는
     파라미터 없는 이름만 안다. 코덱을 붙인 채 보내면 400(InvalidMimeType)이다 —
     2026-08-12 의 61건이 전부 이것이었다. */
  function baseMime(m) {
    var s = String(m || '').split(';')[0].trim().toLowerCase();
    return s || 'audio/webm';
  }
  function extOf(mime) {
    var m = String(mime || '').toLowerCase();
    if (m.indexOf('webm') >= 0) return 'webm';
    if (m.indexOf('ogg') >= 0) return 'ogg';
    if (m.indexOf('mp4') >= 0 || m.indexOf('m4a') >= 0) return 'm4a';
    if (m.indexOf('mpeg') >= 0) return 'mp3';
    if (m.indexOf('wav') >= 0) return 'wav';
    return 'webm';
  }

  /* ── 1. 이 기기 뒤지기 ───────────────────────────────────────
   * 키는 '{session}/{questionId}' 다(assets/exam-store.js mediaKey).
   * 값은 {questionKey, blob, mime, …} 이고, 아주 옛 기록은 Blob 자체다.
   * SG_STORE 를 거치지 않고 직접 읽는다 — 스토어를 다른 세션으로 여는 부작용 없이,
   * 진행 중인 시험 옆에서도 안전하게 돌기 위해서다. */
  function scan(session) {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error('IndexedDB is not available in this browser.')); return; }
      var req;
      try { req = indexedDB.open(MEDIA_DB, 1); } catch (e) { reject(e); return; }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(MEDIA_STORE)) db.createObjectStore(MEDIA_STORE);
      };
      req.onerror = function () { reject(req.error || new Error('Could not open the recording store.')); };
      req.onsuccess = function () {
        var db = req.result, st;
        if (!db.objectStoreNames.contains(MEDIA_STORE)) { db.close(); resolve([]); return; }
        try { st = db.transaction(MEDIA_STORE, 'readonly').objectStore(MEDIA_STORE); }
        catch (e) { db.close(); reject(e); return; }
        var kq = st.getAllKeys(), vq = st.getAll();
        var keys = null, vals = null;
        function done() {
          if (!keys || !vals) return;
          var out = [], i;
          for (i = 0; i < keys.length; i++) {
            var k = String(keys[i]);
            var cut = k.lastIndexOf('/');
            var rec = vals[i];
            var blob = rec && rec.blob ? rec.blob : rec;
            if (!blob || typeof blob.size !== 'number' || !blob.size) continue;
            var s = cut > 0 ? k.slice(0, cut) : '';
            if (session && s !== session) continue;
            out.push({
              key: k, session: s, qid: cut > 0 ? k.slice(cut + 1) : k,
              blob: blob, mime: baseMime((rec && rec.mime) || blob.type), size: blob.size
            });
          }
          out.sort(function (a, b) { return a.qid < b.qid ? -1 : 1; });
          db.close();
          resolve(out);
        }
        kq.onsuccess = function () { keys = kq.result || []; done(); };
        vq.onsuccess = function () { vals = vq.result || []; done(); };
        kq.onerror = vq.onerror = function () { db.close(); reject(new Error('Could not read the recording store.')); };
      };
    });
  }

  /* ── 2. 한 장으로 묶기 (무압축 ZIP) ──────────────────────────
   *
   * 학생 한 명이 파일 한 장이어야 한다 — 녹음 열한 개가 낱장으로 흩어지면 며칠 뒤
   * 어느 응시의 것인지 아무도 모른다. 압축은 하지 않는다(store): webm/opus 는 이미
   * 압축된 소리라 줄지 않고, 무압축이면 인코더가 백 줄이면 끝나 CDN 을 붙일 이유가 없다.
   * 같이 넣는 manifest.json 이 어느 세션의 몇 번인지, 언제 떴는지를 적어 둔다. */
  var CRC = (function () {
    var t = new Int32Array(256), i, j, c;
    for (i = 0; i < 256; i++) {
      c = i;
      for (j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c;
    }
    return t;
  })();
  function crc32(bytes) {
    var c = -1, i;
    for (i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  }

  function bytesOf(blob) {
    if (blob.arrayBuffer) return blob.arrayBuffer().then(function (b) { return new Uint8Array(b); });
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(new Uint8Array(fr.result)); };
      fr.onerror = function () { rej(fr.error || new Error('read failed')); };
      fr.readAsArrayBuffer(blob);
    });
  }

  /* MS-DOS 시각 — ZIP 의 날짜 칸은 1980 년 기준의 2초 단위다. */
  function dosTime(d) {
    return { t: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() / 2)) & 0xFFFF,
             d: (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF };
  }

  function zipOf(files, meta) {
    var when = dosTime(new Date());
    var manifest = {
      saved_at: new Date().toISOString(),
      session: (meta && meta.session) || '', set_code: (meta && meta.setCode) || '',
      student: (meta && meta.student) || '', student_id: (meta && meta.studentId) || '',
      files: []
    };

    var entries = files.map(function (f) {
      return { name: f.qid + '.' + extOf(f.mime), blob: f.blob, mime: f.mime, size: f.size };
    });

    return Promise.all(entries.map(function (e) { return bytesOf(e.blob); }))
      .then(function (bufs) {
        entries.forEach(function (e, i) {
          manifest.files.push({ file: e.name, question_id: files[i].qid,
                                mime: e.mime, bytes: e.size });
        });
        var mBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
        var all = entries.map(function (e, i) { return { name: e.name, data: bufs[i] }; });
        all.push({ name: 'manifest.json', data: mBytes });

        var chunks = [], central = [], offset = 0;
        all.forEach(function (e) {
          var name = new TextEncoder().encode(e.name);
          var sum = crc32(e.data), n = e.data.length;

          var lh = new DataView(new ArrayBuffer(30));
          lh.setUint32(0, 0x04034b50, true);       // local file header
          lh.setUint16(4, 20, true);               // version needed
          lh.setUint16(6, 0x0800, true);           // UTF-8 이름
          lh.setUint16(8, 0, true);                // 0 = store(무압축)
          lh.setUint16(10, when.t, true); lh.setUint16(12, when.d, true);
          lh.setUint32(14, sum, true);
          lh.setUint32(18, n, true); lh.setUint32(22, n, true);
          lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
          chunks.push(new Uint8Array(lh.buffer), name, e.data);

          var ch = new DataView(new ArrayBuffer(46));
          ch.setUint32(0, 0x02014b50, true);       // central directory
          ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
          ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
          ch.setUint16(12, when.t, true); ch.setUint16(14, when.d, true);
          ch.setUint32(16, sum, true);
          ch.setUint32(20, n, true); ch.setUint32(24, n, true);
          ch.setUint16(28, name.length, true);
          ch.setUint16(30, 0, true); ch.setUint16(32, 0, true);
          ch.setUint16(34, 0, true); ch.setUint16(36, 0, true);
          ch.setUint32(38, 0, true); ch.setUint32(42, offset, true);
          central.push(new Uint8Array(ch.buffer), name);

          offset += 30 + name.length + n;
        });

        var cSize = central.reduce(function (n, c) { return n + c.length; }, 0);
        var end = new DataView(new ArrayBuffer(22));
        end.setUint32(0, 0x06054b50, true);
        end.setUint16(8, all.length, true); end.setUint16(10, all.length, true);
        end.setUint32(12, cSize, true); end.setUint32(16, offset, true);

        return new Blob(chunks.concat(central, [new Uint8Array(end.buffer)]),
                        { type: 'application/zip' });
      });
  }

  /* 파일 이름 = 아이디 · 학생이름 · 응시 날짜.
   *
   * 며칠 뒤 Downloads 폴더에서 이 한 장을 집어 드는 사람은 세션 uuid 를 모른다.
   * 아는 것은 누가 언제 친 시험인가뿐이라, 이름이 그 세 가지를 말해야 한다.
   * 같은 학생이 같은 날 두 번 쳤으면 이름이 겹치므로 세션 뒷자리를 덧붙인다 —
   * 겹치는 이름은 브라우저가 "(1)" 을 붙여 두 장 중 어느 것이 어느 회차인지 잃는다.
   * 파일 이름에 못 쓰는 글자만 -로 바꾼다(한글 이름은 그대로 둔다). */
  function safe(s) {
    return String(s || '').trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ');
  }
  function zipName(meta) {
    var m = meta || {};
    var day = String(m.examDate || m.submittedAt || new Date().toISOString()).slice(0, 10);
    var tail = String(m.session || '').slice(-6);
    return [safe(m.studentId) || 'student', safe(m.student) || 'unnamed', day, tail]
      .filter(Boolean).join('_') + '.zip';
  }

  function saveLocal(files, meta) {
    if (!files || !files.length) return Promise.resolve(null);
    return zipOf(files, meta).then(function (blob) {
      return dropFile(blob, zipName(meta));
    });
  }

  function dropFile(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {} }, 8000);
    return { name: name, bytes: blob.size };
  }

  /* 같은 한 장을 Supabase 에도 올린다 — 두 곳(로컬 파일 + 클라우드)에 남긴다는 규칙.
   *
   * 자리는 개별 녹음과 같은 {uid}/{session}/ 이다. 채점이 이걸 음성으로 착각할 걱정은
   * 없다: 서버는 파일 이름에서 확장자를 뗀 값이 문항 id 와 **정확히 같은** 것만 고른다
   * (api/score.js pickRecording). 'smeag007_PAI JUN YUAN_2026-08-14_bcfec6.zip' 은
   * 어떤 문항 id 와도 같지 않다. */
  function uploadZip(blob, meta, uid, tok) {
    var name = zipName(meta);
    var path = [uid, meta.session, name].map(encodeURIComponent).join('/');
    return fetch(SG_AUTH.url + '/storage/v1/object/' + BUCKET + '/' + path, {
      method: 'POST',
      headers: {
        apikey: SG_AUTH.anonKey, Authorization: 'Bearer ' + tok,
        'Content-Type': 'application/zip', 'x-upsert': 'true'
      },
      body: blob
    }).then(function (r) {
      if (r.ok) return { name: name, bytes: blob.size };
      return r.text()['catch'](function () { return ''; }).then(function (t) {
        throw new Error('HTTP ' + r.status + ' ' + t);
      });
    });
  }

  /* 이 응시의 ZIP 을 이 기기에서 이미 한 번 내려받았는가. 화면이 스스로 거는
     자리에서만 본다 — 사람이 버튼을 누른 자리는 이 표를 지나친다. */
  var SAVED_KEY = 'sg2_rec_saved_v1';
  function savedList() {
    try { return JSON.parse(localStorage.getItem(SAVED_KEY) || '[]') || []; } catch (e) { return []; }
  }
  function wasSaved(session) { return savedList().indexOf(session) >= 0; }
  function markSaved(session) {
    var l = savedList();
    if (l.indexOf(session) < 0) l.push(session);
    try { localStorage.setItem(SAVED_KEY, JSON.stringify(l.slice(-200))); } catch (e) {}
  }

  /* ── 3. 버킷에 실제로 무엇이 있는가 ──────────────────────────
   * localStorage 의 "올렸다" 표가 아니라 서버에 묻는다. 표가 어긋난 자리에서
   * 그 표를 믿으면 영영 다시 올리지 않는다 — 이번 응시가 정확히 그 자리였다. */
  function remote(session, owner) {
    if (!window.SG_AUTH) return Promise.resolve([]);
    return SG_AUTH.token().then(function (tok) {
      if (!tok) return [];
      var uid = owner || (SG_AUTH.user() && SG_AUTH.user().id);
      if (!uid) return [];
      return fetch(SG_AUTH.url + '/storage/v1/object/list/' + BUCKET, {
        method: 'POST',
        headers: {
          apikey: SG_AUTH.anonKey, Authorization: 'Bearer ' + tok,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ prefix: uid + '/' + session, limit: 500 })
      }).then(function (r) { return r.ok ? r.json() : []; })
        .then(function (rows) {
          return (rows || []).map(function (f) { return f && f.name; }).filter(Boolean);
        });
    })['catch'](function () { return []; });
  }

  /* ── 4. 셋을 묶는다 ──────────────────────────────────────────
   *
   * 순서가 뜻을 가진다. 손에 쥐는 일(saveLocal)이 먼저고, 그다음이 서버다.
   * 업로드가 통째로 실패해도 파일 한 장은 이미 내려받혀 있다.
   *
   * @param row       응시 행 { session, owner?, set_code?, submitted_at? }
   * @param opts.owner       staff 가 남의 응시를 회수할 때(버킷 경로의 첫 칸)
   * @param opts.save        false 면 로컬 저장을 건너뛴다(기본은 항상 저장)
   *                         'once' 면 이 응시를 아직 저장한 적 없을 때만 저장한다 —
   *                         화면이 스스로 거는 자리에서 쓴다. 성적 화면을 열 때마다
   *                         같은 ZIP 이 쏟아지면 아무도 그 폴더를 읽지 않게 된다.
   *                         사람이 버튼을 누른 자리에서는 늘 저장한다(파일을 잃었을 때
   *                         다시 받는 길이 그것뿐이다).
   * @param opts.student     파일 이름에 적을 학생 이름
   * @param opts.studentId   파일 이름에 적을 학번
   * @param opts.onProgress  (done, total)
   */
  function ensure(row, opts) {
    opts = opts || {};
    var out = { found: 0, saved: null, uploaded: 0, already: 0, failed: 0, error: '' };
    if (!row || !row.session || !window.SG_AUTH) return Promise.resolve(out);

    var uid = opts.owner || row.owner || (SG_AUTH.user() && SG_AUTH.user().id);
    if (!uid) { out.error = 'no owner'; return Promise.resolve(out); }

    return scan(row.session).then(function (files) {
      out.found = files.length;
      if (!files.length) return out;

      var meta = {
        session: row.session, setCode: row.set_code, submittedAt: row.submitted_at,
        examDate: opts.examDate || row.submitted_at,
        student: opts.student || '', studentId: opts.studentId || ''
      };

      /* 한 장으로 묶는 일은 한 번만 한다 — 로컬로 내려받는 것과 클라우드로 올리는 것이
         같은 한 장이어야 나중에 둘을 견줄 수 있다. 저장이 실패해도 업로드는 막지 않는다:
         둘은 서로의 보험이지 전제가 아니다. */
      var dropIt = opts.save !== false && !(opts.save === 'once' && wasSaved(row.session));
      var packing = opts.save === false
        ? Promise.resolve(null)
        : zipOf(files, meta)['catch'](function () { return null; });

      return packing.then(function (zip) {
        out.zip = zip;
        if (zip && dropIt) {
          try { out.saved = dropFile(zip, zipName(meta)); markSaved(row.session); } catch (e) {}
        }
        return Promise.all([remote(row.session, uid), SG_AUTH.token()]);
      }).then(function (a) {
        var have = a[0] || [], tok = a[1];
        if (!tok) { out.error = 'not signed in'; out.failed = files.length; return out; }

        /* 묶음 한 장도 클라우드에 올린다 — 로컬 파일과 Supabase 두 곳에 남긴다는 규칙.
           실패해도 개별 녹음 업로드는 그대로 간다(채점에 필요한 것은 개별 파일이다). */
        var zipUp = out.zip
          ? uploadZip(out.zip, meta, uid, tok).then(function (z) { out.zipSaved = z; },
              function (e) { out.zipError = String((e && e.message) || e).slice(0, 200); })
          : Promise.resolve();

        var todo = files.filter(function (f) {
          return have.indexOf(f.qid + '.' + extOf(f.mime)) < 0;
        });
        out.already = files.length - todo.length;
        if (!todo.length) return zipUp.then(function () { return out; });

        var i = 0;
        function one() {
          if (i >= todo.length) return Promise.resolve(out);
          var f = todo[i++];
          var path = [uid, row.session, f.qid + '.' + extOf(f.mime)]
            .map(encodeURIComponent).join('/');
          return fetch(SG_AUTH.url + '/storage/v1/object/' + BUCKET + '/' + path, {
            method: 'POST',
            headers: {
              apikey: SG_AUTH.anonKey, Authorization: 'Bearer ' + tok,
              'Content-Type': f.mime, 'x-upsert': 'true'
            },
            body: f.blob
          }).then(function (r) {
            if (r.ok) { out.uploaded += 1; return null; }
            out.failed += 1;
            return r.text()['catch'](function () { return ''; }).then(function (t) {
              if (!out.error) out.error = ('HTTP ' + r.status + ' ' + t).slice(0, 200);
            });
          })['catch'](function (e) {
            out.failed += 1;
            if (!out.error) out.error = String((e && e.message) || e).slice(0, 200);
          }).then(function () {
            if (typeof opts.onProgress === 'function') {
              try { opts.onProgress(i, todo.length); } catch (e) {}
            }
            return one();     // 하나씩 — 시험장 회선을 막지 않는다
          });
        }
        return one().then(function () { return zipUp; }).then(function () { return out; });
      });
    })['catch'](function (e) {
      out.error = String((e && e.message) || e);
      return out;
    });
  }

  return { scan: scan, zipOf: zipOf, saveLocal: saveLocal, remote: remote, ensure: ensure,
           extOf: extOf, baseMime: baseMime };
})();
