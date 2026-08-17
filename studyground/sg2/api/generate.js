/* SMEAG StudyGround — /api/generate : 문서가 없을 때 AI 로 시험 재료를 짓는다.
 *
 * 무엇을 짓고 무엇을 짓지 않는가
 *   짓는 것은 **내용**뿐이다. 시험의 모양 — 섹션·모듈·블록 구성, 문항 수, 보기 개수,
 *   지시문 — 은 config/blueprint.toefl.json 이 정하고 브라우저가 들고 온다. 모양까지
 *   맡기면 매번 다른 시험이 나오고, 그러면 config/timing.toefl.json 의 시간 배분과
 *   어긋난다. 여기서는 청사진의 빈 칸만 채운다.
 *
 * 왜 블록 하나씩 부르는가
 *   세트 하나는 문항 120개다. 한 번에 물으면 (1) 서버리스 함수 시간이 모자라고
 *   (2) 뒤로 갈수록 품질이 떨어지며 (3) 중간에 실패하면 전부 날아간다. 블록 하나가
 *   한 호출이고, 순서를 이어 붙이는 일은 브라우저(assets/set-generate.js)가 한다.
 *   실패한 블록만 다시 부르면 된다.
 *
 * 왜 정답을 따로 만들지 않는가
 *   문항과 정답을 두 번 물으면 반드시 어긋난다 — set-import.js 의 게이트 절반이 그
 *   어긋남을 잡으려고 있는 것이다. 여기서는 문항·정답·**근거**가 한 응답에 같이 온다.
 *   근거(evidence)는 지문·대본에서 그대로 따온 구절이고, 브라우저가 그 구절이 실제로
 *   본문에 있는지 대조한다. 없으면 지어낸 것이므로 stop 게이트다.
 *
 * 누가 부를 수 있나
 *   두 갈래다. (1) Supabase 로그인 토큰이 있고 sg_profiles.role 이 teacher·admin 일 때
 *   (/api/feedback 과 같다). (2) 관리자 토큰 — 헤더 x-sg-token 이 서버의 SG_ADMIN_TOKEN
 *   (없으면 SG_TTS_TOKEN)과 같을 때. 선생님 계정 없이 관리자 비밀번호만으로 들어온
 *   화면을 위한 길이다. 자세한 사정은 _llm.js 의 adminToken 주석에 있다.
 *   학생 토큰은 401.
 *
 * 계약
 *   GET  /api/generate   → { providers:[{id,label,ready,why,models:[…],default}] }
 *   POST /api/generate   { provider?, model?, task, spec, context? }
 *        → { provider, model, task, usage:{in,out}, data:{…} }
 *
 *   task 별 data 모양은 아래 TASKS 의 schema 문자열이 그대로 계약이다.
 *   문항 번호(no)는 어느 task 도 돌려주지 않는다 — 번호는 청사진 순서에서 나오므로
 *   브라우저가 매긴다. 모델에게 번호를 맡기면 반드시 어디선가 한 칸 밀린다.
 */

'use strict';

const LLM = require('./_llm.js');

const SYSTEM =
  'You are a TOEFL item writer for SMEAG, an English academy. You write original test ' +
  'material for a TOEFL Essentials-style mock test.\n' +
  'Hard rules:\n' +
  '- Everything you write must be original. Never reproduce or paraphrase a real ETS ' +
  'passage, a published article, or any copyrighted text.\n' +
  '- Target CEFR B1-B2 learners. Plain academic or campus English. No idioms that depend ' +
  'on a specific culture, no wordplay, no humour that hinges on connotation.\n' +
  '- Every question must have exactly one defensible answer. Distractors must be plausible ' +
  'to a student who did not understand, and clearly wrong to one who did.\n' +
  '- Never write "All of the above", "None of the above", "Both A and B", or negative ' +
  'stems ("Which is NOT...").\n' +
  '- Spread the correct answers across positions. Do not put most answers in one position.\n' +
  '- Use no names of real people, companies, or institutions. Invented names only.\n' +
  '- Return ONLY a JSON object. No prose, no markdown fence, no commentary.';

