# TOEFL Practice Book — B2 Level Up · 교재 제작 모듈 PRD

| 항목 | 값 |
|---|---|
| 문서 | Product Requirements Document (BMAD PM 산출물) — 교재(Practice Book) 모듈 |
| 제품 | SMEAG StudyGround 2.0 — Practice Book Authoring & Publishing |
| 버전 | v1.0 (Draft) |
| 작성일 | 2026-08-17 |
| 근거 자료 | ① `studyground/sg2/config/_set9_fragments/*.json` 실측 ② `assets/set-import.js` · `set-generate.js` · `api/generate.js` 코드 실측 ③ `docs/bmad/architecture.md` |
| 대상 코드베이스 | `/Users/kwangseobpark/smeag-TOFEL 자료/studyground/` |
| 정본 우선순위 | **architecture.md > book-prd.md > timing-spec.md > book-epics-and-stories.md** — 이 모듈도 기존 세트와 동일하게 `architecture.md`를 최종 조정자(tiebreaker)로 삼는다 |

> **표기 규칙** — 기존 문서 세트(`prd.md`, `epics-and-stories.md`, `README.md`)의 규약을 그대로 승계한다.
> - 본문은 한국어, 코드 식별자·필드명·화면 문구는 원문(영어) 그대로 유지한다. **교재와 화면에 실제로 인쇄·표시되는 문구는 영어만 쓴다.**
> - **확정(관찰)**: 실제 시험 화면녹화·인쇄물에서 직접 확인된 사실.
> - **확정(코드)**: `_set9_fragments/*.json`, `set-import.js` 등 기존 코드·데이터에서 실측된 사실.
> - **official**: ETS 공식 채점 가이드 등 외부 공개 규격.
> - **⚠️ 가설(검증필요)**: 근거 없이 추정한 값. 확정 전에는 코드에 하드코딩하지 않는다.
> - **신규**: 현재 코드베이스에 존재하지 않으며 이번 작업에서 새로 만들어야 하는 파일/모듈/컬럼.

---

## 1. Goals and Background Context

### 1.1 Background — 지금 무엇이 문제인가

SMEAG는 **시험을 치를 수 있는 자산**을 갖췄다. SET 9까지의 문항 데이터가 `config/_set9_fragments/*.json` 형태로 존재하고, `set-import.js`가 docx를 그 스키마로 파싱하며, `set-generate.js` + `api/generate.js`가 블루프린트의 빈칸을 AI로 채운다. `exam-runtime.html`은 그 팩을 실제 시험으로 돌린다.

그러나 **가르칠 수 있는 자산은 없다.** 학생이 시험 전에 무엇을 어떤 순서로 연습해야 하는지가 어디에도 적혀 있지 않고, 강사는 매 수업마다 SET에서 문항을 오려 붙여 프린트를 만든다. 그 결과 세 가지 손실이 계속 발생한다.

| 관찰된 손실 | 내용 |
|---|---|
| 순서의 부재 | 문항은 있으나 **난이도·기능 순서**가 없다. SET은 시험이지 커리큘럼이 아니다 |
| 재사용 불가 | 강사가 만든 프린트는 파일 한 장으로 끝난다. 정답 해설·오디오·검색 가능한 형태로 남지 않는다 |
| 중복 인지 불가 | 새로 만든 연습문제가 SET 1–9의 문항과 겹치는지 아무도 확인하지 않는다. 학생이 실전에서 본 적 있는 문항을 다시 만난다 |

### 1.2 이 모듈이 만드는 것 — 하나의 원본, 다섯 개의 산출물

**TOEFL Practice Book — B2 Level Up**은 4권(Reading / Listening / Speaking / Writing) × 10챕터 구성의 교재다. 핵심 결정은 하나다.

> **챕터는 딱 한 번 저작된다.** 저작 결과는 `chapter JSON` 한 파일이며, 인쇄물·정답지·시험 팩·오디오·검색 인덱스는 **전부 그 파일에서 파생된다.** 파생물을 사람이 손으로 고치는 경로는 존재하지 않는다.

```
                       ┌──────────────────────────┐
                       │  chapter JSON (단일 원본)  │
                       │  = 기존 팩 스키마의 확장   │
                       └────────────┬─────────────┘
                                    │
     ┌──────────────┬───────────────┼───────────────┬──────────────┐
     ▼              ▼               ▼               ▼              ▼
 ① Student PDF  ② Answer Key   ③ Runnable      ④ Listening    ⑤ book-index.json
    (A4, 흑백)     + Teacher      exam set        audio           (사이트 검색용
                   PDF (staff)    (sg2:set:*)     (multivoice TTS)  사이드카)
```

산출 수량: **4권 × 10챕터 = 40챕터**, 각 챕터마다 3개 에디션(Student / Answer Key / Teacher) → **인쇄 대상 PDF 120종**.

### 1.3 Goals — 이번 릴리즈가 달성할 것

| # | Goal | 성공의 정의 |
|---|---|---|
| BG1 | 단일 원본 저작 | 40개 챕터가 각각 하나의 JSON으로 존재하고, 그 JSON을 고치는 것 외에 산출물을 바꾸는 방법이 없다 |
| BG2 | 다섯 산출물 자동 생성 | 챕터 JSON 하나를 입력하면 PDF 3종 · 시험 팩 1종 · 오디오 · 인덱스가 사람 개입 없이 나온다 |
| BG3 | 저작 품질 게이트 | CEFR-B2 적합성 · 정답 유일성 · SET 1–9 중복 · 사실관계 4종 검사가 저장 전에 돌고, `set-import.js`와 **완전히 동일한 게이트 형태**로 보고된다 |
| BG4 | 검색 가능성 | 인쇄본에서는 목차·색인으로, PDF에서는 텍스트 검색·아웃라인으로, 사이트에서는 `book-index.json`으로 같은 챕터에 도달한다 |
| BG5 | 리스닝 오디오 일원화 | 리스닝 스크립트가 챕터 JSON 안에 있고, 기존 multivoice TTS 도구가 그것을 읽어 mp3를 만들며, 인쇄본에는 QR이 찍힌다 |
| BG6 | 시험 형식과의 일치 | 교재의 모든 연습 유형이 `_set9_fragments`에서 실측된 task family 안에만 존재한다. 실제 시험에 없는 유형은 교재에도 없다 |
| BG7 | 관리자 전용 | 저작·생성·다운로드 전 구간이 `SG_ADMIN` 게이트 뒤에 있고, 정답지·교사용 에디션은 staff 외에는 URL을 알아도 받을 수 없다 |
| BG8 | 제약 준수 | 무빌드 vanilla JS(ES5), stdlib-first Python, langgraph 선택적 의존, 흑백 인쇄 가독성 |

