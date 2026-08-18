# TOEFL Practice Book — Epics & Stories (BMAD / Scrum Master)

> **문서 목적** — `book-prd.md`의 BFR/BNFR을 구현 가능한 단위까지 쪼갠 교재 모듈 백로그.
> **저장소 루트** — `/Users/kwangseobpark/smeag-TOFEL 자료`
> **경로 표기** — 모든 `Files` 항목은 저장소 루트 기준 상대경로이며 `(신규)` / `(수정)`을 반드시 표기한다. **파일 경로·모듈명·DB 컬럼명의 정본은 `architecture.md`** 이며, 이 문서와 어긋나면 architecture.md가 이긴다.
> **표기 규칙** — 실측으로 확정된 사실은 그대로 서술한다. 검증이 필요한 값은 **⚠️ 가설(검증필요)** 태그를 붙인다.
> **전역 제약** — 인쇄물·UI 문구는 **영어 전용**(`data-ko` 신규 금지). 브라우저 JS는 **ES5 IIFE**, 빌드·CDN·`import` 금지. Python은 **stdlib + argparse**, 신규 의존성은 선택적·가드 필수. 콘텐츠 포맷 신규 발명 금지. 게이트 객체는 `{level, scope, message}` 한 형태뿐.

---

## 0. 배경 요약 (이 백로그가 전제하는 사실)

| 구분 | 내용 | 신뢰도 |
|---|---|---|
| 시험 형식 | Reading `cloze`/`passage`, Listening `audio-set`(L1 32 + L2 15), Speaking `record-set`(S1 7 + S2 4), Writing `build-set` 10 + `free-write` 2 | **확정(코드)** — `config/_set9_fragments/*.json` 실측 |
| 모듈 시간 | Reading 섹션 `2100`, Speaking S1/S2 각 `600`, Writing W1/W2/W3 각 `600` | **확정(코드)** |
| 게이트 형태 | `{level:'stop'|'warn', scope, message}` — `stop` 하나라도 있으면 저장 버튼 잠김 | **확정(코드)** — `set-import.js:958` |
| 블록 단위 AI 생성 | `set-generate.js`가 블루프린트를 따라 블록별로 빈칸만 채운다. 구조는 만들지 않는다 | **확정(코드)** |
| 생성 API 인증 | `api/generate.js` — Supabase 토큰, role은 teacher/admin | **확정(코드)** |
| 팩 저장 | `set-store.js` — `sg2:set:<slug>` + `sg2:set-index` | **확정(코드)** |
| 관리자 게이트 | `admin-session.js`의 `window.SG_ADMIN.can(set)`. 통과 전 `main.wrap`은 `hidden` | **확정(코드)** |
| 그래프 이중 백엔드 | 구조를 의존성 없는 모듈에 선언하고 langgraph 빌더와 stdlib 순차 실행기가 같은 선언을 읽는다 | **확정(문서)** — architecture.md 8.4 |
| air-gapped 캠퍼스 | 신규 런타임 의존성 회피. langgraph는 선택적 | **확정** — `smeag-local-ai/requirements.txt` 전제 |
| 챕터 저장 위치 | 저장소 파일 / localStorage / Supabase 중 미결 | **⚠️ 가설** — OQ B-2 |
| PDF 생성 실행 위치 | Python 도구 vs 브라우저 인쇄 CSS | **⚠️ 가설** — OQ B-1 |

### 산출 규모 (검산값)

| 항목 | 값 |
|---|---|
| 권 × 챕터 | 4 × 10 = **40 챕터** |
| 에디션 | 3 (student / answerKey / teacher) → **120 PDF** |
| 챕터당 원본 | **1** (chapter JSON) |
| 챕터당 산출물 | **5** (student PDF / answerKey+teacher PDF / exam set / audio / index sidecar) |
| 저작 게이트 | **4** (BG-A CEFR · BG-B 정답 유일성 · BG-C SET 1–9 중복 · BG-D 사실관계) |

---

## Epic B1 — 챕터 스키마와 게이트 계약

**목표** — "챕터란 무엇인가"와 "무엇이 통과 불가인가"를 코드로 못박는다. 이 에픽은 화면을 그리지 않고 PDF도 만들지 않는다. **계약만** 만든다.
**완료 정의** — 임의의 챕터 JSON을 넣으면 스키마 위반과 4종 게이트 위반이 `{level, scope, message}` 배열로 나오고, 같은 입력에 대해 브라우저와 Python이 **같은 판정**을 낸다.

---

### Story B1.1: 챕터 스키마 정의 (기존 팩 스키마의 확장)

**As a** 교재 저작자 **I want** 챕터가 기존 시험 팩과 같은 뼈대를 갖기를 **so that** 저작한 챕터가 아무 변환 없이 실제 시험 런타임에서 돌아간다.

**Acceptance Criteria**
1. `book-schema.js`(신규)가 `SG_BOOK_SCHEMA` 전역 하나를 노출하는 **ES5 IIFE**다.
2. 챕터 최상위 필드는 기존 섹션 팩(`{id,label,timeLimitSec,modules}`)에 다음만 추가한다: `book`(`reading|listening|speaking|writing`), `chapterNo`(1–10), `title`(영어), `objectives[]`, `teachingNotes[]`, `indexTerms[]`, `contentHash`. **`modules[].blocks[].questions[]` 하위 구조는 `_set9_fragments`와 필드 단위로 동일**하며 새 필드를 넣지 않는다(BNFR3).
3. `block.kind`의 허용값은 정확히 6종이다: `cloze`, `passage`, `audio-set`, `record-set`, `build-set`, `free-write`. 그 외 값은 `{level:'stop', scope:'chapter'}` 게이트다. **iBT 전용 유형은 값 자체가 존재하지 않는다.**
4. `slug`는 `book-<book>-ch<NN>` 규칙으로 **계산**되며 저작자가 입력하지 않는다.
5. `contentHash`는 `contentHash` 자신을 제외한 나머지를 키 정렬 후 직렬화해 SHA-256으로 구한다. 같은 내용은 항상 같은 해시를 낸다(BNFR5).
6. `validate(chapter)` 는 throw 하지 않고 `{ok, gates[]}` 를 반환한다. **스키마 오류로 저작 화면이 죽으면 안 된다.**
7. 배너 주석은 한국어 설명문이며, "왜 새 포맷을 만들지 않았는지"와 "포맷을 늘리면 런타임이 교재 팩을 못 읽는다"는 실패를 명시한다.

**Files**
- `studyground/sg2/assets/book-schema.js` (신규)

**Depends on** — 없음

**Verification**
1. `_set9_fragments/reading.json`에 `book`/`chapterNo`/`title`만 얹어 `validate()` → `ok:true`, gates 0건.
2. `block.kind`를 `'prose-summary'`로 바꾸면 `stop` 게이트 1건이 나오는지 확인.
3. 필드 순서만 바꾼 두 객체의 `contentHash`가 동일한지 확인.

---

### Story B1.2: 게이트 판정 규칙의 단일 선언 (`book_gate_spec`)

**As a** 파이프라인 개발자 **I want** 게이트 규칙이 한 곳에만 적히기를 **so that** 브라우저 저작 화면과 Python 파이프라인이 서로 다른 판정을 내는 사고가 구조적으로 불가능해진다.

**Acceptance Criteria**
1. architecture.md 8.4의 `graph_spec.py` 패턴을 따른다 — **의존성 없는 단일 모듈**에 게이트 목록·기본 level·scope·메시지 템플릿을 선언하고, 두 실행기가 그것을 읽는다.
2. 선언 내용: `GATES = [{id:'BG-A'|'BG-B'|'BG-C'|'BG-D', scope, defaultLevel, messageTemplate}]` 와 임계치 상수. **임계치는 코드 상수가 아니라 이 선언 파일의 값**이며, 조정 시 두 실행기가 함께 따라온다(BFR11).
3. Python 선언(`book_gate_spec.py`)과 JS 선언(`book-gates.js` 내부 테이블)은 **동일 값을 갖고, 그 동일성을 검사하는 스크립트가 있다.**
4. 게이트 객체 형태는 `{level, scope, message}` 정확히 3필드다. `code`/`severity`/`hint` 같은 필드를 덧붙이지 않는다(BNFR11).
5. `message`는 **영어 한 문장**이며 기존 `set-import.js` 게이트 문구의 어조를 따른다(무엇이 틀렸고 어디를 고칠지 지시).
6. 판정 불가(검사 대상 부재)는 조용한 통과가 아니라 `warn`이다(BFR10).

