"""
교재 챕터 품질 게이트 4종 — 전부 결정적이고, 전부 오프라인에서 판정을 낸다.

이 파일이 존재하는 이유
---------------------
집필 파이프라인(graph.py)이 LLM 을 부르는 것은 draft/revise 두 노드뿐이다. 판정은
LLM 이 하지 않는다. 캠퍼스 장비는 망이 끊겨 있고(smeag-local-ai/requirements.txt),
게이트가 모델을 필요로 하면 "망이 안 되니까 오늘은 검산 없이 넘긴다" 가 반드시
일어난다. 그 한 번이 정답 없는 문항을 인쇄까지 보낸다. 그래서 네 게이트는 전부
계산으로만 결론을 내고, LLM 이 있으면 좋아지는 것은 fact_gate 의 '설명' 뿐이다.

게이트 모양은 studyground/sg2/assets/set-import.js 와 글자까지 같다.

    {'level': 'stop'|'warn'|'info', 'scope': str, 'message': str}

관리자 화면이 세트 가져오기 게이트와 집필 게이트를 한 목록에 섞어 그리기 때문에
모양이 갈리면 화면이 게이트를 두 번 해석해야 한다. scope 값도 되도록
docs/bmad/book-schema.md §4-2 의 이름을 재사용한다(answer/cloze/choices/count/ids).
book-schema 의 validate() 가 만들지 않는 판정에만 새 scope 를 쓴다 — cefr/dup/fact.

메시지는 영어다(화면에 그대로 뜬다). 주석과 문서는 한국어다 — 집 규칙.
"""

from __future__ import annotations

import json
import re
from typing import Any, Iterable, Sequence

STOP = "stop"
WARN = "warn"
INFO = "info"


def gate(level: str, scope: str, message: str) -> dict:
    """게이트 하나. 이 함수 말고 다른 데서 dict 를 직접 만들지 말 것 — 키가 갈린다."""
    return {"level": level, "scope": scope, "message": message}


def worst(gates: Sequence[dict]) -> str:
    """게이트 목록의 최악 등급. 'stop' 이 하나라도 있으면 저장 버튼이 잠긴다."""
    levels = {g.get("level") for g in gates}
    if STOP in levels:
        return STOP
    if WARN in levels:
        return WARN
    return INFO


# ══════════════════════════════════════════════════════════════════════════
# 0. 텍스트 수확 — 어느 게이트든 "학생이 읽는 영어"만 본다
# ══════════════════════════════════════════════════════════════════════════

# dup-core.js 의 SKIP_KEYS 를 그대로 옮긴다. 여기에 없는 키가 dup-core 에 생기면
# 두 도구가 다른 것을 비교하게 되므로, 저쪽을 고칠 때 이 집합도 같이 고친다.
SKIP_KEYS = {
    "id", "kind", "no", "layout", "answer",
    "audio", "image", "introAudio", "perQuestionAudio",
    "heading", "instruction", "label", "labelKo",
    "prepSec", "respondSec", "minWords", "timeLimitSec",
    "scriptOrigin", "scriptNote", "scriptBlockId", "scriptKind", "revisionNote",
    "markerOrigin", "markerNote", "origin", "originNote",
    "promptRaw", "choicesRaw", "answerKeyRaw", "sourceCorrections",
    "questions", "blocks", "modules", "sections",
    "slots", "voices",
    "hint",                       # cloze 힌트 — 내용이 아니라 입력 보조 조각
    "tiles", "trapTiles",         # build 타일 — sentence 에서 파생된 같은 단어들
    "situationLabel", "bulletsLabel", "to",
    # 교재 전용 키. 학생이 읽는 문제지가 아니라 편집 메타라 비교·측정에서 뺀다.
    "audioRef", "introAudioRef", "scriptRef",
    "schemaVersion", "book", "chapterNo", "slug", "cefr", "edition",
    "provenance", "indexTerms", "glossary", "teaching", "targetSkills",
    "modelAnswers",
}


def harvest(node: Any, out: list | None = None) -> list:
    """객체에서 내용 문자열만 재귀 수집. 새 문항 종류가 생겨도 자동으로 따라온다."""
    if out is None:
        out = []
    if node is None:
        return out
    if isinstance(node, str):
        if node.strip():
            out.append(node)
        return out
    if isinstance(node, (int, float, bool)):
        return out
    if isinstance(node, (list, tuple)):
        for item in node:
            harvest(item, out)
        return out
    if isinstance(node, dict):
        for k, v in node.items():
            if k in SKIP_KEYS or (k and k[0] == "_"):
                continue
            harvest(v, out)
    return out


def walk(chapter: dict) -> list:
    """[{q, block, module, mi, bi, qi}] — book-schema.js walk() 와 같은 순회."""
    out = []
    for mi, mod in enumerate(chapter.get("modules") or []):
        for bi, blk in enumerate(mod.get("blocks") or []):
            for qi, q in enumerate(blk.get("questions") or []):
                out.append({"q": q, "block": blk, "module": mod,
                            "mi": mi, "bi": bi, "qi": qi})
    return out


_PROSE_Q_FIELDS = ("script", "situation", "prompt", "sentence", "context")


def prose_of(chapter: dict) -> list:
    """
    이어진 글만 모은다 — 지문 · cloze 템플릿 · 대본 · 발문 · 모범답안.

    문장 길이는 여기서만 잰다. 선택지("in the library")는 문장이 아니라 명사구라,
    문장으로 세면 평균이 내려간다(SET9 리딩 실측: 선택지 포함 7.87 단어 / 제외 9.25
    단어). 선택지 수는 blueprint 가 고정하므로 그 값이 섞이면 챕터의 문체가 아니라
    문항 수를 재게 된다. 지시문·머리말은 유형이 고정하는 정형문이라 양쪽 어디에도
    넣지 않는다 — blueprint 의 난이도를 재게 된다.
    """
    texts: list[str] = []
    for mod in chapter.get("modules") or []:
        for blk in mod.get("blocks") or []:
            if blk.get("template"):
                texts.append(str(blk["template"]))
            for p in blk.get("paragraphs") or []:
                texts.append(str(p))
            if blk.get("introScript"):
                texts.append(str(blk["introScript"]))
            for q in blk.get("questions") or []:
                for f in _PROSE_Q_FIELDS:
                    if q.get(f):
                        texts.append(str(q[f]))
                for post in q.get("posts") or []:
                    if isinstance(post, dict) and post.get("text"):
                        texts.append(str(post["text"]))
    for track in (chapter.get("audio") or {}).get("tracks") or []:
        if track.get("script"):
            texts.append(str(track["script"]))
    for ma in chapter.get("modelAnswers") or []:
        if ma.get("text"):
            texts.append(str(ma["text"]))
    return [t for t in texts if t and t.strip()]


