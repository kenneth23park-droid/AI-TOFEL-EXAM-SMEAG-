#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
SET 9  Writing + Speaking  추출기.

원본(.docx, 읽기 전용)에서 아래 3개 fragment 를 만든다.
  studyground/sg2/config/_set9_fragments/writing.json
  studyground/sg2/config/_set9_fragments/speaking.json
  studyground/sg2/config/_set9_fragments/speaking_script.json

의존성: 표준 라이브러리만 (zipfile / re / json / html / pathlib / argparse).
실행:   studyground/.venv/bin/python studyground/tools/extract_set9_writing_speaking.py

스키마는 studyground/sg2/assets/set1.js 를 정본으로 따른다.
  build-set  question : {id, kind:'build', no, context, slots[], tiles[], sentence, answerTokens[]}
      slots[] 원소는 {"t":"f","text":...}(고정 표시) 또는 {"t":"b","a":...}(타일 자리)
      answerTokens 는 slots 의 'b' 를 순서대로 뽑은 것과 1:1 로 일치해야 한다.
  free-write question : {id, kind:'email'|'discussion', no, ...}
  record-set question  : {id, kind:'repeat'|'interview', no, audio, prepSec, respondSec}
"""

import argparse
import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DOC_Q = ROOT / "NEW TOEFL MOCK TEST SET  9.docx"
DOC_KEY = ROOT / "SET 9 ANSWER KEY.docx"
DOC_SCRIPT = ROOT / "SET 9 SCRIPT.docx"
OUT_DIR = ROOT / "studyground" / "sg2" / "config" / "_set9_fragments"

AUDIO_DIR = "media/audio/set9/"

# 원본에 시간/단어수 지시가 없어 SET 1 실측값을 그대로 쓴다 (보고서에 명시).
DEFAULT_MODULE_SEC = 600
DEFAULT_EMAIL_MIN_WORDS = 80
DEFAULT_DISCUSSION_MIN_WORDS = 100
DEFAULT_PREP_SEC = 3
DEFAULT_REPEAT_RESPOND_SEC = 20
DEFAULT_INTERVIEW_RESPOND_SEC = 45

WARNINGS = []


def warn(msg):
    WARNINGS.append(msg)


# --------------------------------------------------------------------------
# docx 파싱 (표준 zipfile + re 만 사용)
# --------------------------------------------------------------------------
def paragraphs(docx_path):
    """word/document.xml 의 <w:p> 단위 평문 리스트."""
    import zipfile

    with zipfile.ZipFile(str(docx_path)) as z:
        xml = z.read("word/document.xml").decode("utf-8")
    out = []
    for pxml in re.findall(r"<w:p[ >].*?</w:p>|<w:p/>", xml, re.S):
        text = "".join(re.findall(r"<w:t[^>]*>(.*?)</w:t>", pxml, re.S))
        out.append(html.unescape(text))
    return out


def strip_leaked_xml(s):
    """
    이 원본 docx 들은 일부 문단에 XML 마크업이 '문자'로 새어 들어가 있다
    (예: '<w:t>__ <w:t>__ which books'). 표시용 텍스트만 남긴다.
    """
    s = re.sub(r"</?w:[^>]*>", " ", s)
    s = re.sub(r"</?w:[^>]*$", " ", s)
    return s


def clean(s):
    return re.sub(r"\s+", " ", strip_leaked_xml(s)).strip()


def find_index(paras, needle, start=0):
    for i in range(start, len(paras)):
        if clean(paras[i]).lower() == needle.lower():
            return i
    return -1


# --------------------------------------------------------------------------
# Build a sentence
# --------------------------------------------------------------------------
BLANK_RE = re.compile(r"_{2,}")


def parse_slot_pattern(raw):
    """
    '______, ______ ______ out of stock ______ ______.' 같은 줄을
    [{'t':'b'}, {'t':'f','text':','}, ...] 형태의 뼈대로 쪼갠다.
    (blank 의 answer 는 아직 비어 있다 — 정답 문장과 맞춰 채운다.)
    """
    line = strip_leaked_xml(raw)
    # 한 칸짜리 '_' 도 blank 로 취급 (원본 Q1 에 '_' 가 하나 섞여 있다)
    line = re.sub(r"(?<![_\w])_(?![_\w])", "__", line)
    parts = []
    pos = 0
    for m in BLANK_RE.finditer(line):
        fixed = line[pos:m.start()]
        if fixed.strip():
            parts.append({"t": "f", "text": re.sub(r"\s+", " ", fixed).strip()})
        parts.append({"t": "b"})
        pos = m.end()
    tail = line[pos:]
    if tail.strip():
        parts.append({"t": "f", "text": re.sub(r"\s+", " ", tail).strip()})
    return parts


TRAP_RE = re.compile(r"\(\s*trap\s*\)", re.I)


def parse_tiles(raw):
    """
    'was     my size     is(Trap)     it     in      no' →
      [{'text':'was','trap':False}, ..., {'text':'is','trap':True}, ...]
    구분자는 2칸 이상 공백. 토큰 줄에 밑줄이 섞여 있는 경우가 있어 제거한다.
    """
    line = strip_leaked_xml(raw)
    line = BLANK_RE.sub("  ", line)
    tiles = []
    for chunk in re.split(r"\s{2,}|\t", line):
        chunk = chunk.strip()
        if not chunk:
            continue
        trap = bool(TRAP_RE.search(chunk))
        text = TRAP_RE.sub("", chunk).strip()
        if not text:
            continue
        tiles.append({"text": text, "trap": trap})
    return tiles


def norm(s):
    """토큰 비교용 정규화 — 대소문자/구두점/따옴표 무시."""
    s = s.replace("’", "'").replace("‘", "'")
    s = re.sub(r"[^a-z0-9' ]+", "", s.lower())
    return re.sub(r"\s+", " ", s).strip()


def fill_slots(slots, tiles, sentence, qno):
    """
    정답 문장을 슬롯 순서대로 소비하면서 blank 에 들어갈 토큰을 결정한다.
    고정(fixed) 텍스트는 문장에서 그대로 건너뛴다.
    """
    remaining = norm(sentence)
    pool = [t["text"] for t in tiles]
    used = set()
    filled = []
    for slot in slots:
        if slot["t"] == "f":
            ft = norm(slot["text"])
            if ft and remaining.startswith(ft):
                remaining = remaining[len(ft):].strip()
            elif ft:
                warn("Q%d: fixed text %r not matched at %r" % (qno, slot["text"], remaining[:40]))
            filled.append({"t": "f", "text": slot["text"]})
            continue
        # blank: 남은 문장의 앞부분과 일치하는 가장 긴 미사용 타일을 고른다.
        best, best_len = None, -1
        for idx, cand in enumerate(pool):
            if idx in used:
                continue
            nc = norm(cand)
            if not nc:
                continue
            if remaining == nc or remaining.startswith(nc + " "):
                if len(nc) > best_len:
                    best, best_len = idx, len(nc)
        if best is None:
            raise SystemExit(
                "Q%d: no tile matches the answer sentence at %r (pool=%r)"
                % (qno, remaining[:60], [p for i, p in enumerate(pool) if i not in used])
            )
        used.add(best)
        token = pool[best]
        remaining = remaining[len(norm(token)):].strip()
        filled.append({"t": "b", "a": token})
    if remaining:
        warn("Q%d: leftover answer text after filling slots: %r" % (qno, remaining))
    return filled


def extract_build_set(qparas, kparas):
    start = find_index(qparas, "Build a sentence")
    if start < 0:
        raise SystemExit("'Build a sentence' heading not found")
    heading = clean(qparas[find_index(qparas, "Questions 1-10", start)])
    instruction = clean(qparas[find_index(qparas, "Questions 1-10", start) + 1])
    end = find_index(qparas, "WRITE AN EMAIL", start)

    # 정답 문장: 정답키의 'Writing' 헤딩 다음의 비어있지 않은 10줄
    kstart = find_index(kparas, "Writing")
    if kstart < 0:
        raise SystemExit("'Writing' heading not found in answer key")
    sentences = [clean(p) for p in kparas[kstart + 1:] if clean(p)][:10]
    if len(sentences) != 10:
        raise SystemExit("expected 10 writing answer sentences, got %d" % len(sentences))

    # 문항 블록: (context 질문줄, 밑줄 패턴줄, 토큰줄) 3연속
    body = [clean(p) for p in qparas[start:end]]
    rows = []
    i = 0
    while i < len(body) - 2:
        pat = body[i + 1]
        if BLANK_RE.search(pat) and body[i] and not BLANK_RE.search(body[i]):
            rows.append((body[i], qparas[start + i + 1], qparas[start + i + 2]))
            i += 3
        else:
            i += 1
    if len(rows) != 10:
        raise SystemExit("expected 10 build-a-sentence rows, got %d" % len(rows))

    questions = []
    for n, ((context, pat_raw, tiles_raw), sentence) in enumerate(zip(rows, sentences), start=1):
        skeleton = parse_slot_pattern(pat_raw)
        tiles = parse_tiles(tiles_raw)
        slots = fill_slots(skeleton, tiles, sentence, n)
        answer_tokens = [s["a"] for s in slots if s["t"] == "b"]
        n_blank = len(answer_tokens)
        n_real = len([t for t in tiles if not t["trap"]])
        if n_blank != n_real:
            warn("Q%d: %d blanks but %d non-trap tiles" % (n, n_blank, n_real))
        questions.append({
            "id": "set9-W1-q%02d" % n,
            "kind": "build",
            "no": n,
            "context": context,
            "slots": slots,
            "tiles": [t["text"] for t in tiles],
            "trapTiles": [t["text"] for t in tiles if t["trap"]],
            "sentence": sentence,
            "answerTokens": answer_tokens,
        })
    return heading, instruction, questions


# --------------------------------------------------------------------------
# WRITE AN EMAIL  /  ACADEMIC DISCUSSION
# --------------------------------------------------------------------------
def extract_email(qparas):
    start = find_index(qparas, "WRITE AN EMAIL")
    end = find_index(qparas, "WRITE for an ACADEMIC DISCUSSION", start)
    body = [clean(p) for p in qparas[start + 1:end] if clean(p)]
    # 원본은 같은 블록을 두 번 반복해 두었다 — 첫 번째 사본만 쓴다.
    def grab(prefix):
        for t in body:
            if t.lower().startswith(prefix.lower()):
                return t[len(prefix):].strip(" :–-")
        return None

    to = grab("To:")
    subject = grab("Subject:")
    si = body.index("SITUATION")
    situation = body[si + 1]
    bi = body.index("YOUR EMAIL SHOULD")
    bullets = []
    for t in body[bi + 1:]:
        if t in ("SITUATION", "YOUR EMAIL SHOULD") or t.lower().startswith(("to:", "subject:")):
            break
        bullets.append(t)
    if not situation or not bullets:
        raise SystemExit("email situation/bullets not extracted")
    return {
        "id": "set9-W2-email",
        "kind": "email",
        "no": 11,
        "to": to,
        "subject": subject,
        "situationLabel": "SITUATION",
        "situation": situation,
        "bulletsLabel": "YOUR EMAIL SHOULD",
        "bullets": bullets,
        "prompt": situation + " " + " ".join(bullets),
        "minWords": DEFAULT_EMAIL_MIN_WORDS,
    }


def extract_discussion(qparas):
    start = find_index(qparas, "WRITE for an ACADEMIC DISCUSSION")
    if start < 0:
        return None
    end = find_index(qparas, "SPEAKING SECTION", start)
    body = [clean(p) for p in qparas[start + 1:end] if clean(p)]
    if not body:
        return None
    professor = body[0]
    prompt = body[1]
    posts = []
    i = 2
    while i + 1 < len(body):
        name, text = body[i], body[i + 1]
        if name == professor:  # 두 번째 사본 시작
            break
        if len(name.split()) <= 3 and len(text.split()) > 10:
            posts.append({"name": name, "text": text})
            i += 2
        else:
            i += 1
    if not prompt or not posts:
        raise SystemExit("discussion prompt/posts not extracted")
    return {
        "id": "set9-W3-disc",
        "kind": "discussion",
        "no": 12,
        "professor": professor,
        "prompt": prompt,
        "posts": posts,
        "minWords": DEFAULT_DISCUSSION_MIN_WORDS,
    }


# --------------------------------------------------------------------------
# Speaking
# --------------------------------------------------------------------------
def extract_speaking(qparas, sparas):
    si = -1
    for i, p in enumerate(sparas):
        if "SPEAKING SECTION" in clean(p):
            si = i
            break
    if si < 0:
        raise SystemExit("SPEAKING SECTION not found in script")

    ii = find_index(sparas, "Interview", si)
    if ii < 0:
        raise SystemExit("'Interview' heading not found in script")

    task1_body = [clean(p) for p in sparas[si + 1:ii] if clean(p)]
    task1_instr = task1_body[0]
    if not task1_instr.lower().startswith("instructions"):
        raise SystemExit("Task 1 instruction line not found")
    repeat_lines = [t for t in task1_body[1:] if not re.match(r"^Questions?\s", t, re.I)]

    task2_body = [clean(p) for p in sparas[ii + 1:] if clean(p)]
    task2_instr = task2_body[0]
    if not task2_instr.lower().startswith("instructions"):
        raise SystemExit("Task 2 instruction line not found")
    interview_lines = task2_body[1:]

    # 문항문서(Task 1 / Task 2) 헤딩 — 라벨/지시문의 근거
    t1_head = find_index(qparas, "Task 1")
    t2_head = find_index(qparas, "Task 2")
    t1_label = clean(qparas[t1_head + 1]) if t1_head >= 0 else "Listen and Repeat"
    t2_label = clean(qparas[t2_head + 2]) if t2_head >= 0 else "Answer the interviewer's questions."

    script = {}
    s1_questions = []
    for n, line in enumerate(repeat_lines, start=1):
        qid = "set9-S1-q%02d" % n
        script[qid] = line
        s1_questions.append({
            "id": qid, "kind": "repeat", "no": n,
            "audio": AUDIO_DIR + qid + ".mp3",
            "prepSec": DEFAULT_PREP_SEC,
            "respondSec": DEFAULT_REPEAT_RESPOND_SEC,
        })
    s2_questions = []
    for n, line in enumerate(interview_lines, start=1):
        qid = "set9-S2-q%02d" % n
        script[qid] = line
        s2_questions.append({
            "id": qid, "kind": "interview", "no": len(repeat_lines) + n,
            "audio": AUDIO_DIR + qid + ".mp3",
            "prepSec": DEFAULT_PREP_SEC,
            "respondSec": DEFAULT_INTERVIEW_RESPOND_SEC,
        })

    script["set9-S1-intro"] = task1_instr
    script["set9-S2-intro"] = task2_instr

    speaking = {
        "id": "speaking",
        "label": "Speaking",
        "labelKo": "스피킹",
        "timeLimitSec": None,
        "modules": [
            {
                "id": "S1",
                "label": "Task 1 · " + t1_label,
                "timeLimitSec": DEFAULT_MODULE_SEC,
                "blocks": [{
                    "kind": "record-set",
                    "heading": "Task 1",
                    "instruction": t1_label,
                    "introAudio": AUDIO_DIR + "set9-S1-intro.mp3",
                    "perQuestionAudio": True,
                    "questions": s1_questions,
                }],
            },
            {
                "id": "S2",
                "label": "Task 2 · Interview",
                "timeLimitSec": DEFAULT_MODULE_SEC,
                "blocks": [{
                    "kind": "record-set",
                    "heading": "Task 2",
                    "instruction": t2_label,
                    "introAudio": AUDIO_DIR + "set9-S2-intro.mp3",
                    "perQuestionAudio": True,
                    "questions": s2_questions,
                }],
            },
        ],
    }
    script_doc = {
        "code": "SET9",
        "section": "speaking",
        "audioDir": AUDIO_DIR,
        "lines": [{"id": k, "text": script[k]} for k in
                  ["set9-S1-intro"] + [q["id"] for q in s1_questions] +
                  ["set9-S2-intro"] + [q["id"] for q in s2_questions]],
    }
    return speaking, script_doc


# --------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(OUT_DIR))
    args = ap.parse_args()
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    qparas = paragraphs(DOC_Q)
    kparas = paragraphs(DOC_KEY)
    sparas = paragraphs(DOC_SCRIPT)

    heading, instruction, build_qs = extract_build_set(qparas, kparas)
    email_q = extract_email(qparas)
    disc_q = extract_discussion(qparas)

    modules = [
        {
            "id": "W1", "label": "Build a Sentence", "timeLimitSec": DEFAULT_MODULE_SEC,
            "blocks": [{
                "kind": "build-set", "heading": heading, "instruction": instruction,
                "questions": build_qs,
            }],
        },
        {
            "id": "W2", "label": "Write an Email", "timeLimitSec": DEFAULT_MODULE_SEC,
            "blocks": [{"kind": "free-write", "heading": "WRITE AN EMAIL", "questions": [email_q]}],
        },
    ]
    if disc_q:
        modules.append({
            "id": "W3", "label": "Write for an Academic Discussion",
            "timeLimitSec": DEFAULT_MODULE_SEC,
            "blocks": [{"kind": "free-write",
                        "heading": "WRITE for an ACADEMIC DISCUSSION",
                        "questions": [disc_q]}],
        })
    else:
        warn("no Academic Discussion task found in SET 9 question document")

    writing = {
        "id": "writing", "label": "Writing", "labelKo": "라이팅",
        "timeLimitSec": None, "modules": modules,
    }

    speaking, script_doc = extract_speaking(qparas, sparas)

    writing["_warnings"] = list(WARNINGS)

    def dump(name, obj):
        path = out_dir / name
        path.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("wrote", path)

    dump("writing.json", writing)
    dump("speaking.json", speaking)
    dump("speaking_script.json", script_doc)

    print("build-set questions:", len(build_qs))
    print("free-write questions:", 1 + (1 if disc_q else 0))
    print("speaking S1:", len(speaking["modules"][0]["blocks"][0]["questions"]),
          "S2:", len(speaking["modules"][1]["blocks"][0]["questions"]))
    for w in WARNINGS:
        print("WARNING:", w, file=sys.stderr)


if __name__ == "__main__":
    main()