**Files**
- `studyground/sg2/tools/book_gate_spec.py` (신규 — 의존성 없는 단일 진실 소스)
- `studyground/sg2/assets/book-gates.js` (신규 — 같은 선언의 JS 미러 + 판정 구현)
- `studyground/sg2/tools/check_gate_parity.py` (신규 — 두 선언 동일성 검사)

**Depends on** — B1.1

**Verification**
1. `python3 studyground/sg2/tools/check_gate_parity.py` → `PARITY OK (4 gates)`.
2. `book_gate_spec.py`의 임계치 하나를 바꾸면 parity 검사가 **FAIL** 하는지 확인(선언이 실제로 이중화돼 있음을 증명).

---

### Story B1.3: BG-B 정답 유일성 게이트

**As a** 채점 담당자 **I want** 정답이 하나뿐임이 저장 전에 증명되기를 **so that** "다른 답도 맞잖아요"라는 이의제기가 인쇄 후에 발생하지 않는다.

**Acceptance Criteria**
1. `cloze`: `answer`가 `hint`(선행 글자)로 시작하는지 검사한다. 불일치는 `warn`(기존 `set-import.js`가 같은 상황에 `warn`을 쓴다 — 어조 일치).
2. `cloze`: `template`의 빈칸 개수와 `questions` 개수가 다르면 `stop`.
3. `mcq`: `answer` 인덱스가 `choices` 범위 밖이면 `stop`. `choices` 중 중복 문자열이 있으면 `stop`(두 개가 동시에 정답이 된다). `choices`가 3개 미만이면 `warn`(기존 import의 thin-choices 규칙과 동일).
4. `build-set`: `answerTokens[]`가 없으면 `stop`. 타일 다중집합과 정답 토큰 다중집합이 불일치하면 `stop`.
5. `free-write`: 정답 검사 대상이 아니므로 게이트를 올리지 않되, `minWords`가 없으면 `warn`.
6. `record-set`: 정답 없음이 정상이다. 게이트 없음.
7. 모든 판정은 B1.2 선언의 `defaultLevel`을 읽어서 결정하며, 함수 안에 level을 하드코딩하지 않는다.

**Files**
- `studyground/sg2/assets/book-gates.js` (수정)
- `studyground/sg2/tools/book_gate_spec.py` (수정 — BG-B 임계치)

**Depends on** — B1.2

**Verification**
1. `_set9_fragments/writing.json`의 `build-set` 블록을 그대로 넣어 게이트 0건 확인.
2. `choices` 두 개를 같은 문자열로 만들면 `stop` 1건이 나오는지 확인.
3. `hint`를 정답과 다른 글자로 바꾸면 `warn` 1건(문구에 문항 id 포함) 확인.

---

### Story B1.4: BG-C SET 1–9 중복 게이트 + 코퍼스 빌더

**As a** 콘텐츠 책임자 **I want** 새 문항이 기존 세트와 겹치는지 저장 전에 알기를 **so that** 학생이 실전에서 본 문항을 교재에서 다시 만나 연습 효과가 무너지는 일을 막는다.

**Acceptance Criteria**
1. `build_dup_corpus.py`(신규)가 SET 1–9 전 문항·지문을 정규화(소문자, 구두점 제거, 공백 단일화)해 **단일 코퍼스 파일**로 굽는다. 저작 화면은 그 파일을 **읽기만** 한다.
2. 판정: 정규화 후 문자열 **정확 일치 = `stop`**, 5-gram Jaccard **0.6 이상 = `warn`**. **⚠️ 가설(검증필요)** — 임계치는 B1.2 선언 값이며 첫 챕터 저작 직후 재조정(OQ B-3).
3. `message`에는 겹친 상대 세트와 문항 id가 들어간다. 어디를 봐야 할지 모르는 메시지는 실패로 본다.
4. 코퍼스에는 **정답이 들어가지 않는다.** 대조 대상은 지문·문항 텍스트뿐이다(BNFR9).
5. 코퍼스 파일에 `corpusHash`가 있고, 게이트 결과에 그 해시가 기록되어 "어느 시점의 코퍼스로 검사했는가"를 나중에 알 수 있다.
6. 코퍼스가 없으면 `{level:'warn', scope:'duplicate', message:'…'}` 를 올리고 저작은 계속 가능하다(오프라인 신규 설치 상황).

**Files**
- `studyground/sg2/tools/build_dup_corpus.py` (신규)
- `studyground/sg2/config/book/dup-corpus.json` (신규 — 빌드 산출물)
- `studyground/sg2/assets/book-gates.js` (수정)

**Depends on** — B1.2

**Verification**
1. `_set9_fragments/reading.json`의 문항 하나를 그대로 복사해 챕터에 넣으면 `stop` 1건 + 상대 세트 id 표기 확인.
2. 그 문항의 단어 두 개만 바꾸면 `warn`으로 내려가는지 확인.
3. 코퍼스 파일을 지우고 게이트를 돌리면 `warn` 1건, 저장 버튼은 잠기지 않음 확인.

---

### Story B1.5: BG-A CEFR-B2 게이트 · BG-D 사실관계 게이트

**As a** 교재 책임자 **I want** 난이도와 사실관계가 자동으로 한 번 걸러지기를 **so that** 검수자가 명백한 문제를 찾는 데 시간을 쓰지 않고 판단이 필요한 곳에만 시간을 쓴다.

**Acceptance Criteria**
1. BG-A는 블루프린트의 범위값(지문 어수 `passageWords{min,max}`, cloze `templateWords{min,max}`, 문단 수)과 실제 값을 대조한다. 범위 밖은 `warn`이며 message에 실제값과 기대범위를 함께 적는다.
2. BG-A의 어휘 난이도 판정 방식은 **⚠️ 가설(검증필요)** — OQ B-4. 1차 구현은 결정론적 지표(평균 문장 길이, 절 수, 어휘 목록 대조)만 쓴다. **LLM 판정은 브라우저·Python 동일 판정 제약(BFR12) 때문에 게이트에 넣지 않는다.**
3. BG-D는 지문에서 연도·수치·고유명사를 추출해 **저작자 확인이 필요한 항목 목록**을 `warn`으로 올린다. 자동으로 참/거짓을 단정하지 않는다.
4. BG-D는 실존 기관·인물을 사칭하는 형태(공식 문서·영수증·공지처럼 보이는 위조)를 발견하면 `stop`을 올린다.
5. 두 게이트 모두 검사 대상이 없으면 `warn`이며 조용히 통과하지 않는다.
6. 두 게이트는 **예외를 밖으로 던지지 않는다.** 내부 실패는 `warn` 게이트로 변환된다(BFR33).

**Files**
- `studyground/sg2/assets/book-gates.js` (수정)
- `studyground/sg2/tools/book_gate_spec.py` (수정)

**Depends on** — B1.2

**Verification**
1. 블루프린트 범위를 벗어난 지문(예: 400어)을 넣어 `warn` + 실제값·기대범위 표기 확인.
2. 지문에 연도 3개를 넣고 BG-D가 3개를 모두 확인 목록에 올리는지 확인.
3. 게이트 함수 내부에서 강제로 예외를 던지도록 조작해도 `validate()`가 throw 하지 않고 `warn`으로 나오는지 확인.

---

## Epic B2 — 저장소와 DB

**목표** — 40개 챕터가 장기 자산으로 살아남게 한다. 브라우저 localStorage 하나에 40챕터의 원본을 맡기지 않는다.
**완료 정의** — 챕터를 저장·불러오기·목록화할 수 있고, 정답을 포함한 자산은 staff 권한 경로로만 나가며, 산출물의 stale 여부를 해시로 판정할 수 있다.

---

### Story B2.1: 챕터 스토어 (`book-store.js`)

**As a** 저작자 **I want** 챕터가 세트와 같은 방식으로 저장·목록화되기를 **so that** 이미 검증된 저장 계약을 다시 만들지 않는다.

