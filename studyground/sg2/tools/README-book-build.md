# 교재 PDF 빌드 (`tools/build_book.py`)

챕터 JSON 한 벌에서 **TOEFL Practice Book — B2 Level Up** 의 A4 PDF 3판을 뽑는다.
학생용·정답판·교사판이 전부 같은 원고에서 나오므로, 정답을 고치면 세 판이 함께 바뀐다.
인쇄물을 손으로 편집하는 길은 없다 — 있으면 첫 수정에서 원고와 인쇄물이 갈라진다.

관련 문서: `docs/bmad/book-schema.md`(필드 계약) · `docs/bmad/book-prd.md`(BFR14~16, 검색 3층)

---

## 1. 준비물

| 필요한 것 | 왜 | 없으면 |
|---|---|---|
| Python 3.9+ | 빌더 본체. **표준 라이브러리만** 쓴다 | — |
| 헤드리스 Chrome / Chromium / Edge | PDF 인쇄 엔진. 조판 실측도 여기서 한다 | PDF 단계에서 안내 메시지와 함께 멈춘다 |
| node (선택) | 검산의 정본 `assets/book-schema.js` 를 그대로 돌린다 | 축소판 검산으로 넘어간다(§5) |

새 pip 패키지는 하나도 늘리지 않는다. 캠퍼스 장비는 오프라인이라 설치가 불가능하고,
설치가 필요한 도구는 결국 "그 노트북에서만 되는 빌드"가 된다.

크롬을 못 찾으면 이렇게 알려 준다.

```bash
CHROME_BIN=/opt/google/chrome/chrome python3 tools/build_book.py ...
# 또는
python3 tools/build_book.py --chrome "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ...
```

찾는 순서는 `--chrome` → `CHROME_BIN`/`CHROME_PATH` → `PATH` → macOS·Linux 표준 설치 경로다.

---

## 2. 명령

```bash
cd studyground/sg2

# 학생용 1권 (챕터 폴더 기본값: config/_book)
python3 tools/build_book.py --book reading --edition student --out dist/books

# 세 판 한꺼번에
python3 tools/build_book.py --book listening --edition all --out dist/books

# 챕터 한 장만
python3 tools/build_book.py --chapter reading-03 --edition teacher --out dist/books

# 다른 폴더의 원고로
python3 tools/build_book.py --book writing --edition all \
        --chapters /path/to/chapters --out dist/books

# 합성 1챕터로 전 구간 점검 (§7)
python3 tools/build_book.py --selftest
```

| 플래그 | 뜻 |
|---|---|
| `--edition` | `student` · `answer-key` · `teacher` · `all` |
| `--chapters DIR` | 챕터 JSON 폴더. 파일명은 `{slug}.json` (기본 `config/_book`) |
| `--out DIR` | 산출물 뿌리. 실제 파일은 `DIR/{book}/` 아래에 놓인다 |
| `--keep-html` | 중간 HTML(pass1/pass2)을 남긴다. 조판이 이상할 때 브라우저로 직접 연다 |
| `--allow-stop` | `stop` 게이트가 있어도 뽑는다. **검토용이며 학생에게 나가면 안 된다** |
| `--chrome PATH` | 크롬 실행 파일 경로 |

### 산출물

```
dist/books/reading/
  reading-01.student.pdf      # 챕터 한 장만 뽑으면 파일명이 슬러그
  reading-01.answer-key.pdf
  reading-01.teacher.pdf
  reading.student.pdf         # 여러 챕터를 한 권으로 뽑으면 파일명이 권 id
  book-index.json             # 검색 사이드카 (권 단위로 누적)
```

`book-index.json` 은 판을 따로 돌려도 **덮어쓰지 않고 병합**한다. `student` 를 뽑고
나중에 `teacher` 를 뽑으면 `page` 에 두 판의 시작 쪽수가 같이 남는다. 단, 그 사이
원고가 바뀌면(`contentHash` 가 달라지면) 옛 쪽수는 버린다 — 낡은 쪽수를 남겨 두는 것이
없는 것보다 나쁘기 때문이다.

---

## 3. 무엇이 어느 판에 인쇄되나

| | student | answer-key | teacher |
|---|:--:|:--:|:--:|
| 지문·문항·선택지 | ● | ● | ● |
| 챕터 목표 · `targetSkills` · `strategy` | ● | ● | ● |
| 정답(선택지 표시 · 클로즈 채움 · Answer 줄) | | ● | ● |
| 리스닝/스피킹 대본 | | ● | ● |
| 모범답안(`modelAnswers`) | | ● | ● |
| `teaching.commonErrors` · 모범답안 `notes` | | | ● |
| 답 쓰는 줄(라이팅) | 12줄 | 6줄 | 6줄 |