/** 청사진 조각을 사람 말로 풀어 준다 — 모델은 JSON 보다 문장을 잘 지킨다. */
function specLines(spec) {
  const L = [];
  if (spec.instruction) L.push('Instruction shown to the student: "' + spec.instruction + '"');
  if (spec.questions) L.push('Number of questions: exactly ' + spec.questions);
  if (spec.choices) L.push('Choices per question: exactly ' + spec.choices);
  if (spec.passageWords) L.push('Passage length: ' + spec.passageWords.min + '-' + spec.passageWords.max + ' words total');
  if (spec.paragraphs) L.push('Paragraphs: about ' + spec.paragraphs);
  if (spec.templateWords) L.push('Text length: ' + spec.templateWords.min + '-' + spec.templateWords.max + ' words');
  if (spec.scriptWords) L.push('Script length: ' + spec.scriptWords.min + '-' + spec.scriptWords.max + ' words');
  if (spec.minWords) L.push('The student must write at least ' + spec.minWords + ' words in response.');
  return L.join('\n');
}

/** 주제·피할 것 등 문맥을 덧붙인다. */
function contextLines(ctx) {
  const c = ctx || {};
  const L = [];
  if (c.topic) L.push('Topic to write about: ' + c.topic);
  if (c.genre) L.push('Text type: ' + c.genre);
  if (c.domain) L.push('Setting: ' + c.domain);
  if (c.avoid && c.avoid.length) {
    L.push('These topics are already used in other test sets. Do not write about any of ' +
      'them, and do not write about a near neighbour of one: ' + c.avoid.slice(0, 60).join('; '));
  }
  if (c.note) L.push(String(c.note));
  return L.join('\n');
}

/* ─────────────────────────────────────────────────────────────── task 표 */

