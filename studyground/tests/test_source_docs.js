/* 세트 번호 → 원본 docx 세 장 — sg2/tools/source_docs.mjs 의 검산.
 * 실행: node studyground/tests/test_source_docs.js
 *
 * 원본 문서의 이름은 세트마다 다르게 온다. 도구가 이름을 한 벌만 알고 있으면 다음 세트에서
 * "원본을 찾지 못했습니다" 로 멈춘다 — build_voices_manifest.mjs 가 SET 10 의 이름만 알아
 * SET 11·12 의 음성을 만들지 못한 채로 있었다. 지금까지 실제로 온 이름 네 벌을 그대로
 * 고정해 둔다. 새로운 이름이 오면 여기에 한 줄 보태고 규칙을 고친다.
 */

'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');

var fails = [];
function ok(name, cond, extra) {
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (extra ? ': ' + extra : ''));
  if (!cond) fails.push(name);
}

var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-src-'));
function put(name) { fs.writeFileSync(path.join(dir, name), 'x'); }

/* 실제로 받아 온 이름들 — 공백 두 칸, 'Questions' 꼬리, 'ANWER' 오타까지 그대로다. */
[
  'NEW TOEFL MOCK TEST SET  9.docx', 'SET 9 SCRIPT.docx', 'SET 9 ANSWER KEY.docx',
  'NEW TOEFL MOCK TEST SET 10 Questions.docx', 'SET 10 SCRIPT.docx', 'SET 10 ANSWER KEY.docx',
  'NEW TOEFL SET 11.docx', 'SET 11 SCRIPT.docx', 'SET 11 ANWER KEY.docx',
  'NEW TOEFL SET 12.docx', 'SET 12 SCRIPT.docx', 'SET 12 ANWER KEY.docx',
  'NEW TOEFL SET 11.docx.bak-before-writing-tiles',   // docx 가 아니다 — 걸리면 안 된다
  '~$EW TOEFL SET 12.docx'                            // 워드가 열어 둔 임시 파일
].forEach(put);

import(require('url').pathToFileURL(path.join(__dirname, '..', 'sg2', 'tools', 'source_docs.mjs')))
  .then(function (M) {
    console.log('[1] 세트마다 다른 이름을 그대로 찾아낸다');
    [
      [9,  'NEW TOEFL MOCK TEST SET  9.docx',           'SET 9 ANSWER KEY.docx'],
      [10, 'NEW TOEFL MOCK TEST SET 10 Questions.docx', 'SET 10 ANSWER KEY.docx'],
      [11, 'NEW TOEFL SET 11.docx',                     'SET 11 ANWER KEY.docx'],
      [12, 'NEW TOEFL SET 12.docx',                     'SET 12 ANWER KEY.docx']
    ].forEach(function (row) {
      var got;
      try { got = M.findSourceDocs(dir, row[0]); } catch (e) { got = { error: e.message }; }
      ok('SET ' + row[0] + ' 문제지', got.questions === row[1], got.questions || got.error);
      ok('SET ' + row[0] + ' 정답지', got.answers === row[2], got.answers || got.error);
      ok('SET ' + row[0] + ' 스크립트', got.script === 'SET ' + row[0] + ' SCRIPT.docx', got.script || got.error);
    });

    console.log('\n[2] 번호가 비슷한 세트를 물지 않는다');
    var one = null;
    try { one = M.findSourceDocs(dir, 1); } catch (e) { one = { error: e.message }; }
    ok('SET 1 은 SET 12 를 집지 않는다 (없으면 없다고 한다)', !!one.error,
       one.error ? '멈춤' : one.questions);

    console.log('\n[3] 고를 수 없으면 고르지 않는다');
    put('NEW TOEFL SET 12 (revised).docx');
    var two = null;
    try { two = M.findSourceDocs(dir, 12); } catch (e) { two = { error: e.message }; }
    ok('문제지 후보가 둘이면 멈춘다', !!(two && two.error), two && two.error ? '멈춤' : (two && two.questions));
    ok('무엇이 있었는지 알려 준다', !!(two && two.error && /revised/.test(two.error)));

    fs.rmSync(dir, { recursive: true, force: true });
    console.log(fails.length ? '\n✗ ' + fails.length + ' FAILED: ' + fails.join(', ') : '\n✓ ALL PASS');
    process.exit(fails.length ? 1 : 0);
  })
  .catch(function (e) {
    console.error('source_docs.mjs 를 불러오지 못했습니다: ' + (e && e.message));
    process.exit(1);
  });
