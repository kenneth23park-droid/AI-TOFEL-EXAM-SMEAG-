#!/usr/bin/env node
/* SMEAG StudyGround — 시험이 끝난 뒤, 그날 응시를 통째로 AI 리뷰한다.
 *
 *     node tools/ai_review_run.js                       # 오늘(KST) 응시 전부
 *     node tools/ai_review_run.js --date 2026-08-12
 *     node tools/ai_review_run.js --dry-run             # 누구를 부를지, 얼마나 쓸지만
 *     node tools/ai_review_run.js --force               # 이미 리뷰가 있어도 다시 쓴다
 *     node tools/ai_review_run.js --student smeag010    # 한 명만
 *     node tools/ai_review_run.js --lang ko
 *
 * 필요한 것:  SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY · (OPENAI|ANTHROPIC)_API_KEY
 *             studyground/.env 를 자동으로 읽는다.
 *
 * ── 왜 따로 도구가 있나 ────────────────────────────────────────────────────
 * 리뷰는 원래 학생이 부른다 — 제출 직후 그 화면에서(exam-shell.js), 오프라인으로
 * 쳤다면 리뷰 화면을 여는 순간(review.html). 그런데 그 두 자리는 **학생이 화면을
 * 열어야** 돈다. 시험장에서 제출하고 그대로 집에 간 반은 아무도 리뷰를 못 받는다.
 * 선생님이 성적을 나눠 주기 전에 한 반을 통째로 채워 두는 자리가 여기다.
 *
 * ── 무엇을 다시 쓰는가 ─────────────────────────────────────────────────────
 * 프롬프트도, 저장하는 모양도 /api/feedback 의 것을 그대로 가져다 쓴다(SYSTEM ·
 * SCHEMA · attemptFor · rowsFor · putComments). 여기서 프롬프트를 한 벌 더 쓰면
 * "AI 리뷰" 가 부르는 자리마다 다른 글이 되고, 고칠 때 한쪽만 고치게 된다.
 * 다른 것은 하나뿐이다: 문항 메타데이터를 브라우저가 아니라 여기서 만든다 —
 * 콘텐츠 팩(sg2/assets/set9.js)을 node 에서 그대로 평가해 채점표를 얻는다.
 *
 * 점수는 여기서 나오지 않는다. 객관식은 이미 채점되어 있고, 라이팅·스피킹은
 * /api/score 의 몫이다. 이 도구는 이미 매겨진 점수를 말로 옮길 뿐이다.
 */
'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');

/* ── .env ───────────────────────────────────────────────────────────────── */
/* 키를 셸에 미리 걸어 두게 하지 않는다 — 시험 끝나고 바쁜 자리에서 쓰는 도구다. */
(function loadEnv() {
  var f = path.join(ROOT, '.env');
  if (!fs.existsSync(f)) return;
  fs.readFileSync(f, 'utf8').split('\n').forEach(function (line) {
    var m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) return;
    var v = m[2].trim().replace(/^["']|["']$/g, '');
    if (v && !process.env[m[1]]) process.env[m[1]] = v;
  });
})();

/* ── 인자 ───────────────────────────────────────────────────────────────── */

var ARGV = process.argv.slice(2);
function opt(name, dflt) {
  var i = ARGV.indexOf('--' + name);
  return i >= 0 && ARGV[i + 1] && ARGV[i + 1].indexOf('--') !== 0 ? ARGV[i + 1] : dflt;
}
function flag(name) { return ARGV.indexOf('--' + name) >= 0; }

/* 시험은 세부(KST)에서 친다. 서버 시각이 무엇이든 '오늘' 은 학생의 오늘이다. */
function todayKST() {
  var now = new Date(Date.now() + 9 * 3600 * 1000);
  return now.toISOString().slice(0, 10);
}

var DATE = opt('date', todayKST());
var LANG = opt('lang', 'en') === 'ko' ? 'ko' : 'en';
var ONLY = opt('student', '');
var DRY = flag('dry-run');
var FORCE = flag('force');
var PROVIDER = opt('provider', '');
var MODEL = opt('model', '');

/* ── 브라우저 자산을 node 에서 쓴다 ──────────────────────────────────────── */
/* set9.js · sg-results.js · sg-comments.js 는 <script src> 로 로드되는 ES5 라
   window 만 있으면 그대로 돈다. 채점 규칙을 여기서 다시 구현하지 않기 위해서다 —
   두 벌이 되는 순간 학생 화면의 O/X 와 리뷰가 말하는 O/X 가 갈릴 수 있다. */
global.window = global;
function loadAsset(rel) {
  var p = path.join(ROOT, 'sg2', 'assets', rel);
  // eslint-disable-next-line no-eval
  eval(fs.readFileSync(p, 'utf8'));
}
loadAsset('set9.js');
loadAsset('set1.js');
loadAsset('sg-results.js');
loadAsset('sg-comments.js');

var SG_RESULTS = global.window.SG_RESULTS;
var SG_COMMENTS = global.window.SG_COMMENTS;

var LLM = require(path.join(ROOT, 'sg2', 'api', '_llm.js'));
var FB = require(path.join(ROOT, 'sg2', 'api', 'feedback.js'));

var SUPABASE_URL = process.env.SUPABASE_URL || LLM.SUPABASE_URL;
var SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/* ── Supabase (service_role) ────────────────────────────────────────────── */

function svc(query) {
  return fetch(SUPABASE_URL + '/rest/v1/' + query, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: 'Bearer ' + SERVICE_KEY,
      'Content-Type': 'application/json'
    }
  }).then(function (r) {
    return r.text().then(function (t) {
      if (!r.ok) throw new Error('supabase ' + r.status + ' ' + t);
      return t ? JSON.parse(t) : null;
    });
  });
}

