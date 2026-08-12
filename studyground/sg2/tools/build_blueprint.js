#!/usr/bin/env node
/* SMEAG StudyGround — 콘텐츠 팩에서 "청사진"만 뽑아낸다.
 *
 * 왜 필요한가
 *   AI 로 세트를 만들 때 모양까지 AI 에게 맡기면 매번 다른 시험이 나온다. 문항 수도
 *   모듈 구성도 흔들리고, 그러면 config/timing.toefl.json 의 시간 배분과 어긋난다.
 *   그래서 **모양은 여기서 고정하고 AI 에게는 빈 칸만 준다.**
 *
 *   청사진은 지어낸 것이 아니라 이미 치러 본 세트(SET 9)에서 뽑는다 — 리딩 모듈이
 *   왜 2개이고 클로즈가 왜 10문항인지는 ETS 서식이 그렇기 때문이고, 그 사실이
 *   기록된 곳은 문서가 아니라 팩이다.
 *
 * 쓰는 법
 *   node tools/build_blueprint.js                 # SET 9 → config/blueprint.toefl.json
 *   node tools/build_blueprint.js assets/set1.js SMEAG_SET1 config/blueprint.x.json
 *
 * 뽑는 것은 **구조**뿐이다 — 섹션·모듈·블록·문항 수·유형·지시문·본문 분량.
 * 지문 내용은 한 글자도 옮기지 않는다(그대로 옮기면 AI 가 베낀다).
 *
 * 생성 예산(단어 수 범위·주제 영역)은 구조에서 나오지 않는다. 이 스크립트가 원본의
 * 실제 분량에서 ±20% 범위를 계산해 넣어 두면, 사람이 파일을 열어 손보면 된다.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const packFile = process.argv[2] || 'assets/set9.js';
const globalName = process.argv[3] || 'SMEAG_SET9';
const outFile = process.argv[4] || 'config/blueprint.toefl.json';

global.window = global;
require(path.join(ROOT, packFile));
const pack = global[globalName];
if (!pack || !pack.sections) {
  console.error('팩을 읽지 못했습니다: ' + packFile + ' → window.' + globalName);
  process.exit(1);
}

/* 섹션 순서. 팩마다 배열 순서가 제각각이라 여기서 시험 순서로 한 번 세운다 —
   청사진 순서가 곧 AI 생성 결과의 섹션 순서다. 목록에 없는 섹션은 뒤에 그대로 남긴다. */
const SECTION_ORDER = ['reading', 'listening', 'writing', 'speaking'];
function sectionRank(id) {
  const i = SECTION_ORDER.indexOf(id);
  return i < 0 ? SECTION_ORDER.length : i;
}

/** 단어 수. 지문 분량을 "몇 자" 가 아니라 "몇 단어" 로 적어야 AI 에게 지시가 된다. */
function words(s) {
  return String(s || '').trim().split(/\s+/).filter(Boolean).length;
}

/** n 을 중심으로 ±pct 범위. 10 단위로 반올림해 프롬프트에 적기 좋게 만든다. */
function band(n, pct) {
  const d = Math.max(10, Math.round((n * (pct || 0.2)) / 10) * 10);
  return { min: Math.max(10, Math.round((n - d) / 10) * 10), max: Math.round((n + d) / 10) * 10 };
}

/** 블록 하나 → 청사진 조각. 내용은 버리고 크기만 남긴다. */
function blockSpec(blk) {
  const qs = blk.questions || [];
  const kinds = {};
  qs.forEach(function (q) { kinds[q.kind] = (kinds[q.kind] || 0) + 1; });

  const spec = {
    kind: blk.kind,
    instruction: blk.instruction || '',   // 'Read a notice.' — 지시문은 서식이라 그대로 쓴다
    questions: qs.length,
    questionKinds: kinds
  };

  if (blk.template) spec.templateWords = band(words(blk.template));
  if (blk.paragraphs) {
    spec.paragraphs = blk.paragraphs.length;
    spec.passageWords = band(blk.paragraphs.map(words).reduce(function (a, b) { return a + b; }, 0));
  }
  if (blk.script) spec.scriptWords = band(words(blk.script));
  if (blk.perQuestionAudio) spec.perQuestionAudio = true;
  if (blk.image || (blk.images && blk.images.length)) spec.image = true;
  /* 스피킹 블록의 script 는 들려줄 대사가 아니라 **안내 방송** 이다(각 Task 첫 화면).
     문항의 script 와 뜻이 달라서, 분량은 블록이 아니라 문항 쪽에서 재야 한다 —
     안내 방송 길이를 따라 만들면 따라 말할 문장이 세 배로 길어진다. */
  if (blk.kind === 'record-set') {
    if (blk.script) spec.introScript = true;
    const per = qs.map(function (q) { return words(q.script); }).filter(Boolean);
    spec.scriptWords = per.length
      ? band(per.reduce(function (a, b) { return a + b; }, 0) / per.length, 0.4)
      : undefined;
    if (!spec.scriptWords) delete spec.scriptWords;
  }

  const minW = qs.filter(function (q) { return q.minWords; })[0];
  if (minW) spec.minWords = minW.minWords;

  /* 객관식 보기 개수 — 세트마다 다르면 안 되는 값이라 최빈값 하나로 못 박는다. */
  const counts = qs.filter(function (q) { return q.choices; }).map(function (q) { return q.choices.length; });
  if (counts.length) spec.choices = counts.sort()[Math.floor(counts.length / 2)];

  /* 응답형 문항의 시간 — repeat/interview 는 준비·발화 초가 문항에 박혀 있다. */
  const timed = qs.filter(function (q) { return q.respondSec; })[0];
  if (timed) { spec.prepSec = timed.prepSec; spec.respondSec = timed.respondSec; }

  /* 문장 조립은 슬롯 수가 곧 난이도다. */
  const slotted = qs.filter(function (q) { return q.slots; });
  if (slotted.length) {
    spec.slots = band(slotted.map(function (q) { return q.slots.length; })
      .reduce(function (a, b) { return a + b; }, 0) / slotted.length, 0.35);
  }
  return spec;
}