const TASKS = {

  /* 세트 전체의 주제를 한 번에 배정한다. 블록마다 따로 주제를 고르게 하면 리딩 두
     지문이 둘 다 도시 녹화(綠化) 이야기가 되는 일이 생긴다 — 각 호출은 서로를
     모르기 때문이다. 주제만 먼저 한 번에 정해 두면 그 뒤 호출은 서로 겹치지 않는다. */
  topics: {
    maxTokens: 3000,
    schema:
`{"topics":[{"ref":"<the ref you were given, unchanged>","topic":"<6-12 words>","genre":"<e.g. lecture, campus notice, staff email>","domain":"<e.g. campus life, biology, art history>"}]}
Rules:
- One entry for every ref you were given, in the same order. Do not add or drop refs.
- Every topic must be distinct from every other topic in this list, not merely differently worded.
- Match the topic to the instruction given for that ref: "Read a notice." needs something a
  campus would post; "Listen to a talk." needs a short academic lecture.
- Academic topics: spread across sciences, social sciences, and arts. Do not let one field
  take more than a third of them.`,
    user(spec, ctx) {
      return 'Assign one topic to each slot of a TOEFL mock test.\n\n' +
        contextLines(ctx) + '\n\nSlots:\n' +
        (ctx.slots || []).map(function (s) {
          return '- ' + s.ref + ' [' + s.section + ' ' + s.module + '] ' +
            (s.instruction || s.kind) + ' — ' + s.questions + ' question(s)';
        }).join('\n');
    }
  },

  /* 리딩 클로즈 — 지문 하나에 빈칸 n 개. */
  'reading-cloze': {
    maxTokens: 2000,
    schema:
`{"template":"<the full text with {{1}} … {{n}} where the blanks go>",
 "blanks":[{"answer":"<one word>","hint":"<the first 2-5 letters of that word>"}]}
Rules:
- The template contains {{1}} through {{n}} exactly once each, in ascending order, where n is
  the number of questions. Nothing else in double braces.
- "blanks" is in the same order as the placeholders: blanks[0] fills {{1}}.
- Every answer is a single word with no spaces and no punctuation.
- "hint" is a literal prefix of "answer" — the same letters, lower case, 2 to 5 of them.
  A student who reads the hint and the sentence must be able to reach exactly one word.
- The blanks must test grammar and collocation, not trivia. Do not blank a proper noun,
  a number, or a word the passage never prepares the reader for.
- The first sentence and the last sentence carry no blanks — the student needs a way in
  and a way out.`,
    user(spec, ctx) {
      return 'Write one fill-in-the-blank reading passage.\n\n' + specLines(spec) + '\n' + contextLines(ctx);
    }
  },

  /* 리딩 지문 + 객관식. insert 문항이 섞이면 지문에 {{A}}~{{D}} 자리를 심는다. */
  'reading-passage': {
    maxTokens: 4000,
    schema:
`{"title":"<short title, or empty string for an email or notice>",
 "paragraphs":["<paragraph>", "…"],
 "questions":[{"kind":"mcq","prompt":"…","choices":["…"],"answer":<0-based index>,"evidence":"<verbatim quote from the passage>"}]}
Rules:
- "evidence" is copied character for character from one of the paragraphs, 8 words or more,
  and it is what makes the answer correct. If you cannot quote it, the question is wrong —
  rewrite the question.
- Mix question types across the block: main idea, detail, inference, vocabulary in context.
  A vocabulary question quotes the word in the stem, e.g. The word "revolutionizing" in
  paragraph 1 is closest in meaning to.
- For an email or a notice, write it the way it would really appear (greeting, body, sign-off;
  or heading, details, contact line). "title" may be empty then.`,
    user(spec, ctx) {
      let extra = '';
      if (spec.questionKinds && spec.questionKinds.insert) {
        extra =
          '\n\nOne of the questions is a sentence-insertion question. For it:\n' +
          '- Place {{A}}, {{B}}, {{C}} and {{D}} in the paragraphs, at four sentence boundaries ' +
          'where a sentence could grammatically be added. Exactly one of each, in order.\n' +
          '- Emit it as {"kind":"insert","sentence":"<the sentence to insert>","answer":<0 for A, 1 for B, ' +
          '2 for C, 3 for D>,"evidence":"<the verbatim sentence it must follow>"} with no "prompt" ' +
          'and no "choices" — those are fixed wording the app supplies.\n' +
          '- The inserted sentence must contain a back-reference (a demonstrative, "such", ' +
          '"these factors") so that only one position works.\n' +
          '- Put it last in the "questions" array.';
      }
      return 'Write one reading passage and its questions.\n\n' + specLines(spec) + '\n' + contextLines(ctx) + extra;
    }
  },

  /* 리스닝 짧은 응답 드릴 — 문항마다 음성이 따로다. 들려주는 것은 질문 한 문장이고
     보기는 그 질문에 대한 응답이다. */
  'listening-drill': {
    maxTokens: 3000,
    schema:
`{"items":[{"script":"<the one sentence the student hears>","choices":["…"],"answer":<0-based index>}]}
Rules:
- "script" is a single spoken utterance: a question or a remark someone would say on campus.
  10-18 words. It is heard, never read, so it must be clear on one listening.
- The choices are possible replies. The correct one answers what was actually asked; the
  wrong ones answer a similar-sounding or adjacent question.
- Vary the function across items: asking for information, making a request, offering,
  complaining, confirming, apologising.`,
    user(spec, ctx) {
      return 'Write ' + spec.questions + ' short listening-and-response items.\n\n' +
        specLines(spec) + '\n' + contextLines(ctx);
    }
  },

  /* 리스닝 대화·안내방송·강의 — 대본 하나에 문항 n 개. */
  'listening-set': {
    maxTokens: 4000,
    schema:
`{"script":"<the full spoken text>",
 "questions":[{"prompt":"…","choices":["…"],"answer":<0-based index>,"evidence":"<verbatim quote from the script>"}]}
Rules:
- The script is what a voice actor reads aloud. For a conversation, mark every turn with
  "M: " or "W: " at the start of the line and put each turn on its own line. For an
  announcement or a talk, write continuous prose with no speaker labels.
- Speech, not writing: contractions, false starts are fine, no bullet points, no headings,
  no numbers that a listener could not hold in their head.
- "evidence" is copied character for character from the script, 8 words or more.
- The first question asks what the conversation or talk is mainly about. The rest follow the
  order in which the information appears.`,
    user(spec, ctx) {
      return 'Write one listening passage and its questions.\n\n' + specLines(spec) + '\n' + contextLines(ctx);
    }
  },

  /* 문장 조립 — 조각을 순서대로 놓아 한 문장을 만든다.
     타일 섞기·정답 토큰 뽑기는 여기서 하지 않는다(브라우저가 한다). 모델에게는
     "문장을 어떻게 자를지"만 묻는다 — 자를 자리를 정하는 것이 이 과제의 전부다. */
  'writing-build': {
    maxTokens: 3000,
    schema:
`{"items":[{"context":"<a one-line prompt or question that sets the situation>",
            "sentence":"<the full correct sentence>",
            "chunks":[{"text":"…","fixed":true|false}]}]}
Rules:
- Joining the chunks with single spaces must reproduce "sentence" exactly, including the
  final full stop. Put punctuation that ends the sentence in its own chunk with fixed:true.
- fixed:true means the chunk is printed on screen already; fixed:false means the student
  must drag it into place. Between 4 and 7 chunks are fixed:false.
- A chunk is a meaningful unit — "wanted to know", "the final project" — not a single word
  unless that word stands alone grammatically.
- Each item tests one structure (reported speech, relative clause, conditional, passive,
  comparative, gerund vs infinitive…). Do not repeat a structure within the block.
- The chunks must have exactly one grammatical ordering. If two orderings both work,
  rewrite the sentence.`,
    user(spec, ctx) {
      return 'Write ' + spec.questions + ' sentence-building items.\n\n' + specLines(spec) + '\n' + contextLines(ctx);
    }
  },

  'writing-email': {
    maxTokens: 1500,
    schema:
`{"to":"<first name of the recipient>","subject":"<the subject line>",
 "situation":"<3-5 sentences describing the situation the student is in>",
 "bullets":["<what the email must do>","…"]}
Rules:
- Exactly 3 bullets. Each names a distinct communicative act (describe, explain, request,
  suggest, apologise) so that a response can be scored on whether all three were done.
- The situation is written in the second person ("You and your friend Christina are…").
- Everyday or campus context. Not academic argument — that is the other writing task.`,
    user(spec, ctx) {
      return 'Write one email-writing prompt.\n\n' + specLines(spec) + '\n' + contextLines(ctx);
    }
  },

  'writing-discussion': {
    maxTokens: 2000,
    schema:
`{"professor":"<Doctor Surname – Course Name>",
 "prompt":"<the professor's post: 3-5 sentences ending in a question the student must answer>",
 "posts":[{"name":"<first name>","text":"<70-90 words>"},{"name":"…","text":"…"}]}
Rules:
- Exactly 2 student posts. One agrees, one disagrees, and both give reasons — the student's
  job is to add something neither of them said, so neither post may be exhaustive.
- The professor's question must be answerable from general knowledge. No specialist facts.
- Each post reads like a real classmate: a claim, a reason, an example, a closing line.`,
    user(spec, ctx) {
      return 'Write one academic-discussion prompt.\n\n' + specLines(spec) + '\n' + contextLines(ctx);
    }
  },

  /* 문항은 문서에 있는데 대본만 없을 때 — SET 9 리스닝 Module 2 가 정확히 그랬다.
     이때는 문항을 지어서는 안 된다. 이미 있는 문항이 맞아떨어지도록 대본을 쓴다.
     정답이 문서에 없으면 어느 보기가 맞게 되는지도 같이 말하게 한다 — 대본을 쓴 쪽만이
     그 답을 안다. */
  'listening-script-for': {
    maxTokens: 4000,
    schema:
`{"script":"<the full spoken text>",
 "answers":[{"answer":<0-based index of the choice this script makes correct>,"evidence":"<verbatim quote from your script>"}]}
Rules:
- You are given questions that already exist. Do not change them, do not add any, do not
  drop any. Write the passage they are asking about.
- "answers" has exactly one entry per question, in the order the questions were given.
- If a question already shows you its correct answer, your script must make that answer the
  correct one. Treat it as a constraint, not a suggestion.
- The script must contain enough for every question, and must not make a second choice
  defensible for any of them.
- Same speech rules as any listening passage: "M: "/"W: " line prefixes for a conversation,
  continuous prose for an announcement or a talk.`,
    user(spec, ctx) {
      return 'Write the listening passage that these existing questions are about.\n\n' +
        specLines(spec) + '\n' + contextLines(ctx) + '\n\nQuestions:\n' +
        JSON.stringify(ctx.questions || [], null, 1);
    }
  },

  /* 정답만 없을 때 — 문항도 지문도 있는데 정답지를 안 올린 경우.
     이것은 집필이 아니라 **풀이**다. 그래서 지시가 정반대다: 아무것도 새로 쓰지 마라. */
  solve: {
    maxTokens: 2500,
    schema:
`{"answers":[{"answer":<0-based index, or the exact word for a fill-in-the-blank>,
              "evidence":"<verbatim quote from the source text>",
              "confidence":"high"|"low"}]}
Rules:
- Write nothing new. You are answering questions someone else wrote, from the source text
  you were given and nothing else.
- One entry per question, in the order given. Never reorder, never skip.
- "evidence" is copied character for character from the source text.
- Use confidence "low" when the source does not settle it — two choices defensible, or the
  answer is not in the text at all. Say low rather than guessing; a wrong answer marked high
  is worse than a blank, because nobody goes back to check it.`,
    user(spec, ctx) {
      return 'Answer these questions from the source text.\n\nSource text:\n' +
        String(ctx.source || '') + '\n\nQuestions:\n' +
        JSON.stringify(ctx.questions || [], null, 1);
    }
  },

  /* 스피킹 — 따라 말하기(repeat) 와 인터뷰(interview). 둘 다 "들려줄 문장" 목록이다. */
  'speaking-set': {
    maxTokens: 2000,
    schema:
`{"introScript":"<the instructions the student hears before the task>",
 "items":[{"script":"<the one sentence the student hears>"}]}
Rules:
- The intro tells the student who is speaking and what to do, in 2-3 spoken sentences.
- Every item is one utterance, spoken by the same voice, in the same situation as the intro.
- Nothing in an item may depend on having answered a previous item.`,
    user(spec, ctx) {
      const kind = (ctx && ctx.kind) || 'repeat';
      const per = kind === 'interview'
        ? 'This is an interview. Each item is a question an interviewer asks about the ' +
          'student\'s own life and opinions. The student answers from experience, so no item ' +
          'may need outside knowledge. Order them from easy to demanding.'
        : 'This is listen-and-repeat. The student hears a sentence once and says it back, so ' +
          'each item must be sayable in one breath and must not contain a tongue-twister, a ' +
          'rare name, or a number longer than two digits. Grow the length gradually across ' +
          'the items — the first is the shortest, the last the longest.';
      return 'Write ' + spec.questions + ' speaking items.\n\n' + specLines(spec) + '\n' +
        per + '\n' + contextLines(ctx);
    }
  }
};

