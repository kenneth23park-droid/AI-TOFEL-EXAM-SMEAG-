#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""build_set9.py — SET 9 콘텐츠 팩 조립기.

입력 (읽기 전용):
  sg2/config/_set9_fragments/{reading,listening,writing,speaking}.json   ← 추출 담당자 산출물
  sg2/media/pictures/set9/mapping.json                                   ← docx 이미지 앵커표
  sg2/media/audio/set9/*.mp3                                             ← TTS 담당자 산출물
출력:
  sg2/assets/set9.js   (window.SMEAG_SET9, ES5, 빌드 없음)

하는 일은 3가지뿐이고 문항 텍스트는 한 글자도 만들지 않는다:
  1) fragments 의 논리적 오디오 id → 디스크에 실재하는 파일명으로 리졸브
     (TTS 담당자는 'l1-q01.mp3', 추출 담당자는 'set9-L1-q01.mp3' 로 서로 다른 규칙을 썼다).
     실재하지 않으면 audio 필드를 **떼고** warnings 에 남긴다 — 깨진 src 를 내보내지 않는다.
  2) mapping.json 의 r:embed 앵커 순서대로 삽화를 문항/블록에 붙인다.
  3) reading+listening 의 정답을 answerKey 로 평탄화한다.

표준 라이브러리만 사용. 실행:
  studyground/.venv/bin/python studyground/tools/build_set9.py
"""

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # .../studyground
SG2 = os.path.join(ROOT, 'sg2')
FRAG = os.path.join(SG2, 'config', '_set9_fragments')
AUTHORED = os.path.join(SG2, 'config', '_set9_l2')
AUDIO_DIR = os.path.join(SG2, 'media', 'audio', 'set9')
PIC_DIR = os.path.join(SG2, 'media', 'pictures', 'set9')
OUT = os.path.join(SG2, 'assets', 'set9.js')

AUDIO_REL = 'media/audio/set9/'
PIC_REL = 'media/pictures/set9/'

warnings = []


# ---------------------------------------------------------------- audio 리졸브

def audio_candidates(ref):
    """'media/audio/set9/set9-L1-q01.mp3' → 실제 파일명 후보들(우선순위 순)."""
    base = os.path.basename(ref)
    stem = base[:-4] if base.lower().endswith('.mp3') else base
    out = [stem]

    m = re.match(r'^set9-(L[12])-(.+)$', stem)
    if m:
        mod, rest = m.group(1).lower(), m.group(2)
        out.append(mod + '-' + rest)                 # set9-L1-q01 → l1-q01
        if not rest.startswith('q'):
            out.append(mod + '-q' + rest)            # set9-L1-13-14 → l1-q13-14

    m = re.match(r'^set9-(S[12])-(.+)$', stem)
    if m:
        mod, rest = m.group(1).lower(), m.group(2)
        out.append(mod + '-' + rest)
        if rest == 'intro':
            out.append(mod + '-instructions')        # set9-S1-intro → s1-instructions
        m2 = re.match(r'^q0*(\d+)$', rest)
        if m2:
            out.append(mod + '-q' + m2.group(1))     # set9-S1-q01 → s1-q1

    seen, uniq = set(), []
    for c in out:
        if c not in seen:
            seen.add(c)
            uniq.append(c)
    return uniq


def resolve_audio(ref, where):
    """실재 파일 경로(sg2 기준 상대)를 돌려주거나, 없으면 None + warning."""
    for cand in audio_candidates(ref):
        if os.path.exists(os.path.join(AUDIO_DIR, cand + '.mp3')):
            return AUDIO_REL + cand + '.mp3'
    warnings.append('audio missing for ' + where + ' (ref=' + ref +
                    '); audio field dropped so no broken src is emitted')
    return None


# ---------------------------------------------------------------- 삽화 배정
#
# 근거: sg2/media/pictures/set9/mapping.json 의 anchors[].paraIndex.
# 문항문서에서 r:embed 앵커 20개를 paraIndex 오름차순으로 늘어놓으면
#   194,198,202,206,210,214,218,222,227,231,235,238  → Listening M1 Q1-12 (12개, 4문단 간격)
#   364,368,373                                       → Listening M2 Q1-3
#   381,391,399,424                                   → Listening M2 4-5 / 6-7 / 8-11 / 12-15
#   497,498,499                                       → Writing 학술토론 아바타 3개
#   503..509                                          → Speaking Task1 Q1-7
#   512                                               → Speaking Task2
# 아래 표는 그 순서를 그대로 옮긴 것이다.

L1_Q1_12_IMAGES = ['a', 'b', 'c', 'd', 'e', 'b', 'd', 'c', 'd', 'e', 'b', 'c']
L2_Q1_3_IMAGES = ['e', 'c', 'b']
L2_BLOCK_IMAGES = {
    'Questions 4-5': 'l2-q4-5-conversation.png',
    'Questions 6-7': 'l2-q6-7-conversation.png',
    'Questions 8-11': 'l2-q8-11-talk.png',
    'Questions 12-15': 'l2-q12-15-talk.png',
}


def pic(name, where):
    if not os.path.exists(os.path.join(PIC_DIR, name)):
        warnings.append('picture missing for ' + where + ': ' + name + '; image dropped')
        return None
    return PIC_REL + name


# ---------------------------------------------------------------- 조립

def load(name):
    with open(os.path.join(FRAG, name), 'r', encoding='utf-8') as f:
        return json.load(f)


# ---------------------------------------------------------------- 집필 지문 배선
#
# Listening Module 2 Q4-15 의 대화/강의 본문은 SET 9 SCRIPT.docx 에 전사가 없다.
# 정답키 제약에 맞춰 새로 집필한 지문이 sg2/config/_set9_l2/<blockId>.json 에 있고
# (origin:"authored"), tts_set9.py 가 같은 파일로 mp3 를 만든다. 여기서는 그 원문을
# 블록에 script / scriptOrigin 으로 보존한다 — 재생성해도 배선이 유지되고, 관리자 화면이나
# 나중의 원본 교체 작업에서 "이 소리는 어디서 왔는가"를 팩만 보고 알 수 있어야 하기 때문이다.

def load_authored_scripts():
    """audioId -> 집필 지문 dict. 디렉터리가 없으면 빈 표(경고 후 진행)."""
    out = {}
    if not os.path.isdir(AUTHORED):
        warnings.append('authored script dir missing: config/_set9_l2; '
                        'L2 blocks will carry no script field')
        return out
    for name in sorted(os.listdir(AUTHORED)):
        if not name.endswith('.json'):
            continue
        with open(os.path.join(AUTHORED, name), 'r', encoding='utf-8') as f:
            blk = json.load(f)
        out[blk['audioId']] = blk
    return out


AUTHORED_SCRIPTS = load_authored_scripts()


def attach_script(blk, ref, where):
    """블록의 (리졸브 전) audio ref 로 집필 지문을 찾아 붙인다."""
    stem = os.path.basename(ref)
    if stem.lower().endswith('.mp3'):
        stem = stem[:-4]
    src = AUTHORED_SCRIPTS.get(stem)
    if not src:
        return
    blk['script'] = src['plainText']
    blk['scriptOrigin'] = src.get('origin', 'authored')
    blk['scriptNote'] = src.get('originNote', '')
    blk['scriptBlockId'] = src['blockId']
    blk['scriptKind'] = src['kind']


# ---------------------------------------------------------------- 원본 오타 교정
#
# NEW TOEFL MOCK TEST SET  9.docx 자체에 오타가 있다. blind 검증에서 6건이 나왔고,
# 그중 문법 오류형(physiology/allows, birds species, others genres)은 응시자가 내용을
# 몰라도 "문법적으로 온전한 선택지만 남기는" test-wiseness 로 정답을 좁힐 수 있게 만든다.
# 그래서 화면에는 교정본을 내보내되 원문 표기는 promptRaw / choicesRaw 로 보존하고,
# 무엇을 왜 고쳤는지 문항의 sourceCorrections[] 에 남긴다.
#
# 규칙:
#   * 선택지 순서는 절대 건드리지 않는다 → answer index 는 교정 전후로 동일하다.
#   * 아래 표의 'from' 은 docx 원문과 글자 단위로 일치해야 한다. 불일치하면 빌드가
#     warning 을 남기고 그 항목을 건너뛴다(조용한 오적용 방지).
#
# 원본 파싱 확인(zipfile+re, 읽기 전용)으로 확정한 사항:
#   L2-15 [1] "Classical composers were initially reluctant" 는 문장이 미완성으로 보이나
#   docx 의 해당 <w:p> 가 그 자리에서 끝난다(런 2개: "B." + " Classical composers were
#   initially reluctant"). 잘려 들어온 것이 아니라 원본이 그렇게 짧다. 내용을 지어낼 수
#   없으므로 교정하지 않고 note 로만 기록한다.

SOURCE_CORRECTIONS = {
    'L2-8': {
        'choices': [
            (0,
             'The physiology adaptations that allows birds to fly long distances',
             'The physiological adaptations that allow birds to fly long distances',
             'docx 원문 오타: 명사 physiology 가 한정어 자리에 쓰였고(→ physiological), '
             '복수주어 adaptations 에 allows 가 붙어 수일치가 깨져 있다(→ allow). '
             '오답 선택지만 비문이면 내용을 몰라도 소거되므로 test-wiseness 누출이다.'),
            (3,
             'The evolutionary origins of migratory behavior in birds species',
             'The evolutionary origins of migratory behavior in bird species',
             'docx 원문 오타: birds species → bird species (복합명사의 앞 요소는 단수).'),
        ],
    },
    'L2-10': {
        'choices': [
            (3,
             'To describe how birds have adapted to modem environments',
             'To describe how birds have adapted to modern environments',
             'docx 원문 오타: modem 은 modern 의 OCR/타이핑 오류.'),
        ],
    },
    'L2-14': {
        'prompt': (
            u'What is the speaker’s purpose in complaining jazz improvisation to having a conversation?',
            u'What is the speaker’s purpose in comparing jazz improvisation to having a conversation?',
            'docx 원문 오타: complaining X to Y 는 성립하지 않는 결합이고, 선택지 4개가 전부 '
            '"비유의 목적"을 묻는 형태다 → comparing 의 오타로 확정. 질문 자체가 뜻이 통하지 '
            '않으면 문항이 성립하지 않는다.'),
        'choices': [
            (3,
             'To explain why jazz feels more natural and accessible than others genres',
             'To explain why jazz feels more natural and accessible than other genres',
             'docx 원문 오타: others genres → other genres.'),
        ],
    },
}

# 교정하지 않고 기록만 하는 항목(원본 확인 결과 절단이 아님).
SOURCE_NOTES = {
    'L2-15': [
        {'target': 'choices[1]',
         'raw': 'Classical composers were initially reluctant',
         'action': 'left as-is',
         'why': u'문장이 미완성으로 보이나 NEW TOEFL MOCK TEST SET  9.docx 의 해당 문단이 '
                u'그 자리에서 끝난다(런 구성: "B." + " Classical composers were initially '
                u'reluctant"). 파싱 손실이 아니라 원본이 그렇게 짧다. 뒷부분을 지어낼 수 '
                u'없으므로 원문을 그대로 둔다. 정답은 [2] 이므로 채점에는 영향이 없다.'},
    ],
}


def apply_source_corrections(sections):
    """docx 원문 오타를 화면용 텍스트에만 반영하고 원문은 *Raw 로 보존한다."""
    fixed_q, fixed_items = 0, 0
    seen = set()
    for sec in sections:
        for mod in sec['modules']:
            for blk in mod['blocks']:
                for q in (blk.get('questions') or []):
                    qid = q['id']
                    for note in SOURCE_NOTES.get(qid, []):
                        seen.add(qid)
                        q.setdefault('sourceCorrections', []).append(dict(note))
                    spec = SOURCE_CORRECTIONS.get(qid)
                    if not spec:
                        continue
                    seen.add(qid)
                    before_answer = q.get('answer')
                    recs = q.setdefault('sourceCorrections', [])

                    if 'prompt' in spec:
                        raw, fix, why = spec['prompt']
                        if q.get('prompt') != raw:
                            warnings.append('source correction skipped for ' + qid +
                                            '/prompt: docx text no longer matches the '
                                            'recorded original')
                        else:
                            q['promptRaw'] = raw
                            q['prompt'] = fix
                            recs.append({'target': 'prompt', 'raw': raw,
                                         'corrected': fix, 'action': 'corrected',
                                         'why': why})
                            fixed_items += 1

                    if 'choices' in spec and q.get('choices'):
                        raws = list(q['choices'])
                        touched = False
                        for idx, raw, fix, why in spec['choices']:
                            if idx >= len(q['choices']) or q['choices'][idx] != raw:
                                warnings.append('source correction skipped for ' + qid +
                                                '/choices[' + str(idx) + ']: docx text no '
                                                'longer matches the recorded original')
                                continue
                            q['choices'][idx] = fix
                            recs.append({'target': 'choices[' + str(idx) + ']',
                                         'raw': raw, 'corrected': fix,
                                         'action': 'corrected', 'why': why})
                            touched = True
                            fixed_items += 1
                        if touched:
                            q['choicesRaw'] = raws

                    if q.get('answer') != before_answer:      # 절대 일어나면 안 된다
                        raise AssertionError('source correction changed the answer index '
                                             'for ' + qid)
                    fixed_q += 1

    unknown = (set(SOURCE_CORRECTIONS) | set(SOURCE_NOTES)) - seen
    for qid in sorted(unknown):
        warnings.append('source correction target not found in the pack: ' + qid)
    return fixed_q, fixed_items


def wire_listening(sec):
    for mod in sec['modules']:
        for blk in mod['blocks']:
            where0 = 'listening/' + mod['id'] + '/' + str(blk.get('heading'))

            if blk.get('audio'):
                attach_script(blk, blk['audio'], where0)
                got = resolve_audio(blk['audio'], where0)
                if got:
                    blk['audio'] = got
                else:
                    del blk['audio']
                    blk['audioMissing'] = True

            qs = blk.get('questions') or []
            for i, q in enumerate(qs):
                if q.get('audio'):
                    got = resolve_audio(q['audio'], where0 + '/' + q['id'])
                    if got:
                        q['audio'] = got
                    else:
                        del q['audio']
                        q['audioMissing'] = True

            # 삽화
            if mod['id'] == 'L1' and blk.get('perQuestionAudio'):
                for i, q in enumerate(qs):
                    if i < len(L1_Q1_12_IMAGES):
                        p = pic('l1-q1-12-speaker-' + L1_Q1_12_IMAGES[i] + '.png', where0 + '/' + q['id'])
                        if p:
                            q['image'] = p
            elif mod['id'] == 'L2' and blk.get('perQuestionAudio'):
                for i, q in enumerate(qs):
                    if i < len(L2_Q1_3_IMAGES):
                        p = pic('l1-q1-12-speaker-' + L2_Q1_3_IMAGES[i] + '.png', where0 + '/' + q['id'])
                        if p:
                            q['image'] = p
            elif mod['id'] == 'L2':
                name = L2_BLOCK_IMAGES.get(blk.get('heading'))
                if name:
                    p = pic(name, where0)
                    if p:
                        blk['image'] = p


def wire_speaking(sec):
    for mod in sec['modules']:
        for blk in mod['blocks']:
            where0 = 'speaking/' + mod['id']
            if blk.get('introAudio'):
                got = resolve_audio(blk['introAudio'], where0 + '/intro')
                if got:
                    blk['introAudio'] = got
                else:
                    del blk['introAudio']
            qs = blk.get('questions') or []
            for i, q in enumerate(qs):
                if q.get('audio'):
                    got = resolve_audio(q['audio'], where0 + '/' + q['id'])
                    if got:
                        q['audio'] = got
                    else:
                        del q['audio']
                        q['audioMissing'] = True
                name = ('s-task1-repeat-' + str(i + 1) + '.png') if mod['id'] == 'S1' else 's-task2-interview.png'
                p = pic(name, where0 + '/' + q['id'])
                if p:
                    q['image'] = p


def build_answer_key(sections):
    """reading + listening 의 채점 가능한 문항만 평탄화한다."""
    key = {}
    for sec in sections:
        if sec['id'] not in ('reading', 'listening'):
            continue
        for mod in sec['modules']:
            for blk in mod['blocks']:
                for q in (blk.get('questions') or []):
                    if 'answer' in q:
                        key[q['id']] = q['answer']
    return key


def count_questions(sec):
    n = 0
    for mod in sec['modules']:
        for blk in mod['blocks']:
            n += len(blk.get('questions') or [])
    return n


# ---------------------------------------------------------------- 직렬화 (ES5)

def js(value, indent):
    """JSON 을 ES5 리터럴로. json.dumps 로 나오는 값은 전부 유효한 ES5 표현식이다."""
    return json.dumps(value, ensure_ascii=False, indent=indent, sort_keys=False)


HEADER = """/* =============================================================
 * SMEAG TOEFL — NEW TOEFL SET 9 문제 데이터
 * 원본: NEW TOEFL MOCK TEST SET  9.docx
 *       SET 9 SCRIPT.docx
 *       SET 9 ANSWER KEY.docx
 * 생성: tools/build_set9.py  ← 손으로 고치지 말고 이 스크립트를 고쳐서 재생성할 것.
 * 검산: tests/test_compile_set9.js
 *
 * ES module 아님 — <script src> 로 로드되어 window.SMEAG_SET9 를 정의한다.
 * 화살표함수/const/let/템플릿리터럴 없음(빌드 없는 ES5).
 * ============================================================= */