/* KST 하루. Supabase 는 UTC 로 들고 있으므로 경계를 여기서 옮긴다. */
function dayRange(date) {
  var from = new Date(date + 'T00:00:00+09:00').toISOString();
  var to = new Date(new Date(from).getTime() + 24 * 3600 * 1000).toISOString();
  return { from: from, to: to };
}

function q(v) { return encodeURIComponent(v); }

/* ── 한 응시 ────────────────────────────────────────────────────────────── */

function packOf(setCode) {
  var code = String(setCode || '').toUpperCase().replace(/[^0-9]/g, '');
  return global.window['SMEAG_SET' + code] || null;
}

/** 응시 한 건 → 리뷰 한 벌. 저장까지 하고, 무엇을 했는지 한 줄로 돌려준다. */
async function reviewOne(row, who, picked, model) {
  var label = (who.student_id || '?') + ' ' + (who.name || '');

  var pack = packOf(row.set_code);
  if (!pack) return { label: label, skipped: 'no content pack for ' + row.set_code };

  var det = SG_RESULTS.score(pack, row.answers || {});
  var questions = SG_COMMENTS.questionsFor(det);

  var taskRows = await svc('sg_task_scores?select=question_id,skill,task_kind,ai_score,ai_rubric,' +
    'teacher_score,teacher_note,confirmed_at,transcript' +
    '&owner=eq.' + q(row.owner) + '&session=eq.' + q(row.session));

  var attempt = FB.attemptFor(row, taskRows || [], { questions: questions });

  /* 아무것도 채점되지 않은 응시에 리뷰를 쓰면 지어낸 총평이 최종본으로 남는다.
     제출이 깨졌거나 아직 채점 전인 답안지가 여기로 온다. */
  if (attempt.overall_band === null && !attempt.wrong_questions.length) {
    return { label: label, skipped: 'nothing scored yet' };
  }

  if (DRY) {
    return {
      label: label,
      dry: true,
      band: attempt.overall_band,
      wrong: attempt.wrong_questions.length,
      open: attempt.open_answers.length,
      tasks: attempt.productive_tasks.length
    };
  }

  var user =
    (LANG === 'ko'
      ? 'Write every summary, comment and plan in Korean. Keep skill names in English.\n'
      : 'Write every summary, comment and plan in English.\n') +
    FB.SCHEMA + '\n\nScored attempt:\n' + JSON.stringify(attempt);

  var out = await picked.P.chat(picked.P.key(), model, FB.SYSTEM, user, { maxTokens: 8000 });
  var parsed = LLM.parseJSON(out && out.text);
  if (!parsed) {
    throw new Error('the model did not return usable JSON' + (out && out.truncated ? ' (truncated)' : ''));
  }

  var writes = FB.rowsFor(row.owner, row.session, model, LANG, parsed);
  var saved = await FB.putComments(writes.rows);
  var planErr = '';
  if (writes.plan) {
    try { saved += await FB.putComments([writes.plan]); }
    catch (e) { planErr = String(e.message || e); }
  }

  return {
    label: label,
    band: attempt.overall_band,
    saved: saved,
    questions: (parsed.questions || []).length,
    planErr: planErr,
    usage: (out && out.usage) || {}
  };
}