/* ─────────────────────────────────────────────────────────────── 핸들러 */

async function handler(req, res) {
  if (LLM.cors(req, res)) return;

  const staff = await LLM.staffOrToken(req);
  if (!staff) {
    return LLM.json(res, 401, {
      error: LLM.adminToken()
        ? 'Sign in as a teacher, or enter the admin token (SG_ADMIN_TOKEN) on the set-import screen.'
        : 'Teacher or administrator sign-in is required. The server has no SG_ADMIN_TOKEN set, so the admin-token door is closed.'
    });
  }

  if (req.method === 'GET') return LLM.json(res, 200, { providers: await LLM.listProviders(), tasks: Object.keys(TASKS) });
  if (req.method !== 'POST') return LLM.json(res, 405, { error: 'GET or POST only.' });

  const body = await LLM.readBody(req);
  if (!body) return LLM.json(res, 400, { error: 'Malformed JSON body.' });

  const T = TASKS[String(body.task || '')];
  if (!T) return LLM.json(res, 400, { error: 'Unknown task "' + (body.task || '') + '".' });

  const picked = LLM.resolve(body.provider);
  if (!picked) return LLM.json(res, 400, { error: 'Unknown provider "' + (body.provider || '') + '".' });
  const { id, P } = picked;
  const key = P.key();
  if (!key) return LLM.json(res, 503, { error: P.label + ' is not configured on the server.' });

  const model = String(body.model || '').trim() || P.def();
  const spec = body.spec || {};
  const ctx = body.context || {};

  const user = T.user(spec, ctx) + '\n\nReturn ONLY a JSON object in this exact shape:\n' + T.schema;

  let out;
  try {
    out = await P.chat(key, model, SYSTEM, user, { maxTokens: T.maxTokens });
  } catch (e) {
    return LLM.json(res, 502, { error: String(e.message || e) });
  }

  const parsed = LLM.parseJSON(out && out.text);
  if (!parsed) {
    /* 잘린 것과 이상한 것을 구분해서 말한다 — 잘린 것은 블록을 쪼개면 풀리고,
       이상한 것은 모델을 바꿔야 풀린다. 같은 문구로 알리면 둘 다 못 고친다. */
    return LLM.json(res, 502, {
      error: out && out.truncated
        ? 'The model ran out of output length before finishing this block (' + T.maxTokens + ' tokens).'
        : 'The model did not return usable JSON.'
    });
  }

  return LLM.json(res, 200, {
    provider: id, model, task: body.task,
    usage: (out && out.usage) || {},
    data: parsed
  });
}

module.exports = handler;
/* Vercel 기본 상한은 10초다. 강의 대본 한 편은 그 안에 안 끝난다.
   handler 를 내보낸 **뒤에** 붙여야 한다 — 앞에 두면 module.exports 대입이 지운다. */
module.exports.config = { maxDuration: 60 };