### 1.4 Non-Goals (요약)

상세는 7절. 요약하면 — 학생 배포, 워터마크·DRM, iBT 전용 문항 유형(prose summary / integrated speaking / 30분 에세이), 유료 판매·물류, 교재 다국어판은 이번 범위가 아니다.

### 1.5 Change Log

| 날짜 | 버전 | 변경 | 작성자 |
|---|---|---|---|
| 2026-08-17 | v1.0 | 최초 작성 (`_set9_fragments` 실측 + 기존 BMAD 문서 세트 승계) | PM (BMAD) |

---

## 2. 시험 형식 — 이 교재가 따르는 유일한 규격

> **이 절은 이 문서의 다른 모든 절보다 강하다.** 교재에 등장하는 어떤 연습도 아래 표에 없는 task family를 만들어내서는 안 된다. 근거는 전부 **확정(코드)** — `studyground/sg2/config/_set9_fragments/*.json` 실측이다.

| Section | Module | block `kind` | 구조 | 실측 문항 |
|---|---|---|---|---|
| Reading (`timeLimitSec: 2100`) | R1 | `cloze` ×2 | 빈칸 채우기. 각 문항은 `hint`(선행 글자)와 `answer`를 갖는다 | 10 + 10 |
| | R1 | `passage` ×5 | 지문(webpage / email / notice / passage) + MCQ | 2, 2, 3, 3, 5 |
| | R2 | `cloze` ×1 | 동일 | 10 |
| | R2 | `passage` ×1 | 동일 | 5 |
| Listening | L1 | `audio-set` ×9 | 오디오 1개당 문항 2–4개 묶음. 첫 블록은 단문 응답 12개 | 12,2,2,2,2,2,2,4,4 = **32** |
| | L2 | `audio-set` ×5 | 동일 | 3,2,2,4,4 = **15** |
| Speaking | S1 (`timeLimitSec: 600`) | `record-set` | "Task 1 · Listen and Repeat" | 7 |
| | S2 (`timeLimitSec: 600`) | `record-set` | "Task 2 · Interview" | 4 |
| Writing | W1 (`600`) | `build-set` | "Build a Sentence" — 타일 배열 | 10 |
| | W2 (`600`) | `free-write` | "Write an Email" | 1 |
| | W3 (`600`) | `free-write` | "Write for an Academic Discussion" | 1 |

**존재하지 않는 것 (교재에서 절대 언급 금지)** — prose summary, integrated speaking(read+listen+speak), 30분 independent essay, listening replay 문항, reading insert-text 문항. 이들은 고전적 TOEFL iBT의 유형이며 **이 시험에는 없다.**

콘텐츠 스키마 정본은 기존 팩과 동일하다.

```
{ id, label, timeLimitSec,
  modules:[ { id, label, timeLimitSec,
    blocks:[ { kind, heading, instruction, template?,
      questions:[ { id, kind, no, answer, hint?, choices? } ] } ] } ] }
```

---

## 3. Requirements

### 3.1 Book Functional Requirements (BFR)

#### A. 산출물과 원본

**BFR1** — 시스템은 4권(`reading` / `listening` / `speaking` / `writing`) × 10챕터 = **40개 챕터**를 관리해야 한다. 각 챕터는 `book`(권)과 `chapterNo`(1–10)로 유일하게 식별되며, slug 규칙은 `book-<book>-ch<NN>`이다.

**BFR2** — **챕터 하나의 원본은 JSON 파일 하나다.** 파생 산출물(PDF·시험 팩·오디오·인덱스)에는 편집 경로가 없다. 파생물을 다시 만들면 항상 같은 결과가 나와야 한다(BNFR5 재현성).

**BFR3** — 챕터 JSON은 **기존 팩 스키마를 확장**한다. 새 포맷을 만들지 않는다. 확장 범위는 최상위에 `book`, `chapterNo`, `title`, `objectives[]`, `teachingNotes[]`, `indexTerms[]`, `edition`을 추가하는 것까지이며, `modules[].blocks[].questions[]` 하위 구조는 `_set9_fragments`와 **필드 단위로 동일**해야 한다.

**BFR4** — 하나의 챕터 JSON에서 다음 **다섯 산출물**이 생성된다.

| # | 산출물 | 형식 | 수신자 |
|---|---|---|---|
| ① | Student edition PDF | A4 PDF, 텍스트 레이어 포함 | 교실 인쇄 (staff가 인쇄) |
| ② | Answer Key edition PDF | A4 PDF, 문항별 정답 + 근거 | **staff 전용** |
| ③ | Teacher edition PDF | A4 PDF, ②에 수업 노트·오답 유형·시간 배분 추가 | **staff 전용** |
| ④ | Runnable exam set | 기존 팩(`sg2:set:<slug>`) — 런타임이 그대로 실행 | 학생 (사이트 응시) |
| ⑤ | `book-index.json` 사이드카 | 검색 인덱스 | 사이트 검색 |

리스닝 오디오(mp3)는 ④·①의 공통 부속물이며 6절에서 별도로 규정한다.

**BFR5** — 에디션은 정확히 3종(`student` / `answerKey` / `teacher`)이다. 에디션은 **별도 저작 대상이 아니라 같은 원본의 렌더 모드**다. 즉 `edition` 파라미터만 바꿔 같은 빌더를 다시 돌린다. 40챕터 × 3에디션 = **120 PDF**.