**Acceptance Criteria**
1. `book-store.js`(신규)는 `SG_BOOK_STORE` 전역 하나를 노출하는 ES5 IIFE다. API: `list()`, `get(slug)`, `put(chapter)`, `remove(slug)`, `indexOf(book)`.
2. 키 규칙은 `set-store.js`를 그대로 따른다: `sg2:book:<slug>` + `sg2:book-index`. 새 키 체계를 발명하지 않는다.
3. `put()`은 저장 직전 `contentHash`를 재계산해 넣는다. 저작 화면이 계산한 값을 신뢰하지 않는다.
4. 저장 실패(용량 초과·시크릿 모드)는 조용히 넘어가지 않고 `false` 반환 + 호출자가 표시할 수 있는 사유를 남긴다.
5. 인덱스 항목에는 `slug, book, chapterNo, title, contentHash, updatedAt, gateSummary{stop,warn}`가 들어간다. 본문은 인덱스에 넣지 않는다.

**Files**
- `studyground/sg2/assets/book-store.js` (신규)

**Depends on** — B1.1

**Verification**
1. 40개 더미 챕터를 저장하고 `list()`가 40건을 내는지, 인덱스 크기가 수십 KB 수준인지 확인.
2. localStorage를 가득 채운 상태에서 `put()`이 `false`를 반환하고 예외가 밖으로 나오지 않는지 확인.

---

### Story B2.2: 챕터 · 산출물 테이블 (Supabase)

**As a** 운영자 **I want** 챕터 원본과 산출물 메타가 서버에 남기를 **so that** 브라우저를 갈아입어도, 강사가 바뀌어도 40챕터가 사라지지 않는다.

**Acceptance Criteria**
1. `schema.sql`에 idempotent DDL(`create table if not exists`)로 추가한다. 기존 파일 관례를 따른다.
2. 테이블: `book_chapters`(원본 JSON, `contentHash`, `book`, `chapter_no`, `title`, `updated_at`), `book_artifacts`(`slug`, `kind`(student|answerKey|teacher|pack|audio|index), `content_hash`, `built_at`, `uri`), `book_gates`(마지막 판정 스냅샷).
3. **모든 테이블에 RLS를 켠다.** 학생 role에는 어떤 행도 노출하지 않는다. `answer`를 포함하는 원본 접근은 service_role 또는 teacher/admin 전용이다(BNFR9 — SET 9 정답지 결정과 동일 원칙).
4. 파일 상단에 **한국어 헤더 주석**으로 이 DDL을 어떻게 적용하는지, 왜 RLS가 필요한지(정답 유출 실패 사례) 서술한다. 기존 `schema.sql` 관례 그대로다.
5. `book_artifacts.content_hash` 와 `book_chapters.content_hash` 비교만으로 stale 판정이 가능해야 한다(BFR7).
6. SQLite/Postgres 이중모드를 깨지 않는다 — portable type만 쓴다.

**Files**
- `supabase/schema.sql` (수정 — 파일 끝에 교재 섹션 추가)

**Depends on** — B1.1

**Verification**
1. 같은 SQL을 두 번 실행해도 오류가 없는지 확인(idempotent).
2. anon key로 `book_chapters` select → 0행 또는 거부 확인.
3. teacher role로 select → 자기 캠퍼스 챕터가 보이는지 확인.

---

### Story B2.3: staff 전용 산출물 다운로드 경로

**As a** 교재 책임자 **I want** 정답지·교사용 PDF가 URL을 아는 것만으로는 받아지지 않기를 **so that** 학생 손에 정답지가 들어가는 사고가 링크 공유 한 번으로 일어나지 않는다.

**Acceptance Criteria**
1. `answerKey` / `teacher` 에디션 다운로드는 **서버 측 권한 검사**를 통과해야 한다. 클라이언트 숨김만으로 처리하지 않는다(BFR27).
2. 검사 실패 시 파일 대신 403을 반환하고, 존재 여부도 노출하지 않는다.
3. `student` 에디션과 `pack`은 같은 검사 경로를 쓰되 허용 role이 넓다.
4. 다운로드 이벤트(누가·무엇을·언제)를 남긴다. 유출이 발생했을 때 경로를 추적할 수 있어야 한다.
5. 오프라인 USB 배포본에서는 이 경로가 없으므로, 그 경우 산출물이 애초에 번들에 포함되지 않는다(정답지를 USB에 굽지 않는다).

**Files**
- `studyground/sg2/api/book-artifact.js` (신규)
- `supabase/schema.sql` (수정 — 다운로드 로그 테이블)

**Depends on** — B2.2

**Verification**
1. 로그인하지 않은 상태로 `answerKey` URL 직접 호출 → 403.
2. student role 토큰으로 호출 → 403.
3. teacher role 토큰으로 호출 → 200 + 로그 1행 확인.

---

## Epic B3 — 관리자 UI

**목표** — 40챕터를 사람이 실제로 만들 수 있는 화면을 만든다.
**완료 정의** — 관리자가 로그인해 챕터를 열고, 블록을 편집하고, AI로 빈칸을 채우고, 게이트를 보고, 5종 산출물을 내려받는 전 과정이 한 사이트 안에서 끝난다.

---

### Story B3.1: 교재 목록 화면

**As a** 교재 책임자 **I want** 4×10 격자에서 진행 상황을 한눈에 보기를 **so that** 40챕터 중 어디가 비었고 어디가 막혔는지 회의 없이 안다.

**Acceptance Criteria**
1. 페이지 골격은 `admin-set-view.html`을 복제한다: 상단 **한국어 doc 주석** → `<link app.css>` → `header.nav`(브랜드 + `.nav-right`) → `main.wrap[hidden]` → `.page-h` → gate div → 인쇄 스타일.
2. `SG_ADMIN.can(set)`가 거짓이면 `main.wrap`은 계속 `hidden`이고 gate div만 보인다. 게이팅 패턴은 `admin-session.js` 사용법을 그대로 복사한다.
3. 격자 각 칸: 챕터 번호 · 영어 제목 · task family 배지 · 문항 수 · 게이트 상태(`stop`/`warn`/clean) · 산출물 5종 상태(없음/최신/stale).
4. **UI 문구는 영어 전용.** `data-ko` span을 만들지 않는다.
5. 색상은 `app.css` 토큰만 쓴다(`--brand #0e8f82`, `--ok`, `--bad`, `--warn`, `--line`, `--surface`…). raw hex 금지.
6. 상태는 색만으로 구분하지 않는다 — 아이콘 또는 텍스트를 병기한다(BNFR8).
7. 40칸이 스크롤 없이 한 화면에 들어오는 것을 목표로 하되, 좁은 폭에서는 권 단위로 접힌다.

**Files**
- `studyground/sg2/admin-book.html` (신규)
- `studyground/sg2/assets/app.css` (수정 — `/* === book === */` 주석 블록 안에서만)

**Depends on** — B2.1

**Verification**
1. 비관리자 계정으로 열어 본문이 보이지 않는지 확인.
2. 챕터 0건 상태에서 40칸이 "empty"로 렌더되는지 확인.
3. 흑백 프린트 미리보기에서 게이트 상태 구분이 유지되는지 확인.

---

### Story B3.2: 챕터 편집 화면 (블록 단위)

**As a** 저작자 **I want** 블루프린트가 허용한 블록만 추가할 수 있기를 **so that** 시험에 없는 유형이 교재에 섞여 들어가는 일이 애초에 불가능해진다.

**Acceptance Criteria**
1. 블록 추가 UI는 **블루프린트가 허용한 kind만 제시**한다. 임의 문자열을 입력하는 칸을 두지 않는다(BFR24).
2. 문항 편집은 `questions[]` 항목 단위이며 `id`/`no`는 자동 부여된다.
3. 저장 시 B1.1 `validate()` + B1.2~B1.5 게이트가 전부 돈다.
4. 게이트 패널은 상단 고정이며 `stop` → `warn` 순 정렬. 항목 클릭 시 해당 블록으로 스크롤한다.
5. `stop`이 하나라도 있으면 저장 버튼이 `disabled`이고 **버튼 옆에 이유가 텍스트로** 붙는다(BFR29).
6. 게이트 패널 갱신은 `aria-live`로 알린다.
7. 편집 중 이탈 시 경고한다. 저작한 지문을 날리는 것은 회복 불가능한 손실이다.
8. ES5 IIFE. 전역은 `SG_BOOK_EDIT` 하나.

**Files**
- `studyground/sg2/admin-book-chapter.html` (신규)
- `studyground/sg2/assets/book-edit.js` (신규)
- `studyground/sg2/assets/app.css` (수정 — book 블록)

**Depends on** — B1.5, B2.1, B3.1