def lexis_of(chapter: dict) -> list:
    """
    어휘 지표(MSTTR·AWL)의 대상 — 이어진 글 **더하기** 선택지·제목·불릿까지.

    학생이 읽는 낱말은 선택지에도 있다. 어휘 다양성과 학술어휘 비율은 낱말 단위라
    짧은 조각을 넣어도 왜곡되지 않는다(문장 길이와 다른 점이다).
    """
    texts = list(prose_of(chapter))
    for mod in chapter.get("modules") or []:
        for blk in mod.get("blocks") or []:
            if blk.get("title"):
                texts.append(str(blk["title"]))
            for q in blk.get("questions") or []:
                for c in q.get("choices") or []:
                    texts.append(str(c))
                for b in q.get("bullets") or []:
                    texts.append(str(b))
                if q.get("subject"):
                    texts.append(str(q["subject"]))
    return [t for t in texts if t and t.strip()]


# ══════════════════════════════════════════════════════════════════════════
# 1. cefr_gate — B2 판정을 측정값 세 개로만 내린다
# ══════════════════════════════════════════════════════════════════════════

# 학술어휘목록(AWL, Coxhead 2000) 서브리스트 1·2 의 표제어 120개. 전체 570개를
# 여기 옮겨 적지 않는 이유: 서브리스트 1·2 는 학술 텍스트에 나오는 AWL 토큰의
# 절반 이상을 차지해서, '비율' 이라는 상대 지표를 재는 데는 이 120개로 충분하고
# 목록이 길어질수록 손으로 유지하다 틀린다. 절대 개수가 아니라 아래 CEFR_BANDS 의
# 밴드와 짝지어 읽는 값이므로, 목록을 늘리면 밴드도 같이 다시 재야 한다.
AWL_HEADWORDS = frozenset("""
analyse approach area assess assume authority available benefit concept
consist constitute context contract create data define derive distribute
economy environment establish estimate evident export factor finance formula
function identify income indicate individual interpret involve issue labour
legal legislate major method occur percent period policy principle proceed
process require research respond role section sector significant similar
source specific structure theory vary
achieve acquire administrate affect appropriate aspect assist category
chapter commission community complex compute conclude conduct consequent
construct consume credit culture design distinct element equate evaluate
feature final focus impact injure institute invest item journal maintain
normal obtain participate perceive positive potential previous primary
purchase range region regulate relevant reside resource restrict secure
seek select site strategy survey text tradition transfer
""".split())

_WORD_RE = re.compile(r"[A-Za-z][A-Za-z'-]*")
# 문장 끝. 약어(Dr. Mr. etc.)는 뒤 글자가 대문자여도 잘리지만, 교재 지문에서
# 약어 빈도가 낮아 평균 문장 길이에 미치는 영향이 소수점 아래다.
_SENT_RE = re.compile(r"[^.!?\n]+[.!?]*")
_BLANK_RE = re.compile(r"\{\{\s*\d+\s*\}\}")


def _words(text: str) -> list:
    return [m.group(0).lower() for m in _WORD_RE.finditer(text)]


def _sentences(text: str, blank: str = "blank") -> list:
    """
    문장으로 자른다. cloze 의 {{7}} 은 한 낱말 자리이므로 낱말 하나로 바꿔 놓는다.

    측정할 때는 'blank'(길이가 평균적인 낱말), 사람에게 보여 줄 때는 '___' 를 쓴다 —
    보고서에 "the cost of the first blank" 라고 적히면 원문에 그 단어가 있는 줄 안다.
    """
    clean = _BLANK_RE.sub(blank, text)
    return [s.strip() for s in _SENT_RE.findall(clean) if s.strip()]


def is_academic(token: str) -> bool:
    """
    AWL 표제어이거나 그 표제어의 굴절형인가.

    파생형 전체를 목록으로 들고 있지 않다(analyse/analysed/analysing/analysis…).
    표제어를 접두로 갖는 5글자 이상 토큰을 굴절형으로 친다. 'vary→varies' 처럼
    y 가 i 로 바뀌는 경우만 따로 본다. 과탐(예: 'area' 접두의 다른 단어)이 있을 수
    있으나, 이 값은 챕터끼리·SET9 기준선과 비교하는 상대 지표라 같은 규칙으로
    잰 값끼리는 비교가 성립한다.
    """
    if token in AWL_HEADWORDS:
        return True
    for head in AWL_HEADWORDS:
        if len(head) < 5:
            continue
        if token.startswith(head):
            return True
        if head.endswith("y") and token.startswith(head[:-1] + "i"):
            return True
    return False


def readability(prose: Iterable[str], lexis: Iterable[str] | None = None) -> dict:
    """
    B2 판정에 쓰는 측정값. 전부 셈으로 나오는 값이고 모델이 끼지 않는다.

    prose  — 문장 길이 분포를 재는 대상(이어진 글만).
    lexis  — 어휘 지표를 재는 대상. 안 주면 prose 를 쓴다.

    msttr — 100토큰 창의 type-token ratio 평균. 그냥 TTR 은 글이 길수록 내려가서
            지문 하나(200단어)와 대본 하나(500단어)를 같은 자로 잴 수 없다.
            창을 고정하면 길이의 영향이 사라진다.
    """
    prose = [t for t in prose if t and t.strip()]
    lexis = prose if lexis is None else [t for t in lexis if t and t.strip()]
    sents: list[str] = []
    for t in prose:
        sents.extend(_sentences(t))
    lens = [len(_words(s)) for s in sents]
    lens = [n for n in lens if n > 0]
    toks: list[str] = []
    for t in lexis:
        toks.extend(_words(t))

    n_tok = len(toks)
    n_sent = len(lens)
    mean_len = (sum(lens) / n_sent) if n_sent else 0.0
    long_ratio = (sum(1 for n in lens if n > 25) / n_sent) if n_sent else 0.0
    short_ratio = (sum(1 for n in lens if n < 6) / n_sent) if n_sent else 0.0

    win = 100
    if n_tok >= win:
        chunks = [toks[i:i + win] for i in range(0, n_tok - win + 1, win)]
        msttr = sum(len(set(c)) / len(c) for c in chunks) / len(chunks)
    else:
        msttr = (len(set(toks)) / n_tok) if n_tok else 0.0

    awl = (sum(1 for w in toks if is_academic(w)) / n_tok) if n_tok else 0.0

    return {
        "tokens": n_tok,
        "proseTokens": sum(lens),
        "sentences": n_sent,
        "meanSentenceLen": round(mean_len, 2),
        "longSentenceRatio": round(long_ratio, 3),
        "shortSentenceRatio": round(short_ratio, 3),
        "msttr100": round(msttr, 3),
        "awlRatio": round(awl, 4),
    }