**BFR6** — 시험 팩 산출(④)은 기존 `set-store.js` 계약을 그대로 쓴다: `sg2:set:<slug>` 키에 팩을 넣고 `sg2:set-index`에 등록한다. 교재에서 나온 팩은 인덱스 항목에 `origin: "book"`을 달아 SET 1–9와 구분한다. **(확정(코드) — `set-store.js` 키 규칙 실측)**

**BFR7** — 챕터 JSON은 `contentHash`(정규화 직렬화 후 SHA-256)를 갖는다. 산출물마다 생성 시점의 `contentHash`를 기록하여, 원본이 바뀐 뒤 다시 만들지 않은 산출물을 **stale**로 표시할 수 있어야 한다.

#### B. 저작 품질 게이트

**BFR8** — 저작 게이트는 **4종**이며, 챕터 저장 전에 전부 실행된다.

| ID | 게이트 | 무엇을 본다 | 실패 시 기본 level |
|---|---|---|---|
| BG-A | **CEFR-B2 적합성** | 어휘 난이도 분포, 평균 문장 길이, 문장당 절 수, 지문 길이가 블루프린트 범위 안인지 | `warn` |
| BG-B | **정답 유일성** | `cloze`의 `answer`가 `hint`와 template 문맥에서 유일한지, `mcq`의 오답이 정답과 동시에 성립하지 않는지, `build-set`의 타일 배열이 단 하나의 문법적 순서만 갖는지 | `stop` |
| BG-C | **SET 1–9 중복** | 지문·문항·정답 문자열이 기존 세트와 유사도 임계치를 넘는지 | `stop`(동일) / `warn`(유사) |
| BG-D | **사실관계** | 지문 속 고유명사·수치·연도·인용이 검증 가능한지, 실존 기관·인물을 사칭하지 않는지 | `warn`(불확실) / `stop`(허위 확정) |

**BFR9** — 게이트 결과는 **`set-import.js`와 완전히 동일한 형태**로 반환된다. 새 형태를 만들지 않는다. **(확정(코드) — `set-import.js:958` `function gate(level, scope, message) { gates.push({ level: level, scope: scope, message: message }); }`)**

```js
{ level: 'stop' | 'warn', scope: <string>, message: <string> }
```

- `level: 'stop'`이 하나라도 있으면 **저장 버튼이 잠긴다.** 기존 import 화면과 동일한 동작이다.
- `scope`는 문제가 난 곳을 가리키는 짧은 키다. 교재 모듈에서 허용하는 값: `chapter`, `objectives`, `reading`, `listening`, `speaking`, `writing`, `answers`, `choices`, `cefr`, `duplicate`, `facts`, `audio`, `index`.
- `message`는 **영어 한 문장**이며 무엇이 잘못됐고 어디를 고쳐야 하는지 지시한다. 기존 게이트 문구의 어조를 따른다(예: *"…— check the answer key."*).

**BFR10** — 게이트는 조용히 통과하지 않는다. 검사 대상이 없어서 판단 불가한 경우에도 `warn`을 올린다(예: *"No listening script was found — audio generation is skipped for this chapter."*). **근거 없는 통과는 실패로 간주한다.**

**BFR11** — BG-C(중복) 게이트는 SET 1–9 전 문항을 정규화(소문자·구두점 제거·공백 정규화)한 코퍼스와 대조한다. 코퍼스는 빌드 산출물이며, 저작 화면은 그것을 읽기만 한다. 임계치는 코드 상수가 아니라 설정값이다. **⚠️ 가설(검증필요)** — 초기 임계치는 문항 문자열 정확 일치 = `stop`, 5-gram Jaccard 0.6 이상 = `warn`으로 두고 실사용 후 조정한다(OQ B-3).

**BFR12** — 게이트는 저작 화면(브라우저)과 파이프라인(Python) 양쪽에서 돌 수 있어야 하며, **두 구현이 같은 판정을 내야 한다.** 판정 규칙은 architecture.md 8.4절의 `graph_spec.py` 패턴을 따라 **의존성 없는 단일 선언 모듈**에 두고, 두 실행기가 그 선언을 읽는다.

#### C. 검색 가능성 — 세 겹

**BFR13** — 검색 가능성은 **세 개의 독립된 층**으로 제공되며, 어느 하나가 없어도 나머지로 도달할 수 있어야 한다.

| 층 | 매체 | 요구 |
|---|---|---|
| L1 **PDF 텍스트 레이어** | PDF 뷰어의 Ctrl+F | 모든 본문·문항·정답이 **선택 가능한 실제 텍스트**여야 한다. 지문을 이미지로 굽는 것을 금지한다 |
| L2 **PDF 아웃라인(북마크)** | PDF 사이드바 | 챕터 → 섹션 → 블록 3단 아웃라인이 자동 생성된다. 각 항목은 해당 페이지로 점프한다 |
| L3 **Back-of-book index** | 인쇄 지면 | 권 말미의 색인 페이지. `indexTerms[]`에서 생성되며 **페이지 번호가 실제 조판 결과와 일치**해야 한다 |

**BFR14** — L3 색인은 사람이 손으로 페이지 번호를 적지 않는다. 조판 1차 패스에서 용어 위치를 수집하고 2차 패스에서 색인 페이지를 붙이는 **2-pass 조판**으로 만든다. 1-pass로 추정한 번호는 허용하지 않는다.

**BFR15** — 사이트 검색을 위한 **`book-index.json` 사이드카(신규)** 를 생성한다. 이는 세 층과 별개의 네 번째 자산이며, 브라우저가 통째로 읽을 수 있을 만큼 작아야 한다(BNFR7). 레코드 형태:

```json
{ "schemaVersion": "1.0.0",
  "generatedAt": "...", "corpusHash": "...",
  "entries": [
    { "book": "reading", "chapterNo": 3, "slug": "book-reading-ch03",
      "title": "Cloze: Prepositions and Collocations",
      "objectives": ["..."], "terms": ["preposition", "collocation"],
      "taskFamily": "cloze", "questionCount": 20,
      "page": { "student": 24, "answerKey": 12, "teacher": 12 },
      "audio": null, "contentHash": "..." } ] }
```