PDF 는 당분간 **관리자·교사 전용 다운로드**다. 표지에 그렇게 찍힌다. 학생 배포·워터마크는
이번 범위 밖이고, 그래서 챕터 스키마에도 배포 관련 필드가 없다.

---

## 4. 두 번 조판하는 이유와 그 방식

### 왜 2-pass 인가

책 뒤 색인의 쪽수는 **실측**이어야 한다(BFR14). 손으로 적거나 1-pass 로 추정한 번호는
금지다. 색인을 펼쳤는데 그 말이 없으면 학생은 다시는 색인을 안 본다 — 못 믿는 색인은
없는 색인보다 나쁘다.

### 쪽수를 어떻게 아나 (PDF 라이브러리 없이)

PDF 를 되읽어 세는 길은 막혀 있다(라이브러리 없음). 그래서 **페이지를 브라우저에게
맡기지 않고 우리가 직접 만든다.**

`book_templates/chapter.html.tmpl` 의 조판 스크립트가 A4 본문 상자(`.page`)를 만들고
덩어리(`.atom`)를 하나씩 담는다. 넘치면 상자를 새로 연다. 우리가 만든 상자의 순번이
곧 인쇄 페이지 번호이므로, 색인어에 씌운 보이지 않는 앵커(`<span class="ix">`)가
어느 상자에 들어앉았는지만 읽으면 그게 실측 쪽수다.

읽어 오는 방법은 헤드리스 크롬의 `--dump-dom` 이다. 조판이 끝난 DOM 을 통째로 받아
`<script id="page-map">` 안에 스크립트가 적어 둔 JSON 을 꺼낸다.

```
1차 패스  색인·목차 쪽수를 비운 채 조판 → --dump-dom 으로 용어 위치 실측
2차 패스  그 실측값으로 목차와 책뒤 색인을 채워 다시 조판 → --dump-dom 으로 재측정
검증      본문 쪽수가 1차와 한 쪽이라도 어긋나면 빌드를 실패시킨다
인쇄      --print-to-pdf --no-pdf-header-footer
```

### 2차 패스에서 본문이 밀리지 않게 하는 장치

- **앞붙이(표지·목차)는 로마숫자로 따로 센다.** 목차가 한 장 늘어도 본문 1쪽은 그대로다.
  아라비아 번호를 앞붙이와 나눠 쓰면 목차 길이가 본문 쪽수를 바꾸고, 그러면 1차에서 잰
  색인 번호가 2차에서 전부 틀어진다.
- **색인은 책 뒤에 붙는다.** 뒤에 붙는 것은 앞의 번호를 바꾸지 못한다.

이 두 장치로 구조적으로는 어긋날 수 없지만, 그래도 매 빌드마다 실제로 다시 재서 비교한다.
어긋나면 `stop` 이다 — 색인이 거짓말하는 PDF 를 내보내느니 빌드를 실패시킨다.

### 인쇄 결과 검증

PDF 를 다 쓴 뒤 바이트에서 `/Type /Pages ... /Count N` 을 찾아 페이지 수를 세고,
조판이 만든 상자 수와 비교한다. 다르면 크롬이 페이지를 더 나눈 것이므로 실패시킨다
(대개 `print.css` 의 `--p-h` / `--p-flow-h` 가 A4 와 안 맞을 때다).
페이지 트리가 압축되어 못 읽으면 **"검증 못 함"이라고 말한다** — 여기서 추측한 숫자를
맞다고 하면 검증 전체가 거짓이 된다.

---

## 5. 검산 게이트

게이트 모양은 `assets/set-import.js` 와 같다: `{ level: 'stop'|'warn', scope, message }`.
`stop` 이 하나라도 있으면 **인쇄하지 않는다.**

```
  검산: assets/book-schema.js (node)
  ✗ stop answer     reading-03:reading-03-R1-q11: no answer. …
  · warn provenance reading-03:provenance.reviewedAt is null — …
  게이트 1 stop · 1 warn
✗ stop 게이트가 1 건이라 인쇄하지 않는다.
```

- **node 가 있으면** `assets/book-schema.js` 를 그대로 불러 쓴다. 판정의 정본이 하나뿐이어야
  브라우저 편집 화면과 빌드가 서로 다른 답을 내지 않는다.