# ── B2 밴드 ────────────────────────────────────────────────────────────────
#
# 어디서 온 숫자인가: 이 저장소의 SET 9 조각(config/_set9_fragments/*.json, 대본
# 사이드카 포함)을 이 파일의 readability() 로 직접 재서 잡았다(실측 2026-08-17).
#
#     reading    meanSentenceLen  9.25 · msttr100 0.795 · awlRatio 0.0511
#     listening  meanSentenceLen 10.44 · msttr100 0.717 · awlRatio 0.0265
#     speaking   meanSentenceLen  9.85 · msttr100 0.710 · awlRatio 0.0263
#     writing    meanSentenceLen 10.87 · msttr100 0.718 · awlRatio 0.0242
#
# 재현: python3 -m authoring.cli --baseline
#
# SET 9 는 이 교재가 겨냥하는 바로 그 수험생용으로 이미 승인된 원고다. 그래서
# 밴드는 '이론적 B2' 가 아니라 '승인된 SET 9 이 들어가는 구간' 으로 잡는다.
# ok 구간은 위 실측을 모두 포함하되, 밖으로 크게 나가면(C1 논문투·A2 단문투)
# 사람이 보게 만든다. warn 은 '사람이 본다', stop 은 '이대로는 B2 교재가 아니다'.
#
# 리스닝은 말이라 문장이 짧은 게 정상이므로 문장 길이 하한만 따로 둔다.
CEFR_BANDS = {
    "meanSentenceLen": {"ok": (8.0, 20.0), "hard": (6.0, 28.0)},
    "meanSentenceLenSpoken": {"ok": (7.0, 18.0), "hard": (5.0, 24.0)},
    "msttr100": {"ok": (0.62, 0.88), "hard": (0.45, 0.95)},
    "awlRatio": {"ok": (0.015, 0.090), "hard": (0.004, 0.160)},
    "minTokens": 120,          # 이보다 짧으면 비율 지표가 표본으로 성립하지 않는다
    "longSentenceRatio": 0.20,  # 25단어 넘는 문장이 1/5 이상이면 B2 독자가 놓친다
}

_SPOKEN_BOOKS = ("listening", "speaking")


def cefr_gate(chapter: dict, blueprint: dict | None = None) -> list:
    """
    B2 인가. 문장 길이 분포 · type-token ratio · 학술어휘 비율 세 가지로만 본다.

    판정에 쓴 숫자를 메시지에 그대로 적는다. "너무 어렵다" 만 적으면 집필자가
    무엇을 얼마나 고쳐야 하는지 알 수 없어 게이트를 끄게 된다.
    """
    gates: list = []
    book = str(chapter.get("book") or chapter.get("id") or "")
    m = readability(prose_of(chapter), lexis_of(chapter))

    # 표본이 모자라면 아래 판정은 전부 warn 으로 내린다. 빈 뼈대를 두고 "B2 가
    # 아니다" 라고 47줄을 쏟아 내면, 정작 읽어야 할 answer_gate 의 '내용이 없다' 가
    # 그 안에 묻힌다. 못 잰 것과 재서 벗어난 것은 다른 말이다.
    thin = m["tokens"] < CEFR_BANDS["minTokens"]
    if thin:
        gates.append(gate(WARN, "cefr",
                          "Only %d words of student-facing text: too little to measure the "
                          "level (need %d). The findings below are indicative only."
                          % (m["tokens"], CEFR_BANDS["minTokens"])))

    spoken = book in _SPOKEN_BOOKS
    len_band = CEFR_BANDS["meanSentenceLenSpoken" if spoken else "meanSentenceLen"]

    checks = (
        ("meanSentenceLen", len_band, "mean sentence length", "%.2f words"),
        ("msttr100", CEFR_BANDS["msttr100"], "lexical variety (MSTTR-100)", "%.3f"),
        ("awlRatio", CEFR_BANDS["awlRatio"], "academic-word ratio", "%.4f"),
    )
    for key, band, label, fmt in checks:
        value = m[key]
        lo_ok, hi_ok = band["ok"]
        lo_hard, hi_hard = band["hard"]
        if (value < lo_hard or value > hi_hard) and not thin:
            level = STOP
        elif value < lo_ok or value > hi_ok:
            level = WARN
        else:
            continue
        side = "below" if value < lo_ok else "above"
        gates.append(gate(level, "cefr",
                          ("B2 band: %s is " + fmt + ", %s the B2 range " + fmt + "-" + fmt
                           + " (measured on %d prose words in %d sentences, %d words total).")
                          % (label, value, side, lo_ok, hi_ok,
                             m["proseTokens"], m["sentences"], m["tokens"])))

    if m["sentences"] and m["longSentenceRatio"] > CEFR_BANDS["longSentenceRatio"]:
        gates.append(gate(WARN, "cefr",
                          "B2 band: %.0f%% of sentences are longer than 25 words "
                          "(limit %.0f%%). Long sentences are where B2 readers lose the thread."
                          % (m["longSentenceRatio"] * 100,
                             CEFR_BANDS["longSentenceRatio"] * 100)))

    if not gates:
        gates.append(gate(INFO, "cefr",
                          "B2 band ok: mean sentence %.2f words, MSTTR-100 %.3f, "
                          "academic-word ratio %.4f (%d prose words in %d sentences, "
                          "%d words total)."
                          % (m["meanSentenceLen"], m["msttr100"], m["awlRatio"],
                             m["proseTokens"], m["sentences"], m["tokens"])))
    return gates


# ══════════════════════════════════════════════════════════════════════════
# 2. answer_gate — 정답이 하나이고, 그 하나가 실제로 맞는가
# ══════════════════════════════════════════════════════════════════════════

AUTO_KINDS = ("blank", "mcq", "insert", "build")