**Verification**
1. 블록 추가 드롭다운에 6종만 있고 `prose-summary`가 없는지 확인.
2. 중복 `choices`를 만들어 저장 버튼이 잠기고 사유 텍스트가 붙는지 확인.
3. 키보드만으로 블록 추가 → 문항 입력 → 저장까지 도달 가능한지 확인.

---

### Story B3.3: 블록 단위 AI 생성 붙이기

**As a** 저작자 **I want** 블록의 빈칸을 AI가 채우기를 **so that** 40챕터를 손으로 다 쓰지 않고도 초안을 확보한다.

**Acceptance Criteria**
1. 생성은 `set-generate.js`와 **같은 방식**이다 — 블루프린트가 정한 구조의 **빈칸만** 채우고 구조를 만들지 않는다.
2. 호출 경로는 기존 `api/generate.js`를 그대로 쓴다. Supabase 토큰, role은 teacher/admin. 새 인증 경로를 만들지 않는다.
3. 생성 결과는 **바로 저장되지 않는다.** 편집 화면에 초안으로 들어가고 게이트를 통과해야 저장된다.
4. 생성 실패·타임아웃은 편집 내용을 잃지 않고 오류 배너만 띄운다.
5. 오프라인(생성 API 부재)에서도 편집 화면 자체는 정상 동작한다(BNFR6).
6. 교재용 블루프린트 `blueprint.book.json`(신규)은 `blueprint.toefl.json`의 형식을 그대로 모방한다: `schemaVersion, id, label, derivedFrom, note, sections, questions`.

**Files**
- `studyground/sg2/config/blueprint.book.json` (신규)
- `studyground/sg2/assets/book-edit.js` (수정)

**Depends on** — B3.2

**Verification**
1. 생성 버튼으로 `cloze` 블록 10문항을 채우고 구조(문항 수·필드)가 블루프린트와 일치하는지 확인.
2. 네트워크를 끊고 편집 화면을 열어 편집·저장이 되는지 확인.
3. student role 토큰으로 생성 호출 → 거부 확인.

---

### Story B3.4: 산출물 화면 (5종 생성·다운로드·stale 표시)

**As a** 강사 **I want** 챕터 하나에서 다섯 산출물을 만들고 받기를 **so that** 수업 전날 프린트와 오디오와 온라인 연습을 한 화면에서 준비한다.

**Acceptance Criteria**
1. 산출물 5종(student PDF / answerKey PDF / teacher PDF / exam pack / audio) + 인덱스 반영 상태를 표로 보여준다.
2. 각 행에 마지막 생성 시각과 `contentHash` 앞 8자를 표시한다. 원본 해시와 다르면 **stale** 배지를 단다(BFR26).
3. `answerKey`·`teacher` 행은 staff 권한이 없으면 아예 렌더하지 않으며, 다운로드는 서버 검사(B2.3)를 거친다.
4. 시험 팩 생성은 `set-store.js` 계약을 그대로 쓰고 인덱스 항목에 `origin:"book"`을 단다(BFR6).
5. 생성 중에는 버튼이 잠기고 진행 상태가 텍스트로 표시된다(스피너만으로 알리지 않는다).
6. 실패 시 무엇이 실패했는지 게이트 형태 메시지로 표시한다.

**Files**
- `studyground/sg2/admin-book-build.html` (신규)
- `studyground/sg2/assets/book-build.js` (신규)

**Depends on** — B2.3, B3.2

**Verification**
1. 챕터를 한 글자 수정 후 산출물 5행이 전부 stale로 바뀌는지 확인.
2. 시험 팩 생성 후 `exam-runtime.html`에서 그 slug가 실행되는지 확인.
3. student role로 열어 answerKey/teacher 행이 렌더되지 않는지 확인.

---

### Story B3.5: 관리자 내비게이션 편입

**As a** 관리자 **I want** 교재 메뉴가 기존 관리자 내비에 있기를 **so that** 새 화면을 찾으려고 URL을 외우지 않는다.

**Acceptance Criteria**
1. `exam-admin-nav.js`에 `Practice Book` 항목을 추가한다. 라벨은 영어.
2. 항목은 `SG_ADMIN.can(set)` 통과 시에만 보인다.
3. 기존 항목의 순서·동작을 바꾸지 않는다(회귀 금지).

**Files**
- `studyground/sg2/assets/exam-admin-nav.js` (수정)

**Depends on** — B3.1

**Verification**
1. 기존 관리자 페이지 3개를 열어 내비가 그대로인지 확인.
2. 비관리자에게 항목이 보이지 않는지 확인.

---

## Epic B4 — PDF 빌더

**목표** — 챕터 JSON 하나에서 A4 3에디션을 만든다. 흑백에서 읽히고, 검색되고, 페이지 번호가 맞는 PDF.
**완료 정의** — `build_book_pdf.py --chapter <slug> --edition student|answerKey|teacher` 로 PDF가 나오고, 같은 입력에 같은 바이트가 나오며, 색인 페이지 번호가 실제 조판과 일치한다.

---

### Story B4.1: 조판 골격과 A4 · 흑백 규칙

**As a** 강사 **I want** 교실 복사기로 뽑아도 읽히기를 **so that** 컬러 프린터가 없는 교실에서 수업이 멈추지 않는다.

**Acceptance Criteria**
1. 페이지 크기 A4. 여백·본문 크기·행간은 축소 복사 없이 그대로 인쇄되는 값으로 고정한다.
2. **정보는 색으로만 전달되지 않는다.** 정답 표시·난이도 배지·화자 구분·오답 유형에 명도/패턴/아이콘/라벨 중 하나 이상을 중복 부호화한다(BFR36).
3. 각 챕터 첫 면에 **task family 배지**를 인쇄한다. 텍스트는 `cloze`/`passage`/`audio-set`/`record-set`/`build-set`/`free-write` 중 하나(BFR40).
4. 폰트는 로컬 자산이며 네트워크를 타지 않는다(BNFR6).
5. CLI는 stdlib + argparse 문체다. PDF 라이브러리 의존이 필요하면 **선택적 import + 가드**이며, 없을 때 무엇을 해야 하는지 안내 메시지를 낸다(BNFR2). **⚠️ 가설(검증필요)** — 실행 위치 결정은 OQ B-1.
6. 배너 주석은 한국어 설명문이며 "흑백 판독"이 왜 요구인지(교실 복사기 현실) 명시한다.

**Files**
- `studyground/sg2/tools/build_book_pdf.py` (신규)

**Depends on** — B1.1

**Verification**
1. 한 챕터를 흑백 A4로 실제 인쇄해 배지·정답 표시·화자 구분이 판독되는지 확인(BNFR12).
2. 라이브러리를 제거한 환경에서 실행 → 안내 메시지 + 비영(非0) 종료코드, 스택트레이스 노출 없음.

---

### Story B4.2: 세 에디션 렌더 모드

**As a** 교재 책임자 **I want** 에디션이 별도 저작이 아니라 같은 원본의 렌더 모드이기를 **so that** 학생본과 정답본이 서로 다른 내용을 담는 사고가 구조적으로 불가능해진다.

**Acceptance Criteria**
1. `--edition student|answerKey|teacher` 한 파라미터만 바뀌고 입력 원본은 동일하다(BFR5).
2. **student 에디션에는 정답·해설·교사 노트가 어떤 형태로도 없다** — 흰 글자·투명 레이어·주석·메타데이터 어디에도. 지우는 것이 아니라 **애초에 렌더하지 않는다**(BFR37).
3. answerKey 에디션은 문항별 정답 + **근거 한 줄**을 함께 싣는다. 근거 없는 정답 나열은 실패다(BFR38).
4. teacher 에디션은 answerKey의 상위집합이며 `objectives[]`, `teachingNotes[]`, 예상 오답 유형, 블록별 권장 시간을 추가한다(BFR39).
5. teacher 에디션의 권장 시간은 실제 모듈 시간(Speaking S1/S2 각 600초, Writing W1/W2/W3 각 600초, Reading 섹션 2100초)과 **모순되지 않는다**. 합이 초과하면 빌드가 `warn` 게이트를 낸다.
6. 세 에디션의 페이지 헤더에 에디션명이 인쇄되어 손에 든 종이가 무엇인지 즉시 구분된다.

**Files**
- `studyground/sg2/tools/build_book_pdf.py` (수정)

**Depends on** — B4.1