**BFR16** — `book-index.json`은 **정답을 담지 않는다.** 사이트 검색은 공개 경로이므로 `answer`, `answerTokens`, `hint`는 사이드카에서 제외한다. 이는 SET 9 결정(정답지는 service_role 전용)과 같은 원칙이다.

#### D. 리스닝 오디오 경로

**BFR17** — 리스닝 챕터의 오디오 스크립트는 **챕터 JSON 안에** 산다. 별도 스크립트 파일을 만들지 않는다. 위치와 형태는 기존 `_set9_fragments/listening_script.json`의 구조를 블록 단위로 흡수한 `blocks[].script`이며, 화자 배열은 multivoice TTS 도구가 이미 이해하는 형태를 그대로 쓴다. **(확정(코드) — `listening_script.json` 실측)**

**BFR18** — 오디오 생성은 **기존 `tools/tts_multivoice.py`를 호출**한다. 새 TTS 경로를 만들지 않는다. 교재 모듈이 하는 일은 챕터 JSON에서 스크립트를 뽑아 그 도구가 기대하는 입력으로 넘기고, 산출 mp3를 `media/book/<slug>/` 아래에 결정론적 파일명으로 두는 것까지다.

**BFR19** — 인쇄본에는 **오디오 QR 코드**가 들어간다. QR은 블록 단위(오디오 1개당 1개)로 찍히며, 대상 URL은 해당 오디오의 안정 경로다. QR 옆에는 사람이 읽을 수 있는 짧은 경로 문자열을 병기한다(QR 스캐너가 없는 상황 대비).

**BFR20** — QR 코드 생성은 **외부 서비스에 의존하지 않는다.** 인쇄물이 만들어지는 시점에 오프라인에서 그려져 PDF 안에 벡터 또는 충분한 해상도의 비트맵으로 박힌다.

**BFR21** — 오디오가 아직 생성되지 않은 챕터를 인쇄하려 하면 게이트 `{level:'warn', scope:'audio', message:'…'}`가 오르고, QR 자리에는 "Audio not yet generated" 자리표시가 인쇄된다. 인쇄 자체를 막지는 않는다(교실에서 스크립트만 쓰는 수업이 가능해야 한다).

#### E. 관리자 화면

**BFR22** — 교재 저작·생성 화면은 **`SG_ADMIN` 게이트 뒤에 있다.** 페이지 골격은 `admin-set-view.html`을 복제한다: 상단 한국어 doc 주석 → `<link app.css>` → `header.nav`(브랜드 + `nav-right`) → `main.wrap[hidden]` → `.page-h` → gate div → 인쇄 스타일. `SG_ADMIN.can(set)`가 거짓이면 `main.wrap`은 계속 `hidden`이다. **(확정(코드) — `admin-session.js` · `admin-set-view.html` 실측)**

**BFR23** — **교재 목록 화면(신규)**: 4권 × 10챕터를 격자로 보여준다. 각 칸에 표시할 것 — 챕터 번호, 영어 제목, task family 배지, 문항 수, 게이트 상태(stop/warn/clean), 산출물 5종의 존재 여부와 stale 여부.

**BFR24** — **챕터 편집 화면(신규)**: 챕터 JSON을 블록 단위로 편집한다. 블록 추가는 **블루프린트가 허용한 kind만** 제시한다. 임의의 새 kind를 만들 수 있는 입력창을 두지 않는다.

**BFR25** — 챕터 편집 화면은 `set-generate.js`와 동일한 **블록 단위 AI 생성**을 제공한다. 생성은 블루프린트가 정한 구조의 **빈칸만 채우며, 구조 자체를 만들어내지 않는다.** 생성 호출 경로·인증은 기존 `api/generate.js`를 그대로 쓴다(Supabase 토큰, role은 teacher/admin). **(확정(코드))**

**BFR26** — **산출물 화면(신규)**: 챕터별로 5종 산출물을 만들고 내려받는다. 각 버튼 옆에 마지막 생성 시각과 `contentHash` 앞 8자를 표시한다. 원본 해시와 다르면 버튼에 stale 표시를 단다.

**BFR27** — **Answer Key / Teacher 에디션은 staff 전용이다.** 다운로드는 서버 측 권한 검사를 통과해야 하며, URL을 아는 것만으로는 받을 수 없다. 클라이언트 측 숨김만으로 처리하지 않는다.

**BFR28** — 관리자 화면의 모든 **UI 문구는 영어**다. `data-ko` span을 새로 만들지 않는다. 코드 주석과 문서는 한국어다. (사용자 전역 규칙 — 2026-08-11 KO 토글 제거)

**BFR29** — 게이트 목록은 화면 상단 고정 영역에 `stop` → `warn` 순으로 표시되고, 각 항목은 클릭 시 해당 블록으로 스크롤한다. `stop`이 있는 동안 저장 버튼은 `disabled`이며 그 이유가 버튼 옆에 텍스트로 붙는다(색만으로 알리지 않는다).

#### F. 저작 파이프라인

**BFR30** — 챕터 초안 생성 파이프라인은 **architecture.md 8.4절 패턴을 따른다.** 그래프 구조(`NODES` / `ENTRY` / `EDGES` / `CONDITIONAL`)를 **의존성 없는 단일 모듈**에 선언하고, langgraph 백엔드와 stdlib 순차 폴백이 **같은 선언을 읽는다.**

**BFR31** — langgraph는 **선택적 의존성**이다. 미설치 시 stdlib 순차 실행기로 동일 결과를 내야 한다. 캠퍼스 장비가 air-gapped이므로 신규 런타임 의존성 추가는 금지에 가깝다. 순차 실행기는 `ENTRY`에서 시작해 `CONDITIONAL`/`EDGES`를 따라가는 일반 워크리스트 루프이며 최대 스텝 상한을 둔다.

**BFR32** — 파이프라인 노드 구성(제안):

