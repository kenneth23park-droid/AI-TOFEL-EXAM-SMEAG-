/* AI 로 지은 세트가 문서에서 온 세트와 **같은 팩**이 되는지, 그리고 AI 가 틀렸을 때
 * 그것이 조용히 지나가지 않고 게이트로 올라오는지 본다.
 *
 * 모델은 부르지 않는다. /api/generate 자리에 가짜 응답기를 끼워 넣는다 — 여기서 확인할
 * 것은 "모델이 글을 잘 쓰나" 가 아니라 "모델이 준 것을 우리가 어떻게 다루나" 이고,
 * 후자는 돈을 쓰지 않고 전부 확인할 수 있다.
 *
 *   node tests/test_set_generate.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SG2 = path.join(HERE, '..', 'sg2');

globalThis.window = globalThis;
const IMPORT = require(path.join(SG2, 'assets/set-import.js'));
globalThis.SG_SET_IMPORT = IMPORT;
const GEN = require(path.join(SG2, 'assets/set-generate.js'));

const BP = JSON.parse(readFileSync(path.join(SG2, 'config/blueprint.toefl.json'), 'utf8'));

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔ ' + name.padEnd(38) + (detail || '')); }
  else { fail++; console.log('  ✘ ' + name.padEnd(38) + (detail || '')); }
}

/* ─────────────────────────────────────────── 가짜 모델
 *
 * 청사진이 요구하는 만큼을, 요구하는 모양으로 정확히 돌려주는 "완벽한 모델".
 * 이걸로 만든 세트에 stop 게이트가 하나라도 뜨면 그건 모델 탓이 아니라 우리 조립 탓이다.
 */
const WORDS = ('the quick brown fox jumps over a lazy dog while students review their notes ' +
  'in the campus library before the final examination begins next week').split(' ');
function filler(n, seed) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(WORDS[(i * 7 + seed) % WORDS.length]);
  return out.join(' ');
}

function fakeModel(task, spec, ctx) {
  const n = spec.questions || 0;
  if (task === 'topics') {
    return { topics: (ctx.slots || []).map((s, i) => ({ ref: s.ref, topic: 'topic number ' + i, genre: 'article', domain: 'campus' })) };
  }
  if (task === 'reading-cloze') {
    const answers = [];
    let tpl = 'This passage opens with a sentence that has no blank at all.';
    for (let i = 1; i <= n; i++) {
      const w = ['populations', 'experienced', 'complex', 'social', 'barriers', 'that',
        'economic', 'while', 'identity', 'often'][i % 10];
      answers.push({ answer: w, hint: w.slice(0, 3) });
      tpl += ' Then {{' + i + '}} follows.';
    }
    return { template: tpl + ' A closing sentence ends it.', blanks: answers };
  }
  if (task === 'reading-passage') {
    const paras = [];
    for (let i = 0; i < (spec.paragraphs || 3); i++) paras.push(filler(30, i) + '.');
    const wantInsert = !!(spec.questionKinds && spec.questionKinds.insert);
    if (wantInsert) paras[0] += ' {{A}} more text {{B}} more text {{C}} more text {{D}}';
    const qs = [];
    const mcqCount = n - (wantInsert ? 1 : 0);
    for (let i = 0; i < mcqCount; i++) {
      qs.push({
        kind: 'mcq', prompt: 'Question ' + i + ' about the passage?',
        choices: ['choice a' + i, 'choice b' + i, 'choice c' + i, 'choice d' + i],
        answer: i % 4,
        evidence: paras[i % paras.length].split(' ').slice(0, 9).join(' ')
      });
    }
    if (wantInsert) {
      qs.push({ kind: 'insert', sentence: 'These factors matter.', answer: 3,
        evidence: paras[0].split(' ').slice(0, 9).join(' ') });
    }
    return { title: 'A title', paragraphs: paras, questions: qs };
  }
  if (task === 'listening-drill') {
    const items = [];
    for (let i = 0; i < n; i++) {
      items.push({ script: 'Where is the ' + filler(4, i) + '?',
        choices: ['reply a' + i, 'reply b' + i, 'reply c' + i, 'reply d' + i], answer: i % 4 });
    }
    return { items };
  }
  if (task === 'listening-set') {
    const script = 'M: ' + filler(40, 3) + '.\nW: ' + filler(40, 9) + '.';
    const qs = [];
    for (let i = 0; i < n; i++) {
      qs.push({ prompt: 'Listening question ' + i + '?',
        choices: ['la' + i, 'lb' + i, 'lc' + i, 'ld' + i], answer: i % 4,
        evidence: script.split('\n')[i % 2].replace(/^[MW]: /, '').split(' ').slice(0, 9).join(' ') });
    }
    return { script, questions: qs };
  }
  if (task === 'writing-build') {
    const items = [];
    for (let i = 0; i < n; i++) {
      items.push({
        context: 'What happened ' + i + '?',
        sentence: 'She wanted to know which books I needed for the project.',
        chunks: [
          { text: 'She', fixed: false }, { text: 'wanted to know', fixed: false },
          { text: 'which books', fixed: true }, { text: 'I', fixed: false },
          { text: 'needed', fixed: false }, { text: 'for the project', fixed: false },
          { text: '.', fixed: true }
        ]
      });
    }
    return { items };
  }
  if (task === 'writing-email') {
    return { to: 'Christina', subject: 'An idea', situation: 'You are organising something.',
      bullets: ['Describe it.', 'Explain why.', 'Suggest a time.'] };
  }
  if (task === 'writing-discussion') {
    return { professor: 'Doctor Reyes – Ethics', prompt: 'Do you agree? Why?',
      posts: [{ name: 'Claire', text: 'I agree because…' }, { name: 'Mark', text: 'I disagree because…' }] };
  }
  if (task === 'speaking-set') {
    const items = [];
    for (let i = 0; i < n; i++) items.push({ script: 'Say this sentence number ' + i + ' please.' });
    return { introScript: 'Listen to the trainer and repeat.', items };
  }
  throw new Error('가짜 모델이 모르는 task: ' + task);
}

