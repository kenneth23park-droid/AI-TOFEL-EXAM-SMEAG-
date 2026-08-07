#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""docs/bmad/set9-authored-passages.md 생성기.

단일 진실원천은 sg2/config/_set9_l2/L2-B{2,3,4,5}.json (집필 지문 + 정답 근거) 이고
문항/선택지/정답키는 sg2/assets/set9.js 에서 읽는다. 이 문서는 그 둘의 파생물이므로
지문을 고쳤으면 build_set9.py 와 함께 이 스크립트도 다시 돌린다.

실행: studyground/.venv/bin/python studyground/tools/gen_set9_authored_doc.py
"""

import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
STUDYGROUND = os.path.dirname(HERE)
ROOT = os.path.dirname(STUDYGROUND)
SRC = os.path.join(STUDYGROUND, "sg2", "config", "_set9_l2")
AUD = os.path.join(STUDYGROUND, "sg2", "media", "audio", "set9")
SET9 = os.path.join(STUDYGROUND, "sg2", "assets", "set9.js")
OUT = os.path.join(ROOT, "docs", "bmad", "set9-authored-passages.md")

BLOCKS = ["L2-B2", "L2-B3", "L2-B4", "L2-B5"]
HEADING = {"L2-B2": "Questions 4-5", "L2-B3": "Questions 6-7",
           "L2-B4": "Questions 8-11", "L2-B5": "Questions 12-15"}


def read_pack():
    src = open(SET9, encoding="utf-8").read()
    key = dict((k, int(v)) for k, v in re.findall(r'"(L2-\d+)": (\d+)', src))
    meta = {}
    pat = (r'\{\s*"id": "(L2-\d+)",\s*"kind": "mcq",\s*"no": (\d+),\s*'
           r'"prompt": "((?:[^"\\]|\\.)*)",\s*"choices": \[(.*?)\]')
    for m in re.finditer(pat, src, re.S):
        choices = [c.replace('\\"', '"')
                   for c in re.findall(r'"((?:[^"\\]|\\.)*)"', m.group(4))]
        meta[m.group(1)] = (int(m.group(2)), m.group(3).replace('\\"', '"'), choices)
    return key, meta


def duration(aid):
    out = subprocess.run(["afinfo", os.path.join(AUD, aid + ".mp3")],
                         capture_output=True, text=True).stdout
    m = re.search(r"estimated duration: ([\d.]+)", out)
    return float(m.group(1)) if m else 0.0


def read_corrections():
    """build_set9.py 의 오타 교정표를 그대로 읽어온다(문서에서 다시 적지 않는다)."""
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "build_set9", os.path.join(HERE, "build_set9.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.SOURCE_CORRECTIONS, mod.SOURCE_NOTES


def main():
    key, qmeta = read_pack()
    corrections, notes = read_corrections()
    blocks = [json.load(open(os.path.join(SRC, b + ".json"), encoding="utf-8"))
              for b in BLOCKS]

    L = []
    w = L.append
    w("# SET 9 · Listening Module 2 Q4-15 — 보충 집필 지문 (원본 아님)")
    w("")
    w("> ## ⚠️ 출처 경고 — 반드시 먼저 읽을 것")
    w("> **이 문서에 실린 4개 지문은 원본 SMEAG 자료가 아니다.**")
    w("> `SET 9 SCRIPT.docx` 의 MODULE 2 구간에는 Q1-3(짧은 응답형, 질문문이 곧 음원)만 전사가 있고,")
    w("> **Q4-15 가 묻는 대화·강의 본문은 존재하지 않는다.** 문항·선택지·정답키는 원본 그대로이므로,")
    w("> 아래 지문은 **\"기존 정답키의 정답이 유일하게 성립하도록\" 역으로 집필한 보충 지문**이다.")
    w("> **원본 전사가 확보되면 즉시 교체 대상이다.**")
    w(">")
    w("> 교체 절차: `studyground/sg2/config/_set9_l2/<blockId>.json` 의 `segments` 를 원본으로 갈아끼우고 →")
    w("> `studyground/.venv/bin/python studyground/tools/tts_set9.py --only <audioId> --force` →")
    w("> `studyground/.venv/bin/python studyground/tools/build_set9.py` →")
    w("> `studyground/.venv/bin/python studyground/tools/gen_set9_authored_doc.py` →")
    w("> `node studyground/tests/test_compile_set9.js`.")
    w("")
    w("출처 표시가 남아 있는 곳 (한 군데만 고치면 안 된다):")
    w("")
    w("| 위치 | 필드 |")
    w("|---|---|")
    w("| `sg2/config/_set9_l2/L2-B{2,3,4,5}.json` | `origin: \"authored\"`, `originNote`, `revisionNote` |")
    w("| `sg2/assets/set9.js` (L2 블록 4개) | `scriptOrigin: \"authored\"`, `scriptNote`, `script` |")
    w("| `sg2/tts-manifest.set9.json` | `authored_scripts[]` (`missing_scripts` 는 이제 빈 배열) |")
    w("| `tools/tts_set9.py` | 모듈 docstring + `AUTHORED_BLOCK_ORDER` 주석 |")
    w("| `tests/test_compile_set9.js` | `[7]` 상단 \"결손 해소 이력\" 주석 |")
    w("| 이 문서 | — |")
    w("")
    w("---")
    w("")
    w("## 산출물 요약")
    w("")
    w("| 블록 | 문항 | 종류 | 단어수 | 음원 | 크기 | 재생시간 |")
    w("|---|---|---|---|---|---|---|")
    for b in blocks:
        a = b["audioId"]
        kb = os.path.getsize(os.path.join(AUD, a + ".mp3")) // 1024
        w("| `%s` | %s | %s | %d | `media/audio/set9/%s.mp3` | %s KB | %.1f s |"
          % (b["blockId"], HEADING[b["blockId"]], b["kind"], b["wordCount"],
             a, format(kb, ","), duration(a)))
    w("")
    w("음성 정책은 기존 SET 9 음원 36개와 동일하다 (`tools/tts_set9.py`): macOS `say`,")
    w("`M:` = Alex / `W:` = Samantha, 165 wpm, 대화 화자 전환 0.40 s · 강의 문단 전환 0.55 s,")
    w("앞뒤 0.25 s 패딩, 22.05 kHz mono → lame 96 kbps. 강의는 L1 의 talk 2개와 같이 단일 남성 화자.")
    w("")
    w("---")
    w("")
    w("## 검증 이력")
    w("")
    w("### rev1 → rev2 — 역채점(reverse-grading)")
    w("")
    w("지문만 보고 문제를 푸는 독립 에이전트 4명이 블록별로 12문항을 풀었고,")
    w("**12/12 전부 `set9.js` 의 원본 정답키와 일치**했다. 즉 정답 불일치로 인한 지문 수정은 없었다.")
    w("다만 보고서가 지적한 **품질 결함**(질문문 어휘가 지문에 그대로 노출되는 verbatim leak,")
    w("오답이 명시적으로 부정돼 지문 이해 없이 소거법으로만 풀리는 설계)을 반영해 4개 지문을 개정했다(rev2).")
    w("")
    w("### rev2 → rev3 — blind 검증 (정답을 모르는 독립 응시자 2명)")
    w("")
    w("정답키를 보지 못한 응시자 2명이 rev2 지문만으로 12문항을 각각 풀었다.")
    w("")
    w("- **정답 일치 24/24 (2명 × 12문항).** 정답의 유일성 자체는 rev2 에서 이미 성립했다.")
    w("- 그러나 두 응시자가 **독립적으로 같은 결함**을 지적했다. 응시자 B 는 15개 항목 중 **13개를")
    w("  `solvableByElimination`** 로 표시했고, 진단은 \"오답 선택지를 먼저 만들고 그 부정문을 지문에")
    w("  심은 흔적\"이었다. 즉 **내용을 이해하지 않고 '부정되지 않은 선택지'만 골라도 만점**에 가까웠다.")
    w("")
    w("지적된 대표 문장(전부 rev3 에서 삭제됨):")
    w("")
    w("| 지문 | rev2 문장 | 무엇을 지워 주었나 |")
    w("|---|---|---|")
    w("| L2-B5 | \"It is not a feat of memory either\" / \"neither is the harmony\" | L2-13 오답 [0][1] |")
    w("| L2-B5 | \"I am not making a point about two people trading turns\" | L2-14 오답 [2] |")
    w("| L2-B4 | \"not there because the ledge suits it, or because the city shelters it\" | L2-10 오답 [1][2] — **한 문장이 둘 동시에** |")
    w("| L2-B4 | \"Last week was the machinery of migration... I won't return to any of it today\" | L2-8 오답 [0][3] |")
    w("| L2-B2 | \"we've never exchanged a word\" / \"I'm still in cognitive science\" | L2-4 오답 [3][2] |")
    w("| L2-B2 | 남자의 3개 제안을 여자가 차례로 전부 기각 | L2-5 오답 [0][1][2] |")
    w("")
    w("추가로 **정답 직전 신호어**(\"Here's what actually works\", \"Here is the difficulty\",")
    w("\"The whole problem is the number\", \"That arrangement is the only reason I bring the comparison up\")가")
    w("화자의 목적을 그대로 말해 버려, 목적·주제 추론 문항이 세부사항 검색 문항으로 격하돼 있었다.")
    w("")
    w("### rev3 집필 원칙")
    w("")
    w("1. 오답은 **부정**이 아니라 **충돌**로 죽인다 — 화자가 \"그건 아니다\"라고 선언하는 대신,")
    w("   장면의 사실관계가 그 선택지와 양립할 수 없게 만들고 배제는 응시자의 추론에 맡긴다.")
    w("2. **한 문장이 오답 둘 이상을 동시에 죽이는 구조 금지** — 오답은 지문의 서로 다른 부분에서")
    w("   각각 다른 이유로 배제되어야 한다.")
    w("3. 주제·목적은 **선언하지 말고 실연**한다 — 도입부의 논지 선언과 정답 직전 신호어를 걷어낸다.")
    w("4. 그럼에도 **정답의 유일성은 유지**한다. 부정이 불가피하면 교정조(\"not X, but Y\")가 아니라")
    w("   서술에 녹인 형태로만 쓴다.")
    w("5. 대화에서 제안을 줄줄이 기각하지 않는다 — 제안은 1개 이하, 권고는 적극적 이유와 함께.")
    w("")
    w("블록별 구체적 변경 내역은 각 JSON 의 `revisionNote` 와 아래 블록 절에 있다.")
    w("`evidence[].whyOthersFail` 도 \"화자가 아니라고 말함\" 대신 \"지문의 어느 사실과 어떻게")
    w("충돌하는지\"로 rev3 에서 전면 재작성했다.")
    w("")
    w("### rev3 회귀 검증 (실행 결과)")
    w("")
    w("- `node studyground/tests/test_compile_set9.js` → **ALL PASS** (오디오 결손 0, buildWarnings 0,")
    w("  `scriptOrigin=authored` 블록 4, 오디오 없는 리스닝 블록/문항 0)")
    w("- `node studyground/tests/test_compile_screens.js` → **ALL PASS** (SET 1 회귀 없음)")
    w("- `studyground/tests/*.js` 6개 전부 PASS · `pytest studyground/tests` → **82 passed**")
    w("- **정답 index 무변경** — 오타 교정 전후 `answerKey` 97항목 및 L2 15문항의 `answer` 를 대조해 차이 0")
    w("- 헤드리스 Chrome (`exam-runtime.html?mode=exam&profile=toefl&set=set9#screen=listening.q.L2.04`)")
    w("  → 화면 렌더 OK, `<audio src=\"media/audio/set9/set9-L2-04-05.mp3\">`, 페이지 콘솔 에러 0")
    w("  (정적 서버의 `/favicon.ico` 404 제외)")
    w("- 부정문 잔존 검사 — 4개 지문에서 `not`/`never`/`neither`/`no` 를 전수 훑은 결과,")
    w("  **선택지를 직접 지우는 문장은 0건**. 남은 용례는 관용구(\"You will not believe my morning\"),")
    w("  정답 근거 자체(\"in four years I've never seen you counting days...\" → L2-7),")
    w("  비유 내부 서술(\"Nobody handed you those sentences in advance\" → L2-14 정답 근거)뿐이다.")
    w("- 문항→지문 어휘 누출 검사 — 질문문·정답 선택지와 해당 지문 사이의 3-gram 중복 **0건**.")
    w("  (오답 쪽 \"the sun's\", \"rock and blues\" 2건은 불가피한 내용어이며 정답 쪽이 아니다.)")
    w("")
    w("---")
    w("")
    w("## 원본 docx 오타 교정 (문항 텍스트, 지문과 무관)")
    w("")
    w("blind 검증에서 **`NEW TOEFL MOCK TEST SET  9.docx` 자체의 오타** 6건이 발견됐다.")
    w("그중 문법 오류형은 응시자가 내용을 몰라도 **\"비문인 선택지를 지우는\" test-wiseness** 로")
    w("정답을 좁힐 수 있게 만든다. 화면에는 교정본을 쓰되 **원문 표기는 `promptRaw` / `choicesRaw` 에")
    w("보존**하고, 문항의 `sourceCorrections[]` 에 사유를 남긴다. 표는 `tools/build_set9.py` 의")
    w("`SOURCE_CORRECTIONS` / `SOURCE_NOTES` 에 있으므로 다음 빌드에도 그대로 유지된다.")
    w("")
    w("**선택지 순서는 건드리지 않으므로 정답 index 는 교정 전후 동일하다** (빌드가 assert 로 강제).")
    w("")
    w("| 문항 | 대상 | 원문 (docx) | 교정본 | 사유 |")
    w("|---|---|---|---|---|")
    for qid in sorted(corrections):
        spec = corrections[qid]
        if "prompt" in spec:
            raw, fix, why = spec["prompt"]
            w("| `%s` | 질문문 | %s | %s | %s |" % (qid, raw, fix, why.replace("\n", " ")))
        for idx, raw, fix, why in spec.get("choices", []):
            w("| `%s` | 선택지 [%d] | %s | %s | %s |"
              % (qid, idx, raw, fix, why.replace("\n", " ")))
    for qid in sorted(notes):
        for note in notes[qid]:
            w("| `%s` | %s | %s | **교정하지 않음** | %s |"
              % (qid, note["target"], note["raw"], note["why"].replace("\n", " ")))
    w("")
    w("`L2-15` 선택지 [1] 은 원본 docx 를 `zipfile`+`re` 로 직접 다시 파싱해 확인했다.")
    w("해당 `<w:p>` 는 런 2개(`\"B.\"` + `\" Classical composers were initially reluctant\"`)로")
    w("그 자리에서 끝난다 — 파싱 손실이나 절단이 아니라 **원본이 그렇게 짧다**. 뒷부분을 지어낼 수")
    w("없으므로 원문을 그대로 둔다. 정답은 [2] 이므로 채점에는 영향이 없다.")
    w("")
    w("---")
    w("")

    bad = 0
    for b in blocks:
        bid = b["blockId"]
        w("## %s — %s (`%s`)" % (bid, HEADING[bid], b["audioId"]))
        w("")
        w("- 종류: **%s** · 단어수 **%d** · 음원 **%.1f초**"
          % (b["kind"], b["wordCount"], duration(b["audioId"])))
        w("- 개정 사유: %s" % b.get("revisionNote", "").replace("\n", " "))
        w("")
        w("### 지문 전문")
        w("")
        w("```text")
        for line in b["plainText"].split("\n"):
            w(line)
        w("```")
        w("")
        w("### 정답 근거 대조표")
        w("")
        flat = re.sub(r"\s+", " ", b["plainText"])
        for ev in b["evidence"]:
            qid = ev["questionId"]
            no, prompt, choices = qmeta[qid]
            gold = key[qid]
            if gold != ev["keyedAnswerIndex"]:
                print("MISMATCH %s: pack=%d evidence=%d" % (qid, gold, ev["keyedAnswerIndex"]))
                bad += 1
            for chunk in [c.strip() for c in ev["supportingLine"].split("...") if c.strip()]:
                if re.sub(r"\s+", " ", chunk) not in flat:
                    print("SUPPORTING LINE NOT IN PASSAGE %s: %s" % (qid, chunk[:60]))
                    bad += 1
            w("#### %s (Q%d) — 정답키 **%d** : %s" % (qid, no, gold, choices[gold]))
            w("")
            w("> **문항:** %s" % prompt)
            w("")
            w("**정답 근거 문장 (지문에서 그대로):**")
            w("")
            w("> %s" % ev["supportingLine"])
            w("")
            w("| # | 선택지 | 판정 | 근거 |")
            w("|---|---|---|---|")
            for i, c in enumerate(choices):
                if i == gold:
                    w("| **%d** | **%s** | **정답** | 위 근거 문장 |" % (i, c))
                else:
                    why = ev["whyOthersFail"].get(str(i), "(근거 없음)")
                    w("| %d | %s | 오답 | %s |"
                      % (i, c, why.replace("|", "\\|").replace("\n", " ")))
            note = ev["whyOthersFail"].get("_designNote")
            if note:
                w("")
                w("*설계 메모: %s*" % note)
            w("")
        w("---")
        w("")
    w("*지문 원문의 단일 진실원천은 `sg2/config/_set9_l2/*.json` 이며, 이 문서는")
    w("`tools/gen_set9_authored_doc.py` 가 그 파일들에서 생성한 읽기용 사본이다.*")

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(L) + "\n")
    print("wrote %s (%d bytes)" % (OUT, os.path.getsize(OUT)))
    print("정답키 ↔ evidence 대조: %s" % ("OK" if not bad else "FAIL %d" % bad))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
