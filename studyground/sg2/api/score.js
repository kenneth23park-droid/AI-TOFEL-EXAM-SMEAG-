/* SMEAG StudyGround — /api/score : Writing·Speaking 산출형 과제의 AI 채점.
 *
 * 무엇을 내는가
 *   ETS 공식 루브릭(_rubric_toefl.js) 그대로 과제당 **0~5** 한 점수와 분석 축
 *   코멘트. 1~6 밴드는 여기서 나오지 않는다 — 이 점수를 영역별로 모아 0~30 으로
 *   편 뒤 ETS 대응표를 태우는 일은 화면(sg-band.js)과 서버(scale.py)가 한다.
 *   채점과 환산을 갈라 두어야 대응표가 바뀌어도 다시 채점하지 않는다.
 *
 * 왜 답안을 본문에서 받지 않는가
 *   받으면 학생이 자기 답안 대신 잘 쓴 글을 보내 점수를 살 수 있다. 그래서 채점할
 *   글은 **언제나 서버가 sg_results.answers 에서 직접 읽는다**. 본문으로 받는 것은
 *   문항 메타데이터(어느 문항인지·무슨 과제인지·문제문)뿐이다. 문제문까지 위조해도
 *   채점 대상 글은 이미 제출된 그 글이라, 얻을 수 있는 이득이 크지 않다.
 *
 * 스피킹은 어떻게 채점되는가
 *   말은 글이 아니라서 한 단계가 더 있다. 응시 기기가 녹음을 비공개 버킷
 *   toefl-recordings/{owner}/{session}/{question_id}.{ext} 로 올려 두면, 이 함수가
 *   service_role 로 그 파일을 내려받아 전사(_llm.transcribe)한 뒤 그 글을 채점한다.
 *   전사문은 sg_task_scores.transcript 에 남는다 — 녹음 원본은 90일 뒤 지워도
 *   채점 근거는 남아야 하고, 재채점 때 같은 파일을 두 번 전사할 이유도 없다.
 *   본문의 transcript 는 **staff 만** 쓸 수 있다. 학생이 보낸 전사문을 믿으면
 *   위의 "답안을 본문에서 받지 않는" 규칙이 스피킹에서만 뚫린다.
 *   녹음이 없거나 OPENAI_API_KEY 가 없으면 0 점이 아니라 'no_transcript' 로 건너뛴다.
 *
 * 왜 service_role 이 필요한가
 *   sg_task_scores 의 RLS 는 학생에게 **읽기만** 준다. 학생 토큰으로 점수를 쓸 수
 *   있으면 채점이라는 말이 성립하지 않는다. 그래서 AI 초안은 이 함수가 서버 키로
 *   쓴다. 키가 없으면 채점을 시도하지 않고 503 으로 분명히 말한다 — 조용히 실패해
 *   "AI 가 채점을 안 해 주네" 로 남는 것이 가장 나쁘다.
 *   Vercel 환경변수: SUPABASE_SERVICE_ROLE_KEY
 *
 * 절대 덮지 않는 것
 *   교사가 확정한 행(confirmed_at). 자동 재채점이 교사의 판단을 지우면 안 된다.
 *
 * 계약
 *   POST /api/score
 *     헤더 Authorization: Bearer <supabase access token>
 *     { session, owner?, provider?, model?, lang?, force?,
 *       tasks:[{ question_id, skill, task_kind, prompt?, reference?, transcript? }] }
 *     → { session, owner, provider, model,
 *         scored:[{ question_id, skill, score, criteria:[…] }],
 *         skipped:[{ question_id, reason }] }
 *
 *   owner 는 staff 만 남의 것을 지정할 수 있다. 학생은 언제나 자기 응시만 채점한다.
 *   skipped.reason: 'confirmed' | 'already_scored' | 'no_answer' | 'no_transcript'
 *                 | 'unknown_question' | 'model_error'
 */

'use strict';

const LLM = require('./_llm.js');
const RUBRIC = require('./_rubric_toefl.js');

const SERVICE_KEY = LLM.env('SUPABASE_SERVICE_ROLE_KEY');

/* 한 번 호출로 채점할 수 있는 과제 수 상한. SET 9 는 W 3 + S 15 = 18 개다.
 * 상한을 두는 이유는 비용이지 기술이 아니다 — 넘으면 잘라 내고 그 사실을 돌려준다. */