/* ── 한 반 ──────────────────────────────────────────────────────────────── */

async function main() {
  if (!SERVICE_KEY) {
    console.error('SUPABASE_SERVICE_ROLE_KEY 가 없다. studyground/.env 에 넣거나 셸에 걸어라.');
    process.exit(1);
  }
  var picked = LLM.resolve(PROVIDER);
  if (!picked || !picked.P.key()) {
    console.error('LLM 키가 없다 (OPENAI_API_KEY 또는 ANTHROPIC_API_KEY).');
    process.exit(1);
  }
  var model = MODEL || picked.P.def();

  var span = dayRange(DATE);
  var rows = await svc('sg_results?select=owner,session,set_code,submitted_at,answers,by_section,' +
    'score,total,scale&submitted_at=gte.' + q(span.from) + '&submitted_at=lt.' + q(span.to) +
    '&order=submitted_at.asc');
  rows = rows || [];

  /* 누가 쳤는지. 이름은 화면(로그)에만 쓴다 — 모델에는 신원을 보내지 않는다. */
  var people = await svc('sg_exam_accounts?select=user_id,student_id,name,exam_date');
  var by = {};
  (people || []).forEach(function (p) {
    var cur = by[p.user_id];
    // 같은 사람이 여러 날 응시하면 그날 자리의 학번이 맞다.
    if (!cur || p.exam_date === DATE) by[p.user_id] = p;
  });

  if (ONLY) {
    rows = rows.filter(function (r) {
      return (by[r.owner] || {}).student_id === ONLY;
    });
  }

  /* 이미 AI 리뷰가 있는 응시는 건너뛴다 — 다시 부르는 것은 --force 일 때뿐이다. */
  var had = await svc('sg_comments?select=owner,session&source=eq.ai' +
    '&session=in.(' + rows.map(function (r) { return '"' + r.session + '"'; }).join(',') + ')');
  var seen = {};
  (had || []).forEach(function (c) { seen[c.owner + '|' + c.session] = true; });

  console.log(DATE + ' (KST) — 응시 ' + rows.length + '건 · ' +
              picked.id + '/' + model + ' · ' + LANG + (DRY ? ' · dry-run' : ''));

  var done = 0, skipped = 0, failed = 0, tokensIn = 0, tokensOut = 0;

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var who = by[row.owner] || {};
    var name = (who.student_id || row.owner.slice(0, 8)) + ' ' + (who.name || '');

    if (!FORCE && seen[row.owner + '|' + row.session]) {
      console.log('  · ' + name + ' — 이미 리뷰가 있다 (--force 로 다시 쓴다)');
      skipped++;
      continue;
    }

    try {
      var res = await reviewOne(row, who, picked, model);
      if (res.skipped) {
        console.log('  · ' + name + ' — 건너뜀: ' + res.skipped);
        skipped++;
      } else if (res.dry) {
        console.log('  · ' + name + ' — band ' + res.band + ' · 오답 ' + res.wrong +
                    ' · 서술형 ' + res.open + ' · 과제 ' + res.tasks);
        done++;
      } else {
        tokensIn += res.usage.in || 0;
        tokensOut += res.usage.out || 0;
        console.log('  ✓ ' + name + ' — band ' + res.band + ' · 코멘트 ' + res.saved +
                    '행(문항 ' + res.questions + ')' + (res.planErr ? ' · 계획 저장 실패: ' + res.planErr : ''));
        done++;
      }
    } catch (e) {
      console.log('  ✗ ' + name + ' — ' + String((e && e.message) || e));
      failed++;
    }
  }

  console.log('완료: ' + done + ' · 건너뜀: ' + skipped + ' · 실패: ' + failed +
              (tokensIn ? ' · 토큰 in ' + tokensIn + ' / out ' + tokensOut : ''));
  if (failed) process.exit(1);
}

main().catch(function (e) {
  console.error(String((e && e.stack) || e));
  process.exit(1);
});