def _blueprint_book(blueprint: dict | None, book: str) -> dict | None:
    if not blueprint:
        return None
    for b in blueprint.get("books") or []:
        if b.get("id") == book:
            return b
    return None


def _norm_token(s: str) -> str:
    """build 문항 토큰 비교용. 문장부호와 대소문자는 타일에 안 붙는다."""
    return re.sub(r"[^a-z0-9']+", "", str(s).lower())


def answer_gate(chapter: dict, blueprint: dict | None = None) -> list:
    """
    자동채점 문항의 정답이 성립하는가. 전부 사실 확인이고 취향이 없다.

    여기서 놓치면 학생이 맞고도 틀린다 — 시험 당일에는 고칠 수 없는 종류의 사고라
    대부분이 stop 이다.
    """
    gates: list = []
    flat = walk(chapter)

    # ── 2-a. id / no 유일성 ────────────────────────────────────────────────
    seen_id: dict = {}
    seen_no: dict = {}
    for e in flat:
        q = e["q"]
        qid = str(q.get("id") or "")
        if not qid:
            gates.append(gate(STOP, "ids", "Question %s in module %s has no id."
                              % (q.get("no"), e["module"].get("id"))))
        elif qid in seen_id:
            gates.append(gate(STOP, "ids",
                              "Duplicate question id '%s'. Two questions with one id "
                              "overwrite each other's saved answer." % qid))
        else:
            seen_id[qid] = 1
        no = q.get("no")
        if not isinstance(no, int):
            gates.append(gate(STOP, "ids", "Question '%s' has no numeric 'no'." % qid))
        elif no in seen_no:
            gates.append(gate(STOP, "ids", "Duplicate question number %d ('%s' and '%s')."
                              % (no, seen_no[no], qid)))
        else:
            seen_no[no] = qid

    if seen_no:
        want = list(range(1, len(flat) + 1))
        got = sorted(seen_no.keys())
        if got != want:
            gates.append(gate(STOP, "ids",
                              "Question numbers must run 1..%d with no gaps; got %s."
                              % (len(flat), _brief(got))))

    # ── 2-b. 종류별 정답 ───────────────────────────────────────────────────
    for e in flat:
        q = e["q"]
        qid = str(q.get("id") or ("no." + str(q.get("no"))))
        kind = q.get("kind")

        if kind == "blank":
            ans = str(q.get("answer") or "").strip()
            hint = str(q.get("hint") or "").strip()
            if not ans:
                gates.append(gate(STOP, "answer", "%s: cloze blank has no answer." % qid))
                continue
            if len(ans.split()) > 1:
                gates.append(gate(WARN, "answer",
                                  "%s: cloze answer '%s' is more than one word; the "
                                  "answer box accepts one token." % (qid, ans)))
            if not hint:
                gates.append(gate(STOP, "cloze", "%s: cloze blank has no hint letters." % qid))
            elif not ans.lower().startswith(hint.lower()):
                gates.append(gate(STOP, "cloze",
                                  "%s: hint '%s' is not a prefix of answer '%s'."
                                  % (qid, hint, ans)))
            elif len(hint) >= len(ans):
                gates.append(gate(STOP, "cloze",
                                  "%s: hint '%s' gives away the whole answer '%s'."
                                  % (qid, hint, ans)))

        elif kind in ("mcq", "insert"):
            choices = q.get("choices") or []
            ans = q.get("answer")
            if len(choices) < 3:
                gates.append(gate(STOP, "choices",
                                  "%s: %d choices; a multiple-choice question needs at "
                                  "least 3." % (qid, len(choices))))
            blank_at = [i + 1 for i, c in enumerate(choices) if not str(c or "").strip()]
            if blank_at:
                gates.append(gate(STOP, "choices",
                                  "%s: choice %s is empty." % (qid, _brief(blank_at))))
            if not isinstance(ans, int) or isinstance(ans, bool):
                gates.append(gate(STOP, "answer",
                                  "%s: answer must be a 0-based choice index, got %r."
                                  % (qid, ans)))
            elif ans < 0 or ans >= len(choices):
                gates.append(gate(STOP, "answer",
                                  "%s: answer index %d is outside the %d choices."
                                  % (qid, ans, len(choices))))
            norms = [_norm_token(c) for c in choices]
            dup = [n for n in set(norms) if n and norms.count(n) > 1]
            if dup:
                gates.append(gate(STOP, "choices",
                                  "%s: two choices are the same text (%s) — more than one "
                                  "option is correct." % (qid, ", ".join(sorted(dup)))))

        elif kind == "build":
            sentence = str(q.get("sentence") or "").strip()
            tokens = [t for t in (q.get("answerTokens") or []) if str(t).strip()]
            tiles = [t for t in (q.get("tiles") or []) if str(t).strip()]
            if not sentence:
                gates.append(gate(STOP, "questions", "%s: build question has no sentence." % qid))
            if not tokens:
                gates.append(gate(STOP, "answer", "%s: build question has no answerTokens." % qid))
                continue
            joined = _norm_token("".join(tokens))
            if sentence and joined != _norm_token(sentence):
                gates.append(gate(STOP, "answer",
                                  "%s: answerTokens do not rebuild the sentence. "
                                  "tokens='%s' sentence='%s'."
                                  % (qid, " ".join(str(t) for t in tokens), sentence)))
            if tiles:
                need = sorted(_norm_token(t) for t in tokens)
                have = sorted(_norm_token(t) for t in tiles)
                missing = _multiset_diff(need, have)
                if missing:
                    gates.append(gate(STOP, "answer",
                                      "%s: answer tokens missing from the tiles: %s."
                                      % (qid, ", ".join(missing))))
                extra = _multiset_diff(have, need)
                traps = sorted(_norm_token(t) for t in (q.get("trapTiles") or []))
                stray = _multiset_diff(extra, traps)
                if stray:
                    gates.append(gate(WARN, "answer",
                                      "%s: tiles not used by the answer and not declared as "
                                      "trapTiles: %s." % (qid, ", ".join(stray))))

        elif kind in ("email", "discussion", "repeat", "interview"):
            # 사람이 채점한다. 정답은 없지만 '답할 수 있는 문항인가' 는 여기서 본다.
            if kind == "email":
                if len(q.get("bullets") or []) < 3:
                    gates.append(gate(WARN, "questions",
                                      "%s: an email task needs 3 bullets; got %d."
                                      % (qid, len(q.get("bullets") or []))))
            if kind == "discussion":
                if len(q.get("posts") or []) < 2:
                    gates.append(gate(WARN, "questions",
                                      "%s: a discussion task needs 2 student posts; got %d."
                                      % (qid, len(q.get("posts") or []))))
            if kind in ("repeat", "interview"):
                if not str(q.get("script") or "").strip() and not str(q.get("audioRef") or "").strip():
                    gates.append(gate(STOP, "audio",
                                      "%s: speaking prompt has neither a script nor an "
                                      "audioRef; nothing can be played." % qid))
        else:
            gates.append(gate(STOP, "structure",
                              "%s: unknown question kind '%s'. The exam engine cannot "
                              "render it." % (qid, kind)))

    # ── 2-c. cloze 템플릿의 {{n}} 자리표시자 ────────────────────────────────
    for mod in chapter.get("modules") or []:
        for blk in mod.get("blocks") or []:
            if blk.get("kind") != "cloze":
                continue
            tpl = str(blk.get("template") or "")
            marks = set(int(x) for x in re.findall(r"\{\{\s*(\d+)\s*\}\}", tpl))
            want = set(int(q.get("no")) for q in (blk.get("questions") or [])
                       if isinstance(q.get("no"), int))
            if want - marks:
                gates.append(gate(STOP, "cloze",
                                  "%s block: template has no {{n}} placeholder for question "
                                  "%s." % (mod.get("id"), _brief(sorted(want - marks)))))
            if marks - want:
                gates.append(gate(STOP, "cloze",
                                  "%s block: template has placeholder %s with no matching "
                                  "question." % (mod.get("id"), _brief(sorted(marks - want)))))

    # ── 2-d. blueprint 대비 문항 수 ────────────────────────────────────────
    shape = _blueprint_book(blueprint, str(chapter.get("book") or chapter.get("id") or ""))
    if shape:
        want_total = shape.get("questions")
        if isinstance(want_total, int) and want_total != len(flat):
            gates.append(gate(STOP, "count",
                              "Chapter has %d questions; blueprint.book.json says %d."
                              % (len(flat), want_total)))
        want_mods = shape.get("modules") or []
        got_mods = chapter.get("modules") or []
        if len(want_mods) != len(got_mods):
            gates.append(gate(STOP, "structure",
                              "Chapter has %d modules; blueprint says %d."
                              % (len(got_mods), len(want_mods))))
        for wm, gm in zip(want_mods, got_mods):
            if wm.get("id") != gm.get("id"):
                gates.append(gate(STOP, "structure",
                                  "Module id '%s' does not match blueprint '%s'."
                                  % (gm.get("id"), wm.get("id"))))
            wbs, gbs = wm.get("blocks") or [], gm.get("blocks") or []
            if len(wbs) != len(gbs):
                gates.append(gate(STOP, "structure",
                                  "Module %s has %d blocks; blueprint says %d."
                                  % (wm.get("id"), len(gbs), len(wbs))))
            for bi, (wb, gb) in enumerate(zip(wbs, gbs)):
                if wb.get("kind") != gb.get("kind"):
                    gates.append(gate(STOP, "structure",
                                      "Module %s block %d is '%s'; blueprint says '%s'."
                                      % (wm.get("id"), bi + 1, gb.get("kind"), wb.get("kind"))))
                gqs = gb.get("questions") or []
                if wb.get("questions") != len(gqs):
                    gates.append(gate(STOP, "count",
                                      "Module %s block %d has %d questions; blueprint says %d."
                                      % (wm.get("id"), bi + 1, len(gqs), wb.get("questions"))))
                want_kinds = wb.get("questionKinds") or {}
                got_kinds: dict = {}
                for q in gqs:
                    got_kinds[q.get("kind")] = got_kinds.get(q.get("kind"), 0) + 1
                if want_kinds and got_kinds != want_kinds:
                    gates.append(gate(STOP, "count",
                                      "Module %s block %d question kinds %s do not match "
                                      "blueprint %s."
                                      % (wm.get("id"), bi + 1,
                                         json.dumps(got_kinds, sort_keys=True),
                                         json.dumps(want_kinds, sort_keys=True))))
                want_choices = wb.get("choices")
                if isinstance(want_choices, int):
                    for q in gqs:
                        if q.get("kind") in ("mcq", "insert") and len(q.get("choices") or []) != want_choices:
                            gates.append(gate(STOP, "choices",
                                              "%s: %d choices; blueprint says %d (print column "
                                              "width depends on it)."
                                              % (q.get("id"), len(q.get("choices") or []),
                                                 want_choices)))
    else:
        gates.append(gate(WARN, "count",
                          "No blueprint given: question counts were not checked against "
                          "config/blueprint.book.json."))

    if not any(g["level"] in (STOP, WARN) for g in gates):
        auto = sum(1 for e in flat if e["q"].get("kind") in AUTO_KINDS)
        gates.append(gate(INFO, "answer",
                          "Answer key ok: %d questions, %d auto-scored, ids and numbers unique."
                          % (len(flat), auto)))
    return gates


