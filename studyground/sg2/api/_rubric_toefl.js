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

module.exports = {
  EMAIL, DISCUSSION, REPEAT, INTERVIEW,
  MAX_SCORE: 5,
  normalizeKind, rubricFor, criteriaFor, isRepeat
};