(function () {
  'use strict';

"""

FOOTER = """
  window.SMEAG_SET9 = {
    code: 'SET9',
    title: 'NEW TOEFL SET 9',
    paths: { audio: 'media/audio/set9/', pics: 'media/pictures/set9/' },
    sections: [reading, listening, writing, speaking],
    answerKey: ANSWER_KEY,
    buildWarnings: BUILD_WARNINGS,

    /* --- 편의 helper (set1.js 와 동일 시그니처) ----------------- */
    allQuestions: function () {
      var out = [];
      this.sections.forEach(function (sec) {
        sec.modules.forEach(function (mod) {
          mod.blocks.forEach(function (blk) {
            (blk.questions || []).forEach(function (q) {
              out.push({ q: q, block: blk, module: mod, section: sec });
            });
          });
        });
      });
      return out;
    },
    findQuestion: function (id) {
      var hit = null;
      this.allQuestions().forEach(function (e) { if (e.q.id === id) hit = e; });
      return hit;
    }
  };
})();
"""


def main():
    reading = load('reading.json')
    listening = load('listening.json')
    writing = load('writing.json')
    speaking = load('speaking.json')

    for sec in (reading, listening, writing, speaking):
        sec.pop('_warnings', None)

    wire_listening(listening)
    wire_speaking(speaking)

    sections = [reading, listening, writing, speaking]
    n_q, n_items = apply_source_corrections(sections)
    answer_key = build_answer_key(sections)

    parts = [HEADER]
    for name, sec in (('reading', reading), ('listening', listening),
                      ('writing', writing), ('speaking', speaking)):
        parts.append('  var ' + name + ' = ' + js(sec, 2) + ';\n\n')
    parts.append('  /* reading + listening 객관식 정답 (SET 9 ANSWER KEY.docx). '
                 '값은 choices 의 index 또는 blank 정답 문자열이다. */\n')
    parts.append('  var ANSWER_KEY = ' + js(answer_key, 2) + ';\n\n')
    parts.append('  /* 빌드 시점에 감지된 결손. 런타임은 이 배열을 읽지 않는다(기록용). */\n')
    parts.append('  var BUILD_WARNINGS = ' + js(warnings, 2) + ';\n')
    parts.append(FOOTER)

    with open(OUT, 'w', encoding='utf-8') as f:
        f.write(''.join(parts))

    print('wrote ' + OUT)
    for sec in sections:
        print('  %-10s %d questions, %d modules' % (sec['id'], count_questions(sec), len(sec['modules'])))
    print('  answerKey entries: %d' % len(answer_key))
    print('  source corrections: %d edits over %d questions '
          '(originals kept in promptRaw/choicesRaw)' % (n_items, n_q))
    print('--- build warnings (%d) ---' % len(warnings))
    for w in warnings:
        print('  ! ' + w)

    # 자체 검산: 내보낸 미디어 경로가 전부 실재하는가
    missing = []
    for sec in sections:
        for mod in sec['modules']:
            for blk in mod['blocks']:
                for k in ('audio', 'introAudio', 'image'):
                    if blk.get(k) and not os.path.exists(os.path.join(SG2, blk[k])):
                        missing.append(blk[k])
                for q in (blk.get('questions') or []):
                    for k in ('audio', 'image'):
                        if q.get(k) and not os.path.exists(os.path.join(SG2, q[k])):
                            missing.append(q[k])
    print('--- emitted media existence: %s (%d refs missing) ---'
          % ('OK' if not missing else 'FAIL', len(missing)))
    for m in missing:
        print('  MISSING ' + m)
    return 1 if missing else 0


if __name__ == '__main__':
    sys.exit(main())
