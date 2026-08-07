#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SMEAG TOEFL SET 9 — Listening 섹션 추출기 (재생성 스크립트)

입력 (읽기 전용, 절대 수정하지 않는다):
  <root>/NEW TOEFL MOCK TEST SET  9.docx   문항 + 선택지
  <root>/SET 9 SCRIPT.docx                 리스닝 오디오 스크립트
  <root>/SET 9 ANSWER KEY.docx             정답키

출력:
  studyground/sg2/config/_set9_fragments/listening.json
  studyground/sg2/config/_set9_fragments/listening_script.json

의존성: 파이썬 표준 라이브러리만 (zipfile / re / json / pathlib / argparse).
실행:  studyground/.venv/bin/python studyground/tools/extract_set9_listening.py --verify
"""

import argparse
import json
import re
import sys
import zipfile
from pathlib import Path

# --------------------------------------------------------------------------
# 경로
# --------------------------------------------------------------------------
HERE = Path(__file__).resolve().parent            # studyground/tools
STUDYGROUND = HERE.parent                          # studyground
ROOT = STUDYGROUND.parent                          # 프로젝트 루트 (docx 가 있는 곳)

DOC_QUESTIONS = ROOT / "NEW TOEFL MOCK TEST SET  9.docx"
DOC_SCRIPT = ROOT / "SET 9 SCRIPT.docx"
DOC_ANSWERS = ROOT / "SET 9 ANSWER KEY.docx"

OUT_DIR = STUDYGROUND / "sg2" / "config" / "_set9_fragments"
OUT_LISTENING = OUT_DIR / "listening.json"
OUT_SCRIPT = OUT_DIR / "listening_script.json"

AUDIO_DIR = "media/audio/set9/"

WARNINGS = []


def warn(msg):
    WARNINGS.append(msg)


# --------------------------------------------------------------------------
# docx 파싱 (표준 zipfile + re)
# --------------------------------------------------------------------------
_P_RE = re.compile(r"<w:p\b[^>]*>.*?</w:p>|<w:p\b[^>]*/>", re.S)
_T_RE = re.compile(r"<w:t(?:\s[^>]*)?>(.*?)</w:t>", re.S)
_EMBED_RE = re.compile(r'r:embed="([^"]+)"')
_TBL_RE = re.compile(r"<w:tbl>.*?</w:tbl>", re.S)

_ENTITIES = [("&lt;", "<"), ("&gt;", ">"), ("&quot;", '"'), ("&apos;", "'"), ("&amp;", "&")]


def _unescape(s):
    for a, b in _ENTITIES:
        s = s.replace(a, b)
    return s


def read_paragraphs(docx_path):
    """(text, [rIds]) 튜플 리스트. 표(w:tbl) 내부 문단은 제외한다."""
    if not docx_path.exists():
        raise SystemExit("원본 docx 를 찾을 수 없다: %s" % docx_path)
    with zipfile.ZipFile(str(docx_path)) as z:
        xml = z.read("word/document.xml").decode("utf-8")
    body = xml.split("<w:body>", 1)[1]
    body = _TBL_RE.sub("", body)
    out = []
    for para in _P_RE.findall(body):
        text = _unescape("".join(_T_RE.findall(para)))
        out.append((text, _EMBED_RE.findall(para)))
    return out


def rel_map(docx_path):
    """rId -> word/media/... 파일명"""
    with zipfile.ZipFile(str(docx_path)) as z:
        xml = z.read("word/_rels/document.xml.rels").decode("utf-8")
    out = {}
    for rid, target in re.findall(r'Id="([^"]+)"[^>]*?Target="([^"]+)"', xml):
        out[rid] = target
    return out


# --------------------------------------------------------------------------
# 텍스트 헬퍼
# --------------------------------------------------------------------------
def norm(s):
    s = s.replace(" ", " ")
    s = re.sub(r"\s+", " ", s)
    return s.strip()


CHOICE_RE = re.compile(r"^([A-D])\s*[.)]\s*(.*)$")
NUMBERED_RE = re.compile(r"^(\d{1,2})\s*[.)]\s*(.*)$")


def strip_choice_label(s):
    m = CHOICE_RE.match(s)
    return m.group(2).strip() if m else s


def strip_number(s):
    m = NUMBERED_RE.match(s)
    return m.group(2).strip() if m else s


def find_index(paras, predicate, start=0):
    for i in range(start, len(paras)):
        if predicate(norm(paras[i][0])):
            return i
    return -1


def starts(prefix):
    return lambda t: t.startswith(prefix)


# --------------------------------------------------------------------------
# 1) 정답키
# --------------------------------------------------------------------------
LETTER_TO_INDEX = {"A": 0, "B": 1, "C": 2, "D": 3}


def parse_answer_key():
    paras = [norm(t) for t, _ in read_paragraphs(DOC_ANSWERS)]
    i_listening = find_index_texts(paras, lambda t: t.upper().startswith("LISTENING"))
    if i_listening < 0:
        raise SystemExit("정답키에서 LISTENING 구간을 찾지 못했다")
    i_m1 = find_index_texts(paras, lambda t: t.upper() == "MODULE 1", i_listening)
    i_m2 = find_index_texts(paras, lambda t: t.upper() == "MODULE 2", i_m1 + 1)
    i_end = find_index_texts(paras, lambda t: t.lower() == "writing", i_m2 + 1)
    if min(i_m1, i_m2) < 0:
        raise SystemExit("정답키에서 LISTENING MODULE 1/2 를 찾지 못했다")
    if i_end < 0:
        i_end = len(paras)

    def letters(lo, hi):
        out = []
        for t in paras[lo:hi]:
            m = re.match(r"^([A-D])\s*\.?$", t)
            if m:
                out.append(m.group(1))
        return out

    m1 = letters(i_m1 + 1, i_m2)
    m2 = letters(i_m2 + 1, i_end)
    return m1, m2


def find_index_texts(texts, predicate, start=0):
    for i in range(start, len(texts)):
        if predicate(texts[i]):
            return i
    return -1


# --------------------------------------------------------------------------
# 2) 문항 문서 — LISTENING 구간
# --------------------------------------------------------------------------
# (heading 시작 문자열, 모듈, 오디오 id, 문항번호들)
L1_BLOCKS = [
    ("Questions 13-14", "L1", "set9-L1-13-14", [13, 14]),
    ("Questions 15-16", "L1", "set9-L1-15-16", [15, 16]),
    ("Questions 17-18", "L1", "set9-L1-17-18", [17, 18]),
    ("Questions 19-20", "L1", "set9-L1-19-20", [19, 20]),
    ("Questions 21-22", "L1", "set9-L1-21-22", [21, 22]),
    ("Questions 23-24", "L1", "set9-L1-23-24", [23, 24]),
    ("Questions 25-28", "L1", "set9-L1-25-28", [25, 26, 27, 28]),
    ("Questions 29-32", "L1", "set9-L1-29-32", [29, 30, 31, 32]),
]
# 원본 헤딩 "Questions 8-10" 은 오기다 — 실제 문항은 8,9,10,11 네 개다(정답키 15개와 검산됨).
L2_BLOCKS = [
    ("Questions 4-5", "L2", "set9-L2-04-05", [4, 5]),
    ("Questions 6-7", "L2", "set9-L2-06-07", [6, 7]),
    ("Questions 8-10", "L2", "set9-L2-08-11", [8, 9, 10, 11]),
    ("Questions 12-15", "L2", "set9-L2-12-15", [12, 13, 14, 15]),
]

INSTRUCTION_RE = re.compile(r"^Listen to (a|an) (conversation|announcement|talk)\.?$", re.I)


def block_kind_from_instruction(instr):
    m = INSTRUCTION_RE.match(norm(instr))
    if not m:
        return "unknown"
    return {"conversation": "conversation", "announcement": "announcement", "talk": "lecture"}[
        m.group(2).lower()
    ]


def parse_short_response_choices(paras, lo, hi):
    """A./B./C./D. 라벨이 붙은 선택지들을 순서대로 모아 4개씩 묶는다."""
    groups, cur = [], []
    for t, _ in paras[lo:hi]:
        t = norm(t)
        m = CHOICE_RE.match(t)
        if not m:
            continue
        letter, body = m.group(1), m.group(2).strip()
        if letter == "A":
            if cur:
                groups.append(cur)
            cur = []
        cur.append((letter, body))
    if cur:
        groups.append(cur)
    out = []
    for g in groups:
        if [x[0] for x in g] != ["A", "B", "C", "D"]:
            warn("선택지 라벨 순서가 A-D 가 아니다: %r" % ([x[0] for x in g],))
        out.append([x[1] for x in g])
    return out


def short_response_images(paras, lo, hi):
    """문항별 화자 삽화 rId. 이미지는 '직전 문항 선택지 끝'에 붙어 다음 문항을 가리킨다."""
    rids = []
    for t, imgs in paras[lo:hi]:
        for r in imgs:
            rids.append(r)
    return rids


def parse_mcq_block(paras, lo, hi, nos):
    """헤딩/지시문 이후의 비어있지 않은 줄이 (prompt, 선택지 4개) * N 이라고 가정."""
    lines = []
    for t, _ in paras[lo:hi]:
        t = norm(t)
        if not t:
            continue
        if t.lower().startswith("questions "):
            continue
        if INSTRUCTION_RE.match(t):
            continue
        lines.append(t)
    expected = len(nos) * 5
    if len(lines) != expected:
        raise SystemExit(
            "문항 블록 파싱 실패 (문항 %s): 줄 %d개, 기대 %d개\n%s"
            % (nos, len(lines), expected, "\n".join("  " + l for l in lines))
        )
    out = []
    for k, no in enumerate(nos):
        chunk = lines[k * 5:(k + 1) * 5]
        prompt = strip_number(chunk[0]).strip()
        choices = [strip_choice_label(c).strip() for c in chunk[1:]]
        out.append((no, prompt, choices))
    return out


def parse_questions_doc():
    paras = read_paragraphs(DOC_QUESTIONS)
    texts = [norm(t) for t, _ in paras]

    i_sec = find_index_texts(texts, lambda t: t.upper().startswith("LISTENING SECTION"))
    i_writing = find_index_texts(texts, lambda t: t.upper().startswith("WRITING SECTION"), i_sec)
    if i_sec < 0 or i_writing < 0:
        raise SystemExit("문항 문서에서 LISTENING SECTION / WRITING SECTION 경계를 찾지 못했다")

    i_m2 = find_index_texts(texts, lambda t: t == "Module 2", i_sec)
    i_q112 = find_index_texts(texts, lambda t: t.startswith("Questions 1-12"), i_sec)
    if i_m2 < 0 or i_q112 < 0:
        raise SystemExit("Listening Module 1/2 경계를 찾지 못했다")

    # ---- 블록 경계 계산 -------------------------------------------------
    def heading_index(prefix, start, stop):
        for i in range(start, stop):
            if texts[i].startswith(prefix):
                return i
        raise SystemExit("헤딩을 찾지 못했다: %r" % prefix)

    l1_marks = [(h, heading_index(h, i_sec, i_m2)) for h, _, _, _ in L1_BLOCKS]
    l2_marks = [(h, heading_index(h, i_m2, i_writing)) for h, _, _, _ in L2_BLOCKS]
    i_q13 = l1_marks[0][1]
    i_q13_l2 = find_index_texts(texts, lambda t: t.startswith("Questions 1-3"), i_m2)
    if i_q13_l2 < 0:
        raise SystemExit("Listening Module 2 'Questions 1-3' 를 찾지 못했다")

    result = {"L1": [], "L2": []}
    audio_meta = {}   # audioId -> dict(kind, instruction)

    # ---- L1 Questions 1-12 (per-question audio) -------------------------
    groups = parse_short_response_choices(paras, i_q112, i_q13)
    if len(groups) != 12:
        raise SystemExit("Listening M1 단문응답 선택지 묶음이 12개가 아니다: %d" % len(groups))
    rids = short_response_images(paras, i_q112, i_q13)
    result["L1"].append(
        {
            "heading": texts[i_q112],
            "instruction": "Listen to the question and select the best response from the choices.",
            "perQuestionAudio": True,
            "kind": "short-response",
            "audioIds": ["set9-L1-q%02d" % n for n in range(1, 13)],
            "questions": [(n, None, groups[n - 1]) for n in range(1, 13)],
            "speakerRefs": rids,
        }
    )

    # ---- L1 나머지 블록 --------------------------------------------------
    l1_bounds = [m[1] for m in l1_marks] + [i_m2]
    for k, (heading, mod, audio_id, nos) in enumerate(L1_BLOCKS):
        lo, hi = l1_bounds[k], l1_bounds[k + 1]
        instr = ""
        for t, _ in paras[lo:hi]:
            if INSTRUCTION_RE.match(norm(t)):
                instr = norm(t)
                break
        if not instr:
            warn("L1 %s: 'Listen to ...' 지시문을 찾지 못했다" % heading)
        result["L1"].append(
            {
                "heading": texts[lo].strip(),
                "instruction": instr,
                "perQuestionAudio": False,
                "kind": block_kind_from_instruction(instr),
                "audioIds": [audio_id],
                "questions": parse_mcq_block(paras, lo, hi, nos),
            }
        )

    # ---- L2 Questions 1-3 (per-question audio) --------------------------
    groups2 = parse_short_response_choices(paras, i_q13_l2, l2_marks[0][1])
    if len(groups2) != 3:
        raise SystemExit("Listening M2 단문응답 선택지 묶음이 3개가 아니다: %d" % len(groups2))
    result["L2"].append(
        {
            "heading": texts[i_q13_l2],
            "instruction": "Listen to the question and select the best response from the choices.",
            "perQuestionAudio": True,
            "kind": "short-response",
            "audioIds": ["set9-L2-q%02d" % n for n in range(1, 4)],
            "questions": [(n, None, groups2[n - 1]) for n in range(1, 4)],
            "speakerRefs": short_response_images(paras, i_q13_l2, l2_marks[0][1]),
        }
    )

    l2_bounds = [m[1] for m in l2_marks] + [i_writing]
    for k, (heading, mod, audio_id, nos) in enumerate(L2_BLOCKS):
        lo, hi = l2_bounds[k], l2_bounds[k + 1]
        instr = ""
        for t, _ in paras[lo:hi]:
            if INSTRUCTION_RE.match(norm(t)):
                instr = norm(t)
                break
        if not instr:
            warn("L2 %s: 'Listen to ...' 지시문을 찾지 못했다" % heading)
        blk_heading = texts[lo].strip()
        if heading == "Questions 8-10":
            warn(
                "원본 헤딩 'Questions 8-10' 아래에 실제로는 8,9,10,11 네 문항이 있다. "
                "정답키 M2 15개와 맞추기 위해 헤딩을 'Questions 8-11' 로 교정했다."
            )
            blk_heading = "Questions 8-11"
        result["L2"].append(
            {
                "heading": blk_heading,
                "instruction": instr,
                "perQuestionAudio": False,
                "kind": block_kind_from_instruction(instr),
                "audioIds": [audio_id],
                "questions": parse_mcq_block(paras, lo, hi, nos),
            }
        )

    return result, audio_meta


# --------------------------------------------------------------------------
# 3) 스크립트 문서
# --------------------------------------------------------------------------
SPEAKER_RE = re.compile(r"^([A-Z][A-Za-z]{0,14}|M|W)\s*:\s*")


def parse_script_doc(kind_by_audio):
    """kind_by_audio: 문항 문서의 'Listen to ...' 지시문에서 얻은 audioId -> kind.
    SCRIPT.docx 의 지시문은 25-28/29-32 에서 'announcement' 로 잘못 적혀 있으므로
    문항 문서 쪽(= 응시자에게 보이는 문구)을 정본으로 삼는다."""
    paras = [norm(t) for t, _ in read_paragraphs(DOC_SCRIPT)]

    def idx(pred, start=0):
        return find_index_texts(paras, pred, start)

    i_m1 = idx(lambda t: t.upper() == "MODULE 1")
    i_q112 = idx(lambda t: t.upper().startswith("QUESTIONS 1-12"), i_m1)
    if i_m1 < 0 or i_q112 < 0:
        raise SystemExit("SCRIPT.docx 에서 Module 1 / QUESTIONS 1-12 를 찾지 못했다")

    heads = [
        ("set9-L1-13-14", "Questions 13-14"),
        ("set9-L1-15-16", "Questions 15-16"),
        ("set9-L1-17-18", "Questions 17-18"),
        ("set9-L1-19-20", "Questions 19-20"),
        ("set9-L1-21-22", "Questions 21-22"),
        ("set9-L1-23-24", "Questions 23-24"),
        ("set9-L1-25-28", "Questions 25-28"),
        ("set9-L1-29-32", "Questions 29-32"),
    ]
    marks = []
    cursor = i_q112
    for aid, h in heads:
        j = idx(lambda t, h=h: t.upper().startswith(h.upper()), cursor)
        if j < 0:
            raise SystemExit("SCRIPT.docx 에서 %r 를 찾지 못했다" % h)
        marks.append((aid, j))
        cursor = j + 1
    i_m2 = idx(lambda t: t.upper().startswith("MODULE 2"), cursor)
    if i_m2 < 0:
        raise SystemExit("SCRIPT.docx 에서 MODULE 2 를 찾지 못했다")

    out = {}

    # --- L1 단문응답 12개 ------------------------------------------------
    utter = [t for t in paras[i_q112 + 1:marks[0][1]] if t]
    if len(utter) != 12:
        raise SystemExit("SCRIPT M1 단문응답이 12개가 아니다: %d\n%s" % (len(utter), utter))
    for n, line in enumerate(utter, start=1):
        out["set9-L1-q%02d" % n] = {
            "text": line,
            "voices": ["speaker"],
            "kind": "short-response",
        }

    # --- L1 대화/공지/강의 ------------------------------------------------
    bounds = [m[1] for m in marks] + [i_m2]
    for k, (aid, _) in enumerate(marks):
        lo, hi = bounds[k], bounds[k + 1]
        body = [t for t in paras[lo + 1:hi] if t and not INSTRUCTION_RE.match(t)]
        speakers = []
        for line in body:
            m = SPEAKER_RE.match(line)
            if m and m.group(1) not in speakers:
                speakers.append(m.group(1))
        kind = kind_by_audio.get(aid, "unknown")
        voices = speakers if speakers else ["narrator"]
        if kind == "conversation" and not speakers:
            warn("%s: conversation 인데 화자 라벨(M:/W:)이 없다" % aid)
        out[aid] = {"text": "\n".join(body), "voices": voices, "kind": kind}

    # --- L2 ---------------------------------------------------------------
    m2_lines = [t for t in paras[i_m2 + 1:] if t]
    # 첫 줄은 "Questions 1-15" 헤딩
    if m2_lines and m2_lines[0].lower().startswith("questions"):
        m2_lines = m2_lines[1:]
    # SPEAKING SECTION 이후는 잘라낸다
    cut = len(m2_lines)
    for i, t in enumerate(m2_lines):
        if "SPEAKING SECTION" in t.upper():
            cut = i
            break
    m2_lines = m2_lines[:cut]
    if len(m2_lines) != 15:
        raise SystemExit("SCRIPT M2 줄이 15개가 아니다: %d\n%s" % (len(m2_lines), m2_lines))

    for n in range(1, 4):
        out["set9-L2-q%02d" % n] = {
            "text": m2_lines[n - 1],
            "voices": ["speaker"],
            "kind": "short-response",
        }
    # 4번 이후는 '문항 발문'만 있고 대화/강의 본문 스크립트가 원본에 없다.
    stem_map = [
        ("set9-L2-04-05", m2_lines[3:5]),
        ("set9-L2-06-07", m2_lines[5:7]),
        ("set9-L2-08-11", m2_lines[7:11]),
        ("set9-L2-12-15", m2_lines[11:15]),
    ]
    for aid, stems in stem_map:
        out[aid] = {
            "text": "",
            "voices": [],
            "kind": kind_by_audio.get(aid, "unknown"),
            "missing": True,
            "note": "SET 9 SCRIPT.docx 에 이 블록의 대화/강의 본문 스크립트가 없다. "
                    "발문(questionPrompts)만 원본에 존재한다. 원본 확보 전에는 음원을 만들 수 없다.",
            "questionPrompts": stems,
        }
        warn("%s: 원본 SCRIPT.docx 에 오디오 본문 스크립트가 없다 (발문만 존재)." % aid)

    return out


# --------------------------------------------------------------------------
# 4) 조립
# --------------------------------------------------------------------------
SHORT_RESPONSE_PROMPT = "Listen to the question and select the best response."


def build_listening(parsed, ak_m1, ak_m2):
    modules = []
    for mod_id, label, ak in (("L1", "Listening Module 1", ak_m1), ("L2", "Listening Module 2", ak_m2)):
        blocks = []
        for blk in parsed[mod_id]:
            qs = []
            for i, (no, prompt, choices) in enumerate(blk["questions"]):
                letter = ak[no - 1]
                q = {
                    "id": "%s-%d" % (mod_id, no),
                    "kind": "mcq",
                    "no": no,
                    "prompt": prompt if prompt else SHORT_RESPONSE_PROMPT,
                    "choices": choices,
                    "answer": LETTER_TO_INDEX[letter],
                }
                if blk["perQuestionAudio"]:
                    q["layout"] = "short-response"
                    q["audio"] = AUDIO_DIR + blk["audioIds"][i] + ".mp3"
                qs.append(q)
            b = {
                "kind": "audio-set",
                "heading": blk["heading"],
                "instruction": blk["instruction"],
                "questions": qs,
            }
            if blk["perQuestionAudio"]:
                b["perQuestionAudio"] = True
            else:
                b["audio"] = AUDIO_DIR + blk["audioIds"][0] + ".mp3"
            blocks.append(b)
        modules.append({"id": mod_id, "label": label, "timeLimitSec": None, "blocks": blocks})

    return {
        "id": "listening",
        "label": "Listening",
        "labelKo": "리스닝",
        "timeLimitSec": None,
        "modules": modules,
    }


# --------------------------------------------------------------------------
# 5) 검증
# --------------------------------------------------------------------------
def collect_audio_refs(listening):
    refs = set()
    for mod in listening["modules"]:
        for blk in mod["blocks"]:
            if blk.get("audio"):
                refs.add(blk["audio"])
            for q in blk["questions"]:
                if q.get("audio"):
                    refs.add(q["audio"])
    return refs


def verify(listening, scripts):
    lines = []

    # (a) 문항 수
    counts = {}
    for mod in listening["modules"]:
        counts[mod["id"]] = sum(len(b["questions"]) for b in mod["blocks"])
    assert counts["L1"] == 32, "L1 문항 수 %d != 32" % counts["L1"]
    assert counts["L2"] == 15, "L2 문항 수 %d != 15" % counts["L2"]
    lines.append("(a) OK  L1=%d  L2=%d  total=%d" % (counts["L1"], counts["L2"], counts["L1"] + counts["L2"]))

    # 문항 번호 연속성
    for mod in listening["modules"]:
        nos = [q["no"] for b in mod["blocks"] for q in b["questions"]]
        assert nos == list(range(1, len(nos) + 1)), "%s 문항 번호가 연속이 아니다: %s" % (mod["id"], nos)
    lines.append("(a2) OK 문항 번호 L1 1..32 / L2 1..15 연속")

    # (b) answer 범위
    n_ans = 0
    for mod in listening["modules"]:
        for b in mod["blocks"]:
            for q in b["questions"]:
                assert isinstance(q["answer"], int), "%s answer 가 정수가 아니다" % q["id"]
                assert 0 <= q["answer"] < len(q["choices"]), (
                    "%s answer %d 가 choices(%d) 범위 밖" % (q["id"], q["answer"], len(q["choices"]))
                )
                assert len(q["choices"]) == 4, "%s 선택지가 4개가 아니다: %d" % (q["id"], len(q["choices"]))
                assert all(c.strip() for c in q["choices"]), "%s 빈 선택지가 있다" % q["id"]
                n_ans += 1
    lines.append("(b) OK  answer %d개 전부 0<=a<len(choices), 선택지 4개, 빈 문자열 없음" % n_ans)

    # (c) 오디오 도달성
    n_q = 0
    for mod in listening["modules"]:
        for b in mod["blocks"]:
            for q in b["questions"]:
                assert q.get("audio") or b.get("audio"), "%s 가 오디오에 닿지 않는다" % q["id"]
                n_q += 1
    lines.append("(c) OK  %d문항 전부 자기 audio 또는 블록 audio 를 가진다" % n_q)

    # (d) 스크립트 id 집합 == 참조 id 집합
    refs = collect_audio_refs(listening)
    ref_ids = set(p[len(AUDIO_DIR):-len(".mp3")] for p in refs)
    script_ids = set(scripts.keys())
    assert ref_ids == script_ids, (
        "audio id 불일치\n  참조에만: %s\n  스크립트에만: %s"
        % (sorted(ref_ids - script_ids), sorted(script_ids - ref_ids))
    )
    lines.append("(d) OK  audio id 집합 일치 (%d개): 참조==스크립트" % len(ref_ids))

    missing = sorted(k for k, v in scripts.items() if v.get("missing"))
    empty = sorted(k for k, v in scripts.items() if not v.get("missing") and not v["text"].strip())
    assert not empty, "missing 표시 없이 비어 있는 스크립트: %s" % empty
    lines.append("(d2) 본문 스크립트 확보 %d개 / 원본 결측 %d개 %s"
                 % (len(script_ids) - len(missing), len(missing), missing))
    return lines


# --------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--verify", action="store_true", help="검증만 하고 결과를 출력")
    ap.add_argument("--write", action="store_true", help="JSON 파일을 기록")
    args = ap.parse_args()
    if not args.verify and not args.write:
        args.write = True
        args.verify = True

    ak_m1, ak_m2 = parse_answer_key()
    print("정답키: LISTENING M1 %d개 / M2 %d개" % (len(ak_m1), len(ak_m2)))
    assert len(ak_m1) == 32, "정답키 M1 이 32개가 아니다: %d" % len(ak_m1)
    assert len(ak_m2) == 15, "정답키 M2 가 15개가 아니다: %d" % len(ak_m2)

    parsed, _ = parse_questions_doc()
    kind_by_audio = {}
    for mod_id in ("L1", "L2"):
        for blk in parsed[mod_id]:
            for aid in blk["audioIds"]:
                kind_by_audio[aid] = blk["kind"]
    scripts = parse_script_doc(kind_by_audio)
    listening = build_listening(parsed, ak_m1, ak_m2)

    if args.write:
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        OUT_LISTENING.write_text(
            json.dumps(listening, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        OUT_SCRIPT.write_text(
            json.dumps(scripts, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print("wrote %s" % OUT_LISTENING)
        print("wrote %s" % OUT_SCRIPT)

    if args.verify:
        print("--- verify ---")
        for line in verify(listening, scripts):
            print(line)

    if WARNINGS:
        print("--- warnings (%d) ---" % len(WARNINGS))
        for w in WARNINGS:
            print("  ! " + w)
    return 0


if __name__ == "__main__":
    sys.exit(main())