const MAX_TASKS = 24;

const SYSTEM =
  'You are an ETS-trained TOEFL rater at SMEAG. You score one productive task at a time ' +
  'using the official TOEFL Scoring Guide supplied in the message, and nothing else. ' +
  'Do not invent criteria. In particular there is no word-count rule in the official ' +
  'guides: a short response is not penalised for being short, only for what the guide ' +
  'actually describes (relevance, elaboration, control of language, and for Listen and ' +
  'Repeat, fidelity to the prompt sentence). Score strictly and consistently. ' +
  'Return only JSON.';

function schemaFor(criteria) {
  return 'Return ONLY a JSON object, no prose, in this exact shape:\n' +
    '{"score": <integer 0-5>, "summary": "<one or two sentences justifying the score, ' +
    'quoting the guide\'s language>", "criteria": [' +
    criteria.map(function (c) {
      return '{"name":"' + c + '","comment":"<one short sentence>"}';
    }).join(',') + ']}\n' +
    'Rules:\n' +
    '- "score" is the holistic score from the guide. It is an integer 0-5, never a band.\n' +
    '- Use the whole range. Do not default to 3.\n' +
    '- Every criterion listed above appears exactly once, in that order.\n' +
    '- Comment on what the response actually does; quote a phrase from it when useful.';
}

/* ── Supabase (service_role) ─────────────────────────────────────────────── */

function svcHeaders(extra) {
  return Object.assign({
    apikey: SERVICE_KEY,
    Authorization: 'Bearer ' + SERVICE_KEY,
    'Content-Type': 'application/json'
  }, extra || {});
}

async function svc(path, init) {
  const r = await fetch(LLM.SUPABASE_URL + '/rest/v1/' + path, Object.assign({}, init, {
    headers: svcHeaders((init && init.headers) || {})
  }));
  if (!r.ok) throw new Error('supabase ' + r.status + ' ' + (await r.text().catch(() => '')));
  const text = await r.text().catch(() => '');
  return text ? JSON.parse(text) : null;
}

/* ── 녹음 (비공개 버킷) ──────────────────────────────────────────────────── */

const BUCKET = 'toefl-recordings';

/** {owner}/{session}/ 아래 녹음 목록. 한 번만 부르고 문항별로 나눠 쓴다. */
async function listRecordings(owner, session) {
  const r = await fetch(LLM.SUPABASE_URL + '/storage/v1/object/list/' + BUCKET, {
    method: 'POST',
    headers: svcHeaders(),
    body: JSON.stringify({
      prefix: owner + '/' + session + '/',
      limit: 200,
      sortBy: { column: 'name', order: 'asc' }
    })
  });
  if (!r.ok) throw new Error('storage list ' + r.status + ' ' + (await r.text().catch(() => '')));
  const rows = await r.json().catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

/** 목록에서 이 문항의 녹음을 고른다. 확장자는 브라우저(webm/m4a)마다 다르다. */
function pickRecording(rows, questionId) {
  const want = String(questionId);
  for (const row of rows) {
    const name = String((row && row.name) || '');
    const base = name.replace(/\.[a-z0-9]+$/i, '');
    if (base === want) return row;
  }
  return null;
}

async function downloadRecording(path) {
  const r = await fetch(LLM.SUPABASE_URL + '/storage/v1/object/' + BUCKET + '/' +
    path.split('/').map(encodeURIComponent).join('/'), { headers: svcHeaders() });
  if (!r.ok) throw new Error('storage get ' + r.status);
  return {
    bytes: Buffer.from(await r.arrayBuffer()),
    mime: r.headers.get('content-type') || 'audio/webm'
  };
}

/* ── 답안 꺼내기 ─────────────────────────────────────────────────────────── */

/** sg_results.answers 한 칸에서 채점할 글을 꺼낸다. 모양이 여러 가지라 여기서 흡수한다.
 *  { v: '...' } · { text: '...' } · { v: ['I','wanted to know',…], text: '…' } · 'raw' */
function answerText(rec) {
  if (rec === null || rec === undefined) return '';
  if (typeof rec === 'string') return rec.trim();
  if (typeof rec !== 'object') return String(rec).trim();
  if (typeof rec.text === 'string' && rec.text.trim()) return rec.text.trim();
  const v = rec.v;
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v)) return v.filter(Boolean).join(' ').trim();
  return '';
}