/** /api/generate 를 흉내 내는 fetch. */
function fetchWith(model) {
  return async function (url, init) {
    const body = JSON.parse(init.body);
    let data;
    try { data = model(body.task, body.spec || {}, body.context || {}); }
    catch (e) { return { ok: false, status: 502, json: async () => ({ error: e.message }) }; }
    return { ok: true, status: 200, json: async () => ({ provider: 'fake', model: 'fake-1', usage: { in: 100, out: 200 }, data }) };
  };
}

const base = { code: 'SET 10', blueprint: BP, provider: 'fake', model: 'fake-1', token: 't', concurrency: 4 };

console.log('\nAI 생성 — 조립');
const good = await GEN.generate({ ...base, fetch: fetchWith(fakeModel) });

const stops = good.gates.filter((g) => g.level === 'stop');
ok('멈춤 게이트 없음', stops.length === 0, stops.map((g) => g.message).join(' / '));
ok('총 문항 수가 청사진과 같다', good.stats.total === BP.questions, good.stats.total + ' / ' + BP.questions);
ok('섹션별 문항 수', BP.sections.every((s) => good.stats.bySection[s.id] === s.questions),
  JSON.stringify(good.stats.bySection));
/* 정답표(pack.answerKey)에 담기는 것은 객관식·빈칸 97개다. Build a Sentence 10문항의
   정본은 slots[].a 라서 정답표에 따로 실리지 않는다 — SET 9 팩이 107개를 담은 것은
   정답지 docx 가 완성 문장을 한 번 더 준 덕이고, 채점은 그 값을 쓰지 않는다
   (tests/test_autoscore_build.js). 아래에서 실제 채점 범위로 다시 확인한다. */
ok('정답표가 채워졌다', good.stats.answered === 97, good.stats.answered + '개');
ok('AI 표식이 남는다', good.pack.source === 'set-generate' && good.pack.summary.origin.by === 'ai',
  good.pack.source + ' · ' + good.pack.summary.origin.model);
