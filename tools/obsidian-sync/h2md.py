#!/usr/bin/env python3
"""인포그래픽 HTML -> 옵시디언 마크다운 변환기 (표준 라이브러리만)"""
import html
import re
from html.parser import HTMLParser

SKIP = {"script", "style", "svg", "noscript", "head", "meta", "link", "title",
        "canvas", "iframe", "path", "circle", "rect", "line", "polygon", "g", "defs"}
INLINE = {"a", "strong", "b", "em", "i", "code", "span", "small", "sup", "sub",
          "u", "mark", "abbr", "time", "label", "kbd", "s", "del", "ins", "var"}
HEADS = {"h1": 1, "h2": 2, "h3": 3, "h4": 4, "h5": 5, "h6": 6}
LIST_T = {"ul", "ol"}
EMPH_CLS = re.compile(r"title|head|label|name|term|caption|legend|badge|tag|step|"
                      r"num|kicker|eyebrow|key|metric|value|stat", re.I)
ICON_CLS = re.compile(r"\bicon\b|emoji|decor|sr-only|visually-hidden", re.I)


class Node:
    __slots__ = ("tag", "cls", "attrs", "kids", "text")

    def __init__(self, tag, attrs=None):
        self.tag = tag
        self.attrs = dict(attrs or [])
        self.cls = self.attrs.get("class", "") or ""
        self.kids = []
        self.text = None


