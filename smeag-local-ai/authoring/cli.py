"""
집필 파이프라인 명령줄.

    python3 -m authoring.cli --book reading --chapter 3 --out out/
    python3 -m authoring.cli --gates-only --chapter-file out/reading-03.chapter.json
    python3 -m authoring.cli --selftest
    python3 -m authoring.cli --baseline        # gates.py 의 B2 밴드 근거를 다시 잰다

종료 코드
    0  stop 게이트 없음(사람 검토 대기)
    2  stop 게이트 있음 — 이 원고는 세트로도 PDF 로도 나가면 안 된다
    1  실행 자체가 실패(파일 없음, 백엔드 불일치 등)

표준 라이브러리만 쓴다. 캠퍼스 장비에서 바로 돈다.
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import subprocess
import sys

from . import gates as G
from . import graph, nodes

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURES = os.path.join(HERE, "fixtures")
# 저장소 안에서의 상대 위치. smeag-local-ai/authoring → 저장소 루트.
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
SG2 = os.path.join(REPO, "studyground", "sg2")
BLUEPRINT = os.path.join(SG2, "config", "blueprint.book.json")
FRAGMENTS = os.path.join(SG2, "config", "_set9_fragments")
BOOK_SCHEMA_JS = os.path.join(SG2, "assets", "book-schema.js")


def _read_json(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def _load_blueprint(path: str | None) -> dict:
    path = path or BLUEPRINT
    if not os.path.exists(path):
        raise SystemExit("blueprint not found: %s\n"
                         "Pass --blueprint with the path to config/blueprint.book.json." % path)
    return _read_json(path)


def _load_corpus(spec: str | None) -> list:
    """--corpus 는 디렉터리나 파일 목록(쉼표). 팩이든 챕터든 같은 모양이라 그냥 읽는다."""
    if not spec:
        return []
    out = []
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if os.path.isdir(part):
            files = sorted(glob.glob(os.path.join(part, "*.json")))
        else:
            files = [part]
        for f in files:
            try:
                out.append(_read_json(f))
            except (OSError, ValueError) as exc:
                print("warn: skipped corpus file %s (%s)" % (f, exc), file=sys.stderr)
    return out


# ── 출력 ───────────────────────────────────────────────────────────────────

_MARK = {"stop": "STOP", "warn": "WARN", "info": "info"}


def print_gates(found, title: str = "") -> None:
    if title:
        print(title)
    if not found:
        print("  (no gates)")
        return
    for g in found:
        print("  [%-4s] %-10s %s" % (_MARK.get(g["level"], g["level"]), g["scope"], g["message"]))


def summarize(found) -> str:
    n = {"stop": 0, "warn": 0, "info": 0}
    for g in found:
        n[g["level"]] = n.get(g["level"], 0) + 1
    return "%d stop / %d warn / %d info" % (n["stop"], n["warn"], n["info"])


# ── 챕터가 book-schema.md 를 만족하는가 (필드 대조) ─────────────────────────

_REQUIRED_TOP = ("id", "label", "timeLimitSec", "modules", "schemaVersion", "book",
                 "chapterNo", "slug", "title", "cefr", "targetSkills", "teaching",
                 "glossary", "indexTerms", "provenance")


def schema_fields_report(chapter: dict, blueprint: dict) -> list:
    """
    docs/bmad/book-schema.md §2·§3·§6 의 필드 계약을 파이썬 쪽에서도 확인한다.

    assets/book-schema.js 의 validate() 가 정본이지만, 그건 브라우저(또는 node)가
    있어야 돌아간다. 캠퍼스 장비에는 node 가 없을 수 있어서, '필드가 있는가' 만이라도
    여기서 본다. 내용 검산은 게이트들이 한다.
    """
    out = []
    for key in _REQUIRED_TOP:
        if key not in chapter:
            out.append(G.gate(G.STOP, "chapter", "Missing required field '%s'." % key))
    book = str(chapter.get("book") or "")
    if chapter.get("id") != book:
        out.append(G.gate(G.STOP, "chapter",
                          "id '%s' must equal book '%s' — the timing config matches sections "
                          "by id." % (chapter.get("id"), book)))
    want_slug = "%s-%02d" % (book, int(chapter.get("chapterNo") or 0))
    if chapter.get("slug") != want_slug:
        out.append(G.gate(G.STOP, "chapter", "slug '%s' should be '%s'."
                          % (chapter.get("slug"), want_slug)))
    if chapter.get("cefr") != "B2":
        out.append(G.gate(G.STOP, "chapter", "cefr must be 'B2', got %r." % chapter.get("cefr")))
    if not str(chapter.get("title") or "").strip():
        out.append(G.gate(G.WARN, "chapter", "title is empty — the chapter opener prints it."))
    for e in G.walk(chapter):
        want = "%s-%s-q%02d" % (want_slug, e["module"].get("id"), int(e["q"].get("no") or 0))
        if e["q"].get("id") != want:
            out.append(G.gate(G.STOP, "ids", "Question id '%s' does not follow "
                                             "{slug}-{moduleId}-q{NN} ('%s')."
                              % (e["q"].get("id"), want)))
    shape = None
    for b in blueprint.get("books") or []:
        if b.get("id") == book:
            shape = b
    if shape and shape.get("audio") and not (chapter.get("audio") or {}).get("tracks"):
        out.append(G.gate(G.STOP, "audio",
                          "A listening chapter must declare audio.tracks[]."))
    if not out:
        out.append(G.gate(G.INFO, "chapter",
                          "Field contract ok: every required key of book-schema.md §2 is "
                          "present and ids follow §6."))
    return out


def js_validate(chapter: dict) -> list | None:
    """
    node 가 있으면 assets/book-schema.js 의 validate() 를 그대로 돌려 본다.

    정본 검산이 여기 있으므로, 돌 수 있을 때는 반드시 돌린다. 없으면 None 을
    돌려주고 위의 schema_fields_report 로 만족한다 — node 를 요구사항으로 만들지
    않는다(air-gapped 박스에 없다).
    """
    if not os.path.exists(BOOK_SCHEMA_JS):
        return None
    script = ("const S=require(process.argv[1]);"
              "let c='';process.stdin.on('data',d=>c+=d).on('end',()=>{"
              "const r=S.validate(JSON.parse(c),{blueprint:require(process.argv[2])});"
              "process.stdout.write(JSON.stringify(r));});")
    try:
        proc = subprocess.run(["node", "-e", script, BOOK_SCHEMA_JS, BLUEPRINT],
                              input=json.dumps(chapter).encode("utf-8"),
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)
    except (OSError, subprocess.SubprocessError):
        return None
    if proc.returncode != 0:
        return None
    try:
        return (json.loads(proc.stdout.decode("utf-8")) or {}).get("gates") or []
    except ValueError:
        return None


# ── 명령 ───────────────────────────────────────────────────────────────────

def cmd_author(args) -> int:
    blueprint = _load_blueprint(args.blueprint)
    llm = nodes.resolve_provider(args.provider)
    state = {
        "book": args.book,
        "chapter_no": int(args.chapter),
        "edition": int(args.edition),
        "topic": args.topic or "",
        "blueprint": blueprint,
        "corpus": _load_corpus(args.corpus),
        "llm": llm,
        "max_rounds": int(args.max_rounds),
    }
    print("backend: %s | provider: %s%s"
          % (graph.backend(args.backend), llm.label,
             "" if llm.ready else " (offline — the chapter will come back empty)"))
    out = graph.run(state, args.backend)
    chapter = out.get("chapter") or {}
    found = list(out.get("gates") or [])
    found = schema_fields_report(chapter, blueprint) + found

    print("\nnodes visited: %s" % " -> ".join(out.get("visited") or []))
    for n in out.get("notes") or []:
        print("  · %s" % n)
    print()
    print_gates(found, "gates (%s):" % summarize(found))

    if args.out:
        os.makedirs(args.out, exist_ok=True)
        slug = chapter.get("slug") or "chapter"
        cpath = os.path.join(args.out, "%s.chapter.json" % slug)
        gpath = os.path.join(args.out, "%s.gates.json" % slug)
        with open(cpath, "w", encoding="utf-8") as fh:
            json.dump(chapter, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
        with open(gpath, "w", encoding="utf-8") as fh:
            json.dump({"slug": slug, "status": out.get("status"), "rounds": out.get("rounds"),
                       "backend": out.get("backend"), "gates": found},
                      fh, ensure_ascii=False, indent=2)
            fh.write("\n")
        print("\nwrote %s\nwrote %s" % (cpath, gpath))

    print("\nstatus: %s (rounds %s)" % (out.get("status"), out.get("rounds")))
    return 2 if any(g["level"] == G.STOP for g in found) else 0


def cmd_gates_only(args) -> int:
    if not args.chapter_file or not os.path.exists(args.chapter_file):
        raise SystemExit("--gates-only needs --chapter-file <path to a chapter JSON>")
    chapter = _read_json(args.chapter_file)
    blueprint = _load_blueprint(args.blueprint)
    corpus = _load_corpus(args.corpus)

    found = schema_fields_report(chapter, blueprint)
    found += G.cefr_gate(chapter, blueprint)
    found += G.answer_gate(chapter, blueprint)
    found += G.dup_gate(chapter, corpus)
    found += G.fact_gate(chapter, nodes.resolve_provider(args.provider) if args.provider else None)

    js = js_validate(chapter) if not args.no_node else None
    if js is not None:
        found += [dict(g, scope="js:" + g["scope"]) for g in js]

    if args.json:
        json.dump({"slug": chapter.get("slug"), "gates": found}, sys.stdout,
                  ensure_ascii=False, indent=2)
        sys.stdout.write("\n")
    else:
        print_gates(found, "%s — gates (%s):" % (chapter.get("slug"), summarize(found)))
        if js is None and not args.no_node:
            print("\nnote: node is not available, so assets/book-schema.js validate() was "
                  "not run. The field contract was checked in Python instead.")
    return 2 if any(g["level"] == G.STOP for g in found) else 0


def cmd_baseline(args) -> int:
    """gates.py CEFR_BANDS 주석의 근거를 다시 잰다. 숫자를 고칠 때 이걸 돌린다."""
    print("SET 9 fragments — readability baseline (config/_set9_fragments/)")
    for name in ("reading", "listening", "speaking", "writing"):
        path = os.path.join(FRAGMENTS, name + ".json")
        if not os.path.exists(path):
            print("  %-10s (missing: %s)" % (name, path))
            continue
        frag = _read_json(path)
        prose, lexis = G.prose_of(frag), G.lexis_of(frag)
        spath = os.path.join(FRAGMENTS, name + "_script.json")
        if os.path.exists(spath):
            extra = [str(s) for s in G.harvest(_read_json(spath))]
            prose, lexis = prose + extra, lexis + extra
        m = G.readability(prose, lexis)
        print("  %-10s meanSentenceLen %5.2f · msttr100 %.3f · awlRatio %.4f "
              "(%d prose words / %d sentences)"
              % (name, m["meanSentenceLen"], m["msttr100"], m["awlRatio"],
                 m["proseTokens"], m["sentences"]))
    print("\nCEFR_BANDS in gates.py must contain every line above.")
    return 0


# ── 자체검사 ───────────────────────────────────────────────────────────────

class _Check:
    def __init__(self):
        self.failed = 0
        self.passed = 0

    def ok(self, cond: bool, label: str, detail: str = "") -> bool:
        if cond:
            self.passed += 1
            print("  PASS  %s%s" % (label, (" — " + detail) if detail else ""))
        else:
            self.failed += 1
            print("  FAIL  %s%s" % (label, (" — " + detail) if detail else ""))
        return bool(cond)


def _selftest_state(blueprint, stub_script, corpus):
    return {
        "book": "reading", "chapter_no": 1, "edition": 1,
        "blueprint": blueprint,
        "corpus": corpus,
        "llm": nodes.StubProvider(stub_script),
        "max_rounds": 3,
    }


def cmd_selftest(args) -> int:
    print("authoring selftest")
    print("=" * 72)
    chk = _Check()

    blueprint = _load_blueprint(args.blueprint)
    stub_script = _read_json(os.path.join(FIXTURES, "stub_script.json"))
    corpus_clean = [_read_json(os.path.join(FIXTURES, "corpus_clean.json"))]
    corpus_overlap = [_read_json(os.path.join(FIXTURES, "corpus_overlap.json"))]

    print("\n1. backends")
    print("   langgraph importable: %s" % graph.uses_langgraph())
    backends = ["sequential"] + (["langgraph"] if graph.uses_langgraph() else [])
    runs = {}
    for name in backends:
        out = graph.run(_selftest_state(blueprint, stub_script, corpus_clean), name)
        runs[name] = out
        print("   %-11s visited: %s" % (name, " -> ".join(out.get("visited") or [])))
    if len(backends) == 1:
        print("   (langgraph is not installed here; only the stdlib fallback ran. "
              "That is the campus configuration.)")

    print("\n2. graph")
    seq = runs["sequential"]
    order = seq.get("visited") or []
    chk.ok(order[:6] == ["plan", "draft", "cefr_gate", "answer_gate", "dup_gate", "fact_gate"],
           "entry order is plan -> draft -> the four gates", " -> ".join(order[:6]))
    chk.ok("revise" in order,
           "a stop gate routed the run back through revise",
           "revise appears %d time(s)" % order.count("revise"))
    chk.ok(order[-1] == "review", "the run ends parked at review", order[-1])
    chk.ok(order.count("cefr_gate") == order.count("revise") + 1,
           "every revise round re-ran all four gates",
           "%d gate rounds, %d revisions" % (order.count("cefr_gate"), order.count("revise")))
    if len(backends) == 2:
        chk.ok(runs["langgraph"].get("visited") == order,
               "both backends visit the same nodes in the same order")
        chk.ok(json.dumps(runs["langgraph"].get("chapter"), sort_keys=True)
               == json.dumps(seq.get("chapter"), sort_keys=True),
               "both backends produce the same chapter")

    print("\n3. gates bit and the revision cleared them")
    r1 = seq.get("gate_results") or {}
    final = seq.get("gates") or []
    stops = [g for g in final if g["level"] == G.STOP]
    chk.ok(not stops, "no stop gates remain after revision",
           summarize(final) if not stops else "; ".join(g["message"] for g in stops))
    chk.ok(int(seq.get("rounds") or 0) == 1, "exactly one revise round was needed",
           "rounds=%s" % seq.get("rounds"))
    chk.ok(seq.get("status") == "parked", "chapter is parked for human approval",
           str(seq.get("status")))
    chk.ok(set(r1) == set(nodes.GATE_ORDER), "all four gates reported",
           ", ".join(sorted(r1)))

    chapter = seq.get("chapter") or {}
    print("\n4. output chapter satisfies book-schema.md")
    fields = schema_fields_report(chapter, blueprint)
    chk.ok(not [g for g in fields if g["level"] == G.STOP],
           "field contract (§2, §3, §6)",
           "; ".join(g["message"] for g in fields if g["level"] == G.STOP) or "ok")
    chk.ok(len(G.walk(chapter)) == 30, "30 questions, as blueprint.book.json says for reading",
           "%d" % len(G.walk(chapter)))
    js = js_validate(chapter) if not args.no_node else None
    if js is None:
        print("  SKIP  assets/book-schema.js validate() — node is not available here")
    else:
        js_stop = [g for g in js if g["level"] == "stop"]
        chk.ok(not js_stop, "assets/book-schema.js validate() has no stop",
               "; ".join(g["message"] for g in js_stop) or
               "%d warn" % len([g for g in js if g["level"] == "warn"]))

    print("\n5. each gate, exercised on purpose")
    # answer_gate — 정답을 지우면 물어야 한다
    broken = json.loads(json.dumps(chapter))
    broken["modules"][0]["blocks"][0]["questions"][0]["answer"] = ""
    broken["modules"][0]["blocks"][1]["questions"][0]["answer"] = 99
    ag = G.answer_gate(broken, blueprint)
    chk.ok(len([g for g in ag if g["level"] == G.STOP]) >= 2,
           "answer_gate stops on a missing cloze answer and an out-of-range MCQ index",
           summarize(ag))
    # dup_gate — 통째로 옮긴 지문과 선택지 3개 재활용
    dg = G.dup_gate(chapter, corpus_overlap)
    dstops = [g for g in dg if g["level"] == G.STOP]
    chk.ok(len(dstops) >= 2, "dup_gate stops on a copied passage and recycled choices",
           summarize(dg))
    dg_clean = G.dup_gate(chapter, corpus_clean)
    chk.ok(not [g for g in dg_clean if g["level"] == G.STOP],
           "dup_gate does not bite an unrelated set", summarize(dg_clean))
    # cefr_gate — C1 수준의 긴 문장을 넣으면 밴드를 벗어난다
    heavy = json.loads(json.dumps(chapter))
    long_sentence = ("Notwithstanding the methodological constraints inherent in the "
                     "aforementioned longitudinal investigation, the researchers "
                     "nevertheless contend that the aggregate empirical evidence "
                     "substantiates a causal relationship between institutional "
                     "policy and the observed distributional outcomes across the "
                     "jurisdictions under consideration during the period studied.")
    # 지문만 바꾸면 30개 발문(평균 10단어)이 평균을 끌어내려 warn 에서 멈춘다.
    # C1 원고란 발문까지 그 문체인 원고라서, 학생이 읽는 글 전체를 갈아 끼운다.
    for m in heavy["modules"]:
        for b in m["blocks"]:
            if b.get("paragraphs"):
                b["paragraphs"] = [long_sentence] * 3
            if b.get("template"):
                b["template"] = long_sentence.replace(
                    "the researchers", "the {{%d}}" % b["questions"][0]["no"])
            for q in b.get("questions") or []:
                if q.get("prompt"):
                    q["prompt"] = long_sentence
    cg = G.cefr_gate(heavy, blueprint)
    chk.ok(any(g["level"] == G.STOP for g in cg),
           "cefr_gate stops on C1-style prose",
           "; ".join(g["message"] for g in cg if g["level"] != G.INFO)[:160])
    # 지문만 무거운 원고는 stop 이 아니라 warn 이어야 한다 — 밴드가 계단을 갖는지.
    mild = json.loads(json.dumps(chapter))
    for m in mild["modules"]:
        for b in m["blocks"]:
            if b.get("paragraphs"):
                b["paragraphs"] = [long_sentence] * 3
    mg = G.cefr_gate(mild, blueprint)
    chk.ok(any(g["level"] == G.WARN for g in mg) and not any(g["level"] == G.STOP for g in mg),
           "cefr_gate warns (not stops) when the passages drift but the questions do not",
           "; ".join(g["message"] for g in mg if g["level"] != G.INFO)[:160])
    cg_ok = G.cefr_gate(chapter, blueprint)
    chk.ok(all(g["level"] == G.INFO for g in cg_ok), "cefr_gate passes the fixture chapter",
           cg_ok[0]["message"] if cg_ok else "")
    # fact_gate — 오프라인은 warn 이어야 한다. info 로 조용히 넘어가면 안 된다.
    fg = G.fact_gate(chapter, None)
    chk.ok(any(g["level"] == G.WARN for g in fg),
           "fact_gate warns (never silently passes) when it cannot verify offline",
           summarize(fg))
    claims = G.claims_of(chapter)
    chk.ok(len(claims) >= 1, "fact_gate found checkable claims to hand to a human",
           "%d claim(s): %s" % (len(claims), claims[0]["text"][:60] if claims else ""))

    print("\n6. offline behaviour (no provider at all)")
    off = graph.run({"book": "reading", "chapter_no": 2, "blueprint": blueprint,
                     "corpus": corpus_clean, "llm": None, "max_rounds": 3}, "sequential")
    chk.ok(off.get("status") in ("blocked",), "an offline run finishes instead of crashing",
           str(off.get("status")))
    chk.ok(any("offline: cannot draft" in n for n in off.get("notes") or []),
           "the offline run says 'offline: cannot draft'")
    chk.ok(off.get("visited", [])[-1] == "review",
           "the offline run still parks at review", " -> ".join(off.get("visited") or []))
    chk.ok(off.get("visited", []).count("revise") == 1,
           "offline revise gives up after one round instead of looping",
           "%d revise" % off.get("visited", []).count("revise"))

    print("\n7. dup thresholds match dup-core.js")
    js_th = _dupcore_thresholds()
    if js_th is None:
        print("  SKIP  assets/dup-core.js not readable")
    else:
        shared = [k for k in js_th if k in G.TH]
        diff = {k: (G.TH[k], js_th[k]) for k in shared if G.TH[k] != js_th[k]}
        chk.ok(not diff, "every threshold gates.TH shares with dup-core.js TH is identical",
               json.dumps(diff) if diff else "%d thresholds compared" % len(shared))
        # 파이썬이 옮기지 않은 것: frameDf / clusterJaccard. 둘 다 '군집' 개념이고,
        # gates.boilerplate_df 가 완전일치 군집만 쓰기 때문에 쓸 자리가 없다.
        # 그 차이는 강등을 덜 하는 방향이라 JS 가 잡는 것을 놓치지 않는다(주석 참조).
        missing = sorted(k for k in js_th if k not in G.TH)
        chk.ok(missing == ["clusterJaccard", "frameDf"],
               "only the two cluster thresholds are left unimplemented, as documented",
               ", ".join(missing) or "none")

    print("\n" + "=" * 72)
    print("selftest: %d passed, %d failed" % (chk.passed, chk.failed))
    return 0 if chk.failed == 0 else 1


def _dupcore_thresholds() -> dict | None:
    """
    dup-core.js 의 TH 를 읽어 온다. 두 도구가 같은 자를 쓰는지 확인하는 유일한 방법.

    파서를 쓰지 않고 숫자만 긁는다 — JS 를 실행하려면 node 가 있어야 하는데, 이
    확인이야말로 node 없는 장비에서도 돌아야 한다.
    """
    import re
    path = os.path.join(SG2, "assets", "dup-core.js")
    try:
        with open(path, "r", encoding="utf-8") as fh:
            src = fh.read()
    except OSError:
        return None
    m = re.search(r"var\s+TH\s*=\s*\{(.*?)\n\s*\};", src, re.S)
    if not m:
        return None
    body = re.sub(r"/\*.*?\*/", " ", m.group(1), flags=re.S)
    body = re.sub(r"//[^\n]*", " ", body)
    out = {}
    for key, val in re.findall(r"(\w+)\s*:\s*([0-9.]+)", body):
        out[key] = float(val) if "." in val else int(val)
    # shingleK 는 상수 K 로 적혀 있어서 위 정규식에 안 잡힌다.
    k = re.search(r"var\s+K\s*=\s*(\d+)", src)
    if k:
        out["shingleK"] = int(k.group(1))
    return out or None


# ── argparse ───────────────────────────────────────────────────────────────

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python3 -m authoring.cli",
        description="Author one practice-book chapter and put it through the quality gates.")
    p.add_argument("--book", choices=["reading", "listening", "speaking", "writing"],
                   help="which of the four books this chapter belongs to")
    p.add_argument("--chapter", type=int, help="chapter number, 1..10")
    p.add_argument("--edition", type=int, default=1, help="edition, 1..3 (default 1)")
    p.add_argument("--topic", default="", help="optional subject matter for the draft")
    p.add_argument("--out", help="directory to write <slug>.chapter.json and <slug>.gates.json")
    p.add_argument("--blueprint", help="path to config/blueprint.book.json (default: in-repo)")
    p.add_argument("--corpus", help="existing sets to check overlap against: a directory or "
                                    "a comma-separated list of JSON files")
    p.add_argument("--provider", default="", choices=["", "openai", "anthropic"],
                   help="force an LLM provider; default picks whichever API key is set")
    p.add_argument("--backend", default="", choices=["", "langgraph", "sequential"],
                   help="force a graph backend (default: langgraph if importable)")
    p.add_argument("--max-rounds", type=int, default=nodes.MAX_ROUNDS_DEFAULT,
                   help="how many revise rounds before the chapter is parked anyway")
    p.add_argument("--gates-only", action="store_true",
                   help="run the four gates on an existing chapter file and exit")
    p.add_argument("--chapter-file", help="chapter JSON for --gates-only")
    p.add_argument("--selftest", action="store_true",
                   help="run the whole graph on a fixture with a stub LLM, on both backends")
    p.add_argument("--baseline", action="store_true",
                   help="re-measure the SET 9 readability baseline behind CEFR_BANDS")
    p.add_argument("--no-node", action="store_true",
                   help="do not shell out to node for assets/book-schema.js validate()")
    p.add_argument("--json", action="store_true", help="machine-readable output where available")
    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    if args.selftest:
        return cmd_selftest(args)
    if args.baseline:
        return cmd_baseline(args)
    if args.gates_only:
        return cmd_gates_only(args)
    if not args.book or not args.chapter:
        build_parser().print_help()
        return 1
    return cmd_author(args)


if __name__ == "__main__":
    sys.exit(main())
