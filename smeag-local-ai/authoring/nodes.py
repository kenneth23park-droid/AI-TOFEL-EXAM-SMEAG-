"""
집필 그래프의 노드들 + LLM 프로바이더 껍데기.

노드 계약 (docs/bmad/architecture.md §8.3 의 ScoringState 관례를 그대로 따른다)
--------------------------------------------------------------------------
  node(state) -> dict            상태에 **덮어쓸 키만** 담은 dict 를 돌려준다.
  AuthorState 는 TypedDict(total=False)  전부 선택 키라, 나중에 키가 늘어도
                                         기존 호출자가 깨지지 않는다.

예외 정책도 §8.4 를 따른다. `_SequentialGraph` 는 try/except 가 없다 — 노드 예외는
호출자에게 그대로 올라간다. 그러니 **밖으로 나가는 노드(draft/revise/fact 온라인)는
각자 안에서 예외를 흡수**하고, 실패를 'offline' 이라는 상태값으로 바꿔 놓는다.
게이트 노드는 순수 계산이라 흡수할 예외가 없다.

visited 를 노드가 직접 이어 붙이는 이유 — langgraph 는 리스트 키를 그냥 덮어쓴다.
Annotated[list, add] 리듀서를 쓰면 폴백 쪽에도 같은 리듀서를 흉내 내야 해서, 두
백엔드가 다른 코드를 타게 된다. 노드가 `old + [name]` 을 돌려주면 양쪽이 같다.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any, Dict, List

try:                                   # 3.8+ 는 typing 에 있다. 없으면 그냥 dict.
    from typing import TypedDict
except ImportError:                    # pragma: no cover
    TypedDict = None                   # type: ignore

from . import gates as G


# ══════════════════════════════════════════════════════════════════════════
# 0. 상태
# ══════════════════════════════════════════════════════════════════════════

if TypedDict is not None:
    class AuthorState(TypedDict, total=False):
        # 입력
        book: str                    # 'reading'|'listening'|'speaking'|'writing'
        chapter_no: int
        edition: int
        topic: str                   # 집필 지시(선택). 없으면 모델이 고른다.
        blueprint: dict              # config/blueprint.book.json 을 읽은 것
        corpus: List[dict]           # 중복 비교 대상(기존 팩·챕터)
        llm: Any                     # 프로바이더. None 이면 오프라인
        max_rounds: int              # 기본 3

        # 산출
        chapter: dict
        plan: List[dict]             # 블록별 집필 지시
        gate_results: Dict[str, List[dict]]
        gates: List[dict]            # decide 가 편 것 — 화면에 그대로 나간다
        rounds: int
        status: str                  # 'drafted'|'revising'|'parked'|'blocked'|'offline'
        offline: bool
        notes: List[str]
        visited: List[str]
else:                                  # pragma: no cover
    AuthorState = dict                 # type: ignore

MAX_ROUNDS_DEFAULT = 3


def _note(state: dict, msg: str) -> List[str]:
    return list(state.get("notes") or []) + [msg]


def _visit(state: dict, name: str) -> List[str]:
    return list(state.get("visited") or []) + [name]


# ══════════════════════════════════════════════════════════════════════════
# 1. LLM 프로바이더 껍데기 — studyground/sg2/api/_llm.js 의 계약을 옮긴 것
# ══════════════════════════════════════════════════════════════════════════
#
# 저쪽 chat() 은 { text, usage:{in,out}, truncated } 를 돌려준다. 같은 모양을 쓰는
# 이유는 돈이다 — 토큰을 안 남기면 모델을 바꿀 때 근거가 없다(_llm.js 머리말).
# 금액 환산은 여기서 하지 않는다. 단가표는 파이썬 한 곳(app/scoring/pricing.py)에만.


class LLMResult:
    __slots__ = ("text", "usage", "truncated", "model")

    def __init__(self, text: str, usage: dict | None = None,
                 truncated: bool = False, model: str = ""):
        self.text = text
        self.usage = usage or {"in": 0, "out": 0}
        self.truncated = truncated
        self.model = model

    def __repr__(self) -> str:
        return "LLMResult(model=%r, in=%d, out=%d, truncated=%s)" % (
            self.model, self.usage.get("in", 0), self.usage.get("out", 0), self.truncated)


class OfflineError(RuntimeError):
    """망이 없거나 키가 없다. 호출자는 이걸 '오프라인' 으로 접어야 한다."""


class Provider:
    """공통 껍데기. ready 가 False 면 아무도 chat() 을 부르지 않는다."""

    id = "none"
    label = "offline"
    ready = False
    model = ""

    def chat(self, system: str, user: str, opts: dict | None = None) -> LLMResult:
        raise OfflineError("no LLM provider is configured (offline)")


class OfflineProvider(Provider):
    pass


def _post_json(url: str, headers: dict, payload: dict, timeout: int = 120) -> dict:
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"),
        headers=dict(headers, **{"Content-Type": "application/json"}), method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:            # 본문에 이유가 들어 있다
        body = exc.read().decode("utf-8", "replace")[:500]
        raise OfflineError("%s %s: %s" % (url, exc.code, body)) from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise OfflineError("%s unreachable: %s" % (url, exc)) from exc


class OpenAIProvider(Provider):
    id = "openai"
    label = "OpenAI"

    def __init__(self, key: str, model: str = ""):
        self.key = key
        self.model = model or os.environ.get("OPENAI_MODEL") or "gpt-4o"
        self.ready = bool(key)

    def chat(self, system: str, user: str, opts: dict | None = None) -> LLMResult:
        opts = opts or {}
        body = {
            "model": self.model,
            "messages": [{"role": "system", "content": system},
                         {"role": "user", "content": user}],
            "response_format": {"type": "json_object"},
        }
        temp = opts.get("temperature")
        if temp is not None:
            body["temperature"] = temp
        try:
            j = _post_json("https://api.openai.com/v1/chat/completions",
                           {"Authorization": "Bearer " + self.key}, body)
        except OfflineError as exc:
            # 온도를 안 받는 모델은 400 으로 거절한다. 그 한 필드 때문에 집필이 멈추면
            # 안 되므로 온도만 떼고 한 번 더 부른다 — _llm.js 와 같은 처리.
            if "temperature" not in str(exc) or temp is None:
                raise
            body.pop("temperature", None)
            j = _post_json("https://api.openai.com/v1/chat/completions",
                           {"Authorization": "Bearer " + self.key}, body)
        ch = (j.get("choices") or [{}])[0]
        u = j.get("usage") or {}
        return LLMResult((ch.get("message") or {}).get("content") or "",
                         {"in": u.get("prompt_tokens", 0), "out": u.get("completion_tokens", 0)},
                         ch.get("finish_reason") == "length", self.model)


class AnthropicProvider(Provider):
    id = "anthropic"
    label = "Anthropic (Claude)"

    def __init__(self, key: str, model: str = ""):
        self.key = key
        self.model = model or os.environ.get("ANTHROPIC_MODEL") or "claude-sonnet-5"
        self.ready = bool(key)

    def chat(self, system: str, user: str, opts: dict | None = None) -> LLMResult:
        opts = opts or {}
        body = {
            "model": self.model,
            "max_tokens": opts.get("maxTokens") or 2000,
            "system": system,
            "messages": [{"role": "user", "content": user}],
        }
        if opts.get("temperature") is not None:
            body["temperature"] = opts["temperature"]
        j = _post_json("https://api.anthropic.com/v1/messages",
                       {"x-api-key": self.key, "anthropic-version": "2023-06-01"}, body)
        part = next((c for c in (j.get("content") or []) if c.get("type") == "text"), {})
        u = j.get("usage") or {}
        return LLMResult(part.get("text") or "",
                         {"in": u.get("input_tokens", 0), "out": u.get("output_tokens", 0)},
                         j.get("stop_reason") == "max_tokens", self.model)


def resolve_provider(want: str = "") -> Provider:
    """
    프로바이더를 고른다. 키가 있는 쪽만 후보다 — _llm.js resolve() 와 같은 규칙.
    아무 키도 없으면 OfflineProvider 를 돌려준다. **None 을 돌려주지 않는다** —
    호출부가 매번 None 을 검사하다 한 군데를 빠뜨리면 거기서 터진다.
    """
    want = (want or "").strip().lower()
    keys = {"openai": os.environ.get("OPENAI_API_KEY", "").strip(),
            "anthropic": os.environ.get("ANTHROPIC_API_KEY", "").strip()}
    ctor = {"openai": OpenAIProvider, "anthropic": AnthropicProvider}
    if want:
        if want in ctor and keys.get(want):
            return ctor[want](keys[want])
        return OfflineProvider()
    for pid in ("anthropic", "openai"):
        if keys[pid]:
            return ctor[pid](keys[pid])
    return OfflineProvider()


class StubProvider(Provider):
    """
    --selftest 전용. 정해진 답만 돌려준다.

    round 1 에서 일부러 틀린 값을 넣는 대본을 실을 수 있다. 게이트가 실제로
    물어서 revise 로 돌아가는지를 확인하지 않으면, 조건부 엣지가 죽어 있어도
    아무도 모른다 — 실패를 재현하는 것이 이 스텁의 존재 이유다.
    """

    id = "stub"
    label = "stub (selftest)"
    ready = True
    model = "stub-1"

    def __init__(self, script: dict):
        self.script = script or {}
        self.calls: List[dict] = []

    def chat(self, system: str, user: str, opts: dict | None = None) -> LLMResult:
        payload = G.parse_json(user) or {}
        key = str(payload.get("fillKey") or payload.get("task") or "")
        self.calls.append({"key": key, "opts": opts or {}})
        body = self.script.get(key)
        if body is None:
            body = {}
        text = json.dumps(body, ensure_ascii=False)
        return LLMResult(text, {"in": len(user) // 4, "out": len(text) // 4}, False, self.model)


# ══════════════════════════════════════════════════════════════════════════
# 2. blueprint → 빈 뼈대 (assets/book-schema.js blankChapter 의 파이썬 판)
# ══════════════════════════════════════════════════════════════════════════
#
# 왜 JS 를 부르지 않고 다시 쓰나 — 캠퍼스 장비에 node 가 있다는 보장이 없다.
# 대신 구조의 정본은 양쪽 다 config/blueprint.book.json 하나다. 이 함수는 그 파일을
# 읽어서 접을 뿐이라, 구조가 갈릴 자리는 blueprint 파일 한 곳뿐이다.

SCHEMA_VERSION = "1.0.0"
CEFR = "B2"


def slug_of(book: str, chapter_no: int) -> str:
    return "%s-%02d" % (book, int(chapter_no))


def question_id(slug: str, module_id: str, no: int) -> str:
    return "%s-%s-q%02d" % (slug, module_id, int(no))


def track_id(slug: str, module_id: str, frm: int, to: int) -> str:
    return "%s-%s-%02d-%02d" % (slug, module_id, int(frm), int(to))


def shape_of(blueprint: dict, book: str) -> dict:
    for b in blueprint.get("books") or []:
        if b.get("id") == book:
            return b
    raise ValueError("unknown book: %s (blueprint has %s)"
                     % (book, ", ".join(str(b.get("id")) for b in blueprint.get("books") or [])))


def _kind_list(blk: dict) -> List[str]:
    kinds = blk.get("questionKinds") or {}
    out: List[str] = []
    for k, n in kinds.items():
        out.extend([k] * int(n))
    if not out:
        out = ["mcq"] * int(blk.get("questions") or 0)
    return out


def _blank_question(kind: str, qid: str, no: int, blk: dict) -> dict:
    q: dict = {"id": qid, "kind": kind, "no": no}
    if kind == "blank":
        q["hint"] = ""
        q["answer"] = ""
    elif kind in ("mcq", "insert"):
        q["prompt"] = ""
        q["choices"] = [""] * int(blk.get("choices") or 4)
        q["answer"] = None
    elif kind in ("repeat", "interview"):
        q["audioRef"] = ""
        q["script"] = ""
        q["prepSec"] = blk.get("prepSec") or 3
        q["respondSec"] = blk.get("respondSec") or 20
    elif kind == "build":
        q.update({"context": "", "slots": [], "tiles": [], "trapTiles": [],
                  "sentence": "", "answerTokens": [], "answer": ""})
    elif kind == "email":
        q.update({"to": "", "subject": "", "situationLabel": "SITUATION", "situation": "",
                  "bulletsLabel": "YOUR EMAIL SHOULD", "bullets": [], "prompt": ""})
    elif kind == "discussion":
        q.update({"professor": "", "prompt": "", "posts": []})
    return q


def blank_chapter(blueprint: dict, book: str, chapter_no: int, edition: int = 1) -> dict:
    """
    구조는 blueprint 가 정하고 내용은 전부 빈 문자열인 뼈대.

    생성기가 채우는 것은 '빈 칸' 이지 '구조' 가 아니라는 원칙을 이 함수가 물리적으로
    강제한다 — draft/revise 는 여기서 만든 자리에 값만 넣고 모듈·블록·문항을
    더하거나 빼지 않는다(apply_fill 이 그것도 막는다).
    """
    shape = shape_of(blueprint, book)
    slug = slug_of(book, chapter_no)
    running = 0
    modules: List[dict] = []
    tracks: List[dict] = []

    for m in shape.get("modules") or []:
        blocks: List[dict] = []
        for b in m.get("blocks") or []:
            kinds = _kind_list(b)
            frm, to = running + 1, running + len(kinds)
            blk: dict = {"kind": b.get("kind"),
                         "heading": "Questions %d-%d" % (frm, to),
                         "instruction": str(b.get("instruction") or "")}
            if b.get("kind") == "cloze":
                blk["template"] = ""
            if b.get("kind") == "passage":
                blk["title"] = ""
                blk["paragraphs"] = []
            if b.get("kind") == "audio-set":
                if b.get("perQuestionAudio"):
                    blk["perQuestionAudio"] = True
                else:
                    blk["audioRef"] = track_id(slug, m["id"], frm, to)
                    tracks.append({"id": blk["audioRef"], "script": "", "voiceCast": []})
            if b.get("kind") == "record-set":
                blk["introAudioRef"] = slug + "-" + m["id"] + "-intro"
                blk["introScript"] = ""
                blk["perQuestionAudio"] = True
            blk["questions"] = []
            for kind in kinds:
                running += 1
                qid = question_id(slug, m["id"], running)
                q = _blank_question(kind, qid, running, b)
                if b.get("kind") == "audio-set" and b.get("perQuestionAudio"):
                    # 문항별 음원 블록은 문항마다 트랙이 하나씩 필요하다.
                    # book-schema.md §6 의 '문항 음원 트랙 id' 규약과 같은 이름.
                    q["audioRef"] = qid
                    tracks.append({"id": qid, "script": "", "voiceCast": []})
                if b.get("kind") == "record-set":
                    q["audioRef"] = qid
                blk["questions"].append(q)
            blocks.append(blk)
        mod: dict = {"id": m.get("id"), "label": m.get("label"), "blocks": blocks}
        if "timeLimitSec" in m:
            mod["timeLimitSec"] = m.get("timeLimitSec")
        modules.append(mod)

    chapter: dict = {
        # --- 섹션 조각과 같은 키. 시험 엔진은 여기까지만 본다. ---
        "id": book,
        "label": shape.get("label"),
        "labelKo": shape.get("labelKo"),
        "timeLimitSec": shape.get("timeLimitSec", None),
        "modules": modules,
        # --- 교재가 더하는 키. 엔진은 무시하고 PDF·색인·교사판이 읽는다. ---
        "schemaVersion": SCHEMA_VERSION,
        "book": book,
        "chapterNo": int(chapter_no),
        "slug": slug,
        "title": "",
        "cefr": CEFR,
        "edition": int(edition),
        "targetSkills": [],
        "teaching": {"objective": "", "strategy": [], "commonErrors": []},
        "glossary": [],
        "indexTerms": [],
        "provenance": {"authoredBy": "", "authoredAt": None, "reviewedBy": "",
                       "reviewedAt": None, "level": "assumed", "gateResults": []},
    }
    if shape.get("audio"):
        chapter["audio"] = {"tracks": tracks}
    if shape.get("modelAnswers") and shape.get("modelAnswers") != "none":
        chapter["modelAnswers"] = []
    return chapter


# ══════════════════════════════════════════════════════════════════════════
# 3. 채우기 — 값만 들어가고 구조는 못 바꾼다
# ══════════════════════════════════════════════════════════════════════════

# 블록에 채워도 되는 키. 여기 없는 키는 모델이 보내도 버린다.
_BLOCK_FILLABLE = ("template", "title", "paragraphs", "introScript", "images")
# 문항에 채워도 되는 키.
_Q_FILLABLE = ("hint", "answer", "prompt", "choices", "script", "context", "slots",
               "tiles", "trapTiles", "sentence", "answerTokens", "to", "subject",
               "situation", "bullets", "professor", "posts")
# 챕터 머리에 채워도 되는 키.
_CHAPTER_FILLABLE = ("title", "targetSkills", "teaching", "glossary", "indexTerms",
                     "modelAnswers")


def apply_fill(chapter: dict, fill: dict) -> List[str]:
    """
    모델이 준 값을 뼈대에 밀어 넣는다. **자리를 새로 만들지 않는다.**

    fill 모양:
      {"chapter": {...}, "blocks": [{"module":"R1","index":0, ...,
                                     "questions":[{"no":7, ...}]}],
       "tracks": [{"id": "...", "script": "...", "voiceCast":[...]}]}

    돌려주는 것은 '버린 것' 의 목록이다. 모델이 문항을 더 만들어 보냈다는 사실을
    조용히 삼키면, 왜 문항 수가 안 맞는지 나중에 알 수 없다.
    """
    dropped: List[str] = []
    by_mod = {str(m.get("id")): m for m in chapter.get("modules") or []}

    for key, value in (fill.get("chapter") or {}).items():
        if key in _CHAPTER_FILLABLE:
            chapter[key] = value
        else:
            dropped.append("chapter.%s" % key)

    for spec in fill.get("blocks") or []:
        mod = by_mod.get(str(spec.get("module")))
        if not mod:
            dropped.append("block for unknown module %r" % spec.get("module"))
            continue
        blocks = mod.get("blocks") or []
        idx = int(spec.get("index") or 0)
        if idx < 0 or idx >= len(blocks):
            dropped.append("block index %d out of range in %s" % (idx, spec.get("module")))
            continue
        blk = blocks[idx]
        for key, value in spec.items():
            if key in ("module", "index", "questions"):
                continue
            if key in _BLOCK_FILLABLE:
                blk[key] = value
            else:
                dropped.append("%s block %d .%s" % (spec.get("module"), idx + 1, key))
        by_no = {q.get("no"): q for q in blk.get("questions") or []}
        for qs in spec.get("questions") or []:
            q = by_no.get(qs.get("no"))
            if q is None:
                dropped.append("question no.%s (not in the blueprint skeleton)" % qs.get("no"))
                continue
            for key, value in qs.items():
                if key == "no":
                    continue
                if key in _Q_FILLABLE:
                    q[key] = value
                else:
                    dropped.append("%s.%s" % (q.get("id"), key))

    if fill.get("tracks"):
        by_id = {t.get("id"): t for t in (chapter.get("audio") or {}).get("tracks") or []}
        for spec in fill["tracks"]:
            t = by_id.get(spec.get("id"))
            if t is None:
                dropped.append("audio track %r (not declared by the skeleton)" % spec.get("id"))
                continue
            if spec.get("script") is not None:
                t["script"] = spec["script"]
            if spec.get("voiceCast") is not None:
                t["voiceCast"] = spec["voiceCast"]
    return dropped


def apply_patches(chapter: dict, patches: List[dict]) -> List[str]:
    """
    revise 가 쓰는 좁은 문. {"questionId","field","value"} 하나가 값 하나를 바꾼다.

    통째로 다시 쓴 챕터를 받지 않는 이유 — 게이트를 통과한 39개 문항까지 같이
    흔들린다. 고치라고 한 곳만 고쳐야 다음 라운드의 차이가 그 고침 때문이라고
    말할 수 있다.
    """
    applied: List[str] = []
    by_id = {}
    for e in G.walk(chapter):
        by_id[str(e["q"].get("id"))] = e
    for p in patches or []:
        qid = str(p.get("questionId") or "")
        field = str(p.get("field") or "")
        if qid in by_id and field in _Q_FILLABLE:
            by_id[qid]["q"][field] = p.get("value")
            applied.append("%s.%s" % (qid, field))
        elif qid == "@block" and field in _BLOCK_FILLABLE:
            mod = str(p.get("module") or "")
            idx = int(p.get("index") or 0)
            for m in chapter.get("modules") or []:
                if str(m.get("id")) == mod and 0 <= idx < len(m.get("blocks") or []):
                    m["blocks"][idx][field] = p.get("value")
                    applied.append("%s block %d .%s" % (mod, idx + 1, field))
    return applied


# ══════════════════════════════════════════════════════════════════════════
# 4. 노드
# ══════════════════════════════════════════════════════════════════════════

_HOUSE_RULES = (
    "You are writing one chapter of a TOEFL practice book at CEFR B2. "
    "The exam format is fixed: reading uses cloze (fill in the blank with hint letters) "
    "and passage MCQ; listening uses audio sets; speaking is Listen-and-Repeat and "
    "Interview; writing is Build-a-Sentence, Write an Email and Academic Discussion. "
    "There is no prose summary, no integrated speaking task and no 30-minute essay. "
    "Never add, remove or reorder modules, blocks or questions: fill the slots you are "
    "given. All learner-facing text is English. Reply with JSON only."
)


def plan(state: dict) -> dict:
    """
    빈 뼈대를 세우고 블록마다 '무엇을 채워야 하는지' 를 적는다. LLM 을 부르지 않는다.

    뼈대를 먼저 만드는 것이 이 파이프라인 전체의 안전장치다 — 문항 수·id·번호가
    blueprint 에서 나오므로, 모델이 무엇을 하든 answer_gate 의 count 검사는
    이미 통과한 상태에서 시작한다.
    """
    if state.get("chapter"):
        # --gates-only 처럼 원고를 들고 들어온 경우. 뼈대를 다시 만들면 원고가 지워진다.
        return {"plan": [], "rounds": int(state.get("rounds") or 0),
                "visited": _visit(state, "plan"),
                "notes": _note(state, "plan: chapter supplied by the caller; skeleton skipped")}

    blueprint = state.get("blueprint") or {}
    book = str(state.get("book") or "")
    chapter = blank_chapter(blueprint, book, int(state.get("chapter_no") or 1),
                            int(state.get("edition") or 1))
    shape = shape_of(blueprint, book)
    editorial = blueprint.get("editorial") or {}

    items: List[dict] = []
    for mi, (wm, gm) in enumerate(zip(shape.get("modules") or [], chapter["modules"])):
        for bi, (wb, gb) in enumerate(zip(wm.get("blocks") or [], gm["blocks"])):
            first = (gb.get("questions") or [{}])[0].get("no")
            last = (gb.get("questions") or [{}])[-1].get("no")
            items.append({
                "fillKey": "%s#%d" % (wm.get("id"), bi),
                "module": wm.get("id"),
                "index": bi,
                "kind": wb.get("kind"),
                "instruction": wb.get("instruction"),
                "questionKinds": wb.get("questionKinds"),
                "questionNos": [q.get("no") for q in gb.get("questions") or []],
                "range": [first, last],
                "budget": {k: v for k, v in wb.items()
                           if k in ("templateWords", "passageWords", "scriptWords",
                                    "paragraphs", "choices", "slots", "bullets",
                                    "posts", "minWords")},
                "tracks": [t.get("id") for t in (chapter.get("audio") or {}).get("tracks") or []
                           if str(t.get("id")).startswith("%s-%s" % (chapter["slug"], wm.get("id")))],
            })
    items.append({"fillKey": "chapter", "module": None, "index": None, "kind": "chapter",
                  "editorial": editorial,
                  "modelAnswers": shape.get("modelAnswers") or "none"})

    return {
        "chapter": chapter,
        "plan": items,
        "rounds": 0,
        "max_rounds": int(state.get("max_rounds") or MAX_ROUNDS_DEFAULT),
        "status": "planned",
        "visited": _visit(state, "plan"),
        "notes": _note(state, "plan: %s chapter %d skeleton built from blueprint (%d blocks)"
                              % (book, int(state.get("chapter_no") or 1), len(items) - 1)),
    }


def draft(state: dict) -> dict:
    """
    빈 칸을 채운다. 프로바이더가 없으면 **깨지지 않고** 'offline: cannot draft' 로 접는다.

    망이 없는 캠퍼스에서 이 노드가 예외를 던지면 게이트까지 못 간다. 원고가 비어
    있다는 사실 자체는 answer_gate 가 stop 으로 말해 주므로, 여기서는 상태만 남기고
    그래프를 계속 돌린다 — 사람이 보는 것은 게이트 목록 한 장이어야 한다.
    """
    llm = state.get("llm")
    chapter = state.get("chapter") or {}
    notes = list(state.get("notes") or [])

    if llm is None or not getattr(llm, "ready", False):
        return {"status": "offline", "offline": True,
                "visited": _visit(state, "draft"),
                "notes": notes + ["draft: offline: cannot draft — no LLM provider is "
                                  "configured. The skeleton is unchanged."]}

    usage = {"in": 0, "out": 0}
    for item in state.get("plan") or []:
        user = json.dumps({"task": "fill", "fillKey": item.get("fillKey"),
                           "book": chapter.get("book"), "chapterNo": chapter.get("chapterNo"),
                           "topic": state.get("topic") or "", "slot": item},
                          ensure_ascii=False, indent=1)
        try:
            res = llm.chat(_HOUSE_RULES, user, {"temperature": 0.4, "maxTokens": 4000})
        except Exception as exc:                     # noqa: BLE001
            notes.append("draft: %s failed (%s: %s); that slot is left blank"
                         % (item.get("fillKey"), type(exc).__name__, exc))
            continue
        usage["in"] += res.usage.get("in", 0)
        usage["out"] += res.usage.get("out", 0)
        fill = G.parse_json(res.text)
        if fill is None:
            notes.append("draft: %s returned text that is not JSON%s"
                         % (item.get("fillKey"), " (truncated)" if res.truncated else ""))
            continue
        dropped = apply_fill(chapter, fill)
        if dropped:
            notes.append("draft: %s — dropped %s" % (item.get("fillKey"), ", ".join(dropped[:6])))

    prov = chapter.setdefault("provenance", {})
    prov["authoredBy"] = prov.get("authoredBy") or getattr(llm, "model", "") or getattr(llm, "id", "")
    prov["level"] = "generated"
    notes.append("draft: filled %d slot(s) with %s (tokens in %d / out %d)"
                 % (len(state.get("plan") or []), getattr(llm, "model", "?"),
                    usage["in"], usage["out"]))
    return {"chapter": chapter, "status": "drafted", "offline": False,
            "visited": _visit(state, "draft"), "notes": notes}


def _gate_node(name: str, fn) -> Any:
    """
    게이트 하나를 노드로 감싼다.

    결과를 gate_results[name] 에 **덮어쓴다**. 이어 붙이면 revise 를 돌 때마다
    지난 라운드의 판정이 남아, 고쳐진 문제가 목록에 계속 보인다.
    """
    def node(state: dict) -> dict:
        chapter = state.get("chapter") or {}
        if name == "answer_gate":
            found = fn(chapter, state.get("blueprint"))
        elif name == "dup_gate":
            found = fn(chapter, state.get("corpus") or [])
        elif name == "fact_gate":
            found = fn(chapter, state.get("llm"))
        else:
            found = fn(chapter, state.get("blueprint"))
        results = dict(state.get("gate_results") or {})
        results[name] = found
        return {"gate_results": results, "visited": _visit(state, name)}
    node.__name__ = name
    node.__doc__ = "gates.%s 를 노드로 감싼 것. 판정은 gates.py 에 있다." % name
    return node


cefr_gate = _gate_node("cefr_gate", G.cefr_gate)
answer_gate = _gate_node("answer_gate", G.answer_gate)
dup_gate = _gate_node("dup_gate", G.dup_gate)
fact_gate = _gate_node("fact_gate", G.fact_gate)

GATE_ORDER = ("cefr_gate", "answer_gate", "dup_gate", "fact_gate")


def decide(state: dict) -> dict:
    """네 게이트 결과를 한 목록으로 편다. 순서를 고정해야 화면이 매번 같아 보인다."""
    results = state.get("gate_results") or {}
    flat: List[dict] = []
    for name in GATE_ORDER:
        flat.extend(results.get(name) or [])
    stops = [g for g in flat if g["level"] == G.STOP]
    warns = [g for g in flat if g["level"] == G.WARN]
    return {"gates": flat,
            "visited": _visit(state, "decide"),
            "notes": _note(state, "decide: round %d — %d stop, %d warn, %d info"
                                  % (int(state.get("rounds") or 0), len(stops), len(warns),
                                     len(flat) - len(stops) - len(warns)))}


def need_revision(state: dict) -> str:
    """
    조건부 엣지. stop 이 하나라도 있고 라운드가 남았으면 되돌린다.

    라운드 상한이 있는 이유 — 모델이 같은 실수를 반복하면 무한히 돈다. 상한에
    닿으면 stop 을 안은 채로 review 에 park 한다. '고칠 수 없었다' 는 사실이
    사람에게 보이는 것이, 조용히 도는 것보다 낫다.
    """
    gates = state.get("gates") or []
    has_stop = any(g["level"] == G.STOP for g in gates)
    rounds = int(state.get("rounds") or 0)
    max_rounds = int(state.get("max_rounds") or MAX_ROUNDS_DEFAULT)
    if has_stop and rounds < max_rounds:
        return "revise"
    return "review"


def revise(state: dict) -> dict:
    """
    stop 게이트만 들고 모델에게 고쳐 달라고 한다. 값 하나짜리 패치만 받는다.

    오프라인이면 라운드를 상한까지 올려 두고 나간다. 고칠 수단이 없는데 게이트를
    세 번 더 도는 것은 같은 목록을 세 번 더 만드는 일일 뿐이다.
    """
    rounds = int(state.get("rounds") or 0) + 1
    chapter = state.get("chapter") or {}
    llm = state.get("llm")
    stops = [g for g in (state.get("gates") or []) if g["level"] == G.STOP]
    notes = list(state.get("notes") or [])

    if llm is None or not getattr(llm, "ready", False):
        notes.append("revise: offline: cannot revise — %d stop gate(s) stay open." % len(stops))
        return {"rounds": int(state.get("max_rounds") or MAX_ROUNDS_DEFAULT),
                "status": "blocked", "offline": True,
                "visited": _visit(state, "revise"), "notes": notes}

    user = json.dumps({
        "task": "revise", "fillKey": "revise#%d" % rounds,
        "problems": [{"scope": g["scope"], "message": g["message"]} for g in stops],
        "chapter": chapter,
    }, ensure_ascii=False)
    system = (_HOUSE_RULES + " You are fixing validation failures. Change only what the "
              'problems name. Reply with {"patches":[{"questionId":"...","field":"...",'
              '"value":...}]} and nothing else.')
    try:
        res = llm.chat(system, user, {"temperature": 0, "maxTokens": 3000})
        data = G.parse_json(res.text) or {}
    except Exception as exc:                          # noqa: BLE001
        notes.append("revise: round %d failed (%s: %s); the stop gates stay open."
                     % (rounds, type(exc).__name__, exc))
        return {"rounds": rounds, "status": "revising", "visited": _visit(state, "revise"),
                "notes": notes}

    applied = apply_patches(chapter, data.get("patches") or [])
    notes.append("revise: round %d applied %d patch(es)%s"
                 % (rounds, len(applied), (" — " + ", ".join(applied[:6])) if applied else ""))
    return {"chapter": chapter, "rounds": rounds, "status": "revising",
            "visited": _visit(state, "revise"), "notes": notes}


def review(state: dict) -> dict:
    """
    사람 앞에 세워 둔다(park). 자동 승인은 없다.

    게이트 결과를 provenance.gateResults 에 status:'open' 으로 박는다 —
    book-schema.md §3-7. 사람이 warn 을 'accepted' 로 바꾸기 전에는 검토
    대시보드에서 사라지지 않는다. reviewedAt 은 여기서 절대 채우지 않는다.
    그걸 채우는 순간 '사람이 봤다' 가 거짓이 된다.
    """
    chapter = state.get("chapter") or {}
    gates = state.get("gates") or []
    stops = [g for g in gates if g["level"] == G.STOP]
    prov = chapter.setdefault("provenance", {})
    prov.setdefault("authoredAt", None)
    prov.setdefault("reviewedBy", "")
    prov.setdefault("reviewedAt", None)
    prov["gateResults"] = [{"level": g["level"], "scope": g["scope"], "message": g["message"],
                            "status": "open", "at": None} for g in gates]
    status = "blocked" if stops else "parked"
    return {"chapter": chapter, "status": status,
            "visited": _visit(state, "review"),
            "notes": _note(state, "review: parked for human approval — %s"
                                  % ("%d stop gate(s) could not be cleared in %d round(s)"
                                     % (len(stops), int(state.get("rounds") or 0))
                                     if stops else "no stop gates"))}
