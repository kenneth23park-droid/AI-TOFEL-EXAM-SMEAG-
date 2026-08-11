/* SMEAG StudyGround — 대본 ↔ 오디오 대조의 공용 규칙.
 *
 * 왜 모듈로 뺐나. 같은 대조를 화면 두 곳이 본다.
 *   admin-audio-sync.html   한 클립을 펼쳐 놓고 단어 단위로 형광 대조한다.
 *   admin-audio-files.html  전 클립을 표로 훑으며 "대본대로 읽혔나"만 판정한다.
 * 토크나이즈·숫자 펴기·LCS 가 두 벌로 갈리면 같은 파일에 두 화면이 다른 점수를 낸다.
 * 임계값도 마찬가지라 여기 한 곳에만 둔다.
 *
 * 판정 근거는 셋이고, 있는 것만 쓴다.
 *   1) ASR 대조   config/audio-check.<set>.json 의 asr(오프라인 받아쓰기)과 단어 대조.
 *   2) 길이 모델  단어 수 ÷ 165wpm 로 예상 길이를 세우고 실측과 비율을 본다.
 *                 대본은 있는데 받아쓰기가 아직 없는 클립도 이걸로 잘림·엉뚱한 파일이 걸린다.
 *   3) 신선도     asrAudioSha256 은 "이 받아쓰기가 어느 파일 기준인가"의 지문이다.
 *                 지금 파일 해시가 다르면 음원이 그 뒤에 바뀐 것 — 대조 결과는 옛 파일 얘기다.
 *
 * 임계값의 정본은 tools/verify_audio.py 의 THRESHOLDS 다. 저쪽을 고치면 여기도 같이 고칠 것.
 * (길이 모델에서 세그먼트 사이 gap 은 여기서 더하지 않는다 — audio-check.json 에 턴 정보가
 *  없다. 400ms × 턴 몇 개는 밴드 폭 안이라 판정을 뒤집지 않는다.)
 *
 * 노출 전역: window.SG_SCRIPT_CHECK
 */