| 노드 | 하는 일 |
|---|---|
| `load_blueprint` | 권/챕터에 해당하는 블루프린트 조각을 읽는다 |
| `draft_blocks` | 블록별로 빈칸을 채운다 (AI 또는 수기 입력) |
| `gate_cefr` | BG-A |
| `gate_uniqueness` | BG-B |
| `gate_duplicate` | BG-C (SET 1–9 코퍼스 대조) |
| `gate_facts` | BG-D |
| `assemble` | 게이트 결과를 붙여 챕터 JSON을 확정하고 `contentHash`를 계산 |

**BFR33** — 게이트 노드는 **예외를 그래프 밖으로 던지지 않는다.** 노드 내부에서 흡수하고 실패 사실 자체를 `{level:'warn', scope:…}` 게이트로 바꿔 올린다. 이는 기존 `_SequentialGraph`가 예외를 삼키지 않는 성질을 유지하면서(노드 밖 격리 금지) 새 노드는 각자 내부에서 흡수한다는 architecture.md 8.4의 규정과 일치한다.

**BFR34** — 파이프라인 CLI는 stdlib + argparse다. `build_offline_manifest.py` / `tts_multivoice.py`의 문체를 따른다. 새 pip 의존성은 **선택적이며 가드된 경우에만** 허용한다.

#### G. 인쇄 요구

**BFR35** — 인쇄 대상은 **A4**다. 여백·본문 크기·행간은 교실 복사기 축소 없이 그대로 인쇄되는 것을 전제한다.

**BFR36** — **모든 도해·표·강조는 흑백에서도 판독 가능해야 한다.** 색은 보조 신호로만 쓰고, 정보는 반드시 명도·패턴·아이콘·라벨 중 하나 이상으로 중복 부호화한다. 정답 표시, 난이도 배지, 화자 구분, 오답 유형 구분 전부에 적용된다.

**BFR37** — Student edition에는 **정답·해설·교사 노트가 어떤 형태로도 남지 않는다.** 흰 글자·투명 레이어·주석·메타데이터 어디에도 없어야 한다. 정답을 지운 것이 아니라 애초에 렌더하지 않는다.

**BFR38** — Answer Key edition은 문항별로 정답과 **근거 한 줄**을 함께 싣는다. 근거 없는 정답 나열은 허용하지 않는다.

**BFR39** — Teacher edition은 Answer Key의 상위집합이며 추가로 `objectives[]`, `teachingNotes[]`, 예상 오답 유형, 블록별 권장 시간 배분을 싣는다. 권장 시간은 실제 모듈 `timeLimitSec`(Speaking/Writing 각 600초, Reading 섹션 2100초)와 **모순되지 않아야 한다.**

**BFR40** — 각 챕터 첫 면에는 **task family 배지**가 인쇄된다. 배지 텍스트는 2절 표의 표기를 그대로 쓴다(`cloze` / `passage` / `audio-set` / `record-set` / `build-set` / `free-write`). 학생이 "이 연습이 시험의 어디에 해당하는가"를 한눈에 알 수 있어야 한다.

### 3.2 Book Non-Functional Requirements (BNFR)

**BNFR1 — 무빌드 vanilla JS (필수 제약)**
브라우저 JS는 **ES5**만 쓴다. IIFE 모듈이 전역 하나를 노출하는 형태이며, 빌드 단계·CDN·`import`·`class`·화살표 함수·`let/const`를 쓰지 않는다. 기존 `set-import.js` / `admin-session.js`와 같은 방식이다.

**BNFR2 — Python stdlib-first**
도구는 표준 라이브러리 + `argparse`로 작성한다. 새 pip 의존성은 **선택적이고 import 실패 시 폴백이 있는 경우에만** 허용한다. langgraph가 대표 사례다(BFR31).

**BNFR3 — 콘텐츠 포맷 불변**
새 콘텐츠 포맷을 발명하지 않는다. 챕터 JSON은 기존 팩 스키마의 **상위 필드 추가**만으로 정의되며, 블록·문항 구조는 `_set9_fragments`와 필드 단위로 같다. 이 규칙을 어기면 런타임(`exam-runtime.html`)이 교재 팩을 실행할 수 없게 된다.

**BNFR4 — 디자인 토큰 사용**
UI 크롬에 raw hex를 쓰지 않는다. `app.css`의 토큰(`--ink`, `--muted`, `--line`, `--line-2`, `--card`, `--surface`, `--surface-2`, `--brand` `#0e8f82`, `--brand-ink`, `--ok`, `--bad`, `--warn`, `--radius`)만 쓴다.

**BNFR5 — 재현성**
같은 챕터 JSON을 두 번 빌드하면 **바이트 단위로 같은 PDF**가 나와야 한다(타임스탬프 등 불가피한 필드는 고정 가능해야 한다). 재현되지 않으면 stale 판정(BFR7)이 무의미해진다.

**BNFR6 — 오프라인 구동**
빌드는 네트워크 없이 완료돼야 한다. 폰트는 로컬 자산이고, QR은 오프라인 생성이며, 중복 코퍼스는 로컬 파일이다. AI 초안 생성만이 유일한 온라인 경로이며, 그 단계는 건너뛸 수 있어야 한다.

**BNFR7 — 사이드카 크기**
`book-index.json`은 40챕터 전량을 담고도 브라우저가 한 번에 읽기에 부담 없는 크기를 유지한다. 목표 상한 **512KB**. 초과하면 권 단위 분할로 전환한다. **⚠️ 가설(검증필요)** — 실제 크기는 색인어 밀도에 달렸다(OQ B-5).

**BNFR8 — 접근성 (인쇄·화면 공통)**
색만으로 정보를 구분하지 않는다(BFR36). 관리자 화면은 키보드만으로 조작 가능하고, 게이트 목록은 `aria-live`로 갱신을 알린다. PDF는 텍스트 레이어와 아웃라인을 갖추어 스크린리더가 읽을 수 있어야 한다.

**BNFR9 — 권한 분리**
정답·정답지·교사용 자산은 staff 권한 경로로만 나간다. SET 9 결정과 동일하게 정답 원본은 service_role 전용 경로에 둔다. 학생 경로로 나가는 어떤 자산에도 `answer`가 들어가지 않는다.

