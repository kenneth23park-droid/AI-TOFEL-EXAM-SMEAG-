/* ETS TOEFL 공식 채점 가이드 — AI 채점 프롬프트에 그대로 실어 보내는 원문.
 *
 * 단일 출처는 docs/reference/toefl-official-scoring-guides.md 이고(ETS 배포 PDF 전문),
 * 이 파일은 그 전문 중 **점수 구간 서술** 만 옮긴 사본이다. 여기 없는 기준을 새로
 * 지어내지 않는다 — 특히 "몇 단어 이상" 같은 길이 규칙은 ETS 가이드에 하나도 없다.
 * 밴드는 관련성·전개·언어 통제력(복창은 원문 충실도)으로만 갈린다.
 *
 * 현행 TOEFL 산출형 과제는 넷이고 **네 과제 모두 0~5** 다.
 *   Writing  · Write an Email                 email
 *   Writing  · Write for an Academic Discussion  discussion
 *   Speaking · Listen and Repeat              repeat
 *   Speaking · Take an Interview              interview
 *
 * 1~6 밴드는 여기서 나오지 않는다. 이 점수(0~5)를 영역별로 모아 0~30 으로 편 뒤
 * ETS 대응표를 태우는 일은 sg-band.js / scale.py 가 한다 — 채점과 환산을 갈라 두어야
 * 대응표가 바뀌어도 채점을 다시 하지 않는다.
 */

'use strict';

const EMAIL = `TASK: Write an Email (TOEFL Writing). Score 0-5.
The test taker is presented with a scenario in text regarding either an academic or a social setting.

Score 5 — A fully successful response. Effective, clearly expressed, consistent facility in the use of language. Typically: elaboration that effectively supports the communicative purpose; effective syntactic variety and precise, idiomatic word choice; consistent use of appropriate social conventions (politeness, register, organization of information, formulation of requests/refusals/criticisms); almost no lexical or grammatical errors other than those expected from a competent writer writing under timed conditions (common typos, there/their).
Score 4 — A generally successful response. Mostly effective and easily understood; language facility adequate to the task. Typically: adequate elaboration to support the communicative purpose; syntactic variety and appropriate word choice; mostly appropriate social conventions; few lexical or grammatical errors.
Score 3 — A partially successful response. Generally accomplishes the task; limitations in language facility may prevent parts of the message from being fully clear and effective. Typically: elaboration that partially supports the communicative purpose; a moderate range of syntax and vocabulary; some noticeable errors in structure, word forms, idiomatic language and/or social conventions.
Score 2 — A mostly unsuccessful response. Reflects an attempt to address the task but is mostly ineffective; the message may be limited or difficult to interpret. One or more of: limited or irrelevant elaboration; some connected sentence-level language with a limited range of syntax and vocabulary; an accumulation of errors in sentence structure and/or language use.
Score 1 — An unsuccessful response. Ineffective attempt; the message may be limited to the point of being unintelligible. One or more of: very little elaboration, if any; telegraphic language with a very limited range of vocabulary; serious and frequent errors in the use of language; minimal original language, any coherent language mostly borrowed from the stimulus.
Score 0 — Blank, rejects the topic, not in English, entirely copied from the prompt, entirely unconnected to the prompt, or arbitrary keystrokes.`;