ok('미검수 상태로 시작', good.pack.summary.origin.reviewed === false);
ok('토큰 사용량이 기록된다', good.usage.calls > 0 && good.usage.out > 0,
  good.usage.calls + '회 · out ' + good.usage.out);

/* 팩이 시험 화면이 아는 모양인가 — set9.js 와 같은 열쇠를 갖는지 본다. */
const s9 = (() => { globalThis.window = globalThis; require(path.join(SG2, 'assets/set9.js')); return globalThis.SMEAG_SET9; })();
/* 섹션 배열의 **순서**는 비교하지 않는다 — 시험 순서(config/timing.toefl.json)와 팩의
   배열 순서는 서로 다른 것이고, 팩마다 다르다. 같아야 하는 것은 어떤 모듈이 있느냐다. */
const modIds = (p) => p.sections.flatMap((s) => s.modules.map((m) => s.id + '/' + m.id)).sort().join(',');
ok('모듈 구성이 SET 9 와 같다', modIds(good.pack) === modIds(s9), modIds(good.pack));

/* 섹션은 id 로 찾는다. 배열 위치로 찾으면 순서가 바뀌는 날 조용히 엉뚱한 것을 본다. */
const sec = (pack, id) => pack.sections.filter((s) => s.id === id)[0];
ok('청사진 순서가 곧 팩의 섹션 순서', good.pack.sections.map((s) => s.id).join(',') ===
  BP.sections.map((s) => s.id).join(','), good.pack.sections.map((s) => s.id).join(','));

const withHelpers = IMPORT.withHelpers(good.pack);
ok('allQuestions() 가 돈다', withHelpers.allQuestions().length === BP.questions);

/* 팩이 만들어졌다는 것과 채점이 된다는 것은 다른 말이다. 만점 답안지를 넣어
   실제 채점기(sg-results.js)에 태워 본다 — SET 9 와 같은 107문항이 나와야 한다.
   여기가 어긋나면 시험은 치러지는데 라이팅이 0/0 으로 사라진다. */
const RESULTS = (() => {
  const w = globalThis;
  new Function('window', readFileSync(path.join(SG2, 'assets/sg-results.js'), 'utf8'))(w);
  return w.SG_RESULTS;
})();
const sheet = {};
withHelpers.allQuestions().forEach(({ q }) => {
  if (q.kind === 'blank' || q.kind === 'mcq' || q.kind === 'insert') sheet[q.id] = { v: q.answer };
  else if (q.kind === 'build') sheet[q.id] = { v: q.slots.filter((s) => s.t === 'b').map((s) => s.a) };
});
const marked = RESULTS.score(withHelpers, sheet);
ok('만점 답안이 만점으로 채점된다', marked.score === 107 && marked.total === 107,
  marked.score + '/' + marked.total);
ok('Build a Sentence 가 채점 범위에 든다', marked.bySection.writing.total === 10,
  marked.bySection.writing.total + '문항');

/* 경로 규칙 */
const l1 = sec(good.pack, 'listening').modules[0];
ok('문항별 음성 경로', l1.blocks[0].questions[0].audio === 'media/audio/set10/l1-q01.mp3',
  l1.blocks[0].questions[0].audio);
ok('블록 음성 경로', l1.blocks[1].audio === 'media/audio/set10/l1-q13-14.mp3', l1.blocks[1].audio);
const s1 = sec(good.pack, 'speaking').modules[0].blocks[0];
ok('스피킹 안내 음성 경로', s1.introAudio === 'media/audio/set10/s1-instructions.mp3', s1.introAudio);
ok('스피킹 안내문이 두 이름에 다 있다', !!s1.script && s1.script === s1.introScript);

/* 문장 조립 타일 */
const w1 = sec(good.pack, 'writing').modules[0].blocks[0].questions[0];
ok('타일은 학생이 놓을 조각만', w1.tiles.length === w1.answerTokens.length && w1.tiles.length === 5,
  w1.tiles.join(' | '));
ok('타일이 섞여 있다', w1.tiles.join('|') !== w1.answerTokens.join('|'), w1.tiles.join(' | '));