/** 답안이 NOT SUBMIT 표시인가(녹음 실패 등). 0점이 아니라 '답 없음'이다. */
function isNotSubmit(rec) {
  return !!(rec && typeof rec === 'object' && rec.notSubmit);
}

/* ── 한 과제 채점 ────────────────────────────────────────────────────────── */

async function scoreOne(P, key, model, lang, task, text) {
  const criteria = RUBRIC.criteriaFor(task.skill, task.task_kind);
  const parts = [
    RUBRIC.rubricFor(task.skill, task.task_kind),
    '',
    schemaFor(criteria),
    '',
    lang === 'ko'
      ? 'Write "summary" and every criterion comment in Korean. Keep the criterion names in English.'
      : 'Write "summary" and every criterion comment in English.'
  ];
  if (task.prompt) parts.push('', 'PROMPT GIVEN TO THE TEST TAKER:\n' + task.prompt);
  if (RUBRIC.isRepeat(task.task_kind) && task.reference) {
    parts.push('', 'THE EXACT SENTENCE THE TEST TAKER HAD TO REPEAT:\n' + task.reference);
  }
  parts.push(
    '',
    task.skill === 'speaking'
      ? 'TRANSCRIPT OF THE SPOKEN RESPONSE:\n' + text
      : 'THE RESPONSE:\n' + text
  );

  const started = Date.now();
  const out = await P.chat(key, model, SYSTEM, parts.join('\n'));
  const parsed = LLM.parseJSON(out && out.text);
  if (!parsed || parsed.score === null || parsed.score === undefined) {
    throw new Error('the model did not return a usable score');
  }

  let score = Number(parsed.score);
  if (!isFinite(score)) throw new Error('the model returned a non-numeric score');
  // 루브릭 밖의 값은 루브릭 안으로 접는다. 6점짜리 TOEFL 산출형 과제는 없다.
  score = Math.max(0, Math.min(RUBRIC.MAX_SCORE, Math.round(score)));

  const rows = criteria.map(function (name) {
    const hit = (parsed.criteria || []).find(function (c) {
      return c && String(c.name || '').toLowerCase() === name.toLowerCase();
    });
    return { criterion: name, comment: (hit && String(hit.comment || '')) || '' };
  });

  return {
    score: score,
    rubric: {
      summary: String(parsed.summary || ''),
      criteria: rows,
      task_kind: RUBRIC.normalizeKind(task.task_kind),
      source: 'ai_draft'
    },
    usage: Object.assign({ ms: Date.now() - started }, (out && out.usage) || {})
  };
}

/* ── handler ─────────────────────────────────────────────────────────────── */

