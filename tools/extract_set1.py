#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SMEAG TOEFL SET 1 — 원본 자료 추출 / 검증 도구

원본 docx 는 텍스트박스 때문에 모든 문단이 2번씩 중복 등장하고 앵커 좌표
숫자(예: "left126365")가 본문 앞에 붙는다. 따라서 docx → 최종 JS 를 100%
자동 변환하지 않고, 다음 두 가지만 담당한다.

  extract  : docx 내장 이미지(스피킹 그림 8장)를 app/assets/speaking/ 로 추출하고
             정제된 원문 텍스트를 tools/_clean_set1.txt 로 남긴다.
  verify   : app/js/data/set1.js 의 모든 문제 텍스트가 원본 docx 에 실제로
             존재하는지, 정답이 ANSWER KEY 와 일치하는지 대조한다.

사용:
    python3 tools/extract_set1.py extract
    python3 tools/extract_set1.py verify      # 실패 시 exit code 1
"""

import html
import json
import os
import re
import shutil
import subprocess
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(ROOT, "TOEFL MOCK TEST  SET 1")
DOC = os.path.join(SRC_DIR, "NEW TOEFL SET 1.docx")
KEY = os.path.join(SRC_DIR, "ANSWER KEY SET 1.docx")
DATA_JS = os.path.join(ROOT, "app", "js", "data", "set1.js")
ASSETS = os.path.join(ROOT, "app", "assets", "speaking")
CLEAN_TXT = os.path.join(ROOT, "tools", "_clean_set1.txt")

# 문단 앞에 붙는 도형 앵커 좌표 (예: left126365 / right5715 / 00 / -6351397017 / 19050172084)
ANCHOR = re.compile(r"^(?:left|right|center|top|bottom)?-?\d{2,}")


def doc_lines(path, dedupe=True):
    """docx → 정제된 문단 리스트.

    dedupe=True 일 때만 연속 중복 문단을 제거한다. 문제 docx 는 텍스트박스
    때문에 모든 문단이 2번씩 나오지만, ANSWER KEY docx 는 중복이 없고
    'C','C' 처럼 같은 정답이 연달아 나오므로 반드시 dedupe=False 로 읽어야 한다.
    """
    with zipfile.ZipFile(path) as z:
        xml = z.read("word/document.xml").decode("utf-8")
    xml = re.sub(r"</w:p>", "\n", xml)
    text = html.unescape(re.sub(r"<[^>]+>", "", xml))
    out, prev = [], None
    for raw in text.split("\n"):
        line = raw.strip()
        if not line:
            continue
        if dedupe and line == prev:   # 텍스트박스 중복
            continue
        prev = line
        out.append(line)
    return out


def normalize(s):
    """대조용 정규화: 앵커 제거 · 스마트따옴표 통일 · 공백 축약 · 소문자."""
    s = ANCHOR.sub("", s)
    s = (s.replace("‘", "'").replace("’", "'")
           .replace("“", '"').replace("”", '"')
           .replace("–", "-").replace("—", "-"))
    s = re.sub(r"\s+", " ", s)
    return s.strip().lower()


# ---------------------------------------------------------------- extract
def cmd_extract():
    os.makedirs(ASSETS, exist_ok=True)
    with zipfile.ZipFile(DOC) as z:
        media = sorted(n for n in z.namelist() if n.startswith("word/media/"))
        for name in media:
            dst = os.path.join(ASSETS, os.path.basename(name))
            with z.open(name) as s, open(dst, "wb") as d:
                shutil.copyfileobj(s, d)
    print("이미지 %d장 → %s" % (len(media), os.path.relpath(ASSETS, ROOT)))

    lines = doc_lines(DOC)
    with open(CLEAN_TXT, "w", encoding="utf-8") as f:
        f.write("\n".join(ANCHOR.sub("", l).strip() for l in lines))
    print("정제 원문 %d줄 → %s" % (len(lines), os.path.relpath(CLEAN_TXT, ROOT)))


# ---------------------------------------------------------------- verify
ANSWER_KEY_EXPECTED = {
    # ANSWER KEY SET 1.docx 를 파싱한 결과와 대조된다.
    "R1_cloze": ["brain", "into", "stages", "repairs", "and",
                 "strengthens", "system", "critical", "consolidation", "require"],
    "R2_cloze": ["their", "reduced", "moisture", "species", "extensive",
                 "dormant", "triggers", "survival", "strategies", "how"],
    "R1_mcq": "CB ADB DCDAB",
    "R2_mcq": "ABCDB",
    "L1": "CABACDADBCACCDBCAC",
    "L2": "CBAABDCBDABCCCB",
}


def parse_answer_key():
    """ANSWER KEY docx → {'R1_cloze':[...], 'L1':'CABAC...', ...}"""
    lines = [ANCHOR.sub("", l).strip() for l in doc_lines(KEY, dedupe=False)]
    out, cur, buf = {}, None, []

    def flush():
        if cur:
            out[cur] = list(buf)

    for line in lines:
        up = line.upper()
        if "MODULE 1" in up and "READING" in up:
            flush(); cur, buf = "R1", []
        elif "MODULE 2" in up and "READING" in up:
            flush(); cur, buf = "R2", []
        elif "MODULE 1" in up and "LISTENING" in up:
            flush(); cur, buf = "L1", []
        elif "MODULE 2" in up and "LISTENING" in up:
            flush(); cur, buf = "L2", []
        elif up.startswith("WRITING"):
            flush(); cur, buf = "W", []
        elif up.startswith("ANSWER KEY") or up.startswith("QUESTION"):
            continue
        elif cur:
            buf.append(line)
    flush()

    res = {}
    for mod in ("R1", "R2"):
        items = out.get(mod, [])
        res[mod + "_cloze"] = [x.lower() for x in items[:10]]
        res[mod + "_mcq"] = "".join(x for x in items[10:] if x in "ABCD")
    for mod in ("L1", "L2"):
        res[mod] = "".join(x for x in out.get(mod, []) if x in "ABCD")
    res["W"] = out.get("W", [])
    return res


def load_set1():
    """node 없이 set1.js 를 평가하기 위해 최소 셰이퍼를 붙여 node 로 JSON 출력."""
    shim = (
        "var window={};"
        + open(DATA_JS, encoding="utf-8").read()
        + "\nprocess.stdout.write(JSON.stringify({"
          "sections:window.SMEAG_SET1.sections}));"
    )
    try:
        raw = subprocess.run(["node", "-e", shim], capture_output=True,
                             check=True, text=True).stdout
    except FileNotFoundError:
        print("⚠ node 가 없어 set1.js 검증을 건너뜁니다 (brew install node)")
        return None
    except subprocess.CalledProcessError as e:
        print("✗ set1.js 실행 실패:\n" + e.stderr)
        sys.exit(1)
    return json.loads(raw)


def walk(sections):
    for sec in sections:
        for mod in sec["modules"]:
            for blk in mod["blocks"]:
                for q in blk["questions"]:
                    yield sec, mod, blk, q


def cmd_verify():
    fails = []

    def check(ok, msg):
        print(("  ✓ " if ok else "  ✗ ") + msg)
        if not ok:
            fails.append(msg)

    print("[1] ANSWER KEY 파싱 대조")
    key = parse_answer_key()
    for k, expected in ANSWER_KEY_EXPECTED.items():
        got = key.get(k)
        if isinstance(expected, str):
            expected = expected.replace(" ", "")
        check(got == expected, "%s = %s" % (k, got if got else "(없음)"))

    data = load_set1()
    if data is None:
        return 1 if fails else 0

    print("\n[2] 문항 수")
    counts = {}
    for sec, mod, blk, q in walk(data["sections"]):
        counts[sec["id"]] = counts.get(sec["id"], 0) + 1
    for sid, want in (("reading", 35), ("listening", 33), ("writing", 12), ("speaking", 11)):
        check(counts.get(sid) == want, "%s = %d (기대 %d)" % (sid, counts.get(sid, 0), want))

    print("\n[3] set1.js 정답 ↔ ANSWER KEY")
    letters = "ABCD"
    by_mod = {}
    for sec, mod, blk, q in walk(data["sections"]):
        by_mod.setdefault(mod["id"], []).append(q)

    for mid, keyname in (("R1", "R1_cloze"), ("R2", "R2_cloze")):
        got = [q["answer"] for q in by_mod[mid] if q["kind"] == "blank"]
        check(got == key[keyname], "%s 빈칸 10개 일치" % mid)
    for mid, keyname in (("R1", "R1_mcq"), ("R2", "R2_mcq"), ("L1", "L1"), ("L2", "L2")):
        got = "".join(letters[q["answer"]] for q in by_mod[mid]
                      if q["kind"] in ("mcq", "insert"))
        check(got == key[keyname], "%s 객관식 = %s" % (mid, got))

    print("\n[4] Writing Build a Sentence ↔ ANSWER KEY 문장")
    wkey = [normalize(s) for s in key["W"][:10]]
    wgot = [normalize(q["sentence"]) for q in by_mod["W1"]]
    for i, (a, b) in enumerate(zip(wkey, wgot), 1):
        check(a == b, "W%-2d %s" % (i, b))

    print("\n[5] 문제 텍스트가 원본 docx 에 존재하는가")
    corpus = " || ".join(normalize(l) for l in doc_lines(DOC))
    missing = []
    for sec, mod, blk, q in walk(data["sections"]):
        # 단문응답 prompt 는 앱이 만든 한국어 지시문, build 의 sentence 는 ANSWER KEY 쪽
        # 문장이라 문제 docx 에는 없다. 각각 [4]·정답키 검사에서 이미 대조된다.
        fields = ("prompt", "sentence")
        if q.get("layout") == "short-response":
            fields = ()
        elif q.get("kind") == "build":
            fields = ()
        for field in fields:
            v = q.get(field)
            if v and normalize(v) not in corpus:
                missing.append("%s.%s" % (q["id"], field))
        for c in q.get("choices", []):
            if normalize(c) not in corpus:
                missing.append("%s choice:%s" % (q["id"], c[:40]))
    check(not missing, "원문 대조 (누락 %d건)%s" %
          (len(missing), "" if not missing else " → " + ", ".join(missing[:8])))

    print("\n[6] 미디어 파일 존재")
    miss_media = []
    for sec, mod, blk, q in walk(data["sections"]):
        for holder in (q, blk):
            for field in ("audio", "image", "introAudio"):
                p = holder.get(field)
                if p and not os.path.exists(os.path.join(ROOT, p)):
                    miss_media.append(p)
    check(not miss_media, "미디어 경로 (누락 %d건)%s" %
          (len(set(miss_media)), "" if not miss_media else " → " + "; ".join(sorted(set(miss_media))[:5])))

    print("\n" + ("전부 통과 ✅" if not fails else "실패 %d건 ❌" % len(fails)))
    return 1 if fails else 0


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "verify"
    if cmd == "extract":
        cmd_extract()
    elif cmd == "verify":
        sys.exit(cmd_verify())
    else:
        print(__doc__)
        sys.exit(2)