const blueprint = {
  schemaVersion: '1.0.0',
  id: 'toefl-essentials',
  label: 'New TOEFL',
  derivedFrom: pack.code || packFile,
  note: '구조만 담는다. 지문·문항 내용은 여기 없다 — AI 가 이 빈 칸을 채운다.',
  sections: pack.sections.slice().sort(function (a, b) {
    return sectionRank(a.id) - sectionRank(b.id);
  }).map(function (sec) {
    return {
      id: sec.id,
      label: sec.label,
      labelKo: sec.labelKo || '',
      timeLimitSec: sec.timeLimitSec == null ? null : sec.timeLimitSec,
      modules: sec.modules.map(function (mod) {
        return {
          id: mod.id,
          label: mod.label,
          blocks: mod.blocks.map(blockSpec)
        };
      })
    };
  })
};

/* ---- 빠진 분량 메우기 ----
   SET 9 리스닝 Module 1 은 원본 대본 문서에 대사가 통째로 없었다(set-import.js 가
   그때 warn 을 올린 그 자리다). 팩에 없으니 여기서도 안 뽑힌다. 그런데 AI 에게
   "몇 단어짜리 대화를 쓰라" 를 못 일러 주면 길이가 매번 달라진다.
   지시문과 문항 수가 같은 다른 블록 — 같은 서식의 같은 과제다 — 에서 빌려 온다.
   지어낸 숫자가 아니라 같은 세트 안의 같은 종류에서 온 숫자다. */
(function fillGaps() {
  const donors = [];
  blueprint.sections.forEach(function (s) {
    s.modules.forEach(function (m) {
      m.blocks.forEach(function (b) { if (b.scriptWords) donors.push(b); });
    });
  });
  const borrowed = [];
  blueprint.sections.forEach(function (s) {
    if (s.id !== 'listening') return;
    s.modules.forEach(function (m) {
      m.blocks.forEach(function (b) {
        if (b.scriptWords || b.perQuestionAudio) return;
        /* 1순위는 같은 지시문·같은 문항 수. 없으면 문항 수만 맞춘다 — 안내방송(announcement)
           대본은 이 세트 어디에도 없지만, 문항 2개짜리 음원의 길이는 서로 비슷하다. */
        const same = donors.filter(function (d) {
          return d.instruction === b.instruction && d.questions === b.questions;
        })[0];
        const near = same || donors.filter(function (d) { return d.questions === b.questions; })[0];
        if (!near) return;
        b.scriptWords = near.scriptWords;
        b.scriptWordsFrom = same ? 'same instruction and question count' : 'same question count';
        borrowed.push(m.id + ' ' + b.instruction);
      });
    });
  });
  if (borrowed.length) console.log('  대본 분량을 같은 서식 블록에서 빌림: ' + borrowed.length + '곳');
})();

/* 총 문항 수를 머리에 적어 둔다 — 청사진을 손보다 실수로 문항이 늘거나 준 것을
   사람이 파일 첫 화면에서 바로 알아채야 한다. */
let total = 0;
blueprint.sections.forEach(function (s) {
  let n = 0;
  s.modules.forEach(function (m) { m.blocks.forEach(function (b) { n += b.questions; }); });
  s.questions = n;
  total += n;
});
blueprint.questions = total;

fs.writeFileSync(path.join(ROOT, outFile), JSON.stringify(blueprint, null, 2) + '\n');
console.log(outFile + ' — 문항 ' + total + '개, 섹션 ' + blueprint.sections.length + '개');
blueprint.sections.forEach(function (s) {
  console.log('  ' + s.id + ': 모듈 ' + s.modules.length + ' · 문항 ' + s.questions);
});
