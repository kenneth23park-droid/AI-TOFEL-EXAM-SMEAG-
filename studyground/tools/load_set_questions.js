#!/usr/bin/env node
/* 콘텐츠 팩(sg2/assets/setN.js) → Supabase sg_set_questions.
 *
 * 왜 옮기는가
 *   정답이 공개 파일에 있는 한, 화면이 무엇을 감추든 주소를 아는 학생은 그대로
 *   받아 본다. 리뷰가 읽는 정답은 이 표에서 오고, 이 표는 RLS 정책이 없어
 *   service_role 말고는 아무도 읽지 못한다. 학생 화면은 Edge Function
 *   `sg-review` 에게 물어야 하고, 그 함수가 기한과 해제를 확인한다.
 *
 *   팩 파일 자체는 시험 앱(sg2)이 오프라인에서 채점할 때 여전히 필요하다.
 *   그쪽 구멍(공개 URL 로 팩을 받을 수 있다)은 이 스크립트가 닫지 못한다 —
 *   supabase/review_window.sql 의 머리말과 smeag-com/README.md 를 볼 것.
 *
 * 실행:
 *   SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   node studyground/tools/load_set_questions.js SET9 SET1
 *
 *   --print 를 주면 서버에 쓰지 않고 SQL 만 찍는다(SQL Editor 에 붙여넣기용).
 *
 * ⚠️ service_role 키는 이 컴퓨터·서버에만 둔다. 학생 기기로 절대 내려보내지 말 것.
 */
'use strict';

var fs = require('fs');
var path = require('path');

var ASSETS = path.join(__dirname, '..', 'sg2', 'assets');
var args = process.argv.slice(2);
var PRINT = args.indexOf('--print') >= 0;
var CODES = args.filter(function (a) { return a.charAt(0) !== '-'; }).map(function (a) {
  return a.toUpperCase();
});
if (!CODES.length) CODES = ['SET9', 'SET1'];

/* 팩은 브라우저 파일이라 window 에 자기를 매단다. 그 자리를 만들어 주고 읽는다. */
function loadPack(code) {
  var file = path.join(ASSETS, code.toLowerCase() + '.js');
  if (!fs.existsSync(file)) throw new Error('팩 파일이 없습니다: ' + file);
  global.window = global.window || {};
  delete global.window['SMEAG_' + code];
  require(file);
  var pack = global.window['SMEAG_' + code];
  if (!pack) throw new Error(code + ' 팩이 window 에 실리지 않았습니다: ' + file);
  return pack;
}

/* sg2 와 smeag-com 이 쓰는 것과 같은 규칙으로 문항을 편다. */
var SECTION_OF = { R: 'reading', L: 'listening', S: 'speaking', W: 'writing' };
var KNOWN = { reading: 1, listening: 1, speaking: 1, writing: 1 };

function sectionOf(entry, qid) {
  var name = entry && entry.section && (entry.section.id || entry.section.name);
  name = String(name || '').toLowerCase();
  if (KNOWN[name]) return name;
  return SECTION_OF[String(qid).charAt(0).toUpperCase()] || 'other';
}

function rowsOf(pack) {
  var all = typeof pack.allQuestions === 'function' ? pack.allQuestions() : [];
  var keys = pack.answerKey || {};
  return all.map(function (entry, i) {
    var q = entry.q || entry;
    var key = Object.prototype.hasOwnProperty.call(keys, q.id) ? keys[q.id] : q.answer;
    return {
      set_code: String(pack.code || '').toUpperCase(),
      question_id: q.id,
      /* no 는 블록 안의 번호라 세트를 통틀면 여러 번 되풀이된다(R1-1 도 1, R2-1 도 1).
         리뷰가 "3번 문항" 이라고 말하려면 세트 전체를 꿰는 번호가 따로 필요하다. */
      ord: i + 1,
      no: q.no || (i + 1),
      section: sectionOf(entry, q.id),
      prompt: String(q.prompt || q.text || q.question || ''),
      /* 채점 기준이 없는 문항(사람이 채점하는 W·S)은 null 로 남긴다 —
         빈 문자열로 두면 '무응답이 정답' 이 되어 O/X 가 뒤집힌다. */
      answer: (key === undefined || key === null) ? null : key
    };
  });
}

function lit(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return String(v);
  return "'" + String(v).replace(/'/g, "''") + "'";
}
function sqlFor(rows) {
  var head = 'insert into public.sg_set_questions ' +
             '(set_code, question_id, ord, no, section, prompt, answer, updated_at) values\n';
  var body = rows.map(function (r) {
    return '  (' + [lit(r.set_code), lit(r.question_id), r.ord, r.no === null ? 'null' : r.no,
                    lit(r.section), lit(r.prompt),
                    r.answer === null ? 'null' : lit(JSON.stringify(r.answer)) + '::jsonb',
                    'now()'].join(', ') + ')';
  }).join(',\n');
  return head + body + '\non conflict (set_code, question_id) do update set ' +
         'ord = excluded.ord, no = excluded.no, section = excluded.section, ' +
         'prompt = excluded.prompt, answer = excluded.answer, updated_at = now();';
}

function push(rows) {
  var url = process.env.SUPABASE_URL || '';
  var key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) {
    console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.');
    console.error('service_role 키는 이 서버에만 둡니다 — 학생 기기에 절대 내려보내지 마십시오.');
    console.error('키 없이 SQL 만 보려면: node tools/load_set_questions.js --print SET9');
    process.exit(1);
  }
  return fetch(url.replace(/\/$/, '') + '/rest/v1/sg_set_questions?on_conflict=set_code,question_id', {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify(rows)
  }).then(function (r) {
    if (r.ok) return;
    return r.text().then(function (t) { throw new Error('HTTP ' + r.status + ' ' + t); });
  });
}

var all = [];
CODES.forEach(function (code) {
  var rows = rowsOf(loadPack(code));
  var keyed = rows.filter(function (r) { return r.answer !== null; }).length;
  console.error(code + ': 문항 ' + rows.length + '개, 정답 있는 문항 ' + keyed + '개');
  all = all.concat(rows);
});

if (PRINT) { console.log(sqlFor(all)); process.exit(0); }

push(all).then(function () {
  console.error('올렸습니다: ' + all.length + '행 → sg_set_questions');
}, function (e) {
  console.error('실패: ' + e.message);
  process.exit(1);
});