**Verification**
1. student PDF에서 텍스트 전체를 추출해 정답 문자열이 **0건**인지 grep으로 확인.
2. answerKey에서 근거가 빈 문항이 있으면 빌드가 `warn`을 내는지 확인.
3. teacher 권장 시간 합을 600을 넘게 만들어 `warn`이 나오는지 확인.

---

### Story B4.3: 검색 3층 — 텍스트 레이어와 아웃라인

**As a** 강사 **I want** PDF에서 Ctrl+F가 되고 사이드바로 점프되기를 **so that** 40챕터 중 필요한 지점을 회의 중에 찾아낸다.

**Acceptance Criteria**
1. **L1** — 모든 본문·문항·정답이 선택 가능한 실제 텍스트다. **지문을 이미지로 굽는 것을 금지한다**(BFR13).
2. **L2** — 챕터 → 섹션 → 블록 3단 아웃라인이 자동 생성되고 각 항목이 해당 페이지로 점프한다.
3. 아웃라인 라벨은 영어이며 블록의 `heading`을 그대로 쓴다.
4. 텍스트 레이어에 학생 에디션 금지 항목(정답)이 섞이지 않는다 — B4.2 AC2와 같은 검사를 텍스트 추출로 강제한다.

**Files**
- `studyground/sg2/tools/build_book_pdf.py` (수정)

**Depends on** — B4.2

**Verification**
1. PDF 뷰어에서 지문 속 임의 단어를 검색해 히트하는지 확인.
2. 아웃라인 항목 수 = 1(챕터) + 모듈 수 + 블록 수 인지 확인.
3. 텍스트 추출 결과와 원본 JSON의 지문 문자열이 일치하는지 확인.

---

### Story B4.4: 검색 3층 — back-of-book 색인 (2-pass 조판)

**As a** 학생 **I want** 책 뒤 색인의 페이지 번호가 실제와 맞기를 **so that** 색인을 믿고 펼친 페이지에 그 내용이 실제로 있다.

**Acceptance Criteria**
1. 색인은 `indexTerms[]`에서 생성한다. 자동 추출하지 않는다(BOS9).
2. **2-pass 조판**: 1차 패스에서 용어의 실제 페이지 위치를 수집하고, 2차 패스에서 색인 페이지를 붙인다. 추정 번호 금지(BFR14).
3. 색인 페이지 자체가 페이지 수를 늘려 앞 번호가 밀리는 경우를 처리한다(색인은 권 말미이므로 본문 번호는 불변임을 검증으로 확인).
4. 같은 용어가 여러 챕터에 나오면 페이지 번호를 모두 나열한다.
5. 색인은 **권 단위**로 만들어진다(챕터 단위 PDF에는 해당 챕터 항목만).

**Files**
- `studyground/sg2/tools/build_book_pdf.py` (수정)

**Depends on** — B4.3

**Verification**
1. 임의 색인어 5개를 골라 표기된 페이지를 열어 실제로 그 용어가 있는지 확인.
2. 챕터 하나에 문단을 추가해 페이지가 밀린 뒤 색인 번호가 따라 바뀌는지 확인.

---

### Story B4.5: 재현성 고정

**As a** 운영자 **I want** 같은 입력에 같은 PDF가 나오기를 **so that** stale 판정(해시 비교)이 의미를 갖는다.

**Acceptance Criteria**
1. 같은 챕터 JSON을 두 번 빌드하면 **바이트 단위로 동일한 PDF**가 나온다(BNFR5).
2. 타임스탬프·문서 ID 등 비결정 필드는 `contentHash` 또는 고정값에서 유도한다.
3. 딕셔너리·집합 순회 순서에 의존하는 코드를 제거한다.
4. 재현성 검사를 CLI 서브커맨드(`--verify-reproducible`)로 제공한다.

**Files**
- `studyground/sg2/tools/build_book_pdf.py` (수정)

**Depends on** — B4.4

**Verification**
1. 같은 챕터를 두 번 빌드하고 `shasum` 비교 → 동일.
2. 다른 머신·다른 시각에 빌드해도 동일한지 확인.

---

## Epic B5 — 저작 파이프라인 (LangGraph + stdlib 폴백)

**목표** — 초안 생성부터 게이트 통과까지를 하나의 그래프로 묶되, **langgraph 없이도 같은 결과**가 나오게 한다.
**완료 정의** — langgraph가 설치된 환경과 설치되지 않은 환경에서 같은 챕터 입력에 같은 게이트 결과와 같은 `contentHash`가 나온다.

---

### Story B5.1: 그래프 구조 단일 선언 (`graph_spec`)

**As a** 파이프라인 개발자 **I want** 그래프 구조가 한 파일에만 적히기를 **so that** 노드를 추가할 때 두 백엔드 중 하나만 고쳐 어긋나는 사고가 나지 않는다.

**Acceptance Criteria**
1. architecture.md 8.4 패턴 그대로다 — `NODES`, `ENTRY`, `EDGES`, `CONDITIONAL`을 **의존성 없는 모듈**에 선언한다.
2. 노드 구성: `load_blueprint` → `draft_blocks` → `gate_cefr` → `gate_uniqueness` → `gate_duplicate` → `gate_facts` → `assemble`(BFR32).
3. `graph.py`의 langgraph 빌더는 이 선언을 순회해 `add_node`/`add_edge`/`add_conditional_edges`를 호출한다. 노드 이름을 하드코딩하지 않는다.
4. 공개 시그니처(`backend()`, `uses_langgraph()`, `run()`)는 기존 scoring 그래프의 관례를 따른다.
5. `graph_spec` 모듈은 **어떤 서드파티도 import 하지 않는다.**

**Files**
- `studyground/app/authoring/graph_spec.py` (신규)
- `studyground/app/authoring/nodes.py` (신규)
- `studyground/app/authoring/graph.py` (신규)

**Depends on** — B1.2

**Verification**
1. `python3 -c "import app.authoring.graph_spec"` 가 서드파티 없이 성공하는지 확인.
2. `NODES` 키 집합과 `EDGES`/`CONDITIONAL`에 등장하는 노드 이름 집합이 일치하는지 검사(고아 노드 0).

---

### Story B5.2: stdlib 순차 폴백 실행기

**As a** 캠퍼스 운영자 **I want** langgraph 없이도 파이프라인이 돌기를 **so that** 인터넷이 없는 강의실 PC에서도 교재를 만들 수 있다.

**Acceptance Criteria**
1. langgraph import 실패 시 stdlib 순차 실행기로 자동 전환한다. **langgraph는 선택적 의존성**이다(BFR31).
2. 순차 실행기는 하드코딩된 순서가 아니라 `ENTRY`에서 시작해 `CONDITIONAL`/`EDGES`를 따라가는 **일반 워크리스트 루프**다.
3. 무한 루프 방지를 위해 **최대 스텝 상한**을 둔다(기존 scoring 폴백과 같은 방식, 상한 32).
4. **예외를 삼키지 않는다.** 노드 예외는 그대로 전파되며, 예외 흡수는 각 노드 내부의 책임이다(architecture.md 8.4 규정).
5. `uses_langgraph()`가 현재 백엔드를 정직하게 보고하고, 화면·CLI가 그 값을 표시한다.
6. 두 백엔드가 같은 입력에 같은 출력을 낸다.

**Files**
- `studyground/app/authoring/graph.py` (수정)

**Depends on** — B5.1

**Verification**
1. langgraph 설치 환경과 미설치 환경에서 같은 챕터를 돌려 게이트 결과·`contentHash`가 동일한지 확인.
2. `CONDITIONAL`에 순환을 일부러 만들어 32스텝에서 멈추는지 확인.
3. 노드에서 예외를 던져 그대로 전파되는지 확인(폴백이 삼키지 않음).

---

### Story B5.3: 게이트 노드 편입

**As a** 저작자 **I want** 파이프라인이 낸 게이트와 화면이 낸 게이트가 같기를 **so that** "도구마다 말이 다른" 상황이 생기지 않는다.

**Acceptance Criteria**
1. 4개 게이트 노드는 전부 B1.2 선언을 읽는다. 노드 안에 임계치·level을 하드코딩하지 않는다.
2. 각 게이트 노드는 **예외를 밖으로 던지지 않고** 내부에서 흡수해 `{level:'warn', scope:…}` 게이트로 변환한다(BFR33).
3. 노드 출력은 게이트 배열의 누적이며 순서는 노드 실행 순서를 따른다.
4. `assemble` 노드가 `contentHash`를 계산하고 게이트 요약(`{stop, warn}` 개수)을 붙인다.
5. 브라우저 판정과의 동일성은 B1.2의 parity 스크립트로 계속 강제된다.