const DISCUSSION = `TASK: Write for an Academic Discussion (TOEFL Writing). Score 0-5.
The test taker states and supports an opinion within the context of an online class discussion forum.

Score 5 — A fully successful response. A relevant and very clearly expressed contribution to the online discussion, demonstrating consistent facility in the use of language. Typically: relevant and well-elaborated explanations, exemplifications and/or details; effective use of a variety of syntactic structures and precise, idiomatic word choice; almost no lexical or grammatical errors other than those expected from a competent writer under timed conditions.
Score 4 — A generally successful response. A relevant contribution; facility in language allows the writer's ideas to be easily understood. Typically: relevant and adequately elaborated explanations, exemplifications and/or details; a variety of syntactic structures and appropriate word choice; few lexical or grammatical errors.
Score 3 — A partially successful response. A mostly relevant and mostly understandable contribution with some facility in the use of language. Typically: elaboration in which part of an explanation, example or detail may be missing, unclear or irrelevant; some variety in syntactic structures and a range of vocabulary; some noticeable lexical and grammatical errors in sentence structure, word form or idiomatic language.
Score 2 — A mostly unsuccessful response. An attempt to contribute, but limitations in language may make ideas hard to follow. Typically: ideas poorly elaborated or only partially relevant; a limited range of syntactic structures and vocabulary; an accumulation of errors in sentence structure, word forms or use.
Score 1 — An unsuccessful response. Limitations in language may prevent the expression of ideas. Typically: words and phrases indicating an attempt to address the task but with few or no coherent ideas; severely limited range of syntactic structures and vocabulary; serious and frequent errors; minimal original language, any coherent language mostly borrowed from the stimulus.
Score 0 — Blank, rejects the topic, not in English, entirely copied from the prompt, entirely unconnected to the prompt, or arbitrary keystrokes.`;

const REPEAT = `TASK: Listen and Repeat (TOEFL Speaking). Score 0-5.
The test taker repeats a sentence heard within an academic or campus-life scenario. You are given the exact prompt sentence and a transcript of what the test taker said.

Score 5 — The response exactly repeats the prompt: fully intelligible and an exact repetition.
Score 4 — Captures the meaning of the prompt but is not an exact repetition. Minor changes in words or grammar that do not substantially change meaning: one or two function words missing or changed; a content word missing (in longer stimuli) or replaced with a related word; markers of tense/aspect/number missing or incorrect; two words transposed. One or two content words may be ambiguous because of imprecise pronunciation; the speaker may self-correct but successfully completes the response.
Score 3 — Essentially full, but does not accurately capture the original meaning. Contains a majority of the content words or ideas; multiple function words changed or missing; one or more content words missing or substantively changed; the response is a full sentence. Intelligibility issues may cause occasional difficulty.
Score 2 — Missing a significant part of the prompt and/or highly inaccurate. A large portion is missing and important original meaning is left out; the speaker may repeat only the first part, then stop or fill with inaccurate content; not a self-standing sentence; intelligibility is low.
Score 1 — Captures very little of the prompt or is largely unintelligible. A minimal response of a few words; recognizable as an attempt to repeat, but mostly unintelligible.
Score 0 — No response, entirely unintelligible, no English, or content entirely unconnected to the prompt (including only "I don't know").`;

const INTERVIEW = `TASK: Take an Interview (TOEFL Speaking). Score 0-5.
The test taker participates in a simulated conversation with a prerecorded interviewer. You are given the interviewer's question and a transcript of the test taker's spoken answer.

Score 5 — A fully successful response: fully addresses the question, clear and fluent. On topic and well elaborated; good conversational pace with appropriate, natural pauses; pronunciation easily intelligible, rhythm and intonation effectively convey meaning; a range of accurate grammar and vocabulary allows clear expression of precise meanings.
Score 4 — A generally successful response: addresses the question and is reasonably clear. On topic and elaborated but may lack effective sentence-level connectors; good pace generally maintained with some pausing that minimally affects flow; intelligibility not impeded, though occasional words require minor effort; grammar and vocabulary adequate for general meanings most of the time.
Score 3 — A partially successful response: addresses the question but with limited elaboration and/or clarity. Generally on topic but elaboration relatively limited; frequent or lengthy pauses give a choppy pace, frequent fillers; intelligibility sometimes affected by word-level pronunciation or stress/rhythm; limited range and accuracy of grammar and vocabulary noticeably restrict precision.
Score 2 — A mostly unsuccessful response: an attempt that is not supported meaningfully and/or intelligibly. Minimally connected to the question with little or no relevant elaboration, or consists mainly of language from the question; intelligibility limited; very limited range of grammar and vocabulary.
Score 1 — An unsuccessful response: minimally addresses the question with very limited control of language. Only vaguely connected to language in the question; mostly unintelligible; mainly isolated words or phrases.
Score 0 — No response, entirely unintelligible, no English, or content entirely unconnected to the prompt (including only "I don't know").`;

