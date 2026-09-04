/* SMEAG StudyGround — tools/source_docs.mjs : 세트 번호 → 원본 docx 세 장의 실제 파일명.
 *
 * 왜 이름을 적어 두지 않는가
 *   원본 문서의 이름은 세트마다 다르다. 지금까지만 해도 세 벌이다.
 *     SET 9   'NEW TOEFL MOCK TEST SET  9.docx'      (SET 앞뒤 공백 두 칸)
 *     SET 10  'NEW TOEFL MOCK TEST SET 10 Questions.docx' · 'SET 10 ANSWER KEY.docx'
 *     SET 11  'NEW TOEFL SET 11.docx'                 · 'SET 11 ANWER KEY.docx'  (오타)
 *     SET 12  'NEW TOEFL SET 12.docx'                 · 'SET 12 ANWER KEY.docx'
 *   도구가 이름을 한 벌만 알고 있으면 다음 세트에서 "원본을 찾지 못했습니다" 로 멈춘다
 *   (build_voices_manifest.mjs 가 SET 10 이름만 알아 SET 11·12 에서 그렇게 멈췄다).
 *   문서를 받는 사람이 파일 이름을 맞춰 주기를 기대하는 대신, 이름을 읽어서 고른다.
 *
 * 고르는 규칙 — 폴더의 .docx 중 그 세트 번호를 달고 있는 것만 보고,
 *   script  : 이름에 SCRIPT
 *   answers : 이름에 ANSWER KEY / ANWER KEY (오타 포함)
 *   questions: 나머지 하나
 * 후보가 여럿이면 고르지 않고 멈춘다 — 어느 것이 정본인지는 사람이 정할 일이다.
 */
import fs from 'node:fs';
import path from 'node:path';

const SCRIPT_RE = /\bscripts?\b/i;
const ANSWER_RE = /\bans?wer\s*key\b/i;   /* 'ANWER KEY' 오타까지 받는다 */

/** 세트 번호를 달고 있는 .docx 만 남긴다. 'SET 1' 이 'SET 12' 를 물지 않게 경계를 본다. */
function forSet(files, setNo) {
  var re = new RegExp('set\\s*0*' + setNo + '(?![0-9])', 'i');
  return files.filter(function (f) {
    return /\.docx$/i.test(f) && !/^~\$/.test(f) && re.test(f);
  });
}

/**
 * 원본 docx 가 놓이는 자리. 저장소 안(작업 사본)과 kenneth-brain 볼트 둘 다 본다 —
 * build_set11.mjs 는 볼트를, build_voices_manifest.mjs 는 저장소를 보고 있었다.
 * @param {string} sg2  studyground/sg2 절대경로
 */
export function sourceDirs(sg2) {
  const repo = path.dirname(path.dirname(sg2));            // .../smeag-TOFEL 자료
  const home = path.dirname(repo);                         // 저장소를 담고 있는 폴더(사용자 홈)
  return [repo, path.join(home, 'kenneth-brain', path.basename(repo))]
    .filter((d, i, a) => a.indexOf(d) === i && fs.existsSync(d));
}

/** 여러 후보 폴더에서 처음 다 갖춰진 곳을 고른다. */
export function findSourceDocsIn(dirs, setNo) {
  const errs = [];
  for (const d of dirs) {
    try { return findSourceDocs(d, setNo); } catch (e) { errs.push(e.message); }
  }
  throw new Error(errs.join('\n'));
}

/**
 * @param {string} dir    원본 docx 폴더
 * @param {number} setNo  세트 번호
 * @return {{questions:string, script:string, answers:string, dir:string}}
 * @throws 후보가 없거나 여럿이면 무엇이 있었는지 적어 던진다.
 */
export function findSourceDocs(dir, setNo) {
  const all = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  const mine = forSet(all, setNo);
  const script = mine.filter((f) => SCRIPT_RE.test(f));
  const answers = mine.filter((f) => ANSWER_RE.test(f));
  const questions = mine.filter((f) => !SCRIPT_RE.test(f) && !ANSWER_RE.test(f));

  const trouble = [];
  [['문제지', questions], ['스크립트', script], ['정답지', answers]].forEach(function (pair) {
    if (!pair[1].length) trouble.push(pair[0] + ' 를 찾지 못했습니다.');
    else if (pair[1].length > 1) trouble.push(pair[0] + ' 후보가 여럿입니다: ' + pair[1].join(' · '));
  });
  if (trouble.length) {
    throw new Error('SET ' + setNo + ' 원본 docx (' + dir + ')\n  '
      + trouble.join('\n  ') + '\n  그 폴더에서 SET ' + setNo + ' 로 보이는 것: '
      + (mine.length ? mine.join(' · ') : '없음'));
  }
  return { dir: dir, questions: questions[0], script: script[0], answers: answers[0] };
}

/** 찾은 이름을 절대경로로. */
export function sourcePaths(dir, setNo) {
  const f = findSourceDocs(dir, setNo);
  return {
    names: f,
    questions: path.join(dir, f.questions),
    script: path.join(dir, f.script),
    answers: path.join(dir, f.answers)
  };
}