- **node 가 없으면** `book-schema.md` §4-3 의 `stop` 목록만 옮긴 축소판으로 대신하고,
  축소판을 썼다는 사실을 출력 첫 줄에 남긴다. 축소판은 `warn` 을 재현하지 않는다
  (`warn` 은 관리자 화면이 이미 보여 준다). 축소판과 정본이 갈라질 위험은 실재하므로,
  릴리스용 빌드는 node 가 있는 장비에서 돌린다.

---

## 6. 흑백 인쇄 규칙 (`book_templates/print.css`)

학원 복사기는 흑백이고, 원본을 다시 복사한 2세대 복사본이 학생 손에 간다.

- **색은 절대 유일한 신호가 아니다.** 정답은 굵게 + 검은 사각형 + `✓` + `Answer: B` 줄까지
  네 겹으로 표시한다. 어느 하나가 복사에서 죽어도 나머지가 남는다.
- 밴드(High/Mid/Low)는 라벨 글자로 구분하고 테두리 모양(실선/점선)을 겹쳐 쓴다.
- 회색 20%와 30%는 2세대 복사본에서 같은 색이 된다. 그래서 배경 회색은 `#e2e2e2` 하나만 쓴다.
- 0.25pt 미만의 선은 쓰지 않는다(복사에서 사라진다).
- 폰트는 로컬 자산만 쓴다. `@font-face` 로 외부 URL 을 부르지 않는다 — 오프라인 장비에서
  대체 폰트로 밀리면 조판이 바뀌고 색인 쪽수가 어긋난다.
- 문항 하나(`.atom`)는 페이지를 넘지 않는다. 선택지 두 개를 못 본 채 답을 고르게 하지 않는다.
- 도표는 인라인 SVG 이고 글자는 `<text>` 로 남긴다. **path 로 변환하면 PDF 검색에서 그
  글자가 통째로 사라진다.** 지문을 이미지로 굽는 것도 같은 이유로 금지다(검색 1층).

`print.css` 의 `--p-h`(페이지 높이)와 `--p-flow-h`(본문 상자 높이)는 장식이 아니라
**조판의 계약**이다. 값을 바꾸면 색인 쪽수가 통째로 바뀐다.

---

## 7. 셀프테스트

```bash
python3 tools/build_book.py --selftest
```

blueprint 의 reading 구조를 그대로 채운 합성 1챕터(30문항)를 만들어 **검산 → HTML 조판 →
색인 앵커 → 2-pass 실측 → PDF → `book-index.json` → 정답 유출 검사**까지 실제로 돌린다.
구조를 발명하지 않으므로 실제 원고와 똑같은 조건을 지난다.

크롬이 없으면 4)까지만 돌리고 **"PDF·2-pass 색인은 미검증"이라고 분명히 말한 뒤** 0으로
끝난다. 돌리지 않은 것을 통과했다고 말하지 않는다.

실제 출력(macOS · Chrome · node 있음):

```
selftest — 합성 reading 1챕터로 전 구간을 돌린다
  1) 합성 챕터 reading-01 · 30 questions → …/chapters
  2) blueprint 로드: blueprint.book.json
  검산: assets/book-schema.js (node)
  · warn provenance reading-01:provenance.reviewedAt is null — …
  게이트 0 stop · 1 warn
  3) 검산 통과 (assets/book-schema.js (node))
  4) HTML 조판 34713 bytes · toc 9 entries · 색인 앵커 36개 → …/probe.html
  5) chrome: /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
    pass 1 · front 2 · body 5 · terms 4
    pass 2 · front 2 · body 5 · index 1
    PDF reading-01.teacher.pdf · 8 pages · 338 KB
  6) book-index.json 691 bytes · entries 1 · page {'teacher': 1} · 정답 키 유출 0건
  7) 색인 실측 4 terms — 예: collocation → p.1,5, main idea → p.1,5,
     sediment → p.2,3,4,5, tidal marsh → p.2,3
selftest OK — …/reading-01.teacher.pdf
```

---

## 8. `book-index.json` (검색 사이드카)

`docs/bmad/book-prd.md` BFR15 의 모양을 따른다. **정답을 담지 않는다**(BFR16) —
사이트 검색은 공개 경로이고, 정답지는 `service_role` 전용이라는 SET 9 결정과 같은 원칙이다.
`answer` · `answerTokens` · `hint` · `sentence` · `script` 는 사이드카에 넣지 않으며,
셀프테스트가 매번 유출 여부를 실제로 검사한다.