/* task_kind → 루브릭. exam 팩이 쓰는 이름을 모두 받아 준다. */
const BY_KIND = {
  email: EMAIL,
  discussion: DISCUSSION,
  disc: DISCUSSION,
  repeat: REPEAT,
  listen_and_repeat: REPEAT,
  interview: INTERVIEW,
  take_an_interview: INTERVIEW
};

/* 표시용 축. 점수는 총체(0~5) 하나지만, 교사가 "왜 이 점수인가"를 볼 수 있게
 * 분석 축 코멘트를 함께 받는다. 축 점수는 섹션 환산에 쓰지 않는다 —
 * 섞으면 축 개수가 점수를 바꾼다(scale.py 의 _official_only 참조). */
const CRITERIA = {
  writing: ['Task Fulfilment', 'Organization & Development', 'Language Use', 'Vocabulary'],
  speaking: ['Delivery', 'Language Use', 'Topic Development']
};
const REPEAT_CRITERIA = ['Repetition Accuracy', 'Completeness'];

function normalizeKind(kind) {
  return String(kind || '').trim().toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_|_$/g, '');
}

/** task_kind(+skill)에 맞는 ETS 루브릭 원문. 모르면 skill 기준 기본값. */
function rubricFor(skill, kind) {
  const k = normalizeKind(kind);
  if (BY_KIND[k]) return BY_KIND[k];
  return String(skill).toLowerCase() === 'speaking' ? INTERVIEW : DISCUSSION;
}

/** 이 과제에서 교사에게 보여 줄 분석 축. */
function criteriaFor(skill, kind) {
  const k = normalizeKind(kind);
  if (k === 'repeat' || k === 'listen_and_repeat') return REPEAT_CRITERIA;
  return CRITERIA[String(skill).toLowerCase()] || CRITERIA.writing;
}

function isRepeat(kind) {
  const k = normalizeKind(kind);
  return k === 'repeat' || k === 'listen_and_repeat';
}

/* ── Listen and Repeat: 세어서 알 수 있는 것 ──────────────────────────────
 *
 * 이 과제의 루브릭은 판단이 아니라 셈에 가깝다. "그대로 따라 했는가"(5), "내용어 하나가
 * 빠졌는가"(4), "내용어의 과반은 남았는가"(3), "큰 덩어리가 빠졌는가"(2). 모델에게
 * 눈대중으로 세게 하면 같은 녹음이 부를 때마다 다른 점수를 받는다.
 *
 * 그래서 원문과 전사문의 차이는 여기서 **먼저 세고**, 그 사실을 프롬프트에 실어 보낸다.
 * 셈으로 못 넘는 선은 점수에도 씌운다(capFor) — 한 글자도 안 틀렸는데 4점을 주거나,
 * 내용어의 4분의 3이 사라졌는데 5점을 주는 일은 루브릭이 허락하지 않는다.
 *
 * 단, 상한만 씌우고 하한은 두지 않는다(정확히 옮겼을 때의 5점만 예외다). 발음이
 * 뭉개져 알아들을 수 없다거나 하는 것은 세어서 알 수 없고, 그건 모델이 낮출 몫이다. */

const MAX_SCORE = 5;

/* 기능어 — 빠지거나 바뀌어도 4점이 될 수 있는 말(루브릭의 "one or two function words").
 * 내용어와 갈라야 "무엇이 빠졌는가" 가 점수의 언어로 셈이 된다. */
const FUNCTION_WORDS = ('a an the and or but if so as at by for from in into of off on ' +
  'onto out over to up with without is am are was were be been being do does did doing ' +
  'have has had having will would shall should can could may might must not no nor than ' +
  'that this these those there here it its he she him her they them we us you your my ' +
  'his our their i me about after before when while because').split(' ');
const FN = {};
FUNCTION_WORDS.forEach(function (w) { FN[w] = 1; });