**Files**
- `studyground/app/authoring/nodes.py` (수정)

**Depends on** — B5.2, B1.5

**Verification**
1. 같은 챕터를 브라우저 `book-gates.js`와 파이프라인에 각각 넣어 게이트 배열이 일치하는지 확인.
2. 게이트 노드에 강제 예외를 넣어도 파이프라인이 완주하고 `warn`으로 나오는지 확인.

---

### Story B5.4: 파이프라인 CLI

**As a** 저작자 **I want** 40챕터를 한 번에 검사·빌드하기를 **so that** 릴리즈 전에 전권을 훑는 데 하루를 쓰지 않는다.

**Acceptance Criteria**
1. stdlib + argparse. 서브커맨드: `check`(게이트만), `draft`(AI 초안), `build`(산출물), `all`.
2. `--book`, `--chapter`, `--edition` 필터를 지원한다.
3. 종료코드: `stop` 게이트 존재 시 비영. CI에서 그대로 쓸 수 있어야 한다.
4. 출력은 사람이 읽는 표 + `--json` 옵션.
5. 온라인 경로(AI 초안)는 `--offline`으로 건너뛸 수 있다(BNFR6).

**Files**
- `studyground/sg2/tools/build_book.py` (신규)

**Depends on** — B5.3, B4.5

**Verification**
1. `python3 studyground/sg2/tools/build_book.py check --book reading` → 10챕터 표 출력.
2. `stop` 게이트가 있는 챕터를 포함시키면 종료코드가 비영인지 확인.
3. `--offline`으로 네트워크 없이 `check`가 완주하는지 확인.

---

## Epic B6 — 오디오와 검색 사이드카

**목표** — 리스닝 스크립트가 챕터 안에서 살고, 오디오와 QR과 사이트 검색이 그 하나에서 파생되게 한다.
**완료 정의** — 리스닝 챕터 하나에서 mp3가 나오고, 인쇄본에 QR이 찍히고, `book-index.json`에 그 챕터가 등재된다.

---

### Story B6.1: 스크립트 → 오디오 (기존 multivoice TTS 재사용)

**As a** 강사 **I want** 오디오가 챕터에서 자동으로 나오기를 **so that** 스크립트와 음원이 서로 다른 버전으로 갈라지지 않는다.

**Acceptance Criteria**
1. 스크립트는 **챕터 JSON 안**(`modules[].blocks[].script`)에 있다. 별도 스크립트 파일을 만들지 않는다(BFR17).
2. 스크립트 형태는 기존 `_set9_fragments/listening_script.json` 구조를 블록 단위로 흡수하며, 화자 배열은 기존 multivoice 도구가 이미 이해하는 형태 그대로다.
3. 생성은 **기존 `tools/tts_multivoice.py`를 호출**한다. 새 TTS 경로를 만들지 않는다(BFR18).
4. 출력 경로는 `studyground/sg2/media/book/<slug>/<blockId>.mp3` 로 **결정론적**이다.
5. 이미 존재하고 스크립트 해시가 같으면 재생성하지 않는다.
6. Speaking 챕터의 `record-set` intro 오디오도 같은 경로를 쓴다.

**Files**
- `studyground/sg2/tools/build_book_audio.py` (신규 — 기존 TTS 도구를 감싸는 얇은 층)

**Depends on** — B1.1

**Verification**
1. 리스닝 챕터 1개를 돌려 블록 수만큼 mp3가 생기는지 확인.
2. 두 번째 실행에서 재생성이 건너뛰어지는지 확인.
3. 스크립트 한 줄 수정 후 해당 블록만 재생성되는지 확인.

---

### Story B6.2: 인쇄본 QR

**As a** 학생 **I want** 종이에서 오디오로 바로 가기를 **so that** 프린트를 들고도 듣기 연습을 한다.

**Acceptance Criteria**
1. QR은 **블록 단위**(오디오 1개당 1개)로 인쇄된다(BFR19).
2. QR 옆에 사람이 읽을 수 있는 짧은 경로 문자열을 병기한다(스캐너 없는 상황 대비).
3. QR 생성은 **오프라인**이며 외부 서비스에 의존하지 않는다(BFR20). 벡터 또는 인쇄 판독 가능한 해상도로 PDF에 박힌다.
4. 오디오 미생성 챕터는 `{level:'warn', scope:'audio'}` 게이트 + QR 자리에 "Audio not yet generated" 자리표시를 인쇄한다. **인쇄 자체는 막지 않는다**(BFR21).
5. QR 대상 URL 형태는 **⚠️ 가설(검증필요)** — 오프라인 USB 배포본에서의 동작 때문에 결정 필요(OQ B-6).

**Files**
- `studyground/sg2/tools/build_book_pdf.py` (수정)

**Depends on** — B6.1, B4.3

**Verification**
1. 인쇄본을 실제 휴대폰으로 스캔해 오디오가 재생되는지 확인.
2. 오디오를 지우고 빌드해 자리표시가 인쇄되고 빌드가 실패하지 않는지 확인.

---

### Story B6.3: `book-index.json` 사이드카

**As a** 학생 **I want** 사이트 검색으로 챕터를 찾기를 **so that** 어느 권 몇 장에 있는지 모르고도 필요한 연습에 도달한다.

**Acceptance Criteria**
1. 40챕터 전량을 담는 단일 JSON. 스키마는 `book-prd.md` BFR15의 형태를 따른다.
2. **정답을 담지 않는다** — `answer`, `answerTokens`, `hint` 제외(BFR16). 공개 경로로 나가는 자산이다.
3. `page` 필드는 B4.4의 2-pass 조판 결과에서 온다. 추정 금지.
4. `generatedAt`, `corpusHash`, 챕터별 `contentHash`를 포함해 stale 판정이 가능하다.
5. 크기 상한 **512KB**. 초과 시 권 단위 분할로 전환한다. **⚠️ 가설(검증필요)** — OQ B-5.
6. 인덱스는 빌드 산출물이며 손으로 수정하지 않는다.

**Files**
- `studyground/sg2/tools/build_book_index.py` (신규)
- `studyground/sg2/config/book/book-index.json` (신규 — 빌드 산출물)

**Depends on** — B4.4

**Verification**
1. `python3 -c "import json;json.load(open('studyground/sg2/config/book/book-index.json'))"` 파싱 확인.
2. 파일 전체를 grep 해 정답 문자열이 **0건**인지 확인.
3. 파일 크기가 512KB 이하인지 확인.

---

## Epic B7 — 콘텐츠 저작 (40챕터)

**목표** — 앞의 여섯 에픽이 만든 도구로 실제 40챕터를 채운다.
**완료 정의** — 40챕터가 전부 `stop` 게이트 0건이고, 120 PDF가 생성되며, Review 챕터의 문항 수가 실측 시험 규모와 일치한다.

---

### Story B7.1: 교재 블루프린트 확정

**As a** 교재 책임자 **I want** 챕터별 구조가 먼저 확정되기를 **so that** 저작자 4명이 서로 다른 밀도의 챕터를 만들지 않는다.

**Acceptance Criteria**
1. `blueprint.book.json`이 40챕터 각각의 블록 구성·문항 수·지문 길이 범위를 담는다.
2. 형식은 `blueprint.toefl.json`을 그대로 모방한다(`schemaVersion, id, label, derivedFrom, note, sections, questions`).
3. 각 챕터의 task family는 `book-prd.md` 4절 토픽 맵과 **1:1로 일치**한다.
4. Review 챕터(각 권 10장)는 실측 시험 규모를 그대로 쓴다 — Listening 47문항(L1 32 + L2 15), Speaking 11(S1 7 + S2 4), Writing 12(W1 10 + W2 1 + W3 1), Reading는 R1+R2 전체.
5. 비-Review 챕터의 문항 수는 **⚠️ 가설(검증필요)** — OQ B-8.

**Files**
- `studyground/sg2/config/blueprint.book.json` (신규)

**Depends on** — B1.1

**Verification**
1. 블루프린트의 챕터 40건과 PRD 4절 표가 제목·task family 단위로 일치하는지 대조.
2. Review 챕터 문항 수 합이 47/11/12와 맞는지 확인.

---