module.exports = async function handler(req, res) {
  if (LLM.cors(req, res)) return;

  const me = await LLM.whoIs(req);
  if (!me) return LLM.json(res, 401, { error: 'Sign-in is required.' });

  if (req.method === 'GET') return LLM.json(res, 200, { providers: await LLM.listProviders() });
  if (req.method !== 'POST') return LLM.json(res, 405, { error: 'GET or POST only.' });

  if (!SERVICE_KEY) {
    return LLM.json(res, 503, {
      error: 'AI scoring is not configured: SUPABASE_SERVICE_ROLE_KEY is not set on the server.'
    });
  }

  const body = await LLM.readBody(req);
  if (!body) return LLM.json(res, 400, { error: 'Malformed JSON body.' });

  const session = String(body.session || '').trim();
  if (!session) return LLM.json(res, 400, { error: '"session" is required.' });

  // 학생은 자기 응시만. staff 만 남의 응시를 지정할 수 있다.
  const owner = (me.staff && body.owner) ? String(body.owner) : me.id;

  let tasks = Array.isArray(body.tasks) ? body.tasks : [];
  const overflow = Math.max(0, tasks.length - MAX_TASKS);
  tasks = tasks.slice(0, MAX_TASKS);
  if (!tasks.length) return LLM.json(res, 400, { error: '"tasks" is empty.' });

  const picked = LLM.resolve(body.provider);
  if (!picked) return LLM.json(res, 400, { error: 'Unknown provider "' + (body.provider || '') + '".' });
  const { id: providerId, P } = picked;
  const key = P.key();
  if (!key) return LLM.json(res, 503, { error: P.label + ' is not configured on the server.' });
  const model = String(body.model || '').trim() || P.def();
  const lang = body.lang === 'ko' ? 'ko' : 'en';
  const force = !!body.force && me.staff;      // 재채점은 staff 만

  // 1) 채점할 글을 서버가 직접 읽는다(본문의 글은 쓰지 않는다).
  let attempt;
  try {
    const rows = await svc('sg_results?select=answers,set_code,scale&owner=eq.' +
      encodeURIComponent(owner) + '&session=eq.' + encodeURIComponent(session));
    attempt = rows && rows[0];
  } catch (e) {
    return LLM.json(res, 502, { error: 'Could not read the attempt: ' + String(e.message || e) });
  }
  if (!attempt) return LLM.json(res, 404, { error: 'No such attempt for this student.' });
  const answers = attempt.answers || {};

  // 2) 이미 있는 채점을 읽어 둔다 — 확정된 것은 건드리지 않는다.
  let existing = [];
  try {
    existing = await svc('sg_task_scores?select=question_id,ai_score,confirmed_at,transcript,transcript_model,media_path&owner=eq.' +
      encodeURIComponent(owner) + '&session=eq.' + encodeURIComponent(session)) || [];
  } catch (e) { existing = []; }
  const known = {};
  existing.forEach(function (r) { known[r.question_id] = r; });

  const scored = [], skipped = [], writes = [];

  /* 녹음 목록은 스피킹 과제가 실제로 나올 때 한 번만 읽는다. 라이팅만 채점하는
   * 호출(교사가 W 만 재채점)에서 storage 를 건드리지 않기 위한 것. */
  let recordings = null;
  async function recordingsOnce() {
    if (recordings) return recordings;
    try { recordings = await listRecordings(owner, session); }
    catch (e) { recordings = []; }
    return recordings;
  }

  /** 스피킹 한 과제의 전사문. { text, path, model, fresh } — 없으면 text:''. */
  async function speechOf(task, prior) {
    // 1) 교사가 손으로 넣어 준 전사문이 이긴다. 학생이 보낸 것은 쓰지 않는다.
    if (me.staff && task.transcript) {
      return { text: task.transcript, path: (prior && prior.media_path) || '', model: 'manual', fresh: true };
    }
    // 2) 이미 옮겨 적어 둔 글. 같은 음성을 두 번 전사할 이유가 없다(force 여도).
    if (prior && prior.transcript) {
      return { text: prior.transcript, path: prior.media_path || '', model: prior.transcript_model || '', fresh: false };
    }
    // 3) 버킷의 녹음을 내려받아 옮겨 적는다.
    if (!LLM.sttReady()) return { text: '', path: '', model: '', fresh: false };
    const hit = pickRecording(await recordingsOnce(), task.question_id);
    if (!hit) return { text: '', path: '', model: '', fresh: false };
    const path = owner + '/' + session + '/' + hit.name;
    const file = await downloadRecording(path);
    const out = await LLM.transcribe(file.bytes, file.mime);
    return { text: out.text, path: path, model: out.model, fresh: true };
  }

  for (const raw of tasks) {
    const task = {
      question_id: String((raw && raw.question_id) || '').trim(),
      skill: String((raw && raw.skill) || '').trim().toLowerCase(),
      task_kind: String((raw && raw.task_kind) || '').trim(),
      prompt: String((raw && raw.prompt) || '').trim(),
      reference: String((raw && raw.reference) || '').trim(),
      transcript: String((raw && raw.transcript) || '').trim()
    };
    if (!task.question_id || (task.skill !== 'writing' && task.skill !== 'speaking')) {
      skipped.push({ question_id: task.question_id, reason: 'unknown_question' });
      continue;
    }

    const prior = known[task.question_id];
    if (prior && prior.confirmed_at) {
      skipped.push({ question_id: task.question_id, reason: 'confirmed' });
      continue;
    }
    if (prior && prior.ai_score !== null && prior.ai_score !== undefined && !force) {
      skipped.push({ question_id: task.question_id, reason: 'already_scored' });
      continue;
    }

    // 스피킹은 전사문이 있어야 채점할 수 있다. 없으면 0점이 아니라 **채점 안 함**이다.
    const record = answers[task.question_id];
    let speech = { text: '', path: '', model: '', fresh: false };
    if (task.skill === 'speaking' && !isNotSubmit(record)) {
      try {
        speech = await speechOf(task, prior);
      } catch (e) {
        skipped.push({ question_id: task.question_id, reason: 'no_transcript',
                       detail: String(e.message || e) });
        continue;
      }
      if (!speech.text) {
        skipped.push({ question_id: task.question_id, reason: 'no_transcript' });
        continue;
      }
    }
    const text = task.skill === 'speaking' ? speech.text : answerText(record);

    // 빈 답안은 모델에 물어볼 필요가 없다. ETS 가이드가 0 이라고 못 박아 두었다.
    if (!text || isNotSubmit(record)) {
      const criteria = RUBRIC.criteriaFor(task.skill, task.task_kind);
      writes.push(row(owner, session, task, 0, {
        summary: isNotSubmit(record)
          ? 'No response was recorded for this task (NOT SUBMIT).'
          : 'The response is blank.',
        criteria: criteria.map(function (c) { return { criterion: c, comment: '' }; }),
        task_kind: RUBRIC.normalizeKind(task.task_kind),
        source: 'rule'          // 모델을 부르지 않았다는 표시
      }, providerId, '', {}, '', speech));
      scored.push({ question_id: task.question_id, skill: task.skill, score: 0, blank: true });
      continue;
    }

    try {
      const out = await scoreOne(P, key, model, lang, task, text);
      writes.push(row(owner, session, task, out.score, out.rubric, providerId, model, out.usage, '', speech));
      scored.push({
        question_id: task.question_id, skill: task.skill,
        score: out.score, summary: out.rubric.summary, criteria: out.rubric.criteria,
        transcript: task.skill === 'speaking' ? speech.text : undefined
      });
    } catch (e) {
      const why = String(e.message || e);
      // 실패를 기록하되 **기존 점수를 지우지는 않는다**. force 재채점이 실패했을 때
      // ai_score=null 을 덮어쓰면 멀쩡하던 초안이 사라진다. 다만 방금 옮겨 적은
      // 전사문은 남긴다 — 채점만 다시 하면 되지 전사를 다시 살 이유가 없다.
      const hadScore = prior && prior.ai_score !== null && prior.ai_score !== undefined;
      if (!hadScore) writes.push(row(owner, session, task, null, {}, providerId, model, {}, why, speech));
      skipped.push({ question_id: task.question_id, reason: 'model_error', detail: why });
    }
  }

  // 3) 한 번에 upsert. 확정된 행은 위 루프에서 이미 빠졌다.
  if (writes.length) {
    try {
      await svc('sg_task_scores?on_conflict=owner,session,question_id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(writes)
      });
    } catch (e) {
      return LLM.json(res, 502, { error: 'Scored, but could not save: ' + String(e.message || e) });
    }
  }

  return LLM.json(res, 200, {
    session: session,
    owner: owner,
    provider: providerId,
    model: model,
    scored: scored,
    skipped: skipped,
    truncated: overflow || undefined
  });
};

/** sg_task_scores 한 행. AI 칸만 채운다 — 교사 칸은 교사가 쓴다.
 *  speech 는 스피킹에서만 채워진다(라이팅은 빈 문자열). 배열의 모든 행이 같은 키를
 *  가져야 PostgREST 가 한 번에 upsert 하므로, 값이 없어도 칸은 늘 보낸다. */
function row(owner, session, task, score, rubric, provider, model, usage, error, speech) {
  const sp = speech || {};
  return {
    transcript: sp.text || '',
    transcript_model: sp.model || '',
    transcript_at: sp.text ? new Date().toISOString() : null,
    media_path: sp.path || '',
    owner: owner,
    session: session,
    question_id: task.question_id,
    skill: task.skill,
    task_kind: RUBRIC.normalizeKind(task.task_kind),
    ai_score: score,
    ai_rubric: rubric || {},
    ai_provider: provider || '',
    ai_model: model || '',
    ai_at: new Date().toISOString(),
    ai_error: error || '',
    ai_usage: usage || {}
  };
}

module.exports.answerText = answerText;   // 테스트용