/** 채점에 쓰는 낱말 목록. 문장부호·대소문자·겹공백은 말의 차이가 아니다. */
function words(s) {
  return String(s == null ? '' : s)
    .replace(/[‘’ʼ′`]/g, "'")
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** 두 낱말 목록의 최장 공통 부분수열 — 어느 낱말이 살아남았는지 자리까지 맞춰 센다. */
function lcsFlags(a, b) {
  const n = a.length, m = b.length;
  const dp = [];
  for (let i = 0; i <= n; i++) dp.push(new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const keptA = new Array(n).fill(false), keptB = new Array(m).fill(false);
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { keptA[i] = keptB[j] = true; i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return { keptA, keptB };
}

/**
 * 원문과 전사문을 견준 **사실**. 판단은 하나도 들어 있지 않다.
 * @returns {{exact:boolean, refWords:number, saidWords:number,
 *            contentTotal:number, contentKept:number, contentRatio:number,
 *            missingContent:string[], missingFunction:string[], added:string[]}}
 */
function compareRepeat(reference, said) {
  const a = words(reference), b = words(said);
  const { keptA, keptB } = lcsFlags(a, b);

  const missingContent = [], missingFunction = [], added = [];
  let contentTotal = 0, contentKept = 0;
  a.forEach(function (w, i) {
    const isContent = !FN[w];
    if (isContent) contentTotal++;
    if (keptA[i]) { if (isContent) contentKept++; return; }
    (isContent ? missingContent : missingFunction).push(w);
  });
  b.forEach(function (w, i) { if (!keptB[i]) added.push(w); });

  return {
    exact: a.join(' ') === b.join(' ') && a.length > 0,
    refWords: a.length,
    saidWords: b.length,
    contentTotal: contentTotal,
    contentKept: contentKept,
    contentRatio: contentTotal ? contentKept / contentTotal : 0,
    missingContent: missingContent,
    missingFunction: missingFunction,
    added: added
  };
}

/**
 * 위의 사실이 허락하는 최고점. 루브릭 문장을 그대로 옮긴 선이다.
 *   그대로 따라 했다                    → 5 (상한이자 하한)
 *   한 글자라도 다르다                  → 4 ("not an exact repetition")
 *   내용어의 1/4 이상이 사라졌다        → 3 ("a majority of the content words")
 *   내용어의 절반 이상이 사라졌다       → 2 ("a large portion is missing")
 *   내용어의 3/4 이상이 사라졌다        → 1 ("captures very little")
 * 원문을 모르면(reference 없음) 아무 선도 긋지 않는다 — 셀 것이 없으면 세지 않는다.
 */
function capFor(facts) {
  if (!facts || !facts.contentTotal) return MAX_SCORE;
  if (facts.exact) return MAX_SCORE;
  if (facts.contentRatio < 0.25) return 1;
  if (facts.contentRatio < 0.5) return 2;
  if (facts.contentRatio < 0.75) return 3;
  return 4;
}

/** 프롬프트에 싣는 사실 블록. 모델이 다시 세지 않게, 이미 센 것을 보여 준다. */
function repeatFactsText(facts) {
  const list = function (arr) { return arr.length ? arr.join(', ') : '(none)'; };
  return 'OBJECTIVE COMPARISON (already computed by the server; do not recount, do not dispute):\n' +
    '- Exact repetition: ' + (facts.exact ? 'YES' : 'NO') + '\n' +
    '- Words in the prompt sentence: ' + facts.refWords + '; words spoken: ' + facts.saidWords + '\n' +
    '- Content words kept: ' + facts.contentKept + ' of ' + facts.contentTotal +
      ' (' + Math.round(facts.contentRatio * 100) + '%)\n' +
    '- Content words missing or changed: ' + list(facts.missingContent) + '\n' +
    '- Function words missing or changed: ' + list(facts.missingFunction) + '\n' +
    '- Words spoken that are not in the prompt: ' + list(facts.added) + '\n' +
    'Score from the guide using these counts. The server enforces the guide\'s own limits ' +
    'on top of your score, so a score the counts cannot support will simply be lowered.';
}

module.exports = {
  EMAIL, DISCUSSION, REPEAT, INTERVIEW,
  MAX_SCORE,
  normalizeKind, rubricFor, criteriaFor, isRepeat,
  words, compareRepeat, capFor, repeatFactsText
};
