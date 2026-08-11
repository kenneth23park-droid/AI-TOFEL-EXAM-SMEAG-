#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""build_set9.py — SET 9 콘텐츠 팩 조립기.

입력 (읽기 전용):
  sg2/config/_set9_fragments/{reading,listening,writing,speaking}.json   ← 추출 담당자 산출물
  sg2/media/pictures/set9/mapping.json                                   ← docx 이미지 앵커표
  sg2/media/audio/set9/*.mp3                                             ← TTS 담당자 산출물
출력:
  sg2/assets/set9.js   (window.SMEAG_SET9, ES5, 빌드 없음)

하는 일은 아래뿐이고, 원본에 있는 문항 텍스트는 한 글자도 새로 만들지 않는다
(원본이 통째로 빠뜨린 것 — 아래 4)의 insert 마커 — 만 예외이며 출처를 팩에 표시한다):
  1) fragments 의 논리적 오디오 id → 디스크에 실재하는 파일명으로 리졸브
     (TTS 담당자는 'l1-q01.mp3', 추출 담당자는 'set9-L1-q01.mp3' 로 서로 다른 규칙을 썼다).
     실재하지 않으면 audio 필드를 **떼고** warnings 에 남긴다 — 깨진 src 를 내보내지 않는다.
  2) mapping.json 의 r:embed 앵커 순서대로 삽화를 문항/블록에 붙인다.
  3) reading+listening 의 정답을 answerKey 로 평탄화한다.
  4) kind:"insert" 문항이 붙은 지문 본문에 삽입 지점 마커 {{A}}~{{D}} 를 심는다
     (원본 docx 에 마커가 없다 — INSERT_MARKERS 주석 참조, markerOrigin/markerNote 로 표시).

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
#
# ── 확장자 .webp (2026-08-10) ───────────────────────────────────────────────
# docx 에서 뽑은 png 는 문서에 박혀 있던 축소본이라 화자 사진이 116×184 밖에 안 된다.
# 같은 인물·같은 포즈의 800×1200 원본이 media/pictures/ 루트에
# "TOEFL Listening Image (…).webp" 로 이미 들어와 있어 그걸 set9/ 로 옮겨 쓴다.
# png 원본은 mapping.json 의 근거로 남겨 두되 화면에서는 쓰지 않는다.
# speaker-e 는 docx 에서 speaker-a 와 같은 인물이었다 — Q1-12 화자가 4명뿐이 되므로
# 남는 인물(데님셔츠·안경)로 돌려 5명을 채웠다. 그 인물은 L2 12-15 강의 화자와 겹치는데,
# 고해상도 원본이 8장뿐이라 9자리 중 한 번의 재사용은 피할 수 없다. 같은 블록 안이 아니라
# 모듈이 다른 두 자리로 밀어 둔 것이다.
#
# ── 목소리 성별과 사진 성별 맞추기 (2026-08-11) ─────────────────────────────
# docx 가 넘겨준 앵커 순서를 그대로 쓰면 사진은 docx 편집자가 아무렇게나 붙인 것이라
# TTS 배역(config/set9-voice-casting.json)의 성별과 어긋난다 — 실제로 M1 Q1-6 과
# M2 Q1-2 가 남녀가 뒤바뀐 채 나가고 있었다(Q2 는 남성 Liam 목소리에 여성 사진).
# 짧은 응답 문항은 사진 한 장이 곧 화자이므로, 이제 배역표의 gender 를 기준으로 배정한다.
#
# 얼굴 → 성별 (파일 실물 기준. tests/test_speaker_images.py 의 SET9_FACE_GENDER 와 같아야 한다)
#   a 남 · 20대 아시아계        b 여 · 20대 아시아계
#   c 남 · 30~40대 백인(민머리)  d 여 · 40대 백인
#   e 남 · 30대 흑인(안경)       f 여 · 40대 흑인  ← 2026-08-11 추가(여성 얼굴이 둘뿐이었다)
#
# 화자 캐릭터 → 얼굴 (한 캐릭터는 세트 내내 같은 얼굴. 이웃한 두 문항은 다른 얼굴)
#   Ava·Zoe·Lily → b   Mia·Alice·Ivy → d   Emma → f
#   Liam·Noah → a      Mason·Ethan → c     Henry·Oliver → e
#
# M1 Q1-12 화자: Ava Liam Mia Mason Alice Henry Lily Noah Emma Ethan Zoe Oliver
# M2 Q1-3  화자: Ava Emma Ivy
L1_Q1_12_IMAGES = ['b', 'a', 'd', 'c', 'd', 'e', 'b', 'a', 'f', 'c', 'b', 'e']
L2_Q1_3_IMAGES = ['b', 'f', 'd']
PIC_EXT = '.webp'
L2_BLOCK_IMAGES = {
    'Questions 4-5': 'l2-q4-5-conversation' + PIC_EXT,
    'Questions 6-7': 'l2-q6-7-conversation' + PIC_EXT,
    'Questions 8-11': 'l2-q8-11-talk' + PIC_EXT,
    'Questions 12-15': 'l2-q12-15-talk' + PIC_EXT,
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


# ---------------------------------------------------------------- insert 마커 배치
#
# kind:"insert" 문항은 본문에 삽입 지점 표식이 있어야 성립한다. 렌더러
# (sg2/assets/exam-render-reading.js 의 markerTokens)는 /\{\{([A-D])\}\}/ 로 문단을 쪼개
# 클릭 가능한 rd-marker 버튼을 만든다. 마커가 0개면 본문 어디에도 A~D 가 없는 채로
# "Position A~D" 라디오 4개만 뜨고, 응시자는 그 문항을 풀 수 없다(SET 1 은 set1.js 의
# 로마 도로 지문처럼 한 문단 안에 {{A}}~{{D}} 를 갖고 있다 — 그 구조가 정본이다).
#
# 원본 확인 결과 (zipfile+re, 읽기 전용):
#   NEW TOEFL MOCK TEST SET  9.docx 의 "Benefits of Green Roofs" 지문은 본문 문단이 아니라
#   **텍스트박스 안에 있다**. 조상 태그를 끝까지 따라가면
#     w:body > w:p > mc:AlternateContent > mc:Choice > w:drawing > wps:txbx > w:txbxContent > w:p
#   이다. 문서 안에서 이 지문이 두 번 잡히는 것은 사본이 둘이어서가 아니라,
#   같은 텍스트박스를 mc:Choice(w:drawing/wps:txbx)와 mc:Fallback(w:pict/v:textbox)이
#   중복 기술하기 때문이다 — extract_set9_reading.py 머리말의 주의점 2)와 같은 사정이다.
#   그 mc:AlternateContent 블록 전체(약 9.2KB)의 w:t 를 텍스트박스 내부까지 전수 추출해
#   3,106자를 얻었고 **그 안에 A/B/C/D 표식이 하나도 없다**(w:sym 0개, 마커로 쓸 만한
#   기호 문자 0개, 한두 글자짜리 w:t 조각 0개). 즉 파싱 손실이 아니라 원본 자체가
#   마커를 빠뜨렸다. 15번 문항의 지시문("Look at the four letters (A, B, C, and D) in the
#   passage")과 선택지 4개는 정상적으로 있다.
#   ※ 나중에 원본을 재확인하려는 사람에게 — 본문 <w:p> 만 훑으면 이 지문은 아예 잡히지
#     않는다. 반드시 w:txbxContent 안쪽까지 내려가서 확인할 것.
#
# 그래서 마커 위치는 여기서 집필한다. 근거 없는 값을 지어내지 않는다는 규약에 따라
# 블록에 markerOrigin:"authored" + markerNote 를 남긴다(_set9_l2/*.json 의
# scriptOrigin/scriptNote 와 같은 패턴). 원본 마커가 확보되면 이 표만 갈아끼우면 된다.
#
# 배치 근거 — 삽입 문장은
#   "These factors must be carefully weighed against the environmental and economic
#    benefits described above."
# 이고 정답은 D(answer:3). "These factors" 는 복수 선행사(비용·유지관리·하중·구조보강)를
# 요구하고, "benefits described above" 는 앞에 이점 서술이 끝나 있어야 함을 요구한다.
# 따라서 정답은 단점 문단(마지막 문단)이 다 끝난 뒤다.
# 오답도 문법적으로는 붙을 만한 자리에 둔다(너무 뻔하면 문항이 죽는다):
#   A = 이점 문단 중간   — 앞에 복수 명사(insects, birds, wildlife)가 있어 지시어가 걸리는 듯 보인다.
#   B = 이점 문단 끝     — 바로 뒤가 However 단점 문단이라 "요약 자리"로 착각하기 쉽다.
#   C = 단점 문단 중간   — 앞 문장이 investment + maintenance 두 factor 라 복수 선행사가 성립한다.
#                          그러나 뒤에 하중·구조보강이 더 나오므로 요약이 이르다 → 오답.
#   D = 단점 문단 끝     — factor 가 전부 열거된 뒤, 앞의 이점과 견주는 마무리. 정답.
#
# anchor 는 fragments 원문과 글자 단위로 일치해야 하고 문단 안에서 유일해야 한다.
# 불일치하면 warning 을 남기고 건너뛴다(조용한 오적용 방지).

MARKER_LETTERS = ['A', 'B', 'C', 'D']

INSERT_MARKERS = {
    'R2-15': {
        'blockTitle': 'Benefits of Green Roofs',
        # (문단 index, 이 문자열 바로 뒤에 마커를 붙인다, 글자)
        'placements': [
            (3, 'in otherwise barren urban environments.', 'A'),
            (3, 'supply local restaurants and community markets.', 'B'),
            (4, 'substantial initial investment and ongoing maintenance costs.', 'C'),
            (4, 'which can limit installation options for older buildings.', 'D'),
        ],
        'origin': 'authored',
        'note': u'원본 NEW TOEFL MOCK TEST SET  9.docx 의 이 지문에는 A/B/C/D 표식이 '
                u'아예 없다. 이 지문은 본문 문단이 아니라 텍스트박스(w:txbxContent) 안에 '
                u'있고 mc:Choice/mc:Fallback 으로 두 번 기술되는데, 텍스트박스 내부 w:t 까지 '
                u'전수 추출해 확인해도 마커도 w:sym 도 없다. '
                u'마커가 없으면 렌더러가 삽입 지점 버튼을 하나도 만들지 못해 문항이 성립하지 '
                u'않으므로, 정답 D(answer:3) 제약과 지시어 "These factors"/"benefits described '
                u'above" 의 선행사 요건에 맞춰 네 자리를 tools/build_set9.py 에서 집필했다. '
                u'D = 단점 문단이 끝난 자리(모든 factor 열거 후), A·B·C 는 문법적으로는 붙을 만한 '
                u'오답 자리. 원본에서 실제 마커 위치가 확보되면 build_set9.py 의 INSERT_MARKERS '
                u'표를 교체하고 이 필드를 지울 것.',
    },
}


def apply_insert_markers(sections):
    """insert 문항이 붙은 지문 본문에 {{A}}~{{D}} 를 심는다. 출처는 블록에 남긴다."""
    placed_blocks, placed_marks = 0, 0
    seen = set()
    for sec in sections:
        for mod in sec['modules']:
            for blk in mod['blocks']:
                qs = blk.get('questions') or []
                ins = [q for q in qs if q.get('kind') == 'insert']
                if not ins:
                    continue
                paras = blk.get('paragraphs')
                if not paras:
                    warnings.append('insert question in a block without paragraphs: ' +
                                    ', '.join(q['id'] for q in ins))
                    continue

                spec = None
                for q in ins:
                    if q['id'] in INSERT_MARKERS:
                        spec = INSERT_MARKERS[q['id']]
                        seen.add(q['id'])
                        break
                if not spec:
                    # 이미 원본에 마커가 있으면 그대로 두고, 없으면 결손으로 남긴다.
                    if not re.search(r'\{\{[A-D]\}\}', ' '.join(paras)):
                        warnings.append('insert question has no markers and no placement '
                                        'table entry: ' + ', '.join(q['id'] for q in ins))
                    continue

                title = spec.get('blockTitle')
                if title and blk.get('title') != title:
                    warnings.append('insert marker placement skipped: block title is ' +
                                    str(blk.get('title')) + ', expected ' + title)
                    continue

                ok = True
                for idx, anchor, letter in spec['placements']:
                    if idx >= len(paras):
                        warnings.append('insert marker skipped (paragraph ' + str(idx) +
                                        ' out of range) for ' + str(blk.get('title')))
                        ok = False
                        continue
                    if paras[idx].count(anchor) != 1:
                        warnings.append('insert marker skipped for ' + str(blk.get('title')) +
                                        '/' + letter + ': anchor text not found exactly once '
                                        'in paragraph ' + str(idx))
                        ok = False
                        continue
                    paras[idx] = paras[idx].replace(anchor, anchor + ' {{' + letter + '}}')
                    placed_marks += 1

                joined = ' '.join(paras)
                for letter in MARKER_LETTERS:
                    if joined.count('{{' + letter + '}}') != 1:
                        warnings.append('insert marker count is not exactly 1 for ' +
                                        str(blk.get('title')) + '/' + letter)
                        ok = False

                # 정답 index 에 대응하는 마커가 실제로 있는가
                for q in ins:
                    a = q.get('answer')
                    if isinstance(a, int) and 0 <= a < len(MARKER_LETTERS):
                        if '{{' + MARKER_LETTERS[a] + '}}' not in joined:
                            warnings.append('insert answer marker missing for ' + q['id'] +
                                            ' (answer=' + str(a) + ')')
                            ok = False

                if ok:
                    placed_blocks += 1
                blk['markerOrigin'] = spec.get('origin', 'authored')
                blk['markerNote'] = spec.get('note', '')

    unknown = set(INSERT_MARKERS) - seen
    for qid in sorted(unknown):
        warnings.append('insert marker table target not found in the pack: ' + qid)
    return placed_blocks, placed_marks


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
                        p = pic('l1-q1-12-speaker-' + L1_Q1_12_IMAGES[i] + PIC_EXT, where0 + '/' + q['id'])
                        if p:
                            q['image'] = p
            elif mod['id'] == 'L2' and blk.get('perQuestionAudio'):
                for i, q in enumerate(qs):
                    if i < len(L2_Q1_3_IMAGES):
                        p = pic('l1-q1-12-speaker-' + L2_Q1_3_IMAGES[i] + PIC_EXT, where0 + '/' + q['id'])
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
    n_blocks, n_marks = apply_insert_markers(sections)
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
    print('  insert markers: %d markers over %d passage blocks '
          '(markerOrigin/markerNote kept on the block)' % (n_marks, n_blocks))
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
