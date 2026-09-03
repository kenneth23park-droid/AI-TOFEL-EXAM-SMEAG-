/* SMEAG StudyGround — 저장된 세트에 보기 없는 객관식이 남지 않게 막는다.
 *
 * 왜. SET 11 Reading 34번이 "choices": [] 인 채로 배포된 적이 있다. 재빌드본을
 * 되돌리는 커밋에 보기 네 줄이 딸려 나갔는데, 이 파일들은 손으로 읽기엔 너무
 * 길어 아무도 알아채지 못했다. 학생은 문항 자리에서
 * "This question has no choices in the content pack." 만 보았다.
 *
 * 그래서 저장된 팩 자체를 검산한다 — 보기를 골라야 답이 되는 문항(mcq)은
 * 반드시 보기를 가져야 하고, 정답 번호는 그 보기 안을 가리켜야 한다.
 */
const fs = require('fs');
const path = require('path');

const SG2 = path.join(__dirname, '..', 'sg2');
const SETS = ['set9.js', 'set10.js', 'set11.js'];

const checks = [];
function check(name, ok, detail) { checks.push({ name, ok: !!ok, detail: detail || '' }); }

function load(file) {
  global.window = {};
  delete require.cache[require.resolve(path.join(SG2, 'assets', file))];
  require(path.join(SG2, 'assets', file));
  const pack = Object.values(global.window).find((v) => v && v.sections);
  if (!pack) throw new Error(file + ' 에서 세트 팩을 찾지 못했습니다.');
  return pack;
}

function questions(pack) {
  const out = [];
  (pack.sections || []).forEach((s) => (s.modules || []).forEach((m) => (m.blocks || []).forEach((b) => {
    (b.questions || []).forEach((q) => out.push({ section: s.id, q }));
  })));
  return out;
}

SETS.forEach((file) => {
  const pack = load(file);
  const all = questions(pack);
  const mcq = all.filter((e) => e.q.kind === 'mcq');

  check(pack.code + ' 객관식이 있다', mcq.length > 0, String(mcq.length));

  const empty = mcq.filter((e) => !Array.isArray(e.q.choices) || e.q.choices.length === 0);
  check(pack.code + ' 보기 없는 객관식이 없다', empty.length === 0,
    empty.map((e) => e.section + ' ' + (e.q.id || e.q.no)).join(', '));

  const blank = mcq.filter((e) => (e.q.choices || []).some((c) => !String(c || '').trim()));
  check(pack.code + ' 빈 보기 줄이 없다', blank.length === 0,
    blank.map((e) => e.section + ' ' + (e.q.id || e.q.no)).join(', '));

  const off = mcq.filter((e) => {
    if (!Array.isArray(e.q.choices) || !e.q.choices.length) return false;
    const a = e.q.answer;
    return !Number.isInteger(a) || a < 0 || a >= e.q.choices.length;
  });
  check(pack.code + ' 정답이 보기 안을 가리킨다', off.length === 0,
    off.map((e) => e.section + ' ' + (e.q.id || e.q.no) + '→' + e.q.answer).join(', '));
});

const failed = checks.filter((c) => !c.ok);
checks.forEach((c) => console.log((c.ok ? 'PASS ' : 'FAIL ') + c.name + (c.detail ? ' — ' + c.detail : '')));
if (failed.length) process.exit(1);