def _multiset_diff(a: Sequence[str], b: Sequence[str]) -> list:
    """a 에는 있고 b 에는 없는 원소(개수까지 본다)."""
    pool = list(b)
    out = []
    for x in a:
        if x in pool:
            pool.remove(x)
        elif x:
            out.append(x)
    return out


def _brief(seq: Sequence, limit: int = 8) -> str:
    items = list(seq)
    if len(items) <= limit:
        return ", ".join(str(x) for x in items)
    return ", ".join(str(x) for x in items[:limit]) + ", … (%d more)" % (len(items) - limit)


# ══════════════════════════════════════════════════════════════════════════
# 3. dup_gate — dup-core.js 와 같은 자로 잰다
# ══════════════════════════════════════════════════════════════════════════
#
# 임계값의 출처는 studyground/sg2/assets/dup-core.js 의 TH 하나뿐이다. 저쪽 주석에
# 함정 팩 실측 근거가 적혀 있고(containmentWatch 0.25 는 SET9 L2-B2 지문의 44단어
# 패러프레이즈를 잡으려고 고른 값), 여기서 다른 숫자를 쓰면 관리자 화면과 이 CLI 가
# 서로 다른 판정을 내서 "화면에서는 통과인데 파이프라인이 막는다" 가 된다.
# 숫자를 고칠 일이 생기면 dup-core.js 를 고치고 이 표를 따라 옮긴다.
TH = {
    "shingleK": 4,
    "jaccardHigh": 0.55,
    "jaccardWatch": 0.28,
    "containmentHigh": 0.80,
    "containmentWatch": 0.25,
    "containmentMinShingles": 10,
    "runHigh": 25,
    "runWatch": 12,
    "sharedChoicesHigh": 3,
    "minTokens": 6,
    "boilerplateDf": 3,
}