(function () {
  'use strict';

  var TH = {
    wpm: 165,                       // tools/tts_set9.py RATE_WPM
    shortWords: 25,
    durWarnLong: [0.80, 1.30], durFailLong: [0.60, 1.70],
    durWarnShort: [0.70, 1.60], durFailShort: [0.45, 2.50],
    asrOk: 0.97, asrWarn: 0.85     // admin-audio-sync.html 의 band() 와 같은 값
  };

  /* DOM 없이 돌 수 있게 문자열로만 이스케이프한다 — 판정 규칙을 node 테스트
     (tests/test_audio_script_check.js)에서 그대로 돌려 보려고. 결과는 textContent
     방식과 같다. */
  function esc(t) {
    return String(t == null ? '' : t)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ── 숫자 펴기 ───────────────────────────────────────────
     대본은 숫자를 말로 적고("four hundred"), 받아쓰기는 들은 대로 숫자를 쓴다("400").
     같은 소리인데 불일치로 세면, 시각·호실·가격이 몰린 클립 — 즉 가장 정확히 읽혔는지
     확인하고 싶은 클립 — 일수록 점수가 부당하게 낮게 나온다.
     qa/stt_loopback.py 의 _expand_numerals 와 같은 규칙. 규칙이 갈리면 화면과 WER 게이트가
     서로 다른 답을 내므로 반드시 같이 고칠 것. */
  var _ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
    'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
    'seventeen', 'eighteen', 'nineteen'];
  var _TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  var _ORD_KEY = { '1st': 'first', '2nd': 'second', '3rd': 'third', '5th': 'fifth',
    '8th': 'eighth', '9th': 'ninth', '12th': 'twelfth' };
  var _ORD_TAIL = { one: 'first', two: 'second', three: 'third', five: 'fifth',
    eight: 'eighth', nine: 'ninth', twelve: 'twelfth' };

  function intToWords(n) {
    if (n < 20) return [_ONES[n]];
    if (n < 100) return [_TENS[Math.floor(n / 10)]].concat(n % 10 ? [_ONES[n % 10]] : []);
    if (n < 1000) return [_ONES[Math.floor(n / 100)], 'hundred'].concat(n % 100 ? intToWords(n % 100) : []);
    if (n < 1000000) return intToWords(Math.floor(n / 1000)).concat(['thousand'], n % 1000 ? intToWords(n % 1000) : []);
    return [String(n)];
  }
  /** 토큰 하나를 비교용 낱말 배열로. 숫자가 아니면 자기 자신 하나. */
  function expandKey(key) {
    if (_ORD_KEY[key]) return [_ORD_KEY[key]];
    var m = /^(\d+)(st|nd|rd|th)$/.exec(key);
    if (m) {
      var w = intToWords(parseInt(m[1], 10)), last = w[w.length - 1];
      var suffix = _ORD_TAIL[last] || (/y$/.test(last) ? last.slice(0, -1) + 'ieth' : last + 'th');
      return w.slice(0, -1).concat([suffix]);
    }
    if (/^\d{1,6}$/.test(key)) return intToWords(parseInt(key, 10));
    return [key];
  }
  function tokenize(text) {
    var out = [], re = /[A-Za-z0-9']+/g, m;
    while ((m = re.exec(text))) {
      var key = m[0].toLowerCase().replace(/'/g, '');
      out.push({ raw: m[0], at: m.index, keys: expandKey(key) });
    }
    return out;
  }
  /** 대조는 펼친 낱말 단위로 한다. 형광은 원문 토큰 좌표로 칠해야 하므로
   *  낱말마다 원래 토큰 번호(ti)를 달고 다닌다. */
  function toUnits(toks) {
    var u = [];
    toks.forEach(function (t, i) { t.keys.forEach(function (k) { u.push({ key: k, ti: i }); }); });
    return u;
  }
  function lcsPairs(a, b) {
    var n = a.length, m = b.length;
    if (!n || !m) return { pairs: [], same: 0 };
    // 메모리 보호: 아주 긴 텍스트는 앞부분만 맞춘다. 최장 클립(set9-L2-08-11)이
    // 대본 437단어이고 숫자를 펴면 그보다 늘어나므로, 잘림이 실제로 걸리지 않도록
    // 여유를 둔다. dp 는 LIM² × 2바이트라 1600 이면 약 5 MB.
    var LIM = 1600;
    if (n > LIM) { a = a.slice(0, LIM); n = LIM; }
    if (m > LIM) { b = b.slice(0, LIM); m = LIM; }
    var dp = [], i, j;
    for (i = 0; i <= n; i++) dp.push(new Uint16Array(m + 1));
    for (i = n - 1; i >= 0; i--) {
      for (j = m - 1; j >= 0; j--) {
        dp[i][j] = a[i].key === b[j].key ? dp[i + 1][j + 1] + 1
                 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    var pairs = [];
    i = 0; j = 0;
    while (i < n && j < m) {
      if (a[i].key === b[j].key) { pairs.push([i, j]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
      else j++;
    }
    return { pairs: pairs, same: pairs.length };
  }
  /** 원문의 [from,to) 구간을 "형광 처리할 토큰 인덱스 집합"과 함께 HTML 로.
   *  구간을 받는 이유: 문장별 표시와 전체 통계가 같은 한 번의 대조 결과를 쓰게 하려고 —
   *  문장마다 다시 맞추면 같은 단어가 여러 문장에 중복으로 매칭돼 숫자가 어긋난다. */
  function paint(text, toks, badSet, cls, from, to) {
    from = from || 0;
    to = to == null ? text.length : to;
    var out = '', cur = from;
    toks.forEach(function (t, i) {
      if (t.at < from || t.at >= to) return;
      out += esc(text.slice(cur, t.at));
      out += badSet[i] ? '<mark class="' + cls + '">' + esc(t.raw) + '</mark>' : esc(t.raw);
      cur = t.at + t.raw.length;
    });
    return out + esc(text.slice(cur, to));
  }
  /** {text, asr} → 대조 결과. asr 이 없으면 ratio: null(대조 불가, 실패 아님). */
  function compare(item) {
    var st = tokenize(item.text || ''), sa = tokenize(item.asr || '');
    if (!item.asr || !sa.length) {
      return { ratio: null, toks: st, miss: {}, scriptHtml: esc(item.text || ''), asrHtml: '' };
    }
    var us = toUnits(st), ua = toUnits(sa);
    var r = lcsPairs(us, ua);
    // 낱말 단위 매칭을 원래 토큰으로 되접는다. "400"↔"four hundred" 처럼 한 토큰이 여러
    // 낱말로 펴진 경우, 낱말이 전부 맞아야 그 토큰을 맞은 것으로 센다 — 절반만 맞은
    // 숫자를 초록으로 칠하면 화면이 실제보다 관대해진다.
    var hitS = {}, hitA = {};
    r.pairs.forEach(function (p) {
      hitS[us[p[0]].ti] = (hitS[us[p[0]].ti] || 0) + 1;
      hitA[ua[p[1]].ti] = (hitA[ua[p[1]].ti] || 0) + 1;
    });
    var missS = {}, extraA = {}, k;
    for (k = 0; k < st.length; k++) if ((hitS[k] || 0) < st[k].keys.length) missS[k] = 1;
    for (k = 0; k < sa.length; k++) if ((hitA[k] || 0) < sa[k].keys.length) extraA[k] = 1;
    return {
      ratio: (2 * r.same) / (us.length + ua.length),
      missing: Object.keys(missS).length,
      extra: Object.keys(extraA).length,
      toks: st, miss: missS,
      scriptHtml: paint(item.text, st, missS, 'miss'),
      asrHtml: paint(item.asr, sa, extraA, 'extra')
    };
  }

  /* ── 길이 모델 ──────────────────────────────────────────── */
  function wordCount(text) {
    var m = String(text || '').match(/[A-Za-z0-9']+/g);
    return m ? m.length : 0;
  }
  /** 대본 텍스트 → 예상 재생 길이(초). */
  function expectedSeconds(text) { return wordCount(text) / TH.wpm * 60; }
  /** 실측/예상 비율 → 'ok' | 'warn' | 'bad'. 25단어 미만은 문미 한 번의 쉼이 비율을
   *  흔들어서 밴드를 따로 쓴다(verify_audio.py 와 같은 이유·같은 값). */
  function durationBand(words, ratio) {
    if (!isFinite(ratio) || ratio <= 0) return 'none';
    var short = words < TH.shortWords;
    var warn = short ? TH.durWarnShort : TH.durWarnLong;
    var fail = short ? TH.durFailShort : TH.durFailLong;
    if (ratio < fail[0] || ratio > fail[1]) return 'bad';
    if (ratio < warn[0] || ratio > warn[1]) return 'warn';
    return 'ok';
  }
  function asrBand(ratio) {
    if (ratio == null) return 'none';
    if (ratio >= TH.asrOk) return 'ok';
    if (ratio >= TH.asrWarn) return 'warn';
    return 'bad';
  }

  /* ── 대본 인덱스 ────────────────────────────────────────── */
  var BY_PATH = {}, LOADED = {};

  function keyOf(p) { return decodeURI(String(p || '')).replace(/^\.\//, ''); }

  function put(rec) {
    if (!rec || !rec.path) return;
    var k = keyOf(rec.path);
    if (!BY_PATH[k]) BY_PATH[k] = rec;
  }

  /** 한 SET 의 대본·받아쓰기를 불러 경로로 색인한다. 두 번 부르면 캐시를 쓴다. */
  function load(setId) {
    setId = String(setId || '').toLowerCase();
    if (LOADED[setId]) return LOADED[setId];
    var p = (window.fetch ? fetch('config/audio-check.' + setId + '.json')
      .then(function (r) { return r.ok ? r.json() : { items: [] }; })
      .catch(function () { return { items: [] }; })
      : Promise.resolve({ items: [] }))
      .then(function (j) {
        (j.items || []).forEach(function (x) {
          put({ id: x.id, path: x.path, text: x.text || '', asr: x.asr || '',
                sha: x.asrAudioSha256 || '', voices: x.voices || [], source: 'audio-check' });
        });
        // 미리듣기 클립(set9-audio.js)은 대본만 있고 받아쓰기가 없다 — 길이 모델로만 본다.
        var D = window.SMEAG_SET9_AUDIO;
        if (D && setId === 'set9') {
          (D.modules || []).forEach(function (m) {
            (m.items || []).forEach(function (it) {
              put({ id: it.id, path: it.audio, text: it.transcript || '', asr: '',
                    sha: '', voices: it.voices || [], source: 'preview' });
            });
          });
        }
        return BY_PATH;
      });
    LOADED[setId] = p;
    return p;
  }

  /** 경로로 대본 찾기. 없으면 null. */
  function forPath(path) { return BY_PATH[keyOf(path)] || null; }

  /* ── 신선도 해시 ────────────────────────────────────────── */
  /** 파일을 통째로 받아 SHA-256(hex). 안전 컨텍스트(https/localhost)에서만 된다.
   *  file:// 나 http 평문에서는 crypto.subtle 이 없어 null 을 돌려준다 — 실패가 아니라
   *  "확인 못 함"이며, 호출부가 그렇게 표시한다. */
  function sha256(url) {
    var c = window.crypto && window.crypto.subtle;
    if (!c || !window.fetch) return Promise.resolve(null);
    return fetch(url).then(function (r) {
      if (!r.ok) return null;
      return r.arrayBuffer();
    }).then(function (buf) {
      if (!buf) return null;
      return c.digest('SHA-256', buf).then(function (h) {
        return Array.prototype.map.call(new Uint8Array(h), function (b) {
          return ('0' + b.toString(16)).slice(-2);
        }).join('');
      });
    }).catch(function () { return null; });
  }

  /* ── 한 클립 판정 ───────────────────────────────────────── */
  /**
   * check(path, actualSeconds, opts) → Promise<result>
   *   result.verdict  'ok' | 'warn' | 'bad' | 'noscript'
   *   result.ratio    ASR 일치 비율(0~1) 또는 null
   *   result.durRatio 실측/예상 길이 비율 또는 null
   *   result.stale    true = 지금 파일이 받아쓰기 시점의 파일과 다르다
   *   result.notes    화면·CSV 에 그대로 쓰는 사유 문자열 배열
   * opts.url    해시를 잴 실제 주소(오버라이드 반영). 없으면 해시 검사를 건너뛴다.
   * opts.hash   false 면 해시 검사를 하지 않는다(파일 전체를 받지 않는다).
   */
  function check(path, actualSeconds, opts) {
    opts = opts || {};
    var rec = forPath(path);
    if (!rec || !rec.text) {
      return Promise.resolve({ verdict: 'noscript', ratio: null, durRatio: null,
                               stale: false, notes: ['no script on file'], rec: null });
    }
    var cmp = compare(rec);
    var words = wordCount(rec.text);
    var exp = expectedSeconds(rec.text);
    var durRatio = (actualSeconds && exp) ? actualSeconds / exp : null;
    var dBand = durRatio == null ? 'none' : durationBand(words, durRatio);
    var aBand = asrBand(cmp.ratio);

    var wantHash = opts.hash !== false && rec.sha && opts.url;
    return (wantHash ? sha256(opts.url) : Promise.resolve(null)).then(function (hex) {
      var stale = !!(hex && rec.sha && hex !== rec.sha);
      var notes = [];
      if (aBand !== 'none') notes.push(Math.round(cmp.ratio * 100) + '% of words match the ASR');
      else notes.push('no ASR on file — length model only');
      if (durRatio != null) {
        notes.push('plays ' + actualSeconds.toFixed(1) + 's vs ' + exp.toFixed(1) + 's expected (' +
                   words + ' words / ' + TH.wpm + 'wpm, ratio ' + durRatio.toFixed(2) + ')');
      }
      if (stale) notes.push('audio changed since it was transcribed — re-run the ASR');
      else if (wantHash && !hex) notes.push('hash not verifiable here');

      var verdict = 'ok';
      if (aBand === 'bad' || dBand === 'bad') verdict = 'bad';
      else if (aBand === 'warn' || dBand === 'warn' || stale) verdict = 'warn';
      if (aBand === 'none' && dBand === 'none') verdict = 'warn';   // 잴 게 아무것도 없었다

      return { verdict: verdict, ratio: cmp.ratio, durRatio: durRatio, words: words,
               expected: exp, asrBand: aBand, durBand: dBand, stale: stale,
               hash: hex || '', notes: notes, rec: rec, cmp: cmp };
    });
  }

  window.SG_SCRIPT_CHECK = {
    TH: TH, load: load, forPath: forPath, check: check, compare: compare,
    tokenize: tokenize, paint: paint, esc: esc,
    wordCount: wordCount, expectedSeconds: expectedSeconds,
    durationBand: durationBand, asrBand: asrBand, sha256: sha256
  };
})();
