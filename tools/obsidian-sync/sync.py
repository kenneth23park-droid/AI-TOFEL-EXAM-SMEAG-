#!/usr/bin/env python3
"""
인포그래픽 아티팩트 -> 옵시디언 볼트 동기화

세션 작업폴더(scratchpad)에 새로 생긴 인포그래픽 HTML 을 찾아
옵시디언 볼트의 `SMEAG 인포그래픽/` 폴더에 노트로 만든다.

노트 하나에 세 가지가 들어간다.
  1. 마크다운으로 변환한 본문      (검색·백링크·그래프뷰에 잡힘)
  2. 전체 페이지 캡처 PNG          (원본 디자인 그대로 보기)
  3. 인터랙티브 HTML 원본 링크     (클릭하면 브라우저에서 열림)

이미 처리한 파일은 건너뛴다. 원본이 수정되면 다시 만든다.

    python3 tools/obsidian-sync/sync.py            # 새로 생긴 것만
    python3 tools/obsidian-sync/sync.py --all      # 전부 다시 생성
    python3 tools/obsidian-sync/sync.py --quiet    # 훅에서 호출용
"""
import html
import json
import os
import re
import shutil
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import h2md  # noqa: E402

SCRATCH_ROOT = "/private/tmp/claude-501/-Users-kwangseobpark-smeag-TOFEL---"
VAULT = "/Users/kwangseobpark/Documents/Obsidian Vault"
DEST = os.path.join(VAULT, "SMEAG 인포그래픽")
ASSETS = os.path.join(DEST, "_assets")
STATE = os.path.join(ASSETS, ".sync-state.json")
URLMAP = os.path.join(DEST, "_artifact-urls.json")
TMPDIR = os.path.join(ASSETS, ".sync-tmp")
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

MIN_SIZE = 8000
# 브라우저 프로필·의존성 폴더 등 잡음 경로
NOISE = re.compile(
    r"/(chrome[^/]*|prof\w*|p[0-9a-f]|c[0-9]|p[a-e]|Extensions|WasmTtsEngine|"
    r"node_modules|site-packages|wt-head|\.venv[^/]*|\.sync-tmp|dist|build)/")
# 아티팩트는 자체 완결형이라 외부 script src 도 form 도 없다. 앱 화면 캡처와 갈리는 지점.
HAS_SCRIPT_SRC = re.compile(r"<script[^>]+\bsrc=", re.I)
HAS_FORM = re.compile(r"<(form|input)\b", re.I)
# 작업 중 남은 임시·검사용 파일 (원본으로 오인하면 source 표기가 틀어진다)
TEMP_NAME = re.compile(r"^(probe|shot|frame|dump|pex|tmp|test)[-_0-9]*\.html$", re.I)
BAD_CHARS = r'[\\/:*?"<>|#^\[\]]'


def log(msg, quiet=False):
    if not quiet:
        print(msg)


def slugify(title):
    s = re.sub(BAD_CHARS, "", title).replace("\n", " ").strip()
    return re.sub(r"\s+", " ", s)[:80]


def read_title(path):
    s = open(path, encoding="utf-8", errors="ignore").read(200000)
    m = re.search(r"<title[^>]*>(.*?)</title>", s, re.S | re.I)
    return html.unescape(m.group(1)).strip() if m else ""


def is_infographic(path, body):
    if HAS_SCRIPT_SRC.search(body):
        return False
    if HAS_FORM.search(body):
        return False
    return True


def discover():
    """제목별로 가장 큰(=가장 완성된) 인포그래픽 하나씩"""
    best = {}
    for root, dirs, files in os.walk(SCRATCH_ROOT):
        dirs[:] = [d for d in dirs if not NOISE.search("/%s/" % d)]
        if "/scratchpad" not in root:
            continue
        for f in files:
            if not f.endswith(".html") or TEMP_NAME.match(f):
                continue
            p = os.path.join(root, f)
            if NOISE.search(p):
                continue
            try:
                size = os.path.getsize(p)
            except OSError:
                continue
            if size < MIN_SIZE:
                continue
            body = open(p, encoding="utf-8", errors="ignore").read()
            if not is_infographic(p, body):
                continue
            m = re.search(r"<title[^>]*>(.*?)</title>", body, re.S | re.I)
            if not m:
                continue
            title = html.unescape(m.group(1)).strip()
            if not title or len(title) < 4:
                continue
            cur = best.get(title)
            if cur is None or size > cur[1]:
                best[title] = (p, size, os.path.getmtime(p))
    return best


def probe_height(src):
    os.makedirs(TMPDIR, exist_ok=True)
    probe = os.path.join(TMPDIR, "probe.html")
    shutil.copyfile(src, probe)
    with open(probe, "a", encoding="utf-8") as f:
        f.write('<script>window.addEventListener("load",function(){setTimeout('
                'function(){document.title="H="+document.documentElement.scrollHeight}'
                ',400)})</script>')
    try:
        out = subprocess.run(
            [CHROME, "--headless=old", "--disable-gpu", "--hide-scrollbars",
             "--virtual-time-budget=5000", "--window-size=1200,900", "--dump-dom",
             "file://" + probe],
            capture_output=True, text=True, timeout=90).stdout
    except subprocess.TimeoutExpired:
        return 2400
    m = re.search(r"<title>H=(\d+)</title>", out)
    return int(m.group(1)) if m else 2400


def screenshot(src, out_png, height):
    h = max(600, min(height + 40, 12000))
    try:
        subprocess.run(
            [CHROME, "--headless=old", "--disable-gpu", "--hide-scrollbars",
             "--virtual-time-budget=5000", "--force-device-scale-factor=1",
             "--window-size=1200,%d" % h, "--screenshot=" + out_png, "file://" + src],
            capture_output=True, timeout=150)
    except subprocess.TimeoutExpired:
        return False
    return os.path.exists(out_png)


