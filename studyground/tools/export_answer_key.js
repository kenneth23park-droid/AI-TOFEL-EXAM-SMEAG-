/* SMEAG · StudyGround — set9.js 정답을 Supabase 정답지 SQL 로 뽑는다.
 *
 *   node studyground/tools/export_answer_key.js            → SQL 을 stdout 으로
 *   node studyground/tools/export_answer_key.js --digest   → 대조용 md5 만
 *
 * 정답의 정본은 어디까지나 sg2/assets/set9.js 다. 이 스크립트는 그것을
 * public.toefl_answer_keys 로 옮기는 통로일 뿐이라, 정답을 여기서 고치면 안 된다.
 *
 * --digest 로 나오는 해시는 아래 SQL 결과와 같아야 한다. 다르면 번들과 DB 가
 * 어긋난 것이다:
 *
 *   select md5(string_agg(question_id||'|'||section||'|'||module||'|'||q_no||'|'
 *                ||kind||'|'||grader||'|'||coalesce(answer::text,'~')||'|'
 *                ||coalesce(rubric,'~'), E'\n' order by question_id))
 *     from public.toefl_answer_keys where set_code = 'SET9';
 */
'use strict';

var path = require('path');
var crypto = require('crypto');

global.window = {};
require(path.join(__dirname, '..', 'sg2', 'assets', 'set9.js'));

var SET = global.window.SMEAG_SET9;
var SET_CODE = SET.code;

/* 문항 종류 → 채점기. 여기에 없는 종류는 전부 AI 루브릭 채점으로 간다. */
function graderFor(q, sectionId) {
  if (q.kind === 'blank') return { grader: 'exact_text', answer: q.answer, rubric: null };
  if (q.kind === 'mcq' || q.kind === 'insert') return { grader: 'choice_index', answer: q.answer, rubric: null };
  if (q.kind === 'build') {
    /* build 는 고정 토큰(t==='f')이 섞여 있다. 학생이 채우는 건 빈칸(t==='b') 뿐이라
       정답도 빈칸만 순서대로 모은다. */
    var blanks = (q.slots || []).filter(function (s) { return s.t === 'b'; })
                                .map(function (s) { return s.a; });
    return { grader: 'slot_sequence', answer: blanks, rubric: null };
  }
  return { grader: 'ai', answer: null,
           rubric: sectionId === 'speaking' ? 'toefl_speaking' : 'toefl_writing' };
}

function rows() {
  var out = [];
  SET.allQuestions().forEach(function (e) {
    var g = graderFor(e.q, e.section.id);
    /* set9.js 는 정답을 문항 안(q.answer)과 ANSWER_KEY 양쪽에 들고 있다.
       둘이 어긋난 채로 DB 에 올리면 어느 쪽이 맞는지 알 수 없어진다. */
    if (Object.prototype.hasOwnProperty.call(SET.answerKey, e.q.id) &&
        JSON.stringify(SET.answerKey[e.q.id]) !== JSON.stringify(g.answer)) {
      throw new Error('answer key mismatch at ' + e.q.id);
    }
    out.push({
      question_id: e.q.id, section: e.section.id, module: e.module.id,
      q_no: e.q.no, kind: e.q.kind, grader: g.grader, answer: g.answer, rubric: g.rubric
    });
  });
  out.sort(function (a, b) { return a.question_id < b.question_id ? -1 : 1; });
  return out;
}

/* postgres 의 jsonb::text 표기를 그대로 흉내낸다 — 배열 원소 사이가 ', ' 다.
   여기가 어긋나면 digest 대조가 의미를 잃는다. */
function pgJsonText(v) {
  if (v === null || v === undefined) return '~';
  if (Array.isArray(v)) return '[' + v.map(function (x) { return JSON.stringify(x); }).join(', ') + ']';
  return JSON.stringify(v);
}

function digest(list) {
  var lines = list.map(function (r) {
    return [r.question_id, r.section, r.module, r.q_no, r.kind, r.grader,
            pgJsonText(r.answer), r.rubric || '~'].join('|');
  });
  return crypto.createHash('md5').update(lines.join('\n')).digest('hex');
}

function sql(list) {
  var q = function (s) { return s === null ? 'null' : "'" + String(s).replace(/'/g, "''") + "'"; };
  var j = function (v) { return v === null ? 'null' : "'" + JSON.stringify(v).replace(/'/g, "''") + "'::jsonb"; };
  var values = list.map(function (r) {
    return '(' + [q(SET_CODE), q(r.question_id), q(r.section), q(r.module), r.q_no,
                  q(r.kind), q(r.grader), j(r.answer), q(r.rubric)].join(',') + ')';
  });
  return 'insert into public.toefl_answer_keys\n' +
         '  (set_code, question_id, section, module, q_no, kind, grader, answer, rubric)\n' +
         'values\n' + values.join(',\n') + '\n' +
         'on conflict (set_code, question_id) do update set\n' +
         '  section=excluded.section, module=excluded.module, q_no=excluded.q_no,\n' +
         '  kind=excluded.kind, grader=excluded.grader, answer=excluded.answer,\n' +
         '  rubric=excluded.rubric, updated_at=now();\n';
}

var list = rows();
var counts = {};
list.forEach(function (r) { counts[r.grader] = (counts[r.grader] || 0) + 1; });

if (process.argv.indexOf('--digest') >= 0) {
  process.stdout.write(digest(list) + '\n');
} else {
  process.stdout.write(sql(list));
}
process.stderr.write(SET_CODE + ': ' + list.length + '문항 ' + JSON.stringify(counts) +
                     ' digest=' + digest(list) + '\n');