/* ─────────────────────────────────────────── 틀린 모델을 잡아내는가 */

console.log('\nAI 생성 — 잘못된 응답을 잡아내는가');

async function gatesFor(mut) {
  const r = await GEN.generate({ ...base, fetch: fetchWith((t, s, c) => mut(fakeModel(t, s, c), t, s)) });
  return r.gates.filter((g) => g.level === 'stop').map((g) => g.message).join(' || ');
}

ok('지문에 없는 근거를 잡는다',
  (await gatesFor((d, t) => {
    if (t === 'reading-passage') d.questions[0].evidence = 'this sentence appears nowhere in the passage at all';
    return d;
  })).includes('정답 근거가 지문'), '');

ok('빠진 문항을 잡는다',
  (await gatesFor((d, t) => { if (t === 'listening-set') d.questions.pop(); return d; }))
    .includes('청사진은'), '');

ok('힌트가 정답 앞글자가 아니면 잡는다',
  (await gatesFor((d, t) => { if (t === 'reading-cloze') d.blanks[0].hint = 'zz'; return d; }))
    .includes('앞글자가 아닙니다'), '');

ok('빈칸 자리가 없으면 잡는다',
  (await gatesFor((d, t) => { if (t === 'reading-cloze') d.template = d.template.replace('{{1}}', 'word'); return d; }))
    .includes('빈칸 자리'), '');

ok('삽입 자리 표식이 없으면 잡는다',
  (await gatesFor((d, t, s) => {
    if (t === 'reading-passage' && s.questionKinds && s.questionKinds.insert) d.paragraphs[0] = d.paragraphs[0].replace('{{C}}', '');
    return d;
  })).includes('삽입 자리'), '');

ok('보기 범위를 벗어난 정답을 잡는다',
  (await gatesFor((d, t) => { if (t === 'listening-set') d.questions[0].answer = 9; return d; }))
    .includes('보기 범위'), '');

ok('같은 보기가 두 번 있으면 잡는다',
  (await gatesFor((d, t) => { if (t === 'listening-drill') d.items[0].choices[1] = d.items[0].choices[0]; return d; }))
    .includes('같은 보기'), '');

ok('조각이 문장과 맞지 않으면 잡는다',
  (await gatesFor((d, t) => { if (t === 'writing-build') d.items[0].sentence = 'Something else entirely.'; return d; }))
    .includes('정답 문장이 되지 않습니다'), '');

/* 정답 쏠림은 warn 이다 — 만들 수는 있지만 사람이 봐야 한다. */
const skew = await GEN.generate({
  ...base,
  fetch: fetchWith((t, s, c) => {
    const d = fakeModel(t, s, c);
    if (d.questions) d.questions.forEach((q) => { if (q.kind !== 'insert') q.answer = 1; });
    if (d.items) d.items.forEach((q) => { q.answer = 1; });
    return d;
  })
});
ok('정답 쏠림은 경고로 올라온다',
  skew.gates.some((g) => g.level === 'warn' && g.message.includes('몰려 있습니다')),
  skew.gates.filter((g) => g.message.includes('몰려')).map((g) => g.message)[0] || '');

/* 한 블록이 실패해도 나머지는 살아남는가 */
const partial = await GEN.generate({
  ...base, noRetry: true,
  fetch: fetchWith((t, s, c) => {
    if (t === 'writing-email') throw new Error('일부러 실패');
    return fakeModel(t, s, c);
  })
});
ok('한 블록이 실패해도 나머지는 만들어진다',
  partial.stats.total === BP.questions - 1 &&
  partial.gates.some((g) => g.level === 'stop' && g.message.includes('생성 실패')),
  partial.stats.total + '문항');

/* ─────────────────────────────────────────── 슬롯별: 대본만 · 정답만 */

console.log('\n대본만 · 정답만');

const noScript = JSON.parse(JSON.stringify(good.pack));
const target = sec(noScript, 'listening').modules[1].blocks[1];
const targetAnswers = target.questions.map((q) => q.answer);
delete target.script;