```json
{ "schemaVersion": "1.0.0", "generatedAt": "…", "corpusHash": "…",
  "entries": [
    { "book": "reading", "chapterNo": 1, "slug": "reading-01", "title": "…",
      "objectives": ["…"], "terms": ["collocation", "sediment"],
      "taskFamily": "cloze", "taskFamilies": ["cloze", "passage"],
      "questionCount": 30,
      "page": { "student": 1, "answerKey": 1, "teacher": 1 },
      "audio": null, "contentHash": "b283c016…" } ] }
```

`page` 는 그 판 PDF에서 **챕터가 시작하는 본문 쪽수**이며 2-pass 실측값이다.
크기 상한은 512KB 다(BNFR7). 넘으면 빌드가 경고하고, 그때는 권 단위 분할로 전환한다.

---

## 9. 알려진 한계 — 정직하게

1. **PDF 아웃라인(북마크)이 없다.** `--print-to-pdf` 는 목차 북마크를 만들어 주지 않는다.
   검색 3층 중 L1(텍스트 레이어)과 L3(책뒤 색인)만 이 도구가 책임진다. L2 는 아직 없다.
2. **같은 입력에 같은 바이트는 보장 못 한다.** 크롬이 PDF 에 생성 시각을 박는다.
   재현성은 "같은 쪽수·같은 조판"까지이고 바이트 동일성은 아니다.
3. **색인어 매칭은 정확 일치 + 끝의 `(e)s` 까지다.** `tidal marsh` 는 `tidal marshes` 를
   잡지만 `marshland` 는 못 잡는다. 어형 변화를 넓게 잡으면 오탐이 늘고, 오탐은 흑백
   지면을 낭비한다(BOS9 — 색인어는 저작자가 `indexTerms[]` 로 명시한다).
4. **한 덩어리가 A4 한 면보다 크면 잘리지 않고 넘친다.** 그런 덩어리는 반드시
   `⚠ 한 면에 담기지 않는 덩어리:` 로 보고하고 넘어간다. 조용히 잘리는 것보다 낫다.
   지문 문단이 너무 길면 원고에서 문단을 나눈다.
5. **PDF 페이지 수 검증이 항상 되는 것은 아니다.** 크롬이 페이지 트리를 압축하면
   `/Count` 를 못 읽고 "검증 못 함"으로 남는다. 그때는 조판 상자 수만 믿는다.
6. **크롬이 일을 끝내고도 프로세스가 안 죽는 일이 있다**(macOS 에서 재현됨).
   그래서 빌더는 프로세스 종료를 기다리지 않고 "결과가 나왔는가"를 직접 본 뒤 크롬을
   끝낸다. 그래도 시간 안에 결과가 없으면 그때가 진짜 실패다.
7. **한 번에 한 권이다.** 권마다 러닝헤드·색인이 다르므로 섞어 조판하지 않는다.

---

## 10. Supabase Storage 로 보내기

PDF 는 관리자·교사만 받는다. 그래서 **공개 버킷에 올리지 않는다** — 링크가 한 번 새면
회수할 방법이 없고, 교재는 판매물이다.

```bash
# 1) 빌드
python3 tools/build_book.py --book reading --edition all --out dist/books

# 2) 비공개 버킷 'book-pdf' 에 올린다 (경로: {book}/{파일명})
#    service_role 키는 서버에서만 쓴다. 브라우저에 넣지 않는다.
export SUPABASE_URL=https://<project>.supabase.co
export SUPABASE_SERVICE_ROLE=<service_role key>

for f in dist/books/reading/*.pdf; do
  curl -sS -X POST \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE" \
    -H "Content-Type: application/pdf" \
    -H "x-upsert: true" \
    --data-binary "@$f" \
    "$SUPABASE_URL/storage/v1/object/book-pdf/reading/$(basename "$f")"
done
```

- 버킷 `book-pdf` 는 **private** 로 만든다. 관리자 화면은 서버에서 만든
  **서명 URL(유효기간 짧게)** 로만 내려받게 한다. 녹음 파일에 쓰는 방식과 같다.
- RLS 정책은 `supabase/` 의 관례를 따른다 — 모든 테이블·버킷에 정책을 붙이고,
  DDL 은 몇 번 돌려도 같은 결과가 되게 쓴다.
- `book-index.json` 은 **공개 경로로 나가는 유일한 산출물**이다(사이트 검색이 읽는다).
  정답이 없다는 것을 위 §8 의 검사로 확인한 뒤에 올린다. 올리는 자리는 사이트 정적
  자산(`studyground/sg2/config/book/book-index.json`)이며 Storage 가 아니다.
- 음원(mp3)은 이 도구가 만들지 않는다. `tools/tts_*.py` 와 오디오 파이프라인의 몫이다.