class Tree(HTMLParser):
    VOID = {"br", "hr", "img", "input", "meta", "link", "source", "col"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node("root")
        self.stack = [self.root]
        self.skip_depth = 0

    def handle_starttag(self, tag, attrs):
        if self.skip_depth:
            if tag not in self.VOID:
                self.skip_depth += 1
            return
        if tag in SKIP:
            if tag not in self.VOID:
                self.skip_depth = 1
            return
        n = Node(tag, attrs)
        self.stack[-1].kids.append(n)
        if tag not in self.VOID:
            self.stack.append(n)

    def handle_endtag(self, tag):
        if self.skip_depth:
            self.skip_depth -= 1
            return
        if tag in self.VOID or tag in SKIP:
            return
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                del self.stack[i:]
                return

    def handle_data(self, data):
        if self.skip_depth or not data.strip():
            return
        n = Node("#text")
        n.text = data
        self.stack[-1].kids.append(n)


def esc(s):
    return re.sub(r"([\\`*_\[\]|])", r"\\\1", s)


def inline(node, top=True):
    """인라인 마크다운 문자열"""
    if node.tag == "#text":
        return esc(re.sub(r"\s+", " ", node.text))
    if node.tag == "br":
        return "\n"
    if ICON_CLS.search(node.cls):
        return ""
    inner = join_inline(node.kids)
    t = node.tag
    if not inner.strip():
        return ""
    if t in ("strong", "b"):
        return "**%s**" % inner.strip()
    if t in ("em", "i"):
        return "*%s*" % inner.strip()
    if t == "code" or t == "kbd":
        return "`%s`" % inner.strip().replace("`", "")
    if t in ("del", "s"):
        return "~~%s~~" % inner.strip()
    if t == "a":
        href = node.attrs.get("href", "")
        if href and not href.startswith("#"):
            return "[%s](%s)" % (inner.strip(), href)
        return inner
    return inner


def join_inline(kids):
    """인접한 형제 '요소'끼리는 공백으로 띄운다 — 배지·칩이 붙어버리는 것 방지"""
    parts = []
    prev_elem = False
    for k in kids:
        s = inline(k, False)
        if not s:
            continue
        is_elem = k.tag != "#text"
        if parts and is_elem and prev_elem and not s.startswith("\n") \
                and not parts[-1].endswith(("\n", " ")):
            parts.append(" ")
        parts.append(s)
        prev_elem = is_elem
    return "".join(parts)


def is_inline_only(node):
    for k in node.kids:
        if k.tag == "#text" or k.tag in INLINE or k.tag in ("br", "img"):
            continue
        return False
    return True


def collapse(s):
    s = re.sub(r"[ \t]+", " ", s)
    return s.strip()


def cell_text(td):
    parts = []
    for k in td.kids:
        if k.tag == "#text" or k.tag in INLINE or k.tag == "br":
            parts.append(inline(k))
        else:
            parts.append(" ".join(flat_text(k)))
    return collapse(" ".join(parts)).replace("\n", " ").replace("|", "\\|")


def flat_text(node):
    out = []
    if node.tag == "#text":
        return [esc(re.sub(r"\s+", " ", node.text))]
    if ICON_CLS.search(node.cls):
        return []
    if node.tag in INLINE:
        return [inline(node)]
    for k in node.kids:
        out += flat_text(k)
    return out


def render_table(node, out):
    rows = []
    def walk(n):
        if n.tag == "tr":
            cells = [(k.tag, cell_text(k)) for k in n.kids if k.tag in ("td", "th")]
            if cells:
                rows.append(cells)
            return
        for k in n.kids:
            walk(k)
    walk(node)
    if not rows:
        return
    width = max(len(r) for r in rows)
    header = rows[0]
    body = rows[1:]
    if not all(t == "th" for t, _ in header) and len(rows) > 1:
        # th 헤더가 없으면 첫 줄을 헤더로 쓰되 그대로 둔다
        pass
    def fmt(cells):
        vals = [v for _, v in cells] + [""] * (width - len(cells))
        return "| " + " | ".join(v or " " for v in vals) + " |"
    out.append(fmt(header))
    out.append("| " + " | ".join(["---"] * width) + " |")
    for r in body:
        out.append(fmt(r))
    out.append("")


def render_list(node, out, depth=0):
    ordered = node.tag == "ol"
    idx = 1
    for li in node.kids:
        if li.tag != "li":
            continue
        head = []
        nested = []
        for k in li.kids:
            if k.tag in LIST_T:
                nested.append(k)
            elif k.tag == "#text" or k.tag in INLINE or k.tag == "br":
                head.append(inline(k))
            else:
                head.append(" ".join(flat_text(k)))
        text = collapse(" ".join(head)).replace("\n", " ")
        if text:
            bullet = "%d." % idx if ordered else "-"
            out.append("%s%s %s" % ("    " * depth, bullet, text))
            idx += 1
        for n in nested:
            render_list(n, out, depth + 1)
    if depth == 0:
        out.append("")


def render(node, out, hshift=0):
    t = node.tag

    if t == "#text":
        s = collapse(esc(re.sub(r"\s+", " ", node.text)))
        if s:
            out.append(s)
            out.append("")
        return

    if t in ("br", "img", "input"):
        return

    if ICON_CLS.search(node.cls):
        return

    if t == "hr":
        out.append("---")
        out.append("")
        return

    if t in HEADS:
        s = collapse(join_inline(node.kids)).replace("\n", " ")
        if s:
            lvl = min(6, HEADS[t] + hshift)
            out.append("")
            out.append("#" * lvl + " " + s)
            out.append("")
        return

    if t == "table":
        out.append("")
        render_table(node, out)
        return

    if t in LIST_T:
        render_list(node, out)
        return

    if t == "pre":
        code = "".join(flat_text_raw(node))
        out.append("```")
        out.append(code.strip("\n"))
        out.append("```")
        out.append("")
        return

    if t == "blockquote":
        sub = []
        for k in node.kids:
            render(k, sub, hshift)
        for line in [x for x in sub if x.strip()]:
            out.append("> " + line)
        out.append("")
        return

    if t in ("dl",):
        for k in node.kids:
            if k.tag == "dt":
                s = collapse(" ".join(flat_text(k)))
                if s:
                    out.append("- **%s**" % s)
            elif k.tag == "dd":
                s = collapse(" ".join(flat_text(k)))
                if s:
                    out.append("    - %s" % s)
        out.append("")
        return

    # 인라인 내용만 담긴 블록 -> 한 문단
    if is_inline_only(node) and node.kids:
        s = collapse(join_inline(node.kids))
        if not s:
            return
        lines = [collapse(x) for x in s.split("\n")]
        s = "\n".join(x for x in lines if x)
        if not s:
            return
        # 짧고 title/label 계열 클래스면 굵게
        if EMPH_CLS.search(node.cls) and len(s) <= 90 and "\n" not in s \
                and not s.startswith("**"):
            s = "**%s**" % s
        out.append(s)
        out.append("")
        return

    for k in node.kids:
        render(k, out, hshift)


def flat_text_raw(node):
    if node.tag == "#text":
        return [node.text]
    out = []
    for k in node.kids:
        out += flat_text_raw(k)
    return out


def convert(path, hshift=1):
    src = open(path, encoding="utf-8", errors="ignore").read()
    p = Tree()
    p.feed(src)
    out = []
    render(p.root, out, hshift)
    # 빈 줄 정리
    md = "\n".join(out)
    md = re.sub(r"\n{3,}", "\n\n", md)
    md = re.sub(r"[ \t]+\n", "\n", md)
    return md.strip() + "\n"


if __name__ == "__main__":
    import sys
    print(convert(sys.argv[1]))