### Story B7.2: Reading 10챕터 저작

**As a** 학생 **I want** cloze에서 학술 지문까지 계단이 있기를 **so that** 갑자기 어려워져 포기하지 않는다.

**Acceptance Criteria**
1. PRD 4.1 표의 10챕터를 그 순서로 저작한다.
2. ch1–4는 `cloze`, ch5–9는 `passage`, ch10은 R1+R2 전체 Review.
3. 전 챕터 `stop` 게이트 0건. `warn`은 사유가 문서화된 경우만 허용한다.
4. BG-C 중복 게이트가 SET 1–9 대비 `stop` 0건.
5. `indexTerms[]`가 챕터당 최소 5개 있다(색인이 비면 L3 검색층이 죽는다).

**Files**
- `studyground/sg2/config/book/reading/ch01.json` … `ch10.json` (신규 10건)

**Depends on** — B7.1, B3.3

**Verification**
1. `build_book.py check --book reading` → stop 0.
2. ch10의 블록 구성이 `_set9_fragments/reading.json`과 kind·개수 단위로 일치하는지 확인.

---

### Story B7.3: Listening 10챕터 저작 (+ 스크립트)

**As a** 학생 **I want** 1문항 묶음부터 4문항 묶음까지 순서대로 만나기를 **so that** 47문항 모듈에서 처음 겪는 형태가 없다.

**Acceptance Criteria**
1. PRD 4.2 표의 10챕터. ch1–3 단문 응답, ch4–6 2문항 묶음, ch7–8 4문항 묶음, ch9 1회 재생 대응, ch10 Review(47문항).
2. 모든 `audio-set` 블록이 `script`를 갖는다. 스크립트 없는 블록은 `warn`이며 오디오 생성에서 빠진다(BFR21과 동일한 취급).
3. 화자 수·이름이 기존 multivoice 도구가 이해하는 범위 안이다.
4. 전 챕터 `stop` 0건.

**Files**
- `studyground/sg2/config/book/listening/ch01.json` … `ch10.json` (신규 10건)

**Depends on** — B7.1, B6.1

**Verification**
1. `build_book_audio.py --book listening` 전량 실행 후 mp3 개수 = 블록 수 확인.
2. ch10 문항 수 합이 47인지 확인.

---

### Story B7.4: Speaking · Writing 20챕터 저작

**As a** 학생 **I want** 두 산출 기능이 같은 밀도로 다뤄지기를 **so that** 시험의 절반을 준비 없이 맞지 않는다.

**Acceptance Criteria**
1. PRD 4.3(Speaking) · 4.4(Writing) 표의 각 10챕터.
2. Speaking ch1–4는 S1 `record-set`, ch5–8은 S2 `record-set`, ch9는 600초 시간 배분, ch10은 Review(11문항).
3. Writing ch1–4는 W1 `build-set`, ch5–7은 W2 `free-write`(email), ch8–9는 W3 `free-write`(academic discussion), ch10은 Review(12문항).
4. `build-set` 전 문항이 BG-B 정답 유일성 게이트를 통과한다(타일 배열은 단 하나의 문법적 순서만 가져야 한다).
5. `free-write` 문항은 `minWords`를 갖는다.
6. Speaking/Writing 챕터의 권장 시간이 각 모듈 `timeLimitSec: 600`과 모순되지 않는다.
7. 전 챕터 `stop` 0건.

**Files**
- `studyground/sg2/config/book/speaking/ch01.json` … `ch10.json` (신규 10건)
- `studyground/sg2/config/book/writing/ch01.json` … `ch10.json` (신규 10건)

**Depends on** — B7.1, B3.3

**Verification**
1. `build_book.py check --book speaking --book writing` → stop 0.
2. Review 챕터 문항 수 11 / 12 확인.
3. `build-set` 문항 하나의 타일을 다른 순서로 배열해 문법적으로 성립하는 경우가 없는지 저작자 교차 검수.

---

### Story B7.5: 전권 릴리즈 검산

**As a** 교재 책임자 **I want** 릴리즈 전에 고정 수치로 검산하기를 **so that** "다 됐다"는 말이 감이 아니라 숫자로 확인된다.

**Acceptance Criteria**
1. `build_book.py all` 이 40챕터 · 120 PDF · 오디오 · 인덱스를 만들고 종료코드 0.
2. 검산값이 PRD 부록 A와 일치한다: 챕터 40 / PDF 120 / 게이트 종류 4 / 검색층 3 / Review 문항 47·11·12.
3. student PDF 120건 중 40건에서 정답 문자열 grep 0건.
4. `book-index.json`에 정답 0건, 크기 512KB 이하.
5. **흑백 A4 실인쇄 검수**를 권당 최소 1챕터 수행한다(BNFR12). 화면 미리보기만으로 승인하지 않는다.
6. 재현성 검사(`--verify-reproducible`) 통과.

**Files**
- (신규 파일 없음 — 릴리즈 체크리스트 실행)

**Depends on** — B7.2, B7.3, B7.4, B4.5, B6.3

**Verification**
1. 위 6항목을 순서대로 실행하고 결과를 릴리즈 노트에 기록.

---

## 8. 병렬 실행 가능 그룹 (파일 충돌 근거)

판정 기준 — 두 스토리가 **동일 파일을 수정(신규 생성 포함)** 하면 직렬, 서로소면 병렬 가능. `book-gates.js`, `book_gate_spec.py`, `build_book_pdf.py`, `app.css`, `schema.sql`, `blueprint.book.json` 은 다수 스토리가 공유하는 **고충돌 파일**이므로 별도 표기한다.

### 그룹 A — 착수 직후 (선행 없음)

| 스토리 | 배타적으로 소유하는 파일 | 공유 파일 | 판정 |
|---|---|---|---|
| B1.1 스키마 | `assets/book-schema.js` | — | **병렬 가능** |
| B2.2 DB | `supabase/schema.sql` | — | **병렬 가능** (프런트와 무관) |
| B7.1 블루프린트 | `config/blueprint.book.json` | — | **병렬 가능** (B1.1 확정 전 초안 착수 가능, 확정은 B1.1 이후) |

> **3인 동시 착수 가능.** B1.1이 최우선이며 나머지 두 트랙은 B1.1의 필드 목록만 합의되면 진행된다.

### 그룹 B — 게이트 (B1.2 완료 후)

| 스토리 | 배타 파일 | 공유 파일 | 판정 |
|---|---|---|---|
| B1.3 정답 유일성 | — | `book-gates.js`, `book_gate_spec.py` | **직렬** (같은 두 파일) |
| B1.4 중복 | `tools/build_dup_corpus.py`, `config/book/dup-corpus.json` | `book-gates.js` | 코퍼스 빌더는 **병렬 가능**, 판정부는 직렬 |
| B1.5 CEFR·사실 | — | `book-gates.js`, `book_gate_spec.py` | **직렬** |

> 게이트 3건은 같은 파일에 모이므로 **판정 로직은 직렬**이다. 다만 B1.4의 **코퍼스 빌더는 완전히 독립**이므로 B1.3 진행 중에 다른 사람이 착수할 수 있다. 이 파일들을 게이트별 모듈로 쪼개면 병렬화되지만, 게이트가 4개뿐이고 선언이 단일 파일이어야 한다는 제약(B1.2)이 더 크므로 **쪼개지 않는다**.

### 그룹 C — 트랙 병렬 (B1.5 · B2.1 완료 후)

| 트랙 | 배타 파일 | 공유 파일 | 판정 |
|---|---|---|---|
| 관리자 UI (B3.1→B3.2→B3.3→B3.4) | `admin-book*.html`, `assets/book-edit.js`, `assets/book-build.js` | `assets/app.css` | **병렬 가능** |
| PDF 빌더 (B4.1→…→B4.5) | `tools/build_book_pdf.py` | — | **병렬 가능** |
| 파이프라인 (B5.1→B5.2→B5.3) | `app/authoring/*.py` | `book_gate_spec.py`(읽기만) | **병렬 가능** |
| 오디오 (B6.1) | `tools/build_book_audio.py` | — | **병렬 가능** |

> **4인 동시 착수 가능.** 유일한 충돌원은 `app.css` 하나이며, 기존 관례대로 **섹션별 주석 블록**(`/* === book === */`)을 소유권 단위로 삼으면 머지 충돌이 사실상 사라진다. PDF 빌더 트랙 내부(B4.1→B4.5)는 같은 파일이라 **직렬**이다.