**BNFR10 — 코드 주석·문서는 한국어**
새로 쓰는 모듈의 배너 주석과 인라인 주석은 한국어 설명문이다. 단어 나열이 아니라 **왜 이 코드가 있는지, 어떤 실패를 막는지** 서술한다. `set-import.js` / `admin-session.js`의 어조를 기준으로 삼는다.

**BNFR11 — 게이트 형태 단일성**
게이트 객체 형태는 저장소 전체에서 하나다(`{level, scope, message}`). 교재 모듈이 별도 필드(`code`, `severity`, `hint` 등)를 덧붙이지 않는다. 형태를 늘려야 할 이유가 생기면 `set-import.js`와 **함께** 바꾼다.

**BNFR12 — 인쇄 품질 회귀 방지**
챕터 하나를 흑백 A4로 실제 인쇄해 확인하는 절차를 릴리즈 체크리스트에 포함한다. 화면 미리보기만으로 승인하지 않는다.

---

## 4. 챕터 토픽 맵 (40챕터)

> 제목은 **영어**다. 각 챕터는 2절에서 실측된 task family 중 정확히 하나(마지막 Review 챕터는 그 권의 전체 모듈)를 앵커로 삼는다. 오른쪽 한국어 한 줄은 **왜 이 챕터가 이 자리에 있는지**에 대한 근거다.

### 4.1 Book 1 — Reading

| # | Chapter title (EN) | Task family | 배치 근거 |
|---|---|---|---|
| 1 | Cloze: Everyday Word Choice | `cloze` | R1의 첫 블록이 곧 시험의 첫 화면이다. 힌트 글자와 빈칸이라는 조작 자체에 먼저 익숙해져야 한다 |
| 2 | Cloze: Verb Forms and Tense | `cloze` | 실측 cloze 정답의 상당수가 동사 형태다. 어휘보다 형태가 먼저 무너지는 구간을 따로 떼어낸다 |
| 3 | Cloze: Prepositions and Collocations | `cloze` | 힌트 글자가 있어도 연어를 모르면 못 채운다. B2 학습자가 가장 오래 헤매는 지점 |
| 4 | Cloze: Connectors and Transitions | `cloze` | R1 두 번째 cloze 블록은 template이 길다(60–80어). 문장 간 논리 표지가 정답 단서가 되는 구조다 |
| 5 | Read a Webpage | `passage` | 블루프린트의 첫 passage 지시문이 "Read a webpage."다. 짧은 지문 2문항으로 MCQ 조작을 익힌다 |
| 6 | Read an Email | `passage` | 두 번째 passage 유형. 발신자 의도·요청 파악이라는 다른 독해 기능을 쓴다 |
| 7 | Read a Notice | `passage` | 실측상 notice는 문단 수가 크게 늘어난다(14–23문단). 훑어 찾기(scanning)를 별도 챕터로 훈련한다 |
| 8 | Read a Longer Notice: Scanning for Details | `passage` | 같은 notice 유형이지만 190–290어 구간. 길이가 늘 때 무너지는 학생을 위한 계단 하나 |
| 9 | Read an Academic Passage | `passage` | R1 마지막·R2 유일한 5문항 블록. 문단 3개짜리 학술 지문이 이 시험 독해의 최고 난도다 |
| 10 | Review: A Full Reading Module | R1 + R2 전체 | 마지막은 시험 그대로여야 한다. cloze 3블록 + passage 6블록, 섹션 2100초를 통째로 겪는다 |

### 4.2 Book 2 — Listening

| # | Chapter title (EN) | Task family | 배치 근거 |
|---|---|---|---|
| 1 | Short Response: Everyday Requests | `audio-set` (1문항 묶음) | L1 첫 블록은 문항 12개짜리 단문 응답이다. 시험에서 가장 먼저·가장 많이 나오는 형태 |
| 2 | Short Response: Classroom Exchanges | `audio-set` | 같은 형태, 다른 장면. 교실 어휘를 분리해 반복 노출한다 |
| 3 | Short Response: Campus Services | `audio-set` | 같은 형태 세 번째. 12문항 블록을 견디려면 장면 어휘의 폭이 필요하다 |
| 4 | Two-Question Sets: Short Conversations | `audio-set` (2문항 묶음) | L1의 2문항 블록이 6개로 가장 흔하다. 오디오 1회 제약 아래 두 문항을 동시에 붙잡는 훈련 |
| 5 | Two-Question Sets: Announcements | `audio-set` | 대화가 아닌 일방향 발화. 화자가 하나일 때의 정보 배치가 다르다 |
| 6 | Two-Question Sets: Phone and Voice Messages | `audio-set` | L2 앞부분의 짧은 묶음에 대응. 숫자·시간·이름 등 받아적기 부담이 큰 유형을 모은다 |
| 7 | Four-Question Sets: Academic Talks | `audio-set` (4문항 묶음) | L1·L2 끝의 4문항 블록. 길이가 배로 뛰는 지점이라 별도 챕터가 필요하다 |
| 8 | Four-Question Sets: Campus Discussions | `audio-set` | 같은 4문항 묶음의 다화자 버전. 누가 무엇을 말했는지 추적하는 기능이 추가된다 |
| 9 | Note-Taking Under One Play | `audio-set` (혼합) | 오디오는 1회 재생이다(확정(관찰)). 그 제약 자체를 다루는 챕터가 없으면 앞의 8개가 실전에서 무너진다 |
| 10 | Review: A Full Listening Module | L1 32 + L2 15 | 실측 문항 수 그대로. 47문항을 연속으로 듣는 지구력은 따로 겪어야 생긴다 |

### 4.3 Book 3 — Speaking

