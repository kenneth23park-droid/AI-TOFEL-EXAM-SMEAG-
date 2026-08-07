#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
extract_set9_reading.py — NEW TOEFL MOCK TEST SET 9 의 Reading 섹션을
sg2 콘텐츠 팩 스키마(studyground/sg2/assets/set1.js 정본)의 sections[] 원소 하나로 추출한다.

산출:
  studyground/sg2/config/_set9_fragments/reading.json
  studyground/sg2/media/pictures/set9/*.png        (문항문서 word/media 20개)
  studyground/sg2/media/pictures/set9/mapping.json (이미지 → 앵커 근거)

원본(읽기 전용):
  NEW TOEFL MOCK TEST SET  9.docx
  SET 9 ANSWER KEY.docx

표준 라이브러리만 사용한다(zipfile/re/json/os/sys). 신규 의존성 없음.

실행:
  studyground/.venv/bin/python studyground/tools/extract_set9_reading.py
  studyground/.venv/bin/python studyground/tools/extract_set9_reading.py --verify
"""

import json
import os
import re
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
STUDYGROUND = os.path.dirname(HERE)
ROOT = os.path.dirname(STUDYGROUND)

DOC_Q = os.path.join(ROOT, 'NEW TOEFL MOCK TEST SET  9.docx')
DOC_K = os.path.join(ROOT, 'SET 9 ANSWER KEY.docx')

OUT_JSON = os.path.join(STUDYGROUND, 'sg2', 'config', '_set9_fragments', 'reading.json')
OUT_PICS = os.path.join(STUDYGROUND, 'sg2', 'media', 'pictures', 'set9')

WARNINGS = []


def warn(msg):
    WARNINGS.append(msg)


# ───────────────────────────── docx 파싱 ─────────────────────────────
# python-docx 를 쓰지 않고 word/document.xml 을 직접 훑는다.
# 주의점 3가지 (실제로 이 문서에서 전부 발생한다):
#   1) 텍스트박스(v:textbox / w:txbxContent) 안에 w:p 가 중첩된다 → 단순 non-greedy
#      정규식은 문단 경계를 잘못 자른다. 깊이를 세어야 한다.
#   2) mc:AlternateContent 의 mc:Fallback 은 mc:Choice 의 복제본이다 → 버리지 않으면
#      모든 지문이 두 번 나온다.
#   3) '<w:tab/>' 이 '<w:t[^>]*>' 에 매칭된다 → w:t 태그 정규식은 '<w:t(?:\s[^>]*)?>' 여야 한다.

_ENT = [('&lt;', '<'), ('&gt;', '>'), ('&quot;', '"'), ('&apos;', "'"), ('&amp;', '&')]


def _unescape(s):
    for a, b in _ENT:
        s = s.replace(a, b)
    return s


def _drop_subtree(xml, tag):
    """<tag>...</tag> 서브트리를 깊이 계산으로 통째 제거."""
    out, i = [], 0
    open_re = re.compile(r'</?' + re.escape(tag) + r'(?:[\s>]|/>)')
    while True:
        j = xml.find('<' + tag + '>', i)
        if j < 0:
            j = xml.find('<' + tag + ' ', i)
        if j < 0:
            out.append(xml[i:])
            break
        out.append(xml[i:j])
        depth, k = 0, j
        while True:
            m = open_re.search(xml, k)
            if not m:
                k = len(xml)
                break
            depth += -1 if xml[m.start():m.start() + 2] == '</' else 1
            k = xml.find('>', m.start()) + 1
            if depth == 0:
                break
        i = k
    return ''.join(out)


def _spans(xml, tag):
    """중첩을 허용하는 <tag> 열림/닫힘 쌍의 (start_of_open, end_of_close) 목록."""
    tok = re.compile(r'<' + re.escape(tag) + r'(?:\s[^>]*)?/>'
                     r'|<' + re.escape(tag) + r'(?:\s[^>]*)?>'
                     r'|</' + re.escape(tag) + r'>')
    stack, out = [], []
    for m in tok.finditer(xml):
        s = m.group(0)
        if s.endswith('/>'):
            out.append((m.start(), m.end()))
        elif s.startswith('</'):
            if stack:
                out.append((stack.pop(), m.end()))
        else:
            stack.append(m.start())
    out.sort()
    return out


def _runs_text(seg):
    """세그먼트에서 w:t 텍스트를 뽑는다(중첩 w:p 는 호출자가 이미 제거)."""
    seg = seg.replace('<w:tab/>', '\t').replace('<w:br/>', '\n')
    parts = re.findall(r'<w:t(?:\s[^>]*)?>(.*?)</w:t>', seg, re.S)
    return _unescape(''.join(parts))


def _norm(s):
    s = s.replace('\t', ' ').replace('\xa0', ' ')
    s = re.sub(r'[ ]{2,}', ' ', s)
    return s.strip()


def read_docx(path):
    """(paragraphs, rels) 반환. paragraphs = [{'text':.., 'images':[..], 'kind':'p'|'row'}]"""
    z = zipfile.ZipFile(path)
    xml = z.read('word/document.xml').decode('utf-8')
    rels = {}
    if 'word/_rels/document.xml.rels' in z.namelist():
        rx = z.read('word/_rels/document.xml.rels').decode('utf-8')
        for m in re.finditer(r'Id="([^"]+)"[^>]*Target="([^"]+)"', rx):
            rels[m.group(1)] = m.group(2)
    z.close()

    xml = _drop_subtree(xml, 'mc:Fallback')
    body = xml.find('<w:body>')
    xml = xml[body:] if body >= 0 else xml

    # 표: 행 단위 pseudo-paragraph 로 접는다(스키마에 table 필드가 없다).
    tbl_spans = [s for s in _spans(xml, 'w:tbl')]
    top_tbl = []
    for a, b in tbl_spans:
        if not any(a2 < a and b <= b2 for a2, b2 in top_tbl):
            top_tbl.append((a, b))
    top_tbl = [t for t in top_tbl if not any(t is not u and u[0] < t[0] and t[1] <= u[1] for u in top_tbl)]

    def in_table(pos):
        return any(a <= pos < b for a, b in top_tbl)

    items = []  # (sort_key, dict)
    for a, b in _spans(xml, 'w:p'):
        if in_table(a):
            continue
        seg = xml[a:b]
        inner = _spans(seg, 'w:p')
        own = seg
        for ia, ib in sorted(inner, reverse=True):
            if ia == 0:
                continue
            own = own[:ia] + own[ib:]
        txt = _norm(_runs_text(own))
        imgs = [rels.get(e, e) for e in re.findall(r'r:embed="([^"]+)"', own)]
        if txt or imgs:
            items.append((a, {'text': txt, 'images': imgs, 'kind': 'p'}))

    for a, b in top_tbl:
        seg = xml[a:b]
        for ra, rb in _spans(seg, 'w:tr'):
            row = seg[ra:rb]
            cells = []
            for ca, cb in _spans(row, 'w:tc'):
                cells.append(_norm(_runs_text(row[ca:cb])))
            cells = [c for c in cells if c]
            if cells:
                items.append((a + ra, {'text': ' | '.join(cells), 'images': [], 'kind': 'row'}))

    items.sort(key=lambda t: t[0])
    return [d for _, d in items], rels


# ───────────────────────────── 정답키 ─────────────────────────────

LETTER = {'A': 0, 'B': 1, 'C': 2, 'D': 3}


def parse_answer_key():
    paras, _ = read_docx(DOC_K)
    txt = [p['text'] for p in paras]

    def idx(pred, start=0):
        for i in range(start, len(txt)):
            if pred(txt[i]):
                return i
        return -1

    i_read = idx(lambda t: t.upper() == 'READING')
    i_listen = idx(lambda t: t.upper() == 'LISTENING')
    i_m1 = idx(lambda t: t.lower() == 'module 1', i_read)
    i_m2 = idx(lambda t: t.lower() == 'module 2', i_m1 + 1)
    assert 0 <= i_read < i_m1 < i_m2 < i_listen, 'answer key: READING/Module markers not found'

    def collect(a, b):
        out = []
        for t in txt[a:b]:
            if not t:
                continue
            out.append(t)
        return out

    m1 = collect(i_m1 + 1, i_m2)
    m2 = collect(i_m2 + 1, i_listen)
    assert len(m1) == 35, 'answer key READING Module 1 = %d (expected 35)' % len(m1)
    assert len(m2) == 15, 'answer key READING Module 2 = %d (expected 15)' % len(m2)
    return m1, m2


# ───────────────────────────── cloze ─────────────────────────────

# 원본 표기: "1 popul_ _ _ _ _ _", "5 a_ _", "8 T_ _"
BLANK_RE = re.compile(r'(?<![\w])(\d{1,2})\s+([A-Za-z]+)((?:\s*_)+)')


def parse_cloze(raw, first_no):
    """지문 원문 → (template, [{'localNo','hint','underscores','wordLen'}...])"""
    blanks = []
    out, pos = [], 0
    for m in BLANK_RE.finditer(raw):
        local = int(m.group(1))
        hint = m.group(2)
        unders = m.group(3).count('_')
        out.append(raw[pos:m.start()])
        out.append('{{%d}}' % (first_no + local - 1))
        pos = m.end()
        blanks.append({'localNo': local, 'hint': hint, 'underscores': unders,
                       'wordLen': len(hint) + unders})
    out.append(raw[pos:])
    template = _norm(''.join(out))
    # 번호가 1..N 연속인지
    nos = [b['localNo'] for b in blanks]
    assert nos == list(range(1, len(nos) + 1)), 'cloze blank numbering not 1..N: %r' % nos
    return template, blanks


# ───────────────────────────── MCQ ─────────────────────────────

QNUM_RE = re.compile(r'^(\d{1,2})\.\s*(.+)$')
CHOICE_PREFIX_RE = re.compile(r'^([A-D])\.\s*')
# insert 문항의 삽입 문장은 선택지가 아니다 — 선택지 수집에서 제외한다.
INSERT_SENT_RE = re.compile(r'^Sentence to insert\s*:', re.I)


def parse_mcqs(paras, lo, hi):
    """[lo,hi) 구간에서 'NN. prompt' + 뒤따르는 4개 선택지를 뽑는다."""
    out = []
    i = lo
    while i < hi:
        t = paras[i]['text']
        m = QNUM_RE.match(t)
        if not m:
            i += 1
            continue
        no = int(m.group(1))
        prompt = m.group(2).strip()
        j, choices = i + 1, []
        while j < hi and len(choices) < 4:
            c = paras[j]['text']
            if not c:
                j += 1
                continue
            if QNUM_RE.match(c):
                break
            if INSERT_SENT_RE.match(c):
                j += 1
                continue
            choices.append(CHOICE_PREFIX_RE.sub('', c).strip())
            j += 1
        out.append({'no': no, 'prompt': prompt, 'choices': choices, 'endIdx': j})
        i = j
    return out


# ───────────────────────────── 본체 ─────────────────────────────

def find(texts, needle, start=0, exact=True):
    for i in range(start, len(texts)):
        t = texts[i]
        if (t == needle) if exact else (needle in t):
            return i
    raise AssertionError('anchor not found: %r (from %d)' % (needle, start))


def build():
    paras, rels = read_docx(DOC_Q)
    texts = [p['text'] for p in paras]
    key_m1, key_m2 = parse_answer_key()

    i_r_m1 = find(texts, 'Module 1')
    i_listen = find(texts, 'LISTENING SECTION')
    i_r_m2 = find(texts, 'Module 2', i_r_m1 + 1)
    assert i_r_m1 < i_r_m2 < i_listen

    # ── 블록 경계(앵커 기반) ───────────────────────────────────
    a_web = find(texts, 'Read in Daily Life (Webpage)', i_r_m1)
    a_mail = find(texts, 'Read in Daily Life (Email)', a_web)
    a_not1 = find(texts, 'Read in Daily Life (Notice)', a_mail)
    a_not2 = find(texts, 'Read in Daily Life (Notice)', a_not1 + 1)
    a_acad1 = find(texts, 'Academic Passage', a_not2)
    a_acad2 = find(texts, 'Academic Passage', i_r_m2)

    # ── cloze 원문 ─────────────────────────────────────────────
    cloze_src = [i for i in range(i_r_m1, i_listen) if BLANK_RE.search(texts[i])
                 and len(BLANK_RE.findall(texts[i])) >= 8]
    assert len(cloze_src) == 3, 'expected 3 cloze passages in reading, got %d' % len(cloze_src)
    c1, c2, c3 = cloze_src
    assert c1 < c2 < i_r_m2 < c3

    def cloze_block(src_idx, first_no, key_words, key_off, mod):
        template, blanks = parse_cloze(texts[src_idx], first_no)
        qs = []
        for b in blanks:
            gno = first_no + b['localNo'] - 1
            ans = key_words[key_off + b['localNo'] - 1]
            q = {
                'id': '%s-%d' % (mod, gno),
                'kind': 'blank',
                'no': gno,
                'hint': b['hint'],
                'answer': ans
            }
            # 힌트 글자수 + 밑줄 개수 = 정답 길이 검산
            if len(ans) != b['wordLen']:
                fixed = None
                if b['wordLen'] == 4 and b['hint'] == 'th':
                    fixed = 'that'
                if fixed:
                    warn('ANSWER KEY MISMATCH %s-%d: key word %r does not fit the blank '
                         '"%s%s" (hint %r + %d underscores = %d letters). Used %r, which is the '
                         'only reading that fits both the length pattern and the sentence '
                         '("challenges __ require balancing"). Original key value kept in '
                         'answerKeyRaw. NEEDS HUMAN CONFIRMATION.'
                         % (mod, gno, ans, b['hint'], '_' * b['underscores'],
                            b['hint'], b['underscores'], b['wordLen'], fixed))
                    q['answerKeyRaw'] = ans
                    q['answer'] = fixed
                else:
                    warn('ANSWER KEY LENGTH MISMATCH %s-%d: key %r vs blank length %d'
                         % (mod, gno, ans, b['wordLen']))
            qs.append(q)
        return {
            'kind': 'cloze',
            'heading': 'Questions %d-%d' % (first_no, first_no + len(qs) - 1),
            'instruction': 'Fill in the blank.',
            'template': template,
            'questions': qs
        }

    def body_paragraphs(a, b, drop=()):
        out = []
        for i in range(a, b):
            t = texts[i]
            if not t:
                continue
            if t in drop:
                continue
            if re.match(r'^Questions?\s+\d+\s*-\s*\d+$', t):
                continue
            if QNUM_RE.match(t):
                break
            out.append(t)
        return out

    def mcq_block(anchor, stop, mod, key_letters, key_off, instruction, expect):
        lines = body_paragraphs(anchor + 1, stop)
        assert lines, 'no passage body after anchor %d' % anchor
        # 제목 고르기: URL 줄(www...)이나 메일 헤더(To:/From:)는 제목이 아니다.
        # 이메일은 Subject: 줄을, 웹페이지는 URL 다음의 헤딩 줄을 제목으로 쓴다.
        ti = 0
        for k, ln in enumerate(lines):
            if ln.lower().startswith('subject:'):
                ti = k
                break
            if re.match(r'^(www\.|https?://)', ln, re.I) or re.match(r'^(to|from)\s*:', ln, re.I):
                continue
            ti = k
            break
        title = lines[ti]
        rest = lines[:ti] + lines[ti + 1:]
        mcqs = parse_mcqs(paras, anchor + 1, stop)
        assert [m['no'] for m in mcqs] == expect, \
            'block at %d: question numbers %r != expected %r' % (anchor, [m['no'] for m in mcqs], expect)
        qs = []
        for n, m in enumerate(mcqs):
            assert len(m['choices']) == 4, 'Q%d has %d choices' % (m['no'], len(m['choices']))
            lab = key_letters[key_off + n]
            if lab.rstrip('.').upper() in LETTER:
                ai = LETTER[lab.rstrip('.').upper()]
            else:
                # 단어형으로 적힌 정답(예: Reading M2 Q11 = "lessening") → 선택지에서 찾는다
                hit = [k for k, c in enumerate(m['choices']) if c.strip().lower() == lab.strip().lower()]
                assert len(hit) == 1, 'key %r for Q%d not resolvable in choices %r' % (lab, m['no'], m['choices'])
                ai = hit[0]
                warn('answer key entry for %s-%d is the word %r (not a letter); resolved to '
                     'choice index %d.' % (mod, m['no'], lab, ai))
            q = {'id': '%s-%d' % (mod, m['no']), 'kind': 'mcq', 'no': m['no'],
                 'prompt': m['prompt'], 'choices': m['choices'], 'answer': ai}
            qs.append(q)
        return {
            'kind': 'passage',
            'heading': 'Questions %d-%d' % (expect[0], expect[-1]),
            'instruction': instruction,
            'title': title,
            'paragraphs': rest,
            'questions': qs
        }

    # ── R1 ────────────────────────────────────────────────────
    b1 = cloze_block(c1, 1, key_m1, 0, 'R1')
    b2 = cloze_block(c2, 11, key_m1, 10, 'R1')
    b3 = mcq_block(a_web, a_mail, 'R1', key_m1, 20, 'Read a webpage.', [21, 22])
    b4 = mcq_block(a_mail, a_not1, 'R1', key_m1, 22, 'Read an email.', [23, 24])
    b5 = mcq_block(a_not1, a_not2, 'R1', key_m1, 24, 'Read a notice.', [25, 26, 27])
    b6 = mcq_block(a_not2, a_acad1, 'R1', key_m1, 27, 'Read a notice.', [28, 29, 30])
    b7 = mcq_block(a_acad1, i_r_m2, 'R1', key_m1, 30, 'Read a passage.', [31, 32, 33, 34, 35])

    # ── R2 ────────────────────────────────────────────────────
    b8 = cloze_block(c3, 1, key_m2, 0, 'R2')
    b9 = mcq_block(a_acad2, i_listen, 'R2', key_m2, 10, 'Read a passage.', [11, 12, 13, 14, 15])

    # Q15 는 insert 문항 — 지문에 A/B/C/D 마커가 있어야 하지만 원본에 없다.
    q15 = b9['questions'][-1]
    if 'four letters' in q15['prompt'] or 'could be added' in q15['prompt']:
        ins = None
        for t in texts[a_acad2:i_listen]:
            m = re.match(r'^Sentence to insert:\s*[“"](.+)[”"]\s*$', t)
            if m:
                ins = m.group(1).strip()
        assert ins, 'insert sentence not found for R2-15'
        q15['kind'] = 'insert'
        q15['sentence'] = ins
        joined = ' '.join(b9['paragraphs'])
        if '{{A}}' not in joined:
            warn('R2-15 is an insert question, but the source passage "%s" contains NO A/B/C/D '
                 'insertion markers anywhere in the docx (verified by grepping word/document.xml). '
                 'No {{A}}..{{D}} markers were fabricated; the block renders as a plain 4-choice '
                 'question (exam-render-reading.js setInsert() tolerates missing markers). '
                 'NEEDS HUMAN INPUT: the four marker positions must be supplied from the '
                 'authoritative source.' % b9['title'])

    reading = {
        'id': 'reading',
        'label': 'Reading',
        'labelKo': '리딩',
        'timeLimitSec': 35 * 60,
        'modules': [
            {'id': 'R1', 'label': 'Reading Module 1', 'blocks': [b1, b2, b3, b4, b5, b6, b7]},
            {'id': 'R2', 'label': 'Reading Module 2', 'blocks': [b8, b9]}
        ]
    }
    return reading


# ───────────────────────────── 이미지 ─────────────────────────────

# 문항문서 word/media 의 20개는 전부 Listening/Speaking/Writing 삽화다.
# Reading 블록은 이미지를 하나도 참조하지 않는다(문서 전체에서 Reading 구간의
# 문단에 r:embed 가 없음 — 아래 anchor 표가 그 근거다).
IMAGE_NAMES = {
    'image1.png': 'l1-q1-12-speaker-a.png',
    'image2.png': 'l1-q1-12-speaker-b.png',
    'image3.png': 'l1-q1-12-speaker-c.png',
    'image4.png': 'l1-q1-12-speaker-d.png',
    'image5.png': 'l1-q1-12-speaker-e.png',
    'image6.png': 'l2-q4-5-conversation.png',
    'image7.png': 'l2-q6-7-conversation.png',
    'image8.png': 'l2-q8-11-talk.png',
    'image9.png': 'l2-q12-15-talk.png',
    'image10.png': 'w-discussion-01.png',
    'image11.png': 'w-discussion-02.png',
    'image12.png': 'w-discussion-03.png',
    'image13.png': 's-task1-repeat-1.png',
    'image14.png': 's-task1-repeat-2.png',
    'image15.png': 's-task1-repeat-3.png',
    'image16.png': 's-task1-repeat-4.png',
    'image17.png': 's-task1-repeat-5.png',
    'image18.png': 's-task1-repeat-6.png',
    'image19.png': 's-task1-repeat-7.png',
    'image20.png': 's-task2-interview.png',
}


def extract_images():
    paras, _ = read_docx(DOC_Q)
    anchors = {}
    for i, p in enumerate(paras):
        for im in p['images']:
            base = im.split('/')[-1]
            anchors.setdefault(base, []).append({'paraIndex': i, 'nearText': p['text'][:90]})

    if not os.path.isdir(OUT_PICS):
        os.makedirs(OUT_PICS)
    z = zipfile.ZipFile(DOC_Q)
    media = sorted(n for n in z.namelist() if n.startswith('word/media/'))
    written = {}
    for n in media:
        base = n.split('/')[-1]
        name = IMAGE_NAMES.get(base)
        if not name:
            name = base
            warn('no usage-based name for %s; written as-is' % base)
        data = z.read(n)
        with open(os.path.join(OUT_PICS, name), 'wb') as f:
            f.write(data)
        written[base] = {'file': name, 'bytes': len(data), 'anchors': anchors.get(base, [])}
    z.close()

    mapping = {
        'source': os.path.basename(DOC_Q),
        'note': ('Reading 섹션은 이미지를 하나도 사용하지 않는다 — 문항문서의 r:embed 앵커 20개는 '
                 '전부 LISTENING SECTION 이후 문단에 있다(아래 anchors 의 paraIndex 참조; '
                 'Reading 구간은 paraIndex < LISTENING SECTION 앵커). 파일명은 앵커 문단의 '
                 '앞뒤 문맥으로 추정한 사용처이며, Listening/Speaking 담당이 확정해야 한다.'),
        'images': written
    }
    with open(os.path.join(OUT_PICS, 'mapping.json'), 'w') as f:
        json.dump(mapping, f, ensure_ascii=False, indent=2)
    return written


# ───────────────────────────── 검증 ─────────────────────────────

def verify(reading, pics_dir):
    results = []

    mods = {m['id']: m for m in reading['modules']}
    counts = {}
    for mid, m in mods.items():
        counts[mid] = sum(len(b['questions']) for b in m['blocks'])
    assert counts['R1'] == 35, 'R1 = %d (expected 35)' % counts['R1']
    assert counts['R2'] == 15, 'R2 = %d (expected 15)' % counts['R2']
    results.append('(a) question counts: R1=%d R2=%d  OK' % (counts['R1'], counts['R2']))

    mcq_n = 0
    for m in reading['modules']:
        for b in m['blocks']:
            for q in b['questions']:
                if q['kind'] in ('mcq', 'insert'):
                    ch = q.get('choices') or []
                    a = q.get('answer')
                    assert isinstance(a, int), '%s answer not int: %r' % (q['id'], a)
                    assert 0 <= a < len(ch), '%s answer %r out of range 0..%d' % (q['id'], a, len(ch) - 1)
                    mcq_n += 1
    results.append('(b) all %d MCQ/insert answers within 0<=answer<len(choices)  OK' % mcq_n)

    cloze_n = 0
    for m in reading['modules']:
        for b in m['blocks']:
            for q in b['questions']:
                if q['kind'] == 'blank':
                    assert isinstance(q.get('answer'), str) and q['answer'].strip(), \
                        '%s missing answer string' % q['id']
                    assert q.get('hint'), '%s missing hint' % q['id']
                    cloze_n += 1
    results.append('(c) all %d cloze questions have a non-empty answer string (and hint)  OK' % cloze_n)

    for m in reading['modules']:
        for b in m['blocks']:
            if b['kind'] != 'cloze':
                continue
            toks = re.findall(r'\{\{(\d+)\}\}', b['template'])
            assert len(toks) == len(b['questions']), \
                '%s %s: %d {{n}} vs %d questions' % (m['id'], b['heading'], len(toks), len(b['questions']))
            assert sorted(int(t) for t in toks) == sorted(q['no'] for q in b['questions']), \
                '%s %s: {{n}} tokens do not match question numbers' % (m['id'], b['heading'])
            results.append('(d) %s %s: {{n}} count %d == cloze questions %d  OK'
                           % (m['id'], b['heading'], len(toks), len(b['questions'])))

    refs = []
    for m in reading['modules']:
        for b in m['blocks']:
            if b.get('image'):
                refs.append(b['image'])
            for q in b['questions']:
                if q.get('image'):
                    refs.append(q['image'])
    for r in refs:
        p = os.path.join(ROOT, r) if not os.path.isabs(r) else r
        assert os.path.isfile(p), 'referenced image missing: %s' % p
    n_pics = len([f for f in os.listdir(pics_dir) if f.lower().endswith('.png')])
    results.append('(e) reading references %d images (all exist); %d PNG extracted to %s  OK'
                   % (len(refs), n_pics, pics_dir))

    return results


def main():
    reading = build()
    written = extract_images()

    d = os.path.dirname(OUT_JSON)
    if not os.path.isdir(d):
        os.makedirs(d)
    with open(OUT_JSON, 'w') as f:
        json.dump(reading, f, ensure_ascii=False, indent=2)
        f.write('\n')

    with open(OUT_JSON) as f:
        reloaded = json.load(f)

    print('wrote %s' % OUT_JSON)
    print('wrote %d images to %s' % (len(written), OUT_PICS))
    print('--- verify ---')
    for line in verify(reloaded, OUT_PICS):
        print(line)
    print('--- warnings (%d) ---' % len(WARNINGS))
    for w in WARNINGS:
        print('  * ' + w)
    return 0


if __name__ == '__main__':
    sys.exit(main())