### 그룹 D — 검색·QR (B4.3·B6.1 완료 후)

| 스토리 | 배타 파일 | 공유 파일 | 판정 |
|---|---|---|---|
| B4.4 색인 2-pass | — | `build_book_pdf.py` | B6.2와 **직렬** |
| B6.2 QR | — | `build_book_pdf.py` | B4.4와 직렬 |
| B6.3 사이드카 | `tools/build_book_index.py` | — | **병렬 가능** (B4.4 완료 후 page 값 필요) |

### 그룹 E — 콘텐츠 저작 (B7.1 · B3.3 완료 후)

| 스토리 | 배타 파일 | 판정 |
|---|---|---|
| B7.2 Reading | `config/book/reading/ch*.json` | **병렬 가능** |
| B7.3 Listening | `config/book/listening/ch*.json` | **병렬 가능** |
| B7.4 Speaking·Writing | `config/book/speaking/ch*.json`, `config/book/writing/ch*.json` | **2인으로 더 쪼갤 수 있어 병렬 가능** |

> **최대 4인 동시 저작 가능.** 챕터 파일은 서로 완전히 독립이며 공유 파일이 없다. 이 백로그에서 병렬 이득이 가장 큰 구간이다. 단 B7.1(블루프린트)이 확정되기 전에 저작을 시작하면 밀도가 갈라지므로 **선행을 반드시 지킨다**.

### 에픽 간 병렬

| 조합 | 근거 | 판정 |
|---|---|---|
| B3(관리자 UI) ↔ B4(PDF) ↔ B5(파이프라인) | 겹치는 파일 없음 — 각각 `sg2/*.html`+`assets/**`, `sg2/tools/build_book_pdf.py`, `app/authoring/**` | **트랙 병렬 가능** |
| B1(게이트) ↔ B2(DB) | `book-gates.js` vs `schema.sql` — 서로소 | **병렬 가능** |
| B5 ↔ B1.2 | B5의 노드는 `book_gate_spec.py`를 **읽기만** 한다 | B1.2 완료 후 병렬 |
| B7(저작) ↔ B4(PDF) | 저작은 데이터, PDF는 도구 | **병렬 가능** — 단 B7.5 검산은 B4 완료 필요 |

---

## 9. 리스크

| # | 리스크 | 영향 | 완화 |
|---|---|---|---|
| BR1 | 게이트 판정이 브라우저와 Python에서 갈라짐 | 화면에서 통과한 챕터가 CI에서 막힘 → 저작 신뢰 붕괴 | B1.2 단일 선언 + `check_gate_parity.py`를 CI 필수 단계로. 선언을 이중화한 사실 자체를 테스트로 증명 |
| BR2 | 정답이 student 에디션·사이드카로 새어나감 | 교재 전체 폐기, 시험 무결성 훼손 | B4.2 AC2(렌더 자체를 안 함) + B4.2/B6.3 Verification의 **grep 0건** 검사를 완료 조건화. 지우는 방식 금지 |
| BR3 | PDF 라이브러리 도입이 stdlib-first 제약과 충돌 | 캠퍼스 air-gapped 장비에서 빌드 불가 | B4.1 AC5 — 선택적 import + 가드 + 안내 메시지. OQ B-1을 PDF 착수 **전에** 결정 |
| BR4 | 색인 페이지 번호가 실제와 어긋남 | 색인이 있으나 못 믿는 상태 = 없는 것보다 나쁨 | B4.4의 2-pass 조판을 AC로 못박고, Verification에서 5개 표본을 실제로 펼쳐 확인 |
| BR5 | 재현성 미확보로 stale 판정이 무의미해짐 | "다시 만들어야 하나"를 매번 사람이 판단 | B4.5를 별도 스토리로 분리하고 `--verify-reproducible`을 CLI에 상설화 |
| BR6 | 중복 게이트 임계치가 너무 느슨/빡빡 | 겹친 문항을 통과시키거나, 정상 문항을 계속 막음 | 임계치를 B1.2 선언 값으로 두어 코드 수정 없이 조정. 첫 10챕터 저작 직후 재조정을 일정에 명시(OQ B-3) |
| BR7 | 40챕터 저작 인력·기간 과소추정 | 도구는 완성됐는데 책이 비어 있음 | Epic B7을 4인 병렬로 설계(그룹 E). 도구 트랙(B3~B6)과 저작 트랙을 **동시에** 돌리고, B3.3 AI 초안을 저작 시작 조건으로 앞당김 |
| BR8 | 교재가 시험에 없는 유형을 가르침 | 학생이 쓸모없는 연습에 시간을 씀 | B1.1 AC3 — `block.kind` 허용값을 6종으로 **닫는다**. iBT 유형은 값이 존재하지 않아 물리적으로 입력 불가 |
| BR9 | 오디오와 스크립트 버전 분기 | 인쇄 스크립트와 실제 음원이 다름 | B6.1 AC1 — 스크립트를 챕터 JSON 안에 둔다. 별도 파일을 만들 수 없게 하는 것이 유일한 확실한 방지책 |
| BR10 | langgraph 폴백이 노드 추가로 어긋남 | 오프라인 캠퍼스에서만 다른 결과 | B5.1 단일 선언 + B5.2 워크리스트 루프. Verification 1에서 **두 백엔드 동일 출력**을 매번 확인 |
| BR11 | `app.css` 동시 편집 머지 충돌 | 병렬 이득 소멸 | 기존 관례대로 `/* === book === */` 주석 블록 소유권 규칙 적용 |
| BR12 | localStorage에 40챕터 원본을 맡김 | 브라우저 초기화 한 번에 교재 소실 | B2.2 서버 테이블을 초기 스프린트에 배치. OQ B-2를 스키마 확정 전에 결론 |
| BR13 | 흑백 인쇄에서 정보가 사라짐 | 컬러 프린터 없는 교실에서 수업 불가 | BFR36을 B4.1 AC2로 강제 + BNFR12 실인쇄 검수를 B7.5 릴리즈 조건에 포함 |
| BR14 | 사이드카가 커져 사이트 검색이 느려짐 | 검색 3층 중 온라인 층이 실질 사망 | B6.3 AC5 상한 512KB + 초과 시 권 단위 분할 전환 규칙을 미리 정의(OQ B-5) |

---

## 10. 권장 스프린트 배치 (참고)

| 스프린트 | 스토리 | 병렬도 | 산출물 |
|---|---|---|---|
| BS1 | B1.1, B2.2, B7.1(초안) | 3 | 스키마·DB·블루프린트 골격 |
| BS2 | B1.2, B1.3, B2.1 | 2 | 게이트 선언 + 정답 유일성 + 스토어 |
| BS3 | B1.4, B1.5, B3.1 | 3 | 중복·CEFR·사실 게이트 + 목록 화면 |
| BS4 | B3.2, B4.1, B5.1, B6.1 | 4 | 편집 화면 · PDF 골격 · 그래프 선언 · 오디오 |
| BS5 | B3.3, B4.2, B5.2, B2.3 | 4 | AI 생성 · 3에디션 · 폴백 실행기 · 권한 경로 |
| BS6 | B3.4, B4.3, B5.3, B3.5 | 3 | 산출물 화면 · 검색 L1·L2 · 게이트 노드 편입 |
| BS7 | B4.4, B6.2, B5.4 | 2 | 색인 2-pass · QR · 파이프라인 CLI |
| BS8 | B4.5, B6.3, B7.2 착수 | 3 | 재현성 · 사이드카 · Reading 저작 시작 |
| BS9 | B7.2, B7.3, B7.4 | 4 | 40챕터 저작 |
| BS10 | B7.5 | 1 | 전권 검산 · 실인쇄 검수 · 릴리즈 |

> **도구 트랙(BS4–BS7)과 저작 트랙(BS8–BS9)은 겹쳐서 돌린다.** B3.3(AI 초안)이 BS5에 들어가는 이유는, 저작자가 도구 완성을 기다리지 않고 초안을 쌓기 시작할 수 있게 하기 위해서다. 40챕터라는 규모에서 저작은 항상 임계 경로다(BR7).

---

*문서 끝. 스토리의 파일 경로·모듈명·DB 컬럼명이 `architecture.md`와 어긋나면 architecture.md를 따른다. ⚠️ 가설 항목은 `book-prd.md` 8절 Open Questions와 1:1로 대응한다.*