| # | Chapter title (EN) | Task family | 배치 근거 |
|---|---|---|---|
| 1 | Listen and Repeat: Sounds and Syllables | S1 `record-set` | Task 1은 들은 문장을 그대로 되풀이하는 과제다. 개별 음과 음절 수가 먼저 맞아야 문장이 맞는다 |
| 2 | Listen and Repeat: Word Stress | S1 `record-set` | 되풀이가 무너지는 첫 원인은 강세 위치다. 어휘 단위에서 교정한다 |
| 3 | Listen and Repeat: Sentence Rhythm and Linking | S1 `record-set` | 연음·축약을 못 들으면 못 따라한다. 듣기 실패가 말하기 실패로 보이는 구간을 분리한다 |
| 4 | Listen and Repeat: Longer Sentences | S1 `record-set` | S1은 7문항이며 뒤로 갈수록 문장이 길어진다. 기억 폭(memory span)을 따로 늘린다 |
| 5 | Interview: Talking About Yourself | S2 `record-set` | Task 2는 인터뷰 4문항이다. 첫 문항군은 신상·배경이 대부분이라 여기서 시작한다 |
| 6 | Interview: Preferences and Opinions | S2 `record-set` | 선호를 말하려면 이유가 따라와야 한다. 한 문장 답변에서 벗어나는 첫 계단 |
| 7 | Interview: Describing Experiences | S2 `record-set` | 과거 시제와 시간 순서 배열이 동시에 필요한 유형. 문법 부담이 가장 크다 |
| 8 | Interview: Giving Reasons and Examples | S2 `record-set` | 인터뷰 답변의 길이를 결정하는 것은 근거의 개수다. 답변 확장 전략을 명시적으로 가르친다 |
| 9 | Pacing a 600-Second Module | S1 + S2 | 두 모듈 모두 `timeLimitSec: 600`이다(확정(코드)). 시간 배분은 내용과 별개의 기능이므로 별도 챕터로 둔다 |
| 10 | Review: A Full Speaking Module | S1 7 + S2 4 | 11문항 전체. 녹음 UI와 시간 압박을 함께 겪는 마지막 리허설 |

### 4.4 Book 4 — Writing

| # | Chapter title (EN) | Task family | 배치 근거 |
|---|---|---|---|
| 1 | Build a Sentence: Basic Word Order | W1 `build-set` | W1은 타일 배열 10문항이다. 영어 기본 어순이 흔들리면 나머지 9챕터가 성립하지 않는다 |
| 2 | Build a Sentence: Verbs and Agreement | W1 `build-set` | 배열 오답의 큰 축이 동사 형태·수 일치다. 타일에 함정이 섞이는 지점 |
| 3 | Build a Sentence: Modifiers and Clauses | W1 `build-set` | 수식어의 위치는 배열 문제에서 유일 정답을 결정한다. 정답 유일성 게이트(BG-B)와도 직결된다 |
| 4 | Build a Sentence: Connectors and Complex Sentences | W1 `build-set` | 타일 수가 늘고 절이 둘 이상이 되는 마지막 단계. W1의 상한 난도 |
| 5 | Write an Email: Making a Request | W2 `free-write` | W2는 이메일 자유작성 1문항이다. 요청은 가장 빈번한 상황이며 구조가 명확해 첫 챕터로 적합하다 |
| 6 | Write an Email: Explaining a Problem | W2 `free-write` | 상황 설명 + 요청의 2단 구조. 문단 구성이 처음 필요해진다 |
| 7 | Write an Email: Replying and Confirming | W2 `free-write` | 받은 메일에 답하는 형태. 인용·확인·마무리라는 이메일 고유 관습을 다룬다 |
| 8 | Academic Discussion: Stating Your Position | W3 `free-write` | W3는 학술 토론 게시글이다. 입장을 첫 문장에 놓는 습관이 점수를 좌우한다 |
| 9 | Academic Discussion: Responding to Classmates | W3 `free-write` | 이 과제의 지문에는 급우 게시글이 있다. 그것을 인용·반박하는 기능이 이메일과 결정적으로 다른 지점 |
| 10 | Review: A Full Writing Module | W1 + W2 + W3 | 세 모듈 각 600초, 총 12문항. 배열 10 + 자유작성 2의 실제 배분을 그대로 겪는다 |

---

## 5. 관리자 화면 요구 요약

| 화면 | 신규 여부 | 핵심 요구 |
|---|---|---|
| Practice Book — 목록 | 신규 | 4×10 격자, 게이트 상태·산출물 상태(BFR23) |
| Practice Book — 챕터 편집 | 신규 | 블록 단위 편집 + AI 빈칸 채우기 + 게이트 패널(BFR24·25·29) |
| Practice Book — 산출물 | 신규 | 5종 생성·다운로드, stale 표시, staff 권한 검사(BFR26·27) |

세 화면 모두 `admin-set-view.html`의 골격을 복제하고 `SG_ADMIN.can(set)` 게이트를 통과해야 본문이 보인다. 페이지 상단에는 한국어 doc 주석이 붙는다(이 파일이 무엇이고 어떤 실패를 막는지 서술).

---

## 6. 리스닝 오디오 경로 상세

```
chapter JSON
  └ modules[].blocks[].script      ← 저작 시점에 여기 들어간다 (BFR17)
        │
        ▼
  tools/tts_multivoice.py          ← 기존 도구, 그대로 호출 (BFR18)
        │
        ▼
  media/book/<slug>/<blockId>.mp3  ← 결정론적 경로
        │
        ├─▶ 시험 팩(④)이 참조
        └─▶ 인쇄본 QR(⑤)이 가리킴 (BFR19·20)
```

| 항목 | 규정 |
|---|---|
| 스크립트 소재지 | 챕터 JSON 내부. 별도 파일 금지 |
| TTS 엔진 | 기존 multivoice 경로. 신규 엔진 도입 금지 |
| 파일명 | 챕터 slug + 블록 id 기반 결정론적 생성 |
| QR 대상 | 오디오 안정 경로 |
| 미생성 시 | `warn` 게이트 + 지면에 자리표시. 인쇄는 막지 않는다(BFR21) |

---

## 7. Out of Scope