# dup-core.js 의 FIELD_POLICY. None 은 '문항 단위를 만들지 않는다'.
FIELD_POLICY: dict = {
    "mcq": {"use": ["prompt", "sentence"], "choices": True},
    "insert": {"use": ["sentence"], "choices": False},
    "build": {"use": ["sentence"], "choices": False},
    "email": {"use": ["subject", "situation", "bullets"], "choices": False},
    "discussion": {"use": ["prompt", "posts"], "choices": False},
    "blank": None,
    "repeat": None,
    "interview": None,
}

_SMART = {
    "‘": "'", "’": "'", "ʼ": "'",
    "“": '"', "”": '"',
    "–": "-", "—": "-",
}


def normalize(s: Any) -> str:
    """dup-core.js normalize() 의 파이썬 판. 여기가 어긋나면 판정이 두 벌로 갈린다."""
    text = "" if s is None else str(s)
    for k, v in _SMART.items():
        text = text.replace(k, v)
    text = _BLANK_RE.sub(" ", text)
    text = text.lower()
    text = re.sub(r"[^a-z0-9'\s]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def tokens(s: Any) -> list:
    n = normalize(s)
    return n.split(" ") if n else []


def shingles(toks: Sequence[str], k: int) -> list:
    if not toks:
        return []
    if len(toks) < k:
        return [" ".join(toks)]
    return [" ".join(toks[i:i + k]) for i in range(len(toks) - k + 1)]


def longest_run(a: Sequence[str], b: Sequence[str]) -> int:
    """두 토큰열의 최장 연속 공통 구간(단어 수). 후보 쌍에만 돌린다 — O(n·m)."""
    if not a or not b:
        return 0
    prev = [0] * (len(b) + 1)
    best = 0
    for i in range(1, len(a) + 1):
        cur = [0] * (len(b) + 1)
        ai = a[i - 1]
        for j in range(1, len(b) + 1):
            if ai == b[j - 1]:
                cur[j] = prev[j - 1] + 1
                if cur[j] > best:
                    best = cur[j]
        prev = cur
    return best


def _lines(node: Any) -> list:
    out: list = []
    for s in harvest(node):
        for line in str(s).split("\n"):
            if line.strip():
                out.append(line.strip())
    return out


def _mk_unit(uid: str, role: str, where: dict, title: str,
             body_lines: Sequence[str], choices: Sequence[str]) -> dict:
    text = "\n".join(body_lines)
    toks = tokens(text)
    return {
        "uid": uid, "role": role, "where": where, "title": title,
        "text": text, "norm": normalize(text), "toks": toks,
        "sh": shingles(toks, TH["shingleK"]),
        "choices": list(choices),
        "choiceNorms": [normalize(c) for c in choices],
        "short": len(toks) < TH["minTokens"],
    }


def units_of(source: dict, code: str) -> list:
    """
    비교 단위 추출. dup-core.js 2절과 같은 두 종류만 만든다.
      text — 지문 · cloze 템플릿 · 대본
      item — 문항 하나(발문 + 선택지)
    챕터든 SET 팩이든 modules/blocks/questions 모양이 같아서 한 함수로 읽는다.
    """
    units: list = []
    sections = source.get("sections")
    if sections is None:
        sections = [source]           # 챕터 하나 = 섹션 하나
    for sec in sections:
        for mod in sec.get("modules") or []:
            for bi, blk in enumerate(mod.get("blocks") or []):
                where = {
                    "set": code, "section": sec.get("id"), "module": mod.get("id"),
                    "blockKind": blk.get("kind"), "blockHeading": blk.get("heading") or "",
                }
                body = _lines(blk)
                if blk.get("kind") == "cloze":
                    seq = [q.get("answer") for q in (blk.get("questions") or [])
                           if isinstance(q.get("answer"), str)]
                    if seq:
                        body.append("[blanks] " + " ".join(seq))
                if body:
                    units.append(_mk_unit(
                        "%s::blk:%s:%d" % (code, mod.get("id"), bi), "text", where,
                        blk.get("title") or blk.get("heading") or
                        ("%s %s" % (mod.get("id"), blk.get("kind"))),
                        body, []))
                for q in blk.get("questions") or []:
                    kind = q.get("kind")
                    known = kind in FIELD_POLICY
                    pol = FIELD_POLICY.get(kind) if known else None
                    if known and pol is None:
                        continue
                    if not known:
                        qbody, qchoices = _lines(q), list(q.get("choices") or [])
                    else:
                        qbody = []
                        for f in pol["use"]:
                            if q.get(f) is not None:
                                qbody.extend(_lines(q.get(f)))
                        qchoices = list(q.get("choices") or []) if pol["choices"] else []
                    if not qbody and not qchoices:
                        continue
                    units.append(_mk_unit(
                        "%s::%s" % (code, q.get("id")), "item", where,
                        str(q.get("id") or ""), qbody, qchoices))
    return units


def compare(a: dict, b: dict, boiler: dict) -> dict | None:
    """dup-core.js compare() 의 파이썬 판. 반환 severity 는 high/watch/info."""
    a_set = set(a["sh"])
    inter = sum(1 for s in b["sh"] if s in a_set)
    union = len(a["sh"]) + len(b["sh"]) - inter
    jac = (inter / union) if union else 0.0
    min_len = min(len(a["sh"]), len(b["sh"]))
    containment = (inter / min_len) if min_len else 0.0

    exact = bool(a["norm"]) and a["norm"] == b["norm"]

    shared_choices = 0
    if a["choiceNorms"] and b["choiceNorms"]:
        pool = list(b["choiceNorms"])
        for c in a["choiceNorms"]:
            if c in pool:
                pool.remove(c)
                shared_choices += 1

    run = 0
    if inter >= 3 and len(a["toks"]) <= 1500 and len(b["toks"]) <= 1500:
        run = longest_run(a["toks"], b["toks"])
    elif exact:
        run = len(a["toks"])

    reasons: list = []
    sev = None

    def raise_(level: str, why: str) -> None:
        nonlocal sev
        reasons.append(why)
        if level == "high" or sev == "high":
            sev = "high"
        else:
            sev = sev or level

    if exact:
        raise_("high", "the normalised text is identical")
    if not a["short"] and not b["short"]:
        if jac >= TH["jaccardHigh"]:
            raise_("high", "4-gram Jaccard %.2f >= %.2f — only the wording was changed"
                   % (jac, TH["jaccardHigh"]))
        elif jac >= TH["jaccardWatch"]:
            raise_("watch", "4-gram Jaccard %.2f — topic and structure overlap heavily" % jac)
        if min_len >= TH["containmentMinShingles"]:
            if containment >= TH["containmentHigh"]:
                raise_("high", "%d%% of the shorter text sits inside the longer one"
                       % round(containment * 100))
            elif containment >= TH["containmentWatch"]:
                raise_("watch", "%d%% of the shorter text overlaps the longer one"
                       % round(containment * 100))
        if run >= TH["runHigh"]:
            raise_("high", "%d words match in an unbroken run — a moved paragraph" % run)
        elif run >= TH["runWatch"]:
            raise_("watch", "%d words match in an unbroken run" % run)

    if shared_choices >= TH["sharedChoicesHigh"]:
        raise_("high", "%d choices are identical (of %d) — the signature of a recycled item"
               % (shared_choices, len(a["choices"])))
    elif shared_choices == 2 and len(a["choices"]) <= 4:
        raise_("watch", "2 choices are identical")

    if sev is None:
        return None

    bd = max(boiler.get(a["norm"], 0), boiler.get(b["norm"], 0))
    if bd >= TH["boilerplateDf"] and shared_choices < TH["sharedChoicesHigh"]:
        reasons.append("demoted as boilerplate: the same text appears in %d other items" % bd)
        sev = "info"

    return {"severity": sev, "jaccard": round(jac, 4), "containment": round(containment, 4),
            "sharedShingles": inter, "longestRun": run, "sharedChoices": shared_choices,
            "exact": exact, "reasons": reasons}


def boilerplate_df(units: Sequence[dict]) -> dict:
    """
    정형문 판정용 df. 같은 payload 가 서로 다른 문항 몇 곳에 나오는가.

    dup-core.js 는 자카드 0.5 이상을 한 군집으로 묶는 union-find 로 세고, 여기서는
    '정규화 후 완전히 같은 것' 만 한 군집으로 본다. 파이썬 쪽이 군집을 더 잘게 쪼개므로
    df 가 같거나 크게 나오지 않고 **작거나 같게** 나온다 → 강등이 덜 일어난다.
    즉 이 구현은 JS 보다 엄한 쪽으로만 어긋난다. JS 가 잡는 것을 놓치지는 않는다.
    """
    seen: dict = {}
    for u in units:
        if not u["norm"]:
            continue
        seen.setdefault(u["norm"], set()).add(u["uid"])
    return {k: len(v) for k, v in seen.items()}


def dup_gate(chapter: dict, corpus: Sequence[dict] | None = None) -> list:
    """
    이 챕터가 기존 세트·챕터와 겹치는가. dup-core.js 와 같은 정규화·같은 임계값.

    corpus 는 이미 존재하는 팩/챕터 dict 의 목록이다(파일 읽기는 호출자 몫 —
    게이트는 파일시스템을 모른다. 그래야 테스트가 픽스처로 돈다).
    high → stop, watch → warn, info → info 로 옮긴다. 관리자 화면의 등급 세 개와
    게이트 등급 세 개가 1:1 로 붙는다.
    """
    gates: list = []
    code = str(chapter.get("slug") or chapter.get("id") or "chapter")
    mine = units_of(chapter, code)
    theirs: list = []
    for i, pack in enumerate(corpus or []):
        theirs.extend(units_of(pack, str(pack.get("code") or pack.get("slug") or
                                         ("corpus%d" % (i + 1)))))
    if not theirs:
        gates.append(gate(WARN, "dup",
                          "No existing sets were given to compare against; overlap was not "
                          "checked. Pass --corpus to check."))
        return gates

    boiler = boilerplate_df(list(mine) + theirs)
    hits: list = []
    for a in mine:
        for b in theirs:
            if a["role"] != b["role"]:
                continue
            r = compare(a, b, boiler)
            if r:
                hits.append((a, b, r))

    order = {"high": 0, "watch": 1, "info": 2}
    hits.sort(key=lambda h: (order[h[2]["severity"]], -h[2]["jaccard"]))
    lvl = {"high": STOP, "watch": WARN, "info": INFO}
    for a, b, r in hits[:20]:
        gates.append(gate(lvl[r["severity"]], "dup",
                          "%s overlaps %s (%s): %s."
                          % (a["title"] or a["uid"], b["title"] or b["uid"],
                             b["where"].get("set"), "; ".join(r["reasons"]))))
    if len(hits) > 20:
        gates.append(gate(INFO, "dup", "%d more overlap pairs were found; run "
                                       "tools/dup_check.js for the full report."
                          % (len(hits) - 20)))
    if not hits:
        gates.append(gate(INFO, "dup",
                          "No overlap: %d units compared against %d existing units "
                          "(4-gram Jaccard < %.2f, containment < %.2f, longest run < %d)."
                          % (len(mine), len(theirs), TH["jaccardWatch"],
                             TH["containmentWatch"], TH["runWatch"])))
    return gates


# ══════════════════════════════════════════════════════════════════════════
# 4. fact_gate — 확인할 수 있는 주장을 뽑아 놓는다. 조용히 통과시키지 않는다
# ══════════════════════════════════════════════════════════════════════════

# 사람이 확인해야 하는 문장의 서명들. 하나라도 걸리면 '검증 가능한 주장' 으로 본다.
_CLAIM_PATTERNS = (
    (re.compile(r"\b(1[0-9]{3}|20[0-9]{2})\b"), "year"),
    (re.compile(r"\b\d+(\.\d+)?\s?(%|percent)\b", re.I), "percentage"),
    (re.compile(r"\b\d+(\.\d+)?\s?(km|kg|cm|mm|m|miles?|metres?|meters?|tons?|"
                r"degrees?|celsius|fahrenheit|litres?|liters?|hours?|years?|"
                r"centuries|million|billion|thousand)\b", re.I), "quantity"),
    # 'the' 를 필수로 두고 most/only 를 뺀다. 그 둘은 부사로도 쓰여서("matters most",
    # "the only question"), 넣어 두면 목록이 소음으로 차고 사람이 목록 읽기를 그만둔다.
    (re.compile(r"\bthe (first|largest|smallest|oldest|fastest|highest|deepest|"
                r"world's|country's)\b", re.I), "superlative"),
    (re.compile(r"\b(invented|discovered|founded|established|published|built|"
                r"located in|named after|originated)\b", re.I), "attribution"),
    (re.compile(r"\b(according to|studies show|research shows|scientists (say|found))\b",
                re.I), "cited-source"),
)


def claims_of(chapter: dict) -> list:
    """
    사실 확인이 필요한 문장만 골라낸다. 문장 + 왜 뽑혔는지 + 어디서 나왔는지.

    '검증 가능하다' 는 것과 '틀렸다' 는 것은 다르다. 이 함수는 앞의 것만 판단한다 —
    그게 규칙으로 할 수 있는 전부이고, 뒤의 것은 사람이나 모델이 한다.
    """
    out: list = []
    for mi, mod in enumerate(chapter.get("modules") or []):
        for bi, blk in enumerate(mod.get("blocks") or []):
            where = "%s block %d" % (mod.get("id"), bi + 1)
            texts = []
            if blk.get("template"):
                texts.append(str(blk["template"]))
            for p in blk.get("paragraphs") or []:
                texts.append(str(p))
            if blk.get("title"):
                texts.append(str(blk["title"]))
            for q in blk.get("questions") or []:
                for s in harvest(q):
                    texts.append(str(s))
            for t in texts:
                for sent in _sentences(t, "___"):
                    # 물음표로 끝나면 발문이다. 질문은 주장이 아니다.
                    if sent.rstrip().endswith("?"):
                        continue
                    tags = [name for rx, name in _CLAIM_PATTERNS if rx.search(sent)]
                    if tags:
                        out.append({"where": where, "text": sent.strip(),
                                    "why": sorted(set(tags))})
    for track in (chapter.get("audio") or {}).get("tracks") or []:
        for sent in _sentences(str(track.get("script") or ""), "___"):
            if sent.rstrip().endswith("?"):
                continue
            tags = [name for rx, name in _CLAIM_PATTERNS if rx.search(sent)]
            if tags:
                out.append({"where": "audio %s" % track.get("id"),
                            "text": sent.strip(), "why": sorted(set(tags))})
    return out


def fact_gate(chapter: dict, llm: Any = None) -> list:
    """
    사실관계. 오프라인에서는 '확인 못 했다' 를 warn 으로 남기고 주장 목록을 붙인다.

    조용한 통과를 만들지 않는 것이 이 게이트의 전부다. 확인 못 한 주장을 info 로
    적어 두면 아무도 안 읽고, 그대로 인쇄된다. warn 은 관리자 화면에서 노란 줄로
    남고 provenance.gateResults 에 status:'open' 으로 박혀서, 사람이 'accepted' 로
    바꾸기 전까지 검토 대시보드에서 사라지지 않는다.
    """
    claims = claims_of(chapter)
    if not claims:
        return [gate(INFO, "fact",
                     "No checkable factual claims found (no dates, quantities, "
                     "superlatives or attributions in the student-facing text).")]

    if llm is None or not getattr(llm, "ready", False):
        gates = [gate(WARN, "fact",
                      "Offline: %d factual claim(s) could not be verified. A human must "
                      "check each one before this chapter is printed." % len(claims))]
        for c in claims[:12]:
            gates.append(gate(INFO, "fact", "Check (%s, %s): \"%s\""
                              % (c["where"], "/".join(c["why"]), c["text"])))
        if len(claims) > 12:
            gates.append(gate(INFO, "fact", "%d more claim(s) not listed." % (len(claims) - 12)))
        return gates

    # 온라인. 모델은 '틀렸다고 의심되는 것' 만 고른다. 판정은 여전히 사람이 한다 —
    # 모델의 부정이 곧 오류 확정이라면 모델 하나가 원고를 지울 수 있다.
    system = ("You check factual claims in an English teaching text. For each claim, "
              "answer whether it is well-known to be false or doubtful. Reply with JSON "
              '{"suspect":[{"index":<int>,"why":"<one sentence>"}]} and nothing else. '
              "An empty list means every claim looked fine.")
    user = json.dumps([{"index": i, "claim": c["text"]} for i, c in enumerate(claims)],
                      ensure_ascii=False, indent=1)
    try:
        res = llm.chat(system, user, {"temperature": 0, "maxTokens": 1500})
        data = parse_json(res.text) or {}
        suspect = data.get("suspect") or []
    except Exception as exc:                        # noqa: BLE001 — 어떤 실패든 오프라인 취급
        gates = [gate(WARN, "fact",
                      "Fact check could not run (%s: %s); %d claim(s) remain unverified."
                      % (type(exc).__name__, exc, len(claims)))]
        for c in claims[:12]:
            gates.append(gate(INFO, "fact", "Check (%s): \"%s\"" % (c["where"], c["text"])))
        return gates

    gates: list = []
    for s in suspect:
        try:
            c = claims[int(s.get("index"))]
        except (TypeError, ValueError, IndexError):
            continue
        gates.append(gate(WARN, "fact", "Doubtful claim (%s): \"%s\" — %s"
                          % (c["where"], c["text"], s.get("why") or "flagged by review")))
    if not gates:
        gates.append(gate(INFO, "fact",
                          "%d factual claim(s) reviewed, none flagged. The review is "
                          "advisory; the claims still carry a human sign-off." % len(claims)))
    return gates


def parse_json(text: Any) -> dict | None:
    """모델이 ```json 울타리를 씌워 보내도 받아낸다 — api/_llm.js parseJSON() 과 같다."""
    s = str(text or "").strip()
    s = re.sub(r"^```(?:json)?", "", s, flags=re.I).strip()
    s = re.sub(r"```$", "", s).strip()
    try:
        return json.loads(s)
    except ValueError:
        pass
    a, b = s.find("{"), s.rfind("}")
    if a >= 0 and b > a:
        try:
            return json.loads(s[a:b + 1])
        except ValueError:
            return None
    return None


# 그래프가 부르는 네 게이트. 이름은 노드 이름과 같다(graph_spec.py 가 그대로 쓴다).
ALL_GATES: dict = {
    "cefr_gate": cefr_gate,
    "answer_gate": answer_gate,
    "dup_gate": dup_gate,
    "fact_gate": fact_gate,
}
