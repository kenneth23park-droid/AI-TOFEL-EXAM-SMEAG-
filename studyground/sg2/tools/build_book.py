#!/usr/bin/env python3
"""챕터 JSON 한 벌에서 교재 PDF 3판(student · answerKey · teacher)을 조판한다.

왜 이 도구가 있나. 원고는 챕터 JSON 하나뿐이고(docs/bmad/book-schema.md §1-1) 학생용
PDF·정답판·교사판·응시 세트·음원·검색 사이드카는 전부 그 파생물이다. 파생물을 손으로
만들기 시작하면 첫 수정에서 갈라진다 — "정답을 고쳤는데 PDF 만 고쳐졌다"는 사고는
원고가 둘 이상일 때 반드시 일어난다. 그래서 인쇄물은 사람이 편집하지 않고 여기서 나온다.

    python3 tools/build_book.py --book reading --edition student --out dist/books
    python3 tools/build_book.py --book listening --edition all --out dist/books
    python3 tools/build_book.py --chapter reading-03 --edition teacher --out dist/books
    python3 tools/build_book.py --selftest              # 합성 1챕터로 전 구간 점검

── 왜 2-pass 인가 (docs/bmad/book-prd.md BFR14) ─────────────────────────────
책 뒤 색인의 페이지 번호는 추정이 아니라 실측이어야 한다. 색인을 믿을 수 없으면
색인이 없는 것보다 나쁘다 — 학생이 펼친 면에 그 말이 없으면 다음부터 색인을 안 본다.

PDF 라이브러리가 없으므로(캠퍼스 장비는 오프라인이고 새 pip 의존을 늘리지 않는다)
PDF 를 되읽어 페이지를 세는 길은 막혀 있다. 대신 **페이지를 우리가 직접 만든다**.
book_templates/chapter.html.tmpl 의 조판 스크립트가 A4 본문 상자를 만들고 덩어리를
하나씩 담으므로, 그 상자의 순번이 곧 인쇄 페이지 번호다.

  1차 패스 — 색인은 비운 채 조판하고, 헤드리스 크롬의 --dump-dom 으로 DOM 을 받아
            '어느 색인어가 몇 쪽에 앉았는지'를 실측해 가져온다.
  2차 패스 — 그 실측값으로 목차·책뒤 색인을 채워 다시 조판하고, 같은 방법으로 다시
            재서 **본문 페이지가 1차와 한 쪽도 어긋나지 않았는지 검증**한 뒤에야
            --print-to-pdf 로 인쇄한다. 어긋나면 색인이 거짓말을 하게 되므로 실패시킨다.

목차는 앞붙이라 페이지가 늘면 본문이 밀린다. 그래서 앞붙이는 로마숫자로 따로 세고
본문은 1 부터 시작한다. 색인은 책 뒤라 본문 번호에 영향을 주지 않는다. 이 두 장치가
"2차 패스에서 본문이 밀리는" 경우를 구조적으로 없앤다 — 검증은 그 사실의 확인이다.

── 검산 ────────────────────────────────────────────────────────────────────
게이트 판정의 정본은 assets/book-schema.js 다. node 가 있으면 그 파일을 그대로 불러
쓴다(사본을 만들면 언젠가 브라우저와 빌드가 서로 다른 답을 낸다). node 가 없으면
book-schema.md §4-3 의 stop 목록만 옮긴 축소판으로 대신하고, 축소판을 썼다는 사실을
출력에 남긴다. 게이트 모양은 assets/set-import.js 와 같은 {level, scope, message} 다.
stop 이 하나라도 있으면 인쇄하지 않는다.

── 한계 (README-book-build.md 에 자세히) ──────────────────────────────────
· 한 덩어리(문항 하나, 문단 하나)가 A4 한 면보다 크면 자르지 않고 넘치게 두되
  overflow 로 반드시 보고한다. 조용히 잘리면 인쇄한 뒤에야 안다.
· 같은 입력에 같은 바이트는 보장하지 못한다 — 크롬이 PDF 에 생성 시각을 박는다.
· PDF 아웃라인(북마크)은 --print-to-pdf 가 만들어 주지 않는다. 검색 3층 중 L2 는
  이 도구의 범위 밖이고, L1(텍스트 레이어)과 L3(책뒤 색인)만 여기서 책임진다.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import html as _html
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent                       # studyground/sg2
TEMPLATES = HERE / "book_templates"
BLUEPRINT = ROOT / "config" / "blueprint.book.json"
SCHEMA_JS = ROOT / "assets" / "book-schema.js"
DEFAULT_CHAPTERS = ROOT / "config" / "_book"

EDITIONS = ("student", "answerKey", "teacher")
EDITION_ALIASES = {
    "student": "student",
    "answer_key": "answerKey",
    "answer-key": "answerKey",
    "answerkey": "answerKey",
    "answerKey": "answerKey",
    "key": "answerKey",
    "teacher": "teacher",
}
EDITION_FILE = {"student": "student", "answerKey": "answer-key", "teacher": "teacher"}
EDITION_LABEL = {
    "student": "Student Edition",
    "answerKey": "Answer Key",
    "teacher": "Teacher Edition",
}

AUTO_SCORED = ("blank", "mcq", "insert", "build")
BOOK_LABEL = {
    "reading": "Reading",
    "listening": "Listening",
    "speaking": "Speaking",
    "writing": "Writing",
}
INDEX_SCHEMA_VERSION = "1.0.0"


class BuildError(Exception):
    """빌드를 멈춰야 하는 상황. 메시지는 '다음에 무엇을 하라'까지 적는다."""


# ─────────────────────────────────────────────────────────────────────────────
# 글자 다루기
# ─────────────────────────────────────────────────────────────────────────────

def esc(v) -> str:
    return _html.escape("" if v is None else str(v), quote=True)


class Marker:
    """색인어가 인쇄면 어디에 앉았는지 표시할 앵커를 본문에 심는다.

    색인어를 자동 추출하지 않는 것은 결정 사항이다(BOS9) — 저작자가 indexTerms[] 로
    명시한 말만 색인에 오른다. 여기서 하는 일은 '그 말이 본문 어디에 실제로 찍혔는지'를
    찾아 눈에 보이지 않는 span 을 씌우는 것뿐이다. 조판이 끝난 뒤 그 span 이 들어앉은
    페이지 상자의 번호를 읽으면 그것이 색인에 적을 번호다.

    긴 말을 먼저 매치시킨다 — 'topic sentence' 가 있는데 'sentence' 가 먼저 잡히면
    긴 색인어가 영영 안 걸린다.
    """

    def __init__(self, terms):
        self.canon = {}
        uniq = []
        for t in terms:
            t = (t or "").strip()
            if not t:
                continue
            key = t.lower()
            if key in self.canon:
                continue
            self.canon[key] = t
            uniq.append(t)
        uniq.sort(key=len, reverse=True)
        self.re = None
        if uniq:
            # 끝의 (e)s 만 함께 잡는다 — 'tidal marsh' 를 색인어로 적었는데 본문이
            # 'tidal marshes' 면 색인이 비는 일을 막는다. 그 이상의 어형 변화
            # (marsh → marshland)는 잡지 않는다. README 의 '알려진 한계' 참고.
            alt = "|".join(re.escape(esc(t)) for t in uniq)
            self.re = re.compile(r"(?<![\w\-])(" + alt + r")(e?s)?(?![\w\-])", re.I)

    def _canon(self, hit: str):
        return self.canon.get(_html.unescape(hit).lower())

    def mark(self, escaped_text: str) -> str:
        if not self.re:
            return escaped_text

        def sub(m):
            hit = m.group(0)
            canon = self._canon(m.group(1)) or self._canon(hit) or _html.unescape(hit)
            return '<span class="ix" data-t="%s">%s</span>' % (esc(canon), hit)

        return self.re.sub(sub, escaped_text)


def tx(marker: Marker, v) -> str:
    """본문 글자 — 이스케이프한 뒤 색인 앵커를 심는다."""
    return marker.mark(esc(v))


# ─────────────────────────────────────────────────────────────────────────────
# 읽기
# ─────────────────────────────────────────────────────────────────────────────

def load_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise BuildError(f"파일이 없다: {path}")
    except json.JSONDecodeError as e:
        raise BuildError(f"{path} 를 JSON 으로 읽지 못했다 — {e}")


def load_blueprint() -> tuple[dict, dict]:
    """(권 id → 구조, blueprint 전체) — 구조의 정본은 언제나 이 파일이다."""
    bp = load_json(BLUEPRINT)
    return {b["id"]: b for b in bp.get("books", [])}, bp


def load_chapters(chapters_dir: Path, book: str | None, slug: str | None) -> list[dict]:
    if not chapters_dir.is_dir():
        raise BuildError(
            f"챕터 폴더가 없다: {chapters_dir}\n"
            "  편집 화면(admin-book-*.html)에서 챕터를 이 폴더로 내보낸 뒤 다시 돌린다.\n"
            "  다른 위치를 쓰려면 --chapters DIR 로 알려 준다."
        )
    out = []
    for p in sorted(chapters_dir.glob("*.json")):
        if p.name.endswith("_script.json") or p.name.endswith(".index.json"):
            continue
        c = load_json(p)
        if not isinstance(c, dict) or "book" not in c:
            continue
        c["_path"] = str(p)
        if slug and c.get("slug") != slug:
            continue
        if book and not slug and c.get("book") != book:
            continue
        out.append(c)
    if not out:
        what = f"슬러그 {slug}" if slug else f"{book} 권"
        raise BuildError(
            f"{chapters_dir} 안에 {what} 에 해당하는 챕터 JSON 이 없다.\n"
            "  파일명은 {slug}.json 이고 안에 book/chapterNo/slug 가 있어야 한다."
        )
    out.sort(key=lambda c: (c.get("book", ""), c.get("chapterNo", 0)))
    return out


def load_script_sidecar(chapter: dict, chapters_dir: Path) -> dict:
    """{slug}_script.json — _set9_fragments/listening_script.json 과 같은 모양.

    없어도 빌드는 계속한다. 챕터 안에 script 를 직접 넣은 원고가 있기 때문이다.
    다만 scriptRef 가 가리키는 키를 못 찾으면 정답판 대본 자리가 빈다 — 그때는
    경고로 남긴다(조용히 빈 채로 인쇄되는 것이 가장 나쁘다).
    """
    p = chapters_dir / f"{chapter.get('slug')}_script.json"
    if not p.is_file():
        return {}
    d = load_json(p)
    return d if isinstance(d, dict) else {}


# ─────────────────────────────────────────────────────────────────────────────
# 검산 — 정본은 assets/book-schema.js
# ─────────────────────────────────────────────────────────────────────────────

VALIDATOR_JS = r"""
var path = require('path');
var fs = require('fs');
var S = require(process.argv[2]);
try { S.useBlueprint(JSON.parse(fs.readFileSync(process.argv[3], 'utf8'))); } catch (e) {}
var out = [];
for (var i = 4; i < process.argv.length; i++) {
  var c = JSON.parse(fs.readFileSync(process.argv[i], 'utf8'));
  var r = S.validate(c);
  out.push({ slug: c.slug || null, ok: r.ok, gates: r.gates });
}
process.stdout.write(JSON.stringify(out));
"""


def validate_with_node(chapters: list[dict]) -> list[dict] | None:
    node = shutil.which("node")
    if not node or not SCHEMA_JS.is_file():
        return None
    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        runner = td / "run.js"
        runner.write_text(VALIDATOR_JS, encoding="utf-8")
        paths = []
        for i, c in enumerate(chapters):
            f = td / f"c{i}.json"
            f.write_text(json.dumps({k: v for k, v in c.items() if k != "_path"}),
                         encoding="utf-8")
            paths.append(str(f))
        cmd = [node, str(runner), str(SCHEMA_JS), str(BLUEPRINT)] + paths
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            print("  ⚠ node 검산이 실패해 축소판으로 넘어간다 — " + r.stderr.strip()[:300],
                  file=sys.stderr)
            return None
        try:
            return json.loads(r.stdout)
        except json.JSONDecodeError:
            return None


def validate_py(chapter: dict, shape: dict) -> dict:
    """book-schema.md §4-3 의 stop 목록만 옮긴 축소판.

    node 가 없는 장비를 위한 대비책이다. warn 은 재현하지 않는다 — warn 은 사람이 볼
    문제이고 화면(admin)이 이미 보여 준다. 여기서 막아야 하는 것은 '인쇄하면 안 되는
    원고'뿐이다. 정본과 갈라질 위험이 있으므로 이 경로를 탄 사실은 출력에 남긴다.
    """
    gates = []

    def gate(level, scope, message):
        gates.append({"level": level, "scope": scope, "message": message})

    book = str(chapter.get("book") or "")
    if book not in BOOK_LABEL:
        gate("stop", "book", 'Field "book" must be one of reading, listening, speaking, '
                             'writing (got "%s").' % book)
        return {"ok": False, "gates": gates}
    if not shape:
        gate("stop", "book", 'No blueprint found for book "%s".' % book)
        return {"ok": False, "gates": gates}

    no = chapter.get("chapterNo")
    if not isinstance(no, int) or isinstance(no, bool) or not (1 <= no <= 10):
        gate("stop", "chapter", 'Field "chapterNo" must be a whole number from 1 to 10 '
                                '(got "%s").' % chapter.get("chapterNo"))
    if str(chapter.get("id") or "") != book:
        gate("stop", "chapter", 'Field "id" must equal the book id "%s" (got "%s").'
             % (book, chapter.get("id")))
    if not str(chapter.get("title") or "").strip():
        gate("stop", "chapter", 'Field "title" is empty.')

    want_mods = shape.get("modules", [])
    got_mods = chapter.get("modules") or []
    if len(got_mods) != len(want_mods):
        gate("stop", "structure", "Chapter must have exactly %d modules (found %d)."
             % (len(want_mods), len(got_mods)))
        return {"ok": False, "gates": gates}

    total = 0
    for mi, wm in enumerate(want_mods):
        gm = got_mods[mi] or {}
        if str(gm.get("id") or "") != wm["id"]:
            gate("stop", "structure", 'Module %d must have id "%s" (found "%s").'
                 % (mi + 1, wm["id"], gm.get("id")))
        want_blocks = wm.get("blocks", [])
        got_blocks = gm.get("blocks") or []
        if len(got_blocks) != len(want_blocks):
            gate("stop", "structure", "Module %s must have exactly %d blocks (found %d)."
                 % (wm["id"], len(want_blocks), len(got_blocks)))
            continue
        for bi, wb in enumerate(want_blocks):
            gb = got_blocks[bi] or {}
            if str(gb.get("kind") or "") != wb["kind"]:
                gate("stop", "structure", 'Module %s block %d must be of kind "%s" (found "%s").'
                     % (wm["id"], bi + 1, wb["kind"], gb.get("kind")))
            gq = gb.get("questions") or []
            total += len(gq)
            if len(gq) != wb["questions"]:
                gate("stop", "count", "Module %s block %d must have exactly %d questions "
                     "(found %d)." % (wm["id"], bi + 1, wb["questions"], len(gq)))
            got_kinds = {}
            for q in gq:
                k = str((q or {}).get("kind") or "")
                got_kinds[k] = got_kinds.get(k, 0) + 1
            for k, n in (wb.get("questionKinds") or {}).items():
                if got_kinds.get(k, 0) != n:
                    gate("stop", "count", 'Module %s block %d must have %d "%s" questions '
                         "(found %d)." % (wm["id"], bi + 1, n, k, got_kinds.get(k, 0)))

    if total != shape.get("questions"):
        gate("stop", "count", "Chapter must contain exactly %s questions (found %d)."
             % (shape.get("questions"), total))

    seen = set()
    for mod, blk, q in walk(chapter):
        qid = str(q.get("id") or "")
        where = qid or ("module %s" % mod.get("id"))
        if not qid:
            gate("stop", "ids", "A question in module %s has no id." % mod.get("id"))
        elif qid in seen:
            gate("stop", "ids", "Duplicate question ids: %s. Answers would overwrite "
                 "each other." % qid)
        else:
            seen.add(qid)
        kind = str(q.get("kind") or "")
        if kind in AUTO_SCORED:
            a = q.get("answer")
            missing = (a is None or a == "") if kind != "build" else False
            if kind in ("mcq", "insert") and isinstance(a, bool):
                missing = True
            if missing:
                gate("stop", "answer", "%s: no answer. Auto-scored questions cannot be "
                     "saved without one." % where)
        if kind == "blank":
            hint = str(q.get("hint") or "")
            ans = str(q.get("answer") or "")
            if hint and ans and not ans.lower().startswith(hint.lower()):
                gate("stop", "cloze", '%s: hint "%s" is not the beginning of the answer "%s".'
                     % (where, hint, ans))
        if kind in ("mcq", "insert"):
            ch = q.get("choices") or []
            if len(ch) < 3:
                gate("stop", "choices", "%s: only %d choices." % (where, len(ch)))
            elif not isinstance(q.get("answer"), int) or not (0 <= q["answer"] < len(ch)):
                gate("stop", "answer", "%s: answer index %s is outside the %d choices."
                     % (where, q.get("answer"), len(ch)))
            if not str(q.get("prompt") or "").strip():
                gate("stop", "questions", "%s: the question prompt is empty." % where)
        if kind == "build":
            if len(q.get("tiles") or []) < 3:
                gate("stop", "questions", "%s: a Build a Sentence item needs at least 3 tiles."
                     % where)
            if not str(q.get("sentence") or "").strip():
                gate("stop", "answer", "%s: the target sentence is empty." % where)
        if kind == "email" and len(q.get("bullets") or []) < 2:
            gate("stop", "questions", "%s: the email task needs at least 2 bullet requirements."
                 % where)
        if kind == "discussion" and len(q.get("posts") or []) < 2:
            gate("stop", "questions", "%s: the academic discussion needs at least 2 student posts."
                 % where)

    for mod, blk, _ in [(m, b, None) for m in (chapter.get("modules") or [])
                        for b in (m.get("blocks") or [])]:
        if blk.get("kind") == "cloze":
            tpl = str(blk.get("template") or "")
            if not tpl.strip():
                gate("stop", "questions", "Module %s: the cloze template text is empty."
                     % mod.get("id"))
            else:
                for q in blk.get("questions") or []:
                    if ("{{%s}}" % q.get("no")) not in tpl:
                        gate("stop", "cloze", "Module %s: the template has no {{%s}} "
                             "placeholder." % (mod.get("id"), q.get("no")))
        if blk.get("kind") == "passage" and not (blk.get("paragraphs") or []):
            gate("stop", "questions", "Module %s: the passage has no paragraphs." % mod.get("id"))

    if book == "listening":
        tracks = ((chapter.get("audio") or {}).get("tracks")) or []
        if not tracks:
            gate("stop", "audio", "A listening chapter must declare audio.tracks[].")
        by_id = {}
        for t in tracks:
            tid = str((t or {}).get("id") or "")
            if not tid:
                gate("stop", "audio", "An audio track has no id.")
                continue
            if tid in by_id:
                gate("stop", "audio", 'Duplicate audio track id "%s".' % tid)
            by_id[tid] = t
            if not str(t.get("script") or "").strip() and not str(t.get("scriptRef") or "").strip():
                gate("stop", "audio", 'Audio track "%s" has no script and no scriptRef.' % tid)
        for mod in chapter.get("modules") or []:
            for blk in mod.get("blocks") or []:
                if blk.get("kind") != "audio-set":
                    continue
                if blk.get("perQuestionAudio"):
                    for q in blk.get("questions") or []:
                        ref = str(q.get("audioRef") or "")
                        if not ref and not str(q.get("audio") or ""):
                            gate("stop", "audio", "%s: no audioRef." % q.get("id"))
                        elif ref and ref not in by_id:
                            gate("stop", "audio", '%s: audioRef "%s" is not declared in '
                                 "audio.tracks[]." % (q.get("id"), ref))
                else:
                    ref = str(blk.get("audioRef") or "")
                    if not ref and not str(blk.get("audio") or ""):
                        gate("stop", "audio", "Module %s: an audio-set block must name the "
                             "recording its questions are about." % mod.get("id"))
                    elif ref and ref not in by_id:
                        gate("stop", "audio", 'Module %s: audioRef "%s" is not declared in '
                             "audio.tracks[]." % (mod.get("id"), ref))

    return {"ok": not any(g["level"] == "stop" for g in gates), "gates": gates}


def walk(chapter: dict):
    for mod in chapter.get("modules") or []:
        for blk in mod.get("blocks") or []:
            for q in blk.get("questions") or []:
                yield mod, blk, q


def run_gates(chapters: list[dict], shapes: dict, allow_stop: bool) -> str:
    """게이트를 repo 모양 그대로 찍고, stop 이 있으면 인쇄를 막는다."""
    results = validate_with_node(chapters)
    source = "assets/book-schema.js (node)"
    if results is None:
        source = "python fallback (book-schema.md §4-3 stop only)"
        results = []
        for c in chapters:
            r = validate_py(c, shapes.get(c.get("book"), {}))
            results.append({"slug": c.get("slug"), "ok": r["ok"], "gates": r["gates"]})

    stop = warn = 0
    print(f"  검산: {source}")
    for res in results:
        for g in res.get("gates", []):
            if g["level"] == "stop":
                stop += 1
            else:
                warn += 1
            mark = "✗" if g["level"] == "stop" else "·"
            print("  %s %-4s %-10s %s:%s" % (mark, g["level"], g["scope"],
                                             res.get("slug"), g["message"]))
    print(f"  게이트 {stop} stop · {warn} warn")
    if stop and not allow_stop:
        raise BuildError(
            "stop 게이트가 %d 건이라 인쇄하지 않는다.\n"
            "  위 목록을 고친 뒤 다시 돌린다. 검토용으로 어쨌든 뽑아야 하면\n"
            "  --allow-stop 을 붙인다(그 PDF 는 학생에게 나가면 안 된다)." % stop
        )
    return source


# ─────────────────────────────────────────────────────────────────────────────
# 조판 — HTML 만들기
# ─────────────────────────────────────────────────────────────────────────────

class Render:
    """한 권(챕터 여러 장) 한 판(edition)의 HTML 을 만든다."""

    def __init__(self, book: str, chapters: list[dict], edition: str,
                 scripts: dict, blueprint_meta: dict):
        self.book = book
        self.chapters = chapters
        self.edition = edition
        self.scripts = scripts            # slug -> {trackId: {text,...}}
        self.bp = blueprint_meta
        self.toc = []                     # [{id, level, label}]
        self.terms = []                   # 책 전체 색인어(정본 표기)
        self.warnings = []

    # 판별 —— 무엇을 인쇄하는가
    @property
    def show_answers(self) -> bool:
        return self.edition in ("answerKey", "teacher")

    @property
    def show_scripts(self) -> bool:
        return self.edition in ("answerKey", "teacher")

    @property
    def show_models(self) -> bool:
        return self.edition in ("answerKey", "teacher")

    @property
    def show_teaching(self) -> bool:
        return self.edition == "teacher"

    # ── 조각들 ──────────────────────────────────────────────────────────
    def _script_text(self, chapter, ref_or_track) -> str:
        """트랙 id 또는 트랙 객체에서 실제 대본 글자를 찾는다."""
        tracks = ((chapter.get("audio") or {}).get("tracks")) or []
        track = None
        if isinstance(ref_or_track, dict):
            track = ref_or_track
        else:
            for t in tracks:
                if t.get("id") == ref_or_track:
                    track = t
                    break
        if not track:
            return ""
        if str(track.get("script") or "").strip():
            return track["script"]
        ref = str(track.get("scriptRef") or "")
        side = self.scripts.get(chapter.get("slug")) or {}
        entry = side.get(ref) or side.get(track.get("id"))
        if isinstance(entry, dict):
            return str(entry.get("text") or "")
        if isinstance(entry, str):
            return entry
        if ref:
            self.warnings.append(
                '%s: scriptRef "%s" 를 %s_script.json 에서 찾지 못했다 — 정답판 대본이 빈다.'
                % (chapter.get("slug"), ref, chapter.get("slug")))
        return ""

    def _script_html(self, mk, text) -> str:
        if not str(text or "").strip():
            return ""
        rows = []
        for line in str(text).split("\n"):
            line = line.strip()
            if not line:
                continue
            m = re.match(r"^([A-Za-z][A-Za-z .'\-]{0,24}):\s*(.*)$", line)
            if m:
                rows.append('<p><span class="sp">%s:</span> %s</p>'
                            % (esc(m.group(1)), tx(mk, m.group(2))))
            else:
                rows.append("<p>%s</p>" % tx(mk, line))
        return '<div class="script">%s</div>' % "".join(rows)

    # ── 문항 ────────────────────────────────────────────────────────────
    def _question(self, mk, chapter, blk, q) -> str:
        kind = str(q.get("kind") or "")
        no = q.get("no")
        body = []

        if kind in ("mcq", "insert"):
            body.append('<div class="prompt">%s</div>' % tx(mk, q.get("prompt")))
            lis = []
            ans = q.get("answer")
            for i, c in enumerate(q.get("choices") or []):
                letter = chr(ord("A") + i)
                correct = self.show_answers and isinstance(ans, int) and i == ans
                lis.append('<li%s><span class="lt">%s.</span>%s</li>'
                           % (' class="correct"' if correct else "", letter, tx(mk, c)))
            body.append('<ol class="choices">%s</ol>' % "".join(lis))
            if self.show_answers and isinstance(ans, int):
                body.append('<div class="answer-line">Answer: <b>%s</b></div>'
                            % esc(chr(ord("A") + ans)))

        elif kind == "blank":
            # 클로즈 문항 자체는 본문 템플릿 안에 찍힌다. 정답판에서만 목록으로 되짚는다.
            if self.show_answers:
                body.append('<div class="answer-line">Answer: <b>%s</b></div>'
                            % esc(q.get("answer")))
            else:
                return ""

        elif kind == "build":
            if str(q.get("context") or "").strip():
                body.append('<div class="prompt">%s</div>' % tx(mk, q.get("context")))
            slots = q.get("slots") or []
            n_slots = len(slots) if isinstance(slots, list) else int(slots or 0)
            body.append('<div class="slots">%s</div>'
                        % "".join('<span class="slot">&nbsp;</span>' for _ in range(n_slots)))
            body.append('<div class="tiles">%s</div>'
                        % "".join('<span class="tile">%s</span>' % esc(t)
                                  for t in (q.get("tiles") or [])))
            if self.show_answers:
                body.append('<div class="answer-line">Answer: <b>%s</b></div>'
                            % tx(mk, q.get("sentence")))

        elif kind in ("repeat", "interview"):
            prep, resp = q.get("prepSec"), q.get("respondSec")
            body.append('<div class="timing">Prepare %ss &nbsp;·&nbsp; Respond %ss</div>'
                        % (esc(prep), esc(resp)))
            script = str(q.get("script") or "") or self._script_text(chapter, q.get("audioRef"))
            if self.show_scripts and script:
                body.append('<div class="prompt"><b>Recording:</b></div>')
                body.append(self._script_html(mk, script))
            else:
                body.append('<div class="prompt"><i>You will hear the prompt. '
                            'Speak after the beep.</i></div>')

        elif kind == "email":
            body.append('<div class="prompt"><b>To:</b> %s<br><b>Subject:</b> %s</div>'
                        % (tx(mk, q.get("to")), tx(mk, q.get("subject"))))
            if str(q.get("situation") or "").strip():
                body.append("<p>%s</p>" % tx(mk, q.get("situation")))
            bl = q.get("bullets") or []
            if bl:
                body.append("<ul>%s</ul>" % "".join("<li>%s</li>" % tx(mk, b) for b in bl))
            body.append('<div class="prompt">%s</div>' % tx(mk, q.get("prompt")))
            body.append(self._lines(6 if self.show_answers else 12))

        elif kind == "discussion":
            body.append('<div class="prompt"><b>Professor:</b> %s</div>'
                        % tx(mk, q.get("professor")))
            body.append('<div class="prompt">%s</div>' % tx(mk, q.get("prompt")))
            for p in q.get("posts") or []:
                body.append('<div class="script"><p><span class="sp">%s:</span> %s</p></div>'
                            % (esc((p or {}).get("name")), tx(mk, (p or {}).get("text"))))
            body.append(self._lines(6 if self.show_answers else 12))

        else:
            body.append('<div class="prompt">%s</div>' % tx(mk, q.get("prompt")))

        return ('<div class="atom q" id="%s"><span class="qno">%s.</span>%s</div>'
                % (esc(q.get("id")), esc(no), "".join(body)))

    @staticmethod
    def _lines(n) -> str:
        return '<div class="write-lines">%s</div>' % ("<div></div>" * n)

    # ── 블록 ────────────────────────────────────────────────────────────
    def _cloze_body(self, mk, blk) -> str:
        """{{7}} 자리를 밑줄·번호·힌트로 바꾼다. 정답판은 답을 채워 넣는다."""
        by_no = {str(q.get("no")): q for q in (blk.get("questions") or [])}
        out, pos = [], 0
        tpl = str(blk.get("template") or "")
        for m in re.finditer(r"\{\{\s*(\d+)\s*\}\}", tpl):
            out.append(tx(mk, tpl[pos:m.start()]))
            q = by_no.get(m.group(1))
            if self.show_answers and q is not None:
                out.append('<span class="blank filled"><span class="bno">%s</span>&nbsp;%s</span>'
                           % (esc(q.get("no")), tx(mk, q.get("answer"))))
            elif q is not None:
                hint = str(q.get("hint") or "")
                out.append('<span class="blank"><span class="bno">%s</span>&nbsp;'
                           '<span class="bhint">%s</span>&nbsp;____</span>'
                           % (esc(q.get("no")), esc(hint)))
            else:
                out.append('<span class="blank">%s</span>' % esc(m.group(0)))
            pos = m.end()
        out.append(tx(mk, tpl[pos:]))
        return '<div class="atom cloze-body">%s</div>' % "".join(out)

    def _block(self, mk, chapter, mod, blk, bi) -> str:
        kind = str(blk.get("kind") or "")
        bid = "b-%s-%s-%d" % (chapter.get("slug"), mod.get("id"), bi + 1)
        heading = str(blk.get("heading") or "").strip()
        if not heading:
            qs = blk.get("questions") or []
            heading = ("Questions %s-%s" % (qs[0].get("no"), qs[-1].get("no"))) if qs else "Questions"
            self.warnings.append("%s %s block %d: heading 이 비어 있어 문항 번호로 지어 넣었다."
                                 % (chapter.get("slug"), mod.get("id"), bi + 1))
        self.toc.append({"id": bid, "level": 3, "label": heading})

        head = ('<div class="atom block-h" id="%s" data-toc="3|%s" data-keepnext>'
                '<span class="bh-title">%s</span>'
                '<span class="bh-kind">%s</span>'
                '<span class="bh-inst">%s</span></div>'
                % (esc(bid), esc(heading), esc(heading), esc(kind), tx(mk, blk.get("instruction"))))

        parts = [head]

        if kind == "cloze":
            parts.append(self._cloze_body(mk, blk))
            if self.show_answers:
                rows = ['<div class="atom box"><div class="box-t">Answers</div><ol>']
                for q in blk.get("questions") or []:
                    rows.append("<li value=\"%s\"><b>%s</b></li>" % (esc(q.get("no")),
                                                                    tx(mk, q.get("answer"))))
                rows.append("</ol></div>")
                parts.append("".join(rows))
            return '<div class="split block">%s</div>' % "".join(parts)

        if kind == "passage":
            title = str(blk.get("title") or "").strip()
            if title:
                parts.append('<h3 class="atom passage-t" data-keepnext>%s</h3>' % tx(mk, title))
            for i, para in enumerate(blk.get("paragraphs") or []):
                parts.append('<p class="atom para"><span class="pno">%d</span>%s</p>'
                             % (i + 1, tx(mk, para)))

        if kind == "audio-set":
            if not blk.get("perQuestionAudio"):
                ref = str(blk.get("audioRef") or "")
                parts.append('<div class="atom box"><div class="box-t">Audio</div>'
                             '<div>Track <b>%s</b></div></div>'
                             % esc(ref or blk.get("audio") or "—"))
                if self.show_scripts:
                    sc = self._script_html(mk, self._script_text(chapter, ref))
                    if sc:
                        parts.append('<div class="atom">%s</div>' % sc)

        if kind == "record-set":
            intro = str(blk.get("introScript") or "")
            if self.show_scripts and intro.strip():
                parts.append('<div class="atom box"><div class="box-t">Intro recording</div>%s</div>'
                             % self._script_html(mk, intro))

        for q in blk.get("questions") or []:
            if kind == "audio-set" and blk.get("perQuestionAudio") and self.show_scripts:
                sc = self._script_html(mk, self._script_text(chapter, q.get("audioRef")))
                if sc:
                    parts.append('<div class="atom"><div class="timing">Track %s</div>%s</div>'
                                 % (esc(q.get("audioRef")), sc))
            html = self._question(mk, chapter, blk, q)
            if html:
                parts.append(html)

        return '<div class="split block">%s</div>' % "".join(parts)

    # ── 챕터 ────────────────────────────────────────────────────────────
    def _chapter(self, chapter) -> str:
        slug = str(chapter.get("slug") or "")
        title = str(chapter.get("title") or "")
        no = chapter.get("chapterNo")
        terms = list(chapter.get("indexTerms") or [])
        terms += [g.get("term") for g in (chapter.get("glossary") or []) if isinstance(g, dict)]
        mk = Marker(terms)
        for t in terms:
            if t and t not in self.terms:
                self.terms.append(t)

        head_label = "%s · Chapter %s · %s" % (BOOK_LABEL.get(self.book, self.book), no, title)
        cid = "ch-%s" % slug
        self.toc.append({"id": cid, "level": 1, "label": "Chapter %s — %s" % (no, title)})

        kinds = []
        for _, blk, _q in walk(chapter):
            k = str(blk.get("kind") or "")
            if k and k not in kinds:
                kinds.append(k)

        teaching = chapter.get("teaching") or {}
        opener = ['<div class="kicker">%s &nbsp;·&nbsp; Chapter %s</div>'
                  % (esc(BOOK_LABEL.get(self.book, self.book)), esc(no)),
                  "<h1>%s</h1>" % tx(mk, title),
                  '<div class="badges">'
                  + '<span class="badge fill">%s</span>' % esc(chapter.get("cefr") or "B2")
                  + "".join('<span class="badge">%s</span>' % esc(k) for k in kinds)
                  + '<span class="badge">%s</span>' % esc(EDITION_LABEL[self.edition])
                  + "</div>"]
        if str(teaching.get("objective") or "").strip():
            opener.append('<div class="objective">%s</div>' % tx(mk, teaching.get("objective")))
        ts = chapter.get("targetSkills") or []
        if ts:
            opener.append('<div class="box"><div class="box-t">In this chapter you train</div>'
                          "<ul>%s</ul></div>" % "".join("<li>%s</li>" % tx(mk, s) for s in ts))

        parts = ['<div class="atom opener" id="%s" data-toc="1|%s" data-anchor="%s">%s</div>'
                 % (esc(cid), esc("Chapter %s — %s" % (no, title)), esc(slug), "".join(opener))]

        strat = teaching.get("strategy") or []
        if strat:
            parts.append('<div class="atom box"><div class="box-t">How to attack this</div>'
                         "<ol>%s</ol></div>" % "".join("<li>%s</li>" % tx(mk, s) for s in strat))
        if self.show_teaching:
            ce = teaching.get("commonErrors") or []
            if ce:
                parts.append('<div class="atom box teacher-only">'
                             '<div class="box-t">Teacher · common errors</div>'
                             "<ul>%s</ul></div>" % "".join("<li>%s</li>" % tx(mk, e) for e in ce))

        for mod in chapter.get("modules") or []:
            mid = "m-%s-%s" % (slug, mod.get("id"))
            self.toc.append({"id": mid, "level": 2, "label": str(mod.get("label") or mod.get("id"))})
            t = mod.get("timeLimitSec")
            clock = ('<span class="mod-time">%d min</span>' % round(t / 60)) if t else ""
            inner = ['<h2 class="atom module-h" id="%s" data-toc="2|%s" data-keepnext>%s%s</h2>'
                     % (esc(mid), esc(mod.get("label") or mod.get("id")),
                        esc(mod.get("label") or mod.get("id")), clock)]
            for bi, blk in enumerate(mod.get("blocks") or []):
                inner.append(self._block(mk, chapter, mod, blk, bi))
            parts.append('<div class="split module">%s</div>' % "".join(inner))

        gl = chapter.get("glossary") or []
        if gl:
            gid = "g-%s" % slug
            self.toc.append({"id": gid, "level": 2, "label": "Glossary"})
            rows = "".join("<dt>%s</dt><dd>%s</dd>"
                           % (tx(mk, g.get("term")), tx(mk, g.get("gloss")))
                           for g in gl if isinstance(g, dict))
            parts.append('<div class="atom box gloss" id="%s" data-toc="2|Glossary">'
                         '<div class="box-t">Glossary</div><dl>%s</dl></div>' % (esc(gid), rows))

        if self.show_models:
            models = chapter.get("modelAnswers") or []
            if models:
                aid = "ma-%s" % slug
                self.toc.append({"id": aid, "level": 2, "label": "Model answers"})
                rows = ['<h2 class="atom module-h" id="%s" data-toc="2|Model answers" '
                        'data-keepnext>Model answers</h2>' % esc(aid)]
                for m in models:
                    band = str((m or {}).get("band") or "mid")
                    notes = ('<div class="notes">%s</div>' % tx(mk, m.get("notes"))) \
                        if (self.show_teaching and str(m.get("notes") or "").strip()) else ""
                    score = (' &nbsp;Score <b>%s</b>' % esc(m.get("score"))) \
                        if m.get("score") is not None else ""
                    rows.append('<div class="atom model %s"><span class="band">%s</span>'
                                "<b>%s</b>%s<p>%s</p>%s</div>"
                                % (esc(band), esc(band), esc(m.get("questionId")), score,
                                   tx(mk, m.get("text")), notes))
                parts.append('<div class="split">%s</div>' % "".join(rows))

        return ('<div class="split chap" data-head="%s" data-break>%s</div>'
                % (esc(head_label), "".join(parts)))

    # ── 앞붙이 · 뒤붙이 ────────────────────────────────────────────────
    def front(self, pagemap) -> str:
        pages = {}
        for e in (pagemap or {}).get("toc", []):
            if e.get("id"):
                pages[e["id"]] = e.get("page")
        title = "TOEFL Practice Book — B2 Level Up"
        cover = ('<div class="atom opener"><div class="kicker">%s</div><h1>%s</h1>'
                 '<div class="badges"><span class="badge fill">%s</span>'
                 '<span class="badge">%s</span><span class="badge">%d chapters</span></div>'
                 '<div class="objective">%s</div></div>'
                 % (esc(self.bp.get("label") or title),
                    esc(BOOK_LABEL.get(self.book, self.book)),
                    esc(self.bp.get("cefr") or "B2"),
                    esc(EDITION_LABEL[self.edition]), len(self.chapters),
                    esc("Admin and staff copy. Not for student distribution.")))
        rows = []
        for e in self.toc:
            pg = pages.get(e["id"])
            rows.append('<div class="atom toc-row l%d"><span class="t">%s</span>'
                        '<span class="dots"></span><span class="pg">%s</span></div>'
                        % (e["level"], esc(e["label"]), esc(pg if pg is not None else "")))
        toc = ('<div class="split front" data-head="Contents" data-break>'
               '<h1 class="atom ft" data-keepnext>Contents</h1>%s</div>' % "".join(rows))
        return '<div class="split front" data-break>%s</div>%s' % (cover, toc)

    def back(self, pagemap) -> str:
        """책 뒤 색인. 1차 패스에서는 빈 문자열이다 — 번호를 아직 모르기 때문이다."""
        if not pagemap:
            return ""
        terms = (pagemap or {}).get("terms") or {}
        if not terms:
            return ""
        by_letter = {}
        for term in sorted(terms, key=lambda s: s.lower()):
            pgs = terms[term]
            try:
                pgs = sorted(set(pgs), key=lambda p: int(p))
            except (TypeError, ValueError):
                pgs = sorted(set(pgs))
            by_letter.setdefault(term[:1].upper(), []).append((term, pgs))
        rows = []
        for letter in sorted(by_letter):
            rows.append('<div class="ix-letter">%s</div>' % esc(letter))
            for term, pgs in by_letter[letter]:
                rows.append('<div class="ix-row"><span class="term">%s</span> '
                            '<span class="pgs">%s</span></div>'
                            % (esc(term), esc(", ".join(str(p) for p in pgs))))
        return ('<div class="split front" data-head="Index" data-break>'
                '<h1 class="atom ft" data-keepnext>Index</h1>'
                '<div class="atom ix-cols">%s</div></div>' % "".join(rows))

    # ── 본문 ────────────────────────────────────────────────────────────
    def body(self) -> str:
        self.toc = []
        self.terms = []
        return "".join(self._chapter(c) for c in self.chapters)


def build_html(render: Render, pagemap, pass_no: int) -> str:
    tmpl = (TEMPLATES / "chapter.html.tmpl").read_text(encoding="utf-8")
    css = (TEMPLATES / "print.css").read_text(encoding="utf-8")
    body = render.body()                      # toc 를 채우므로 front 보다 먼저 부른다
    front = render.front(pagemap)
    back = render.back(pagemap)
    meta = {
        "pass": pass_no,
        "runhead": "%s · %s" % (BOOK_LABEL.get(render.book, render.book),
                                EDITION_LABEL[render.edition]),
        "footLeft": "TOEFL Practice Book — B2 Level Up",
    }
    return (tmpl
            .replace("{{DOC_TITLE}}", esc("%s — %s" % (BOOK_LABEL.get(render.book, render.book),
                                                       EDITION_LABEL[render.edition])))
            .replace("{{PRINT_CSS}}", css)
            .replace("{{FRONT}}", front)
            .replace("{{BODY}}", body)
            .replace("{{BACK}}", back)
            .replace("{{META}}", json.dumps(meta, ensure_ascii=False)))


# ─────────────────────────────────────────────────────────────────────────────
# 헤드리스 크롬
# ─────────────────────────────────────────────────────────────────────────────

CHROME_CANDIDATES = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
    "/opt/google/chrome/chrome",
]


def find_chrome(explicit: str | None = None) -> str:
    if explicit:
        if Path(explicit).is_file():
            return explicit
        raise BuildError(f"--chrome 로 준 경로에 실행 파일이 없다: {explicit}")
    env = os.environ.get("CHROME_BIN") or os.environ.get("CHROME_PATH")
    if env and Path(env).is_file():
        return env
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser",
                 "chrome"):
        p = shutil.which(name)
        if p:
            return p
    for p in CHROME_CANDIDATES:
        if Path(p).is_file():
            return p
    raise BuildError(
        "헤드리스 크롬을 찾지 못했다. PDF 는 크롬의 인쇄 엔진으로만 만든다.\n"
        "  macOS : /Applications 에 Google Chrome 을 설치한다.\n"
        "  Linux : apt install chromium  또는  google-chrome-stable 을 설치한다.\n"
        "  이미 있는데 못 찾으면  CHROME_BIN=/경로/chrome  으로 알려 주거나\n"
        "  --chrome /경로/chrome 을 붙인다."
    )


def chrome_run(chrome: str, extra: list[str], url: str, done, timeout: int = 240) -> str:
    """헤드리스 크롬을 돌리되 **프로세스 종료를 기다리지 않는다**.

    왜냐하면 새 헤드리스는 --dump-dom / --print-to-pdf 로 일을 다 끝내고도 프로세스가
    남아 있는 일이 흔하다(macOS 에서 재현됨. 결과는 이미 나왔는데 붙잡혀 있다).
    종료를 기다리면 빌드가 통째로 멈춘다. 그래서 '원하는 결과가 나왔는가'(done)를
    직접 보고, 나오면 크롬을 끝낸다. 시간 안에 안 나오면 그때가 진짜 실패다.
    """
    import threading

    profile = tempfile.mkdtemp(prefix="sg2-chrome-")
    cmd = [chrome, "--headless", "--disable-gpu", "--no-sandbox", "--no-first-run",
           "--no-default-browser-check", "--disable-extensions",
           "--disable-background-networking", "--disable-sync", "--mute-audio",
           "--hide-scrollbars", "--user-data-dir=" + profile] + extra + [url]
    chunks: list[bytes] = []
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)

    def pump():
        for line in iter(proc.stdout.readline, b""):
            chunks.append(line)

    t = threading.Thread(target=pump, daemon=True)
    t.start()
    import time as _t
    deadline = _t.time() + timeout
    got = None
    while _t.time() < deadline:
        got = done(b"".join(chunks))
        if got is not None:
            break
        if proc.poll() is not None:
            got = done(b"".join(chunks))
            break
        _t.sleep(0.25)
    proc.kill()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        pass
    shutil.rmtree(profile, ignore_errors=True)
    if got is None:
        raise BuildError("크롬이 %d초 안에 결과를 내지 않았다: %s" % (timeout, url))
    return got


PAGEMAP_RE = re.compile(rb'<script id="page-map"[^>]*>(.*?)</script>', re.S)


def measure(chrome: str, html_path: Path) -> dict:
    """조판 결과를 실측한다 — --dump-dom 으로 조판이 끝난 DOM 을 받아 온다."""

    def done(buf: bytes):
        m = PAGEMAP_RE.search(buf)
        if not m:
            return None
        raw = m.group(1).strip()
        return raw if raw not in (b"", b"null") else None

    try:
        raw = chrome_run(chrome, ["--dump-dom"], html_path.as_uri(), done)
    except BuildError:
        raw = None
    if not raw:
        raise BuildError(
            "조판 결과를 읽지 못했다 (page-map 이 DOM 에 없다).\n"
            "  크롬이 스크립트를 돌리기 전에 DOM 을 뱉었거나 조판 스크립트가 죽었다.\n"
            "  중간 HTML 을 브라우저로 직접 열어 콘솔을 본다: " + str(html_path)
        )
    return json.loads(raw.decode("utf-8"))


def print_pdf(chrome: str, html_path: Path, pdf_path: Path):
    pdf_path.parent.mkdir(parents=True, exist_ok=True)
    if pdf_path.exists():
        pdf_path.unlink()
    state = {"size": -1}

    def done(_buf):
        """파일이 생기고 크기가 두 번 연속 같으면 다 쓴 것으로 본다.

        크롬은 PDF 를 다 쓴 뒤에도 프로세스가 남는 일이 있어 종료를 신호로 쓸 수 없다.
        마지막 바이트까지 %%EOF 로 끝나는지도 함께 본다 — 쓰다 만 파일을 성공으로
        읽으면 페이지 수 검증이 엉뚱한 답을 낸다.
        """
        if not pdf_path.is_file():
            return None
        size = pdf_path.stat().st_size
        if size == 0 or size != state["size"]:
            state["size"] = size
            return None
        with open(pdf_path, "rb") as fh:
            fh.seek(max(0, size - 64))
            return b"%%EOF" in fh.read() or None

    try:
        chrome_run(chrome, ["--print-to-pdf=" + str(pdf_path), "--no-pdf-header-footer"],
                   html_path.as_uri(), done)
    except BuildError:
        raise BuildError(
            "크롬이 PDF 를 끝내 쓰지 못했다: %s\n"
            "  중간 HTML 을 브라우저에서 직접 인쇄해 본다: %s" % (pdf_path, html_path))


PDF_COUNT_RE = re.compile(rb"/Type\s*/Pages[^>]*?/Count\s+(\d+)")
PDF_COUNT_RE2 = re.compile(rb"/Count\s+(\d+)\s*/Kids")


def pdf_page_count(path: Path):
    """PDF 라이브러리 없이 페이지 수만 세어 본다.

    크롬이 쓰는 PDF 는 페이지 트리가 압축되지 않은 객체로 남아 /Count 를 그대로 읽을 수
    있다. 못 읽으면 None 을 돌려주고 '검증 못 함'이라고 말한다 — 여기서 추측한 숫자를
    맞다고 하면 색인 검증 전체가 거짓이 된다.
    """
    data = path.read_bytes()
    for rx in (PDF_COUNT_RE, PDF_COUNT_RE2):
        hits = [int(x) for x in rx.findall(data)]
        if hits:
            return max(hits)
    return None


# ─────────────────────────────────────────────────────────────────────────────
# 사이드카
# ─────────────────────────────────────────────────────────────────────────────

def content_hash(chapter: dict) -> str:
    payload = {k: v for k, v in chapter.items() if k != "_path"}
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()[:16]


ANSWER_KEYS = ("answer", "answerTokens", "hint", "sentence", "modelAnswers", "script",
               "scriptRef")


def index_entry(chapter: dict, pages: dict) -> dict:
    """book-index.json 의 한 줄. 정답을 절대 담지 않는다 (book-prd.md BFR16).

    이 사이드카는 사이트 검색이 읽는 공개 경로 자산이다. SET 9 에서 정한 원칙과 같다 —
    정답지는 service_role 전용이고 공개 경로에는 나가지 않는다.
    """
    kinds = []
    for _m, blk, _q in walk(chapter):
        k = str(blk.get("kind") or "")
        if k and k not in kinds:
            kinds.append(k)
    n = sum(1 for _ in walk(chapter))
    tracks = ((chapter.get("audio") or {}).get("tracks")) or []
    teaching = chapter.get("teaching") or {}
    objectives = [o for o in [teaching.get("objective")] if o]
    objectives += list(chapter.get("targetSkills") or [])
    entry = {
        "book": chapter.get("book"),
        "chapterNo": chapter.get("chapterNo"),
        "slug": chapter.get("slug"),
        "title": chapter.get("title"),
        "objectives": objectives,
        "terms": sorted({t for t in (chapter.get("indexTerms") or []) if t}
                        | {g.get("term") for g in (chapter.get("glossary") or [])
                           if isinstance(g, dict) and g.get("term")}),
        "taskFamily": kinds[0] if kinds else None,
        "taskFamilies": kinds,
        "questionCount": n,
        "page": pages,
        "audio": ({"tracks": len(tracks), "dir": "media/audio/%s" % chapter.get("slug")}
                  if tracks else None),
        "contentHash": content_hash(chapter),
    }
    for k in ANSWER_KEYS:
        assert k not in entry, "index entry must not carry answers"
    return entry


def write_book_index(out_dir: Path, entries: list[dict]) -> Path:
    """book-index.json 을 PDF 옆에 둔다. 판을 따로 돌려도 page 가 합쳐지도록 병합한다."""
    path = out_dir / "book-index.json"
    old = {}
    if path.is_file():
        try:
            prev = json.loads(path.read_text(encoding="utf-8"))
            old = {e.get("slug"): e for e in prev.get("entries", [])}
        except (json.JSONDecodeError, AttributeError):
            old = {}
    merged = dict(old)
    for e in entries:
        prev = old.get(e["slug"])
        if prev and prev.get("contentHash") == e["contentHash"]:
            page = dict(prev.get("page") or {})
            page.update(e["page"])
            e = dict(e, page=page)
        merged[e["slug"]] = e
    rows = sorted(merged.values(), key=lambda e: (str(e.get("book")), e.get("chapterNo") or 0))
    corpus = hashlib.sha256(
        "".join("%s:%s" % (r.get("slug"), r.get("contentHash")) for r in rows).encode("utf-8")
    ).hexdigest()[:16]
    doc = {
        "schemaVersion": INDEX_SCHEMA_VERSION,
        "generatedAt": _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat(),
        "corpusHash": corpus,
        "entries": rows,
    }
    out_dir.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    return path


# ─────────────────────────────────────────────────────────────────────────────
# 빌드
# ─────────────────────────────────────────────────────────────────────────────

def build_edition(book, chapters, edition, scripts, bp_meta, out_dir, chrome,
                  keep_html=False, work_dir=None):
    render = Render(book, chapters, edition, scripts, bp_meta)
    tmp = Path(work_dir) if work_dir else Path(tempfile.mkdtemp(prefix="sg2-book-"))
    tmp.mkdir(parents=True, exist_ok=True)
    stem = "%s.%s" % (book if len(chapters) > 1 else chapters[0].get("slug"),
                      EDITION_FILE[edition])

    # ── 1차 패스 — 색인은 비운 채 조판하고 용어 위치를 실측한다.
    p1_html = tmp / (stem + ".pass1.html")
    p1_html.write_text(build_html(render, None, 1), encoding="utf-8")
    map1 = measure(chrome, p1_html)
    print("    pass 1 · front %s · body %s · terms %d"
          % (map1["frontPages"], map1["bodyPages"], len(map1["terms"])))

    # ── 2차 패스 — 실측값으로 목차·색인을 채우고 다시 조판한다.
    render2 = Render(book, chapters, edition, scripts, bp_meta)
    p2_html = tmp / (stem + ".pass2.html")
    p2_html.write_text(build_html(render2, map1, 2), encoding="utf-8")
    map2 = measure(chrome, p2_html)
    print("    pass 2 · front %s · body %s · index %s"
          % (map2["frontPages"], map2["bodyPages"], map2.get("backPages", 0)))

    # ── 검증 — 색인을 붙인 뒤 본문이 밀렸으면 색인이 거짓말을 한다.
    drift = []
    if map2["bodyPages"] != map1["bodyPages"]:
        drift.append("body pages: %s → %s" % (map1["bodyPages"], map2["bodyPages"]))
    for term, pages in map1["terms"].items():
        if map2["terms"].get(term) != pages:
            drift.append("term %r: %s → %s" % (term, pages, map2["terms"].get(term)))
    for k, v in (map1.get("anchors") or {}).items():
        if (map2.get("anchors") or {}).get(k) != v:
            drift.append("chapter %s: p.%s → p.%s" % (k, v, map2["anchors"].get(k)))
    if drift:
        raise BuildError(
            "2차 패스에서 본문 페이지가 밀렸다 — 색인 번호를 믿을 수 없으므로 인쇄하지 않는다.\n"
            "  " + "\n  ".join(drift[:8]) +
            "\n  앞붙이가 로마숫자가 아니거나 색인이 본문 앞에 들어간 것이 원인이다."
        )
    for o in map1.get("overflow", []) + map2.get("overflow", []):
        print("    ⚠ 한 면에 담기지 않는 덩어리: %s" % o, file=sys.stderr)

    # ── 인쇄
    pdf = out_dir / (stem + ".pdf")
    print_pdf(chrome, p2_html, pdf)
    counted = pdf_page_count(pdf)
    if counted is None:
        print("    PDF %d KB · 페이지 수 검증 못 함(압축된 페이지 트리)"
              % (pdf.stat().st_size // 1024))
    elif counted != map2["totalPages"]:
        raise BuildError(
            "PDF 페이지 수(%d)가 조판 결과(%d)와 다르다 — 크롬이 페이지를 더 나눴다.\n"
            "  print.css 의 --p-h / --p-flow-h 가 A4 에 맞는지 확인한다."
            % (counted, map2["totalPages"]))
    else:
        print("    PDF %s · %d pages · %d KB"
              % (pdf.name, counted, pdf.stat().st_size // 1024))

    if keep_html:
        for f in (p1_html, p2_html):
            shutil.copy2(f, out_dir / f.name)
    elif not work_dir:
        shutil.rmtree(tmp, ignore_errors=True)

    for w in render2.warnings:
        print("    ⚠ %s" % w, file=sys.stderr)

    return {
        "pdf": pdf,
        "pages": map2["totalPages"],
        "anchors": map2.get("anchors") or {},
        "terms": map2["terms"],
    }


def run_build(args) -> int:
    shapes, bp = load_blueprint()
    chapters_dir = Path(args.chapters).resolve()
    chapters = load_chapters(chapters_dir, args.book, args.chapter)
    book = args.book or chapters[0].get("book")
    if any(c.get("book") != book for c in chapters):
        raise BuildError("한 번에 한 권만 조판한다. --book 으로 권을 지정한다.")

    editions = list(EDITIONS) if args.edition == "all" else [EDITION_ALIASES[args.edition]]
    out_dir = Path(args.out).resolve() / book

    print("%s — %d chapters · %s" % (BOOK_LABEL.get(book, book), len(chapters),
                                     ", ".join(EDITION_LABEL[e] for e in editions)))
    for c in chapters:
        print("  · %s  %s" % (c.get("slug"), c.get("title")))
    run_gates(chapters, shapes, args.allow_stop)

    chrome = find_chrome(args.chrome)
    print("  chrome: %s" % chrome)
    scripts = {c.get("slug"): load_script_sidecar(c, chapters_dir) for c in chapters}

    pages_by_slug = {c.get("slug"): {} for c in chapters}
    for ed in editions:
        print("  %s" % EDITION_LABEL[ed])
        res = build_edition(book, chapters, ed, scripts, bp, out_dir, chrome,
                            keep_html=args.keep_html)
        for slug, page in res["anchors"].items():
            if slug in pages_by_slug and page is not None:
                try:
                    pages_by_slug[slug][ed] = int(page)
                except (TypeError, ValueError):
                    pages_by_slug[slug][ed] = page

    idx = write_book_index(out_dir, [index_entry(c, pages_by_slug.get(c.get("slug"), {}))
                                     for c in chapters])
    size = idx.stat().st_size
    print("  %s · %d bytes%s" % (idx.name, size,
                                 "  ⚠ 512KB 상한 초과 — 권 단위 분할 필요" if size > 512 * 1024 else ""))
    return 0


# ─────────────────────────────────────────────────────────────────────────────
# 셀프테스트 — 합성 1챕터로 전 구간을 실제로 돌린다
# ─────────────────────────────────────────────────────────────────────────────

WORDS = ["accurate", "benefit", "considerable", "distinct", "evident", "feasible",
         "gradual", "hypothesis", "implicit", "notable"]


def synth_reading_chapter() -> dict:
    """blueprint 의 reading 구조를 그대로 채운 합성 챕터(30문항).

    구조를 발명하지 않는 것이 요점이다 — 실제 blueprint 와 같은 모듈·블록·문항 수를
    채우므로, 셀프테스트는 검산기와 조판기를 실제 원고와 똑같은 조건으로 통과한다.
    """
    slug = "reading-01"
    modules = []
    no = 0

    def qid(mid, n):
        return "%s-%s-q%02d" % (slug, mid, n)

    # R1
    m1 = {"id": "R1", "label": "Reading Practice 1", "timeLimitSec": 600, "blocks": []}
    tpl_bits, qs = [], []
    for i in range(10):
        no += 1
        w = WORDS[i]
        qs.append({"id": qid("R1", no), "no": no, "kind": "blank", "hint": w[:2], "answer": w})
        tpl_bits.append("The report was {{%d}} about the coastline survey." % no)
    m1["blocks"].append({"kind": "cloze", "heading": "Questions 1-10",
                         "instruction": "Fill in the blank.",
                         "template": " ".join(tpl_bits), "questions": qs})
    for spec in ((2, "A Campus Notice", 7), (3, "Tidal Marshes", 3)):
        count, title, paras = spec
        qs = []
        for _ in range(count):
            no += 1
            qs.append({"id": qid("R1", no), "no": no, "kind": "mcq",
                       "prompt": "What does the passage say about the marsh survey?",
                       "choices": ["It was delayed.", "It was accurate.",
                                   "It was cancelled.", "It was repeated."],
                       "answer": 1})
        m1["blocks"].append({
            "kind": "passage", "heading": "Questions %d-%d" % (no - count + 1, no),
            "instruction": "Read a passage.", "title": title,
            "paragraphs": ["Tidal marshes are a distinct habitat where the evident benefit "
                           "of sediment capture is considerable, and a gradual change in "
                           "salinity shapes which plants take hold." for _ in range(paras)],
            "questions": qs})
    modules.append(m1)

    # R2
    m2 = {"id": "R2", "label": "Reading Practice 2", "timeLimitSec": 450, "blocks": []}
    tpl_bits, qs = [], []
    for i in range(10):
        no += 1
        w = WORDS[i]
        qs.append({"id": qid("R2", no), "no": no, "kind": "blank", "hint": w[:2], "answer": w})
        tpl_bits.append("A {{%d}} shift in the data was recorded by the team." % no)
    m2["blocks"].append({"kind": "cloze", "heading": "Questions 16-25",
                         "instruction": "Fill in the blank.",
                         "template": " ".join(tpl_bits), "questions": qs})
    qs = []
    for i in range(5):
        no += 1
        qs.append({"id": qid("R2", no), "no": no,
                   "kind": "insert" if i == 4 else "mcq",
                   "prompt": ("Where does the sentence best fit?" if i == 4
                              else "What is the main idea of the passage?"),
                   "choices": ["Position A", "Position B", "Position C", "Position D"],
                   "answer": 2})
    m2["blocks"].append({"kind": "passage", "heading": "Questions 26-30",
                         "instruction": "Read a passage.", "title": "Coastal Sediment",
                         "paragraphs": ["Sediment moves along the shore in a feasible and "
                                        "notable pattern that researchers can model." ] * 5,
                         "questions": qs})
    modules.append(m2)

    return {
        "schemaVersion": "1.0.0", "book": "reading", "chapterNo": 1, "slug": slug,
        "id": "reading", "label": "Reading", "title": "Selftest — Cloze and Passage Basics",
        "cefr": "B2", "edition": 1, "timeLimitSec": 1050,
        "targetSkills": ["Read for gist", "Use collocation to fill gaps"],
        "teaching": {
            "objective": "Fill gaps from collocation cues and locate the main idea fast.",
            "strategy": ["Read the whole sentence before choosing a word.",
                         "Check the hint letters against your answer."],
            "commonErrors": ["Choosing a word that fits meaning but not grammar.",
                             "Ignoring the hint letters."]},
        "glossary": [{"term": "collocation", "gloss": "Words that habitually go together."},
                     {"term": "sediment", "gloss": "Particles carried and dropped by water."}],
        "indexTerms": ["collocation", "sediment", "tidal marsh", "main idea"],
        "modules": modules,
        "provenance": {"authoredBy": "build_book.py --selftest", "authoredAt": None,
                       "reviewedBy": "", "reviewedAt": None, "level": "assumed",
                       "gateResults": []},
    }


def run_selftest(args) -> int:
    print("selftest — 합성 reading 1챕터로 전 구간을 돌린다")
    work = (Path(args.out).resolve() / "_selftest") if args.out_given \
        else Path(tempfile.mkdtemp(prefix="sg2-book-selftest-"))
    src = work / "chapters"
    out = work / "dist"
    src.mkdir(parents=True, exist_ok=True)

    chapter = synth_reading_chapter()
    (src / (chapter["slug"] + ".json")).write_text(
        json.dumps(chapter, indent=1, ensure_ascii=False), encoding="utf-8")
    print("  1) 합성 챕터 %s · %d questions → %s"
          % (chapter["slug"], sum(1 for _ in walk(chapter)), src))

    shapes, bp = load_blueprint()
    print("  2) blueprint 로드: %s" % BLUEPRINT.name)
    source = run_gates([chapter], shapes, allow_stop=False)
    print("  3) 검산 통과 (%s)" % source)

    render = Render("reading", [chapter], "teacher", {}, bp)
    html = build_html(render, None, 1)
    hp = work / "probe.html"
    hp.write_text(html, encoding="utf-8")
    n_ix = html.count('class="ix"')
    print("  4) HTML 조판 %d bytes · toc %d entries · 색인 앵커 %d개 → %s"
          % (len(html), len(render.toc), n_ix, hp))
    if n_ix == 0:
        raise BuildError("색인 앵커가 하나도 심기지 않았다 — 색인 페이지가 빈 채로 나온다.")

    try:
        chrome = find_chrome(args.chrome)
    except BuildError as e:
        print("  5) 헤드리스 크롬 없음 — PDF 단계는 실행하지 못했다.")
        print("     " + str(e).replace("\n", "\n     "))
        print("selftest: 크롬 앞 단계까지 통과 (PDF·2-pass 색인은 미검증)")
        return 0
    print("  5) chrome: %s" % chrome)

    res = build_edition("reading", [chapter], "teacher", {}, bp, out, chrome,
                        keep_html=True, work_dir=work / "work")
    page = res["anchors"].get(chapter["slug"])
    idx = write_book_index(out, [index_entry(chapter, {"teacher": int(page)} if page else {})])
    doc = json.loads(idx.read_text(encoding="utf-8"))
    leaked = [k for k in ANSWER_KEYS
              if re.search(r'"%s"\s*:' % k, idx.read_text(encoding="utf-8"))]
    print("  6) book-index.json %d bytes · entries %d · page %s · 정답 키 유출 %d건"
          % (idx.stat().st_size, len(doc["entries"]),
             doc["entries"][0]["page"], len(leaked)))
    if leaked:
        raise BuildError("book-index.json 에 정답 키가 들어갔다: %s" % leaked)
    ix_terms = res["terms"]
    print("  7) 색인 실측 %d terms — 예: %s"
          % (len(ix_terms), ", ".join("%s → p.%s" % (t, ",".join(ix_terms[t]))
                                      for t in sorted(ix_terms)[:4])))
    print("selftest OK — %s" % res["pdf"])
    return 0


# ─────────────────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser(
        description="챕터 JSON 에서 교재 PDF 3판을 조판한다 (2-pass 색인).")
    ap.add_argument("--book", choices=sorted(BOOK_LABEL),
                    help="어느 권을 조판할지. --chapter 를 쓰면 생략해도 된다")
    ap.add_argument("--chapter", metavar="SLUG", help="한 챕터만 (예: reading-03)")
    ap.add_argument("--edition", default="student",
                    choices=sorted(set(list(EDITION_ALIASES) + ["all"])),
                    help="student · answer-key · teacher · all")
    ap.add_argument("--chapters", default=str(DEFAULT_CHAPTERS),
                    help="챕터 JSON 폴더 (기본: config/_book)")
    ap.add_argument("--out", default=None, help="산출물 폴더 (기본: dist/books)")
    ap.add_argument("--chrome", help="헤드리스 크롬 실행 파일 경로")
    ap.add_argument("--keep-html", action="store_true",
                    help="중간 HTML(pass1/pass2)을 산출물 폴더에 남긴다")
    ap.add_argument("--allow-stop", action="store_true",
                    help="stop 게이트가 있어도 인쇄한다 (검토용. 학생 배포 금지)")
    ap.add_argument("--selftest", action="store_true",
                    help="합성 1챕터로 전 구간을 돌려 본다")
    args = ap.parse_args()
    args.out_given = args.out is not None
    if args.out is None:
        args.out = "dist/books"

    try:
        if args.selftest:
            return run_selftest(args)
        if not args.book and not args.chapter:
            ap.error("--book 또는 --chapter 중 하나는 있어야 한다")
        return run_build(args)
    except BuildError as e:
        print("✗ " + str(e), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