| # | 제외 항목 | 사유 / 대안 |
|---|---|---|
| BOS1 | 학생에게 PDF 직접 배포 | 이번 릴리즈에서 PDF는 **admin/staff 다운로드 전용**이다. 학생은 시험 팩(④)으로만 만난다 |
| BOS2 | 워터마크·DRM·개인화 인쇄 | 배포를 하지 않으므로 필요가 없다. BOS1이 풀릴 때 함께 검토한다 |
| BOS3 | 고전 iBT 전용 유형 (prose summary, integrated speaking, 30분 essay, insert-text) | 2절 실측 형식에 존재하지 않는다. 교재가 시험에 없는 것을 가르치면 안 된다 |
| BOS4 | 교재의 한국어판·이중언어판 | UI·인쇄 문구는 영어 전용이 전역 규칙이다 |
| BOS5 | 인쇄 물류·제본·판매 | 제작 파이프라인까지가 범위다 |
| BOS6 | 학생용 진도 관리·숙제 배정 | 별도 트랙. 이번 모듈은 저작과 산출까지 |
| BOS7 | 문항 난이도 자동 캘리브레이션(IRT 등) | 응시 데이터 축적 이후 |
| BOS8 | 챕터 간 자동 링크·선수 학습 그래프 | 4절 토픽 맵의 순서로 대체 |
| BOS9 | 색인어 자동 추출(NLP) | `indexTerms[]`는 저작자가 명시한다. 자동 추출은 오탐이 많고 흑백 지면을 낭비한다 |
| BOS10 | 교재 팩의 성적 반영 | 교재 팩은 연습용이다. 정식 성적 산출은 SET 응시로만 |

---

## 8. Open Questions

| ID | 질문 | 선택지 | 현 상태 | 결정 필요 시점 |
|---|---|---|---|---|
| **OQ B-1** | PDF 생성 실행 위치 | (a) Python 도구 (b) 브라우저 인쇄 CSS (c) 둘 다 | 2-pass 색인(BFR14)과 재현성(BNFR5)은 (a)를 가리킨다. 다만 stdlib-first 제약과 상충 — 선택적 의존성으로 가드 필요 | PDF 빌더 착수 전 |
| **OQ B-2** | 챕터 JSON 저장 위치의 정본 | (a) 저장소 파일 (b) localStorage (c) Supabase | SET은 localStorage 기반이나 교재는 40개 장기 자산이다 | 스키마 확정 전 |
| **OQ B-3** | 중복 판정 임계치 | 정확 일치 = stop / 5-gram Jaccard 0.6 = warn | **⚠️ 가설** (BFR11) | 첫 챕터 저작 직후 |
| **OQ B-4** | CEFR-B2 판정 근거 | (a) 어휘 목록 대조 (b) 통계적 지표 (c) LLM 판정 + 사람 확인 | 게이트가 브라우저·Python 양쪽에서 같은 판정을 내야 한다(BFR12)는 제약이 (c)를 어렵게 만든다 | BG-A 구현 전 |
| **OQ B-5** | `book-index.json` 크기 | 상한 512KB, 초과 시 권 단위 분할 | **⚠️ 가설** (BNFR7) | 10챕터 축적 시점 |
| **OQ B-6** | 오디오 QR의 대상 URL 형태 | (a) 사이트 절대 URL (b) 상대 경로 (c) 짧은 리다이렉트 | 오프라인 USB 배포본에서도 동작해야 한다 | QR 구현 전 |
| **OQ B-7** | Teacher edition의 시간 배분 근거 | 실제 모듈 `timeLimitSec`에서 역산 vs 수업 시수 기준 | BFR39는 "모순 없을 것"까지만 규정 | 첫 Teacher edition 조판 전 |
| **OQ B-8** | 챕터별 문항 수 | 시험과 동일 vs 학습용으로 축소 | 4절 Review 챕터만 시험과 동일하다고 못박음. 나머지는 미정 | 블루프린트 확정 전 |

---

## 부록 A — 검산 기준값

구현이 맞게 돌아가는지 확인하는 고정 수치. 파이프라인이 이 값을 내지 못하면 구현이 틀린 것이다.

| 항목 | 값 |
|---|---|
| 권(book) 수 | **4** (reading / listening / speaking / writing) |
| 권당 챕터 수 | **10** |
| 총 챕터 수 | **40** |
| 에디션 수 | **3** (student / answerKey / teacher) |
| 총 PDF 수 | **120** |
| 챕터당 원본 파일 수 | **1** |
| 챕터당 산출물 종류 | **5** |
| 저작 게이트 종류 | **4** (BG-A ~ BG-D) |
| 게이트 객체 필드 | **3** (`level`, `scope`, `message`) — `set-import.js`와 동일 |
| 검색 층 | **3** (PDF 텍스트 / PDF 아웃라인 / back-of-book 색인) + 사이드카 1 |
| Review 챕터의 Listening 문항 수 | **47** (L1 32 + L2 15) — `_set9_fragments/listening.json` 실측 |
| Review 챕터의 Speaking 문항 수 | **11** (S1 7 + S2 4) |
| Review 챕터의 Writing 문항 수 | **12** (W1 10 + W2 1 + W3 1) |

## 부록 B — BFR/BNFR → 트랙 매핑

| 범위 | 트랙 |
|---|---|
| BFR1–BFR7, BNFR3 | 스키마 |
| BFR8–BFR12, BNFR11 | 게이트 (스키마 + 파이프라인 공동) |
| BFR13–BFR16, BNFR7 | 검색 인덱스 |
| BFR17–BFR21 | 오디오 |
| BFR22–BFR29, BNFR1·4·8 | 관리자 UI |
| BFR30–BFR34, BNFR2·6 | 파이프라인 |
| BFR35–BFR40, BNFR5·12 | PDF 빌더 |
| BNFR9 | 저장소 · DB |
| BNFR10 | 전 트랙 횡단 |

---

*문서 끝. 이 PRD의 ⚠️ 가설 항목은 8절 Open Questions와 1:1로 대응하며, 확정 전에는 코드에 하드코딩하지 않고 설정값을 경유한다. 구조 결정이 이 문서와 어긋나면 `architecture.md`가 이긴다.*