const sf = await GEN.fillScripts(noScript, {
  ...base,
  fetch: fetchWith((t, s, c) => {
    if (t !== 'listening-script-for') throw new Error('엉뚱한 task: ' + t);
    const script = 'W: ' + filler(60, 2) + '.\nM: ' + filler(60, 5) + '.';
    return { script, answers: (c.questions || []).map((q) => ({
      answer: q.correctChoiceIndex, evidence: script.split(' ').slice(1, 10).join(' ') })) };
  })
});
ok('빠진 대본만 채운다', sf.filled === 1 && !!target.script, sf.filled + '곳');
ok('대본을 채워도 정답은 그대로', JSON.stringify(target.questions.map((q) => q.answer)) === JSON.stringify(targetAnswers));

const clash = JSON.parse(JSON.stringify(good.pack));
const ct = sec(clash, 'listening').modules[1].blocks[1];
delete ct.script;
const cf = await GEN.fillScripts(clash, {
  ...base,
  fetch: fetchWith(() => {
    const script = 'W: ' + filler(60, 2) + '.';
    return { script, answers: [{ answer: 3, evidence: script.split(' ').slice(1, 10).join(' ') },
      { answer: 3, evidence: script.split(' ').slice(1, 10).join(' ') }] };
  })
});
ok('대본이 정답지와 어긋나면 멈춘다',
  cf.gates.some((g) => g.level === 'stop' && g.message.includes('대본은')),
  cf.gates.filter((g) => g.level === 'stop').map((g) => g.message)[0] || '');

const noAns = JSON.parse(JSON.stringify(good.pack));
const ab = sec(noAns, 'reading').modules[1].blocks[1];
ab.questions.forEach((q) => { delete q.answer; });
const af = await GEN.fillAnswers(noAns, {
  ...base,
  fetch: fetchWith((t, s, c) => {
    if (t !== 'solve') throw new Error('엉뚱한 task: ' + t);
    return { answers: (c.questions || []).map(() => ({
      answer: 2, confidence: 'high', evidence: String(c.source).split(' ').slice(0, 9).join(' ') })) };
  })
});
ok('빈 정답을 풀어 채운다', af.filled === ab.questions.length && ab.questions[0].answer === 2, af.filled + '개');
ok('AI 가 매긴 정답에 표식이 남는다', ab.questions[0].answerOrigin === 'ai');
ok('정답표가 다시 걷힌다', noAns.answerKey[ab.questions[0].id] === 2);

const bogus = JSON.parse(JSON.stringify(good.pack));
const bb = sec(bogus, 'reading').modules[1].blocks[1];
bb.questions.forEach((q) => { delete q.answer; });
const bf = await GEN.fillAnswers(bogus, {
  ...base,
  fetch: fetchWith((t, s, c) => ({ answers: (c.questions || []).map(() => ({
    answer: 2, confidence: 'high', evidence: 'a quotation that is definitely not in the source text anywhere' })) }))
});
ok('근거 없는 정답은 채우지 않는다',
  bf.filled === 0 && bb.questions[0].answer === undefined &&
  bf.gates.some((g) => g.level === 'stop' && g.message.includes('근거가 본문에 없습니다')));

/* ─────────────────────────────────────────── 겹침 회피 */

console.log('\n주제 겹침 회피');
const avoid = GEN.avoidTopics([s9]);
ok('기존 세트에서 주제를 뽑는다', avoid.length > 10, avoid.length + '개');
ok('지문 전체를 보내지 않는다', avoid.every((t) => t.split(' ').length <= 14),
  '가장 긴 것 ' + Math.max(...avoid.map((t) => t.split(' ').length)) + '단어');

let sentAvoid = null;
await GEN.generate({
  ...base, avoid,
  fetch: fetchWith((t, s, c) => { if (t === 'topics') sentAvoid = c.avoid; return fakeModel(t, s, c); })
});
ok('피할 주제가 주제 배정에 전달된다', sentAvoid && sentAvoid.length === avoid.length);

console.log('\n' + (fail ? fail + '건 실패' : '전부 통과') + ' (' + pass + '건 통과)');
process.exit(fail ? 1 : 0);