def write_note(title, slug, src_name, url, has_png, body_md):
    fm = ["---", "tags: [smeag/인포그래픽]", 'source: "%s"' % src_name]
    if url:
        fm.append('artifact: "%s"' % url)
    fm += ["---", ""]

    head = [
        "# %s" % title,
        "",
        "- 📄 [[%s.html|인터랙티브 원본 열기]]" % slug,
    ]
    if url:
        head.append("- 🌐 [발행된 아티팩트](%s)" % url)
    head += ["- 🗂 [[SMEAG 인포그래픽 색인]]", ""]

    # 콜아웃 안에서는 빈 줄도 '>' 로 이어야 접기가 깨지지 않는다
    preview = ["> [!abstract]- 원본 화면 미리보기 (클릭해서 펼치기)", ">"]
    if has_png:
        preview += ["> ![[%s.png]]" % slug, ""]
    else:
        preview += ["> *(캡처 실패 — 원본 HTML 을 열어 확인하세요)*", ""]

    body = ["---", "", body_md.strip(), "", "---", "", "## 메모", "", "", ""]
    open(os.path.join(DEST, slug + ".md"), "w", encoding="utf-8").write(
        "\n".join(fm + head + preview + body))


def build_index(entries, urls):
    entries = sorted(entries, key=lambda e: -e["mtime"])
    L = ["---", "tags: [smeag/인포그래픽, MOC]", "---", "",
         "# SMEAG 인포그래픽 색인", "",
         "StudyGround 작업에서 만든 인포그래픽 아티팩트 모음. 각 노트에는 "
         "**마크다운 본문** · **원본 화면 캡처** · **인터랙티브 HTML 링크** 가 함께 들어 있습니다.", "",
         "새 아티팩트는 `tools/obsidian-sync/sync.py` 가 자동으로 추가합니다.", "",
         "## 인포그래픽 (%d)" % len(entries), "",
         "| 제목 | 원본 파일 | 아티팩트 |", "| --- | --- | --- |"]
    for e in entries:
        link = "[열기](%s)" % e["url"] if e["url"] else "—"
        L.append("| [[%s]] | `%s` | %s |" % (e["slug"], e["src_name"], link))
    extra = urls.get("_link_only", [])
    if extra:
        L += ["", "## 링크만 있는 아티팩트", "",
              "로컬 원본 HTML 이 남아 있지 않아 웹 링크만 보관합니다.", ""]
        for item in extra:
            L.append("- [%s](%s)" % (item["title"], item["url"]))
    L += ["", "---", "", "## 쓰는 법", "",
          "- **본문**: 마크다운이라 검색·태그·백링크가 다 걸립니다.",
          "- **미리보기**: 콜아웃을 펼치면 원본 화면 전체 캡처가 보입니다.",
          "- **인터랙티브**: `인터랙티브 원본 열기` 를 누르면 기본 브라우저에서 실제 아티팩트가 뜹니다.",
          "- **파일 위치**: `SMEAG 인포그래픽/_assets/` (HTML + PNG)", ""]
    open(os.path.join(DEST, "SMEAG 인포그래픽 색인.md"), "w",
         encoding="utf-8").write("\n".join(L))


def main():
    force = "--all" in sys.argv
    quiet = "--quiet" in sys.argv

    os.makedirs(ASSETS, exist_ok=True)
    state = {}
    if os.path.exists(STATE) and not force:
        try:
            state = json.load(open(STATE, encoding="utf-8"))
        except ValueError:
            state = {}
    urls = {}
    if os.path.exists(URLMAP):
        try:
            urls = json.load(open(URLMAP, encoding="utf-8"))
        except ValueError:
            urls = {}

    found = discover()
    entries, changed = [], 0

    for title, (src, size, mtime) in found.items():
        slug = slugify(title)
        src_name = os.path.basename(src)
        url = urls.get(title)
        prev = state.get(title)
        note = os.path.join(DEST, slug + ".md")
        fresh = (prev and os.path.exists(note)
                 and prev.get("size") == size and abs(prev.get("mtime", 0) - mtime) < 1)

        if fresh:
            entries.append(dict(slug=slug, src_name=prev.get("src_name", src_name),
                                url=url, mtime=mtime))
            continue

        shutil.copyfile(src, os.path.join(ASSETS, slug + ".html"))
        h = probe_height(src)
        png_ok = screenshot(src, os.path.join(ASSETS, slug + ".png"), h)
        try:
            body_md = h2md.convert(src, hshift=1)
        except Exception as e:                      # 변환 실패해도 노트는 남긴다
            body_md = "*(마크다운 변환 실패: %s — 원본 HTML 을 확인하세요)*" % e
        write_note(title, slug, src_name, url, png_ok, body_md)
        state[title] = dict(src=src, src_name=src_name, size=size, mtime=mtime,
                            slug=slug, synced=time.strftime("%Y-%m-%d %H:%M"))
        entries.append(dict(slug=slug, src_name=src_name, url=url, mtime=mtime))
        changed += 1
        log("  + %s" % title, quiet)

    # 볼트에서 사라진 원본은 상태에서만 정리 (노트는 손대지 않는다)
    for title in list(state):
        if title not in found:
            state.pop(title)

    build_index(entries, urls)
    json.dump(state, open(STATE, "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    shutil.rmtree(TMPDIR, ignore_errors=True)

    if changed or not quiet:
        log("옵시디언 동기화: 노트 %d개 (새로 만든 것 %d개) → %s"
            % (len(entries), changed, DEST), quiet and not changed)


if __name__ == "__main__":
    main()
