# 교재 챕터 스키마 (book-schema)

> **정본 문서.** 챕터 JSON 의 모양에 대해 다른 문서와 이 문서가 어긋나면 이 문서가 이긴다.
> 단, 실행되는 검산의 정본은 `studyground/sg2/assets/book-schema.js` 이고, 문항 수·블록 구성의
> 정본은 `studyground/sg2/config/blueprint.book.json` 이다. 이 문서는 그 둘이 왜 그런 모양인지를
> 설명하고, 트랙별로 무엇을 읽고 무엇을 쓰는지를 못 박는다.
>
> 대상 산출물: **TOEFL Practice Book — B2 Level Up** / 4권(Reading·Listening·Speaking·Writing)
> × 각 10챕터 × 3판.

관련 파일

| 파일 | 역할 |
|---|---|
| `docs/bmad/book-schema.md` | 이 문서. 필드 계약. |
| `studyground/sg2/config/blueprint.book.json` | 챕터 구조의 정본(블록 종류·순서·문항 수). 내용은 없다. |
| `studyground/sg2/assets/book-schema.js` | `window.SG_BOOK_SCHEMA` — 검산·뼈대·팩 변환. |
| `studyground/sg2/config/_set9_fragments/*.json` | 챕터가 상위집합으로 삼는 기존 섹션 조각. |
| `studyground/sg2/assets/set-import.js` | gate 모양(`{level,scope,message}`)의 출처. |

---

## 1. 왜 이 모양인가

### 1-1. 원고는 하나뿐이어야 한다

한 챕터에서 다섯 가지가 나온다 — 학생용 PDF, 교사용 정답판 PDF, 응시 가능한 세트,
리스닝 음원, 색인 사이드카. 산출물마다 원고를 따로 두면 첫 수정에서 갈라진다.
"정답을 고쳤는데 PDF 만 고쳐졌다"는 사고는 원고가 둘 이상일 때 반드시 일어난다.
그래서 **집필은 챕터 JSON 한 벌**이고, 나머지는 전부 파생물이다.

### 1-2. 기존 섹션 조각의 완전한 상위집합

`config/_set9_fragments/reading.json` 은 이미 시험 엔진(`assets/exam-render-*.js`)이 먹는
모양이다. 챕터는 그 모양에 **키를 더하기만 하고 하나도 빼지 않는다**. 결과로

- 챕터를 섹션 자리에 그대로 끼워 넣으면 시험이 돌아간다(`SG_BOOK_SCHEMA.toPack`).
- 엔진은 교재 전용 키(`teaching`, `glossary`, …)를 모른 채 무시한다. 엔진을 고칠 필요가 없다.
- 렌더러·채점기·동기화를 교재용으로 두 벌 유지하지 않는다.

교재 전용 포맷을 새로 만드는 길은 **막는다**. 그 길로 가면 "교재에서는 되는데 시험에서는
안 그려지는 문항"이 인쇄 후에 발견된다.

### 1-3. 챕터는 시험보다 짧다

모의고사 1회분(`blueprint.toefl.json`)은 120문항이다. 교재 한 챕터는 그 절반 이하다.
줄인 것은 **분량**이지 **종류**가 아니다 — 블록 종류(`cloze`/`passage`/`audio-set`/
`record-set`/`build-set`/`free-write`)와 문항 종류(`blank`/`mcq`/`insert`/`repeat`/
`interview`/`build`/`email`/`discussion`)는 실제 시험에 있는 것만 쓴다.

> ⚠️ 이 시험 형식에는 prose-summary, 통합형 스피킹, 30분 에세이가 **없다**. 위 목록 밖의
> 과제를 챕터에 넣으면 엔진이 그리지 못하고 `validate()` 가 `stop` 으로 막는다.

---

## 2. 챕터 객체 — 최상위 필드

`왜 쓰나` 열의 트랙 이름은 이 모듈을 나눠 짓는 작업 단위를 가리킨다.

### 2-1. 기존 섹션 조각과 공유하는 키 (엔진이 읽는 부분)

| 필드 | 타입 | 필수 | 누가 쓰나 | 누가 읽나 |
|---|---|---|---|---|
| `id` | `string` | ✅ | `blankChapter()` | 시험 엔진, `timing.toefl.json` 의 섹션 매칭 |
| `label` | `string` | ✅ | `blankChapter()` (blueprint 의 `label`) | 시험 화면 섹션 제목, PDF 러닝헤드 |
| `labelKo` | `string` | — | `blankChapter()` | 관리자 화면(한국어 라벨은 관리자 전용) |
| `timeLimitSec` | `number \| null` | ✅ | blueprint | 시험 엔진 타이머 |
| `modules[]` | `Module[]` | ✅ | 집필/생성 | 시험 엔진, PDF 조판기, 채점기 |

**`id` 는 반드시 책 id 와 같다** (`'reading'`, `'listening'`, `'speaking'`, `'writing'`).
챕터 번호를 여기 섞으면(`'reading-03'`) `timing.toefl.json` 의 섹션별 시간 배정이 붙지 않는다.
챕터를 구분하는 값은 `id` 가 아니라 `slug` 다. `validate()` 는 `id !== book` 을 `stop` 으로 막는다.

### 2-2. 교재가 더하는 키 (엔진은 무시, PDF·색인·교사판이 읽는다)

| 필드 | 타입 | 필수 | 누가 쓰나 | 누가 읽나 |
|---|---|---|---|---|
| `schemaVersion` | `string` | ✅ | `blankChapter()` | 마이그레이션 판정 |
| `book` | `'reading' \| 'listening' \| 'speaking' \| 'writing'` | ✅ | 편집 화면 | 전 트랙. 어느 권인지의 유일한 근거 |
| `chapterNo` | `number` 1..10 | ✅ | 편집 화면 | 목차, 러닝헤드, 저장 슬러그 |
| `slug` | `string` `{book}-{NN}` | ✅ | `slugOf()` | 저장 키, 파일명, 문항 id, 음원 트랙 id |
| `title` | `string` (영어) | ✅ | 집필 | 챕터 표지, 목차, 러닝헤드 |
| `cefr` | `'B2'` | ✅ | `blankChapter()` | 표지 배지, 필터 |
| `edition` | `number` 1..3 | — | 편집 화면 | 판 구분(같은 챕터의 3판) |
| `targetSkills[]` | `string[]` | ✅(warn) | 집필 | 챕터 오프너 "이 챕터에서 훈련하는 것" |
| `teaching` | `Teaching` | ✅(warn) | 집필 | 교사판 PDF, 챕터 오프너 |
| `glossary[]` | `{term,gloss}[]` | ✅(warn) | 집필/생성 | 챕터 어휘 페이지 |
| `indexTerms[]` | `string[]` | ✅(warn) | 집필 | 책 뒤 색인, 검색 사이드카 |
| `audio` | `Audio` | 리스닝만 ✅ | 집필 + TTS 파이프라인 | 음원 생성기, 대본 페이지 |
| `modelAnswers[]` | `ModelAnswer[]` | 스피킹·라이팅 ✅(warn) | 집필 | 교사판 PDF, 채점 기준 |
| `provenance` | `Provenance` | ✅(warn) | 편집 화면 + `validate()` | 검토 대시보드, 릴리스 게이트 |

`✅(warn)` 은 "비면 저장은 되지만 `warn` gate 가 뜬다"는 뜻이다. 시험은 돌아가지만
교사용 PDF 가 빈 페이지로 나온다.

---

## 3. 하위 객체

### 3-1. `Module`

기존 섹션 조각과 **완전히 동일**하다. 새 키를 더하지 않는다.

| 필드 | 타입 | 필수 | 값 |
|---|---|---|---|
| `id` | `string` | ✅ | blueprint 가 고정 — `R1 R2` / `L1 L2` / `S1 S2` / `W1 W2 W3` |
| `label` | `string` | ✅ | blueprint 가 고정 |
| `timeLimitSec` | `number \| null` | — | blueprint 가 고정 |
| `blocks[]` | `Block[]` | ✅ | 개수·순서·kind 전부 blueprint 가 고정 |

### 3-2. `Block`

`kind` 별 필드도 기존 조각과 동일하다. 교재가 더하는 것은 `audioRef` / `introAudioRef`
둘뿐이며, 이유는 §3-5 에 있다.

| 필드 | 타입 | 어느 kind | 설명 |
|---|---|---|---|
| `kind` | `'cloze'\|'passage'\|'audio-set'\|'record-set'\|'build-set'\|'free-write'` | 전부 | blueprint 가 고정 |
| `heading` | `string` | 전부 | `"Questions 7-8"` — 인쇄면 라벨 |
| `instruction` | `string` | 전부 | 학생에게 보이는 지시문(영어) |
| `template` | `string` | `cloze` | `{{7}}` 자리표시자를 문항 `no` 마다 하나씩 포함해야 한다 |
| `title` | `string` | `passage` | 지문 제목 |
| `paragraphs[]` | `string[]` | `passage` | 지문 본문. 문단 하나가 원소 하나 |
| `audioRef` | `string` | `audio-set` | `chapter.audio.tracks[].id` 를 가리킨다 |
| `perQuestionAudio` | `boolean` | `audio-set`·`record-set` | 참이면 블록이 아니라 문항마다 음원이 붙는다 |
| `introAudioRef` | `string` | `record-set` | 안내 음원 트랙 id |
| `introScript` | `string` | `record-set` | 안내 음원 대본 |
| `images[]` | `string[]` | 임의 | 파일명만. `toPack()` 이 경로로 편다 |
| `questions[]` | `Question[]` | 전부 | 개수·종류 구성을 blueprint 가 고정 |

### 3-3. `Question`

| `kind` | 자동채점 | 필수 필드 |
|---|---|---|
| `blank` | ✅ | `id, no, hint, answer` — `answer` 는 문자열, `hint` 는 그 앞글자 |
| `mcq` | ✅ | `id, no, prompt, choices[], answer` — `answer` 는 0 기준 색인 |
| `insert` | ✅ | `mcq` 와 같다. 문장 삽입 위치를 고르는 문항 |
| `build` | ✅ | `id, no, context, slots[], tiles[], sentence, answerTokens[]` |
| `repeat` | ✗ 사람 | `id, no, script` 또는 `audioRef`, `prepSec, respondSec` |
| `interview` | ✗ 사람 | `repeat` 과 같다 |
| `email` | ✗ 사람 | `id, no, to, subject, situation, bullets[], prompt` |
| `discussion` | ✗ 사람 | `id, no, professor, prompt, posts[{name,text}]` |

공통 규칙

- **`no` 는 챕터 전체에서 1..N 연속이다.** 모듈이 바뀌어도 1로 돌아가지 않는다.
  (SET 9 는 모듈마다 다시 1로 시작한다 — 교재는 그 관례를 따르지 않는다. 인쇄물은
  "37번 문제"라는 말이 책 전체에서 한 곳만 가리켜야 하기 때문이다.)
- **`id` 는 `{slug}-{moduleId}-q{NN}`** — 예: `reading-03-R1-q07`. `no` 가 챕터 안에서
  유일하므로 id 도 유일하다. 겹치면 답안 저장이 서로를 덮어써 학생 답이 사라진다.

### 3-4. `Teaching`

| 필드 | 타입 | 최소 | 어디에 인쇄되나 |
|---|---|---|---|
| `objective` | `string` | 1문장 | 챕터 오프너 + 교사판 첫 장 |
| `strategy[]` | `string[]` | 2 | 학생판 "How to attack this" 상자 |
| `commonErrors[]` | `string[]` | 2 | 교사판 전용. `modelAnswers` 의 `low` 밴드와 짝지어 읽힌다 |

### 3-5. `Audio` (리스닝 전용)

```
audio: {
  tracks: [
    { id, scriptRef, script?, voiceCast: [{ role, character }] }
  ]
}
```

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `id` | `string` | ✅ | `{slug}-{moduleId}-{from}-{to}` (예: `listening-03-L1-07-08`). 문항별 음원이면 `{slug}-{moduleId}-q{NN}` |
| `scriptRef` | `string` | `script` 와 택일 | 대본 사이드카(`{slug}_script.json`)의 키. `_set9_fragments/listening_script.json` 과 같은 모양 |
| `script` | `string` | `scriptRef` 와 택일 | 대본을 챕터 안에 직접 넣을 때 |
| `voiceCast[]` | `{role,character}[]` | ✅(warn) | `config/set9-voice-casting.json` 의 `characters[].name` 을 `character` 로 쓴다 |

**왜 `audioRef` 를 따로 두나** — 기존 조각은 블록에 `audio: "media/audio/set9/…mp3"` 경로가
박혀 있다. 교재는 한 챕터가 여러 판(3판)으로 나가고 저장 위치가 판마다 달라서, 원고에
경로를 박으면 판을 바꿀 때마다 원고를 고쳐야 한다. 그래서 원고는 **이름(`audioRef`)** 만
들고, 경로는 `toPack()` 이 `paths.audio + id + '.mp3'` 로 편다. 원고에 이미 `audio` 경로가
들어 있으면 그 값을 존중한다(기존 SET 을 챕터로 옮겨 온 경우).

대본이 없는 트랙은 `stop` 이다. TTS 의 입력이 대본이므로, 대본이 없으면 소리를 만들 수 없고,
소리가 없으면 그 블록의 문항은 응시 화면에서 답할 수 없다.

### 3-6. `ModelAnswer` (스피킹·라이팅 전용)

```
modelAnswers: [ { questionId, band, text, score?, notes? } ]
```

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `questionId` | `string` | ✅ | 그 챕터 안의 문항 id |
| `band` | `'high' \| 'mid' \| 'low'` | ✅ | `blueprint.book.json → modelAnswerBands` |
| `text` | `string` | ✅ | 실제 응답 전문 |
| `score` | `number` | — | ETS 공식 루브릭 점수(있으면) |
| `notes` | `string` | — | 교사판에 붙는 해설. `teaching.commonErrors` 와 연결하면 좋다 |

`free-write` 문항(라이팅 W2·W3)과 `interview` 문항(스피킹 S2)은 **`high` 밴드 하나가
반드시 있어야** 한다(없으면 `warn`). 채점 기준을 글로만 적어 두면 교사마다 점수가 갈린다 —
견줄 실제 응답이 있어야 한다. `repeat` 문항(스피킹 S1)은 제외한다. 대본 자체가 모범답안이다.

### 3-7. `Provenance`

`config/timing.*.json` 의 provenance 관례(`docs/bmad/timing-spec.md` 2절)를 따른다 —
근거를 값 옆이 아니라 한곳에 모아 둔다.

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `authoredBy` | `string` | ✅(warn) | 사람 이름 또는 모델 id |
| `authoredAt` | `ISO8601 \| null` | — | |
| `reviewedBy` | `string` | — | |
| `reviewedAt` | `ISO8601 \| null` | ✅(warn) | `null` 이면 사람 검토 전이다 |
| `level` | `'authored' \| 'generated' \| 'adapted' \| 'assumed'` | — | `blueprint.book.json → provenanceLevels` |
| `gateResults[]` | `{level,scope,message,status,at}[]` | ✅ | 마지막 `validate()` 결과의 보존 기록 |

`gateResults[].status` 는 `'open' \| 'accepted' \| 'fixed'`. `accepted` 는 "이 `warn` 은
사람이 보고 그대로 두기로 했다"는 뜻이며, 누가 언제 받아들였는지가 `at` 에 남는다.
런타임은 `provenance` 를 **읽지 않는다**. 검토 대시보드와 릴리스 판정에만 쓴다.

---

## 4. `SG_BOOK_SCHEMA` API

`assets/book-schema.js`, ES5 IIFE, 전역 하나(`window.SG_BOOK_SCHEMA`), 빌드 단계 없음.
node 에서도 `require()` 로 그대로 불린다(테스트용).

```js
SG_BOOK_SCHEMA.validate(chapter, opt?)   -> { ok: boolean, gates: [{level, scope, message}] }
SG_BOOK_SCHEMA.blankChapter(book, chapterNo) -> chapter
SG_BOOK_SCHEMA.toPack(chapters[], opt?)  -> pack   // set9.js 모양
SG_BOOK_SCHEMA.countQuestions(chapter)   -> number

SG_BOOK_SCHEMA.useBlueprint(blueprintJson) -> boolean
SG_BOOK_SCHEMA.shapeOf(book)             -> blueprint 의 그 권 항목
SG_BOOK_SCHEMA.slugOf(book, chapterNo)   -> 'reading-03'
SG_BOOK_SCHEMA.questionId(slug, moduleId, no) -> 'reading-03-R1-q07'
SG_BOOK_SCHEMA.trackId(slug, moduleId, from, to) -> 'listening-03-L1-07-08'
SG_BOOK_SCHEMA.walk(chapter)             -> [{q, block, module, mi, bi, qi}]

SG_BOOK_SCHEMA.SCHEMA_VERSION  // '1.0.0'
SG_BOOK_SCHEMA.BOOKS           // ['reading','listening','speaking','writing']
SG_BOOK_SCHEMA.SECTION_ORDER   // ['reading','listening','writing','speaking']
SG_BOOK_SCHEMA.CEFR            // 'B2'
```

### 4-1. gate 모양은 `set-import.js` 와 같다

```js
{ level: 'stop' | 'warn', scope: string, message: string }
```

- `stop` — 시험을 만들 수 없는 문제. 저장 버튼을 잠근다.
- `warn` — 만들 수는 있지만 사람이 봐야 하는 문제.
- `ok` 는 "`stop` 이 하나도 없다"는 뜻이다. `warn` 만 있으면 `ok:true` 이고 저장된다.
- 메시지는 **영어**다(화면에 그대로 뜬다). 코드 주석·이 문서는 한국어다.

두 파일이 다른 모양을 쓰면 관리자 화면이 gate 를 두 번 해석해야 하므로 모양을 고정한다.

### 4-2. `scope` 값

| scope | 무엇을 잡나 |
|---|---|
| `book` | `book` 필드가 4권 중 하나가 아님 |
| `chapter` | `chapterNo` 범위, `id`≠`book`, `slug` 불일치, `title` 비었음, `cefr` |
| `structure` | 모듈 개수·id, 블록 개수·kind, `heading` 없음 |
| `count` | 블록별 문항 수, 문항 종류 구성, 챕터 총 문항 수가 blueprint 와 다름 |
| `ids` | 문항 id 없음/중복, `no` 없음/중복 |
| `answer` | 자동채점 문항에 정답 없음, 정답 색인이 선택지 범위 밖 |
| `cloze` | 힌트가 정답의 앞글자가 아님, 힌트가 정답 전체, `{{n}}` 자리표시자 없음 |
| `choices` | 선택지 3개 미만, 빈 선택지, blueprint 와 다른 선택지 수 |
| `questions` | 지문/템플릿/프롬프트가 비었음, 이메일 bullet·토론 post 부족, 타일 부족 |
| `audio` | 트랙 없음/중복/대본 없음, `audioRef` 가 트랙을 못 찾음, voiceCast 없음 |
| `teaching` | `targetSkills`·`objective`·`strategy`·`commonErrors` 부족 |
| `glossary` | `glossary`·`indexTerms` 비었음 |
| `model` | `high` 밴드 모범답안 없음 |
| `provenance` | `authoredBy` 비었음, `reviewedAt` 이 `null` |

### 4-3. `stop` 으로 막는 것들 (요약)

정답 없는 자동채점 문항 · 클로즈 힌트/정답 불일치 · 선택지 3개 미만 · blueprint 와 다른
문항 수 · 리스닝 블록의 대본/음원 누락 · 문항 id 중복. 나머지는 전부 `warn` 이다.

### 4-4. `blankChapter(book, chapterNo)`

blueprint 가 구조를 정하고 내용은 전부 빈 문자열인 뼈대를 만든다. **생성기가 채우는 것은
빈 칸이지 구조가 아니라는 원칙을 이 함수가 물리적으로 강제한다** —
`api/generate.js` 는 `blankChapter()` 로 시작해 값만 넣고, 모듈/블록을 더하거나 빼지 않는다.
빈 뼈대는 당연히 `validate()` 를 통과하지 못한다(내용이 비어 있으므로).

### 4-5. `toPack(chapters[], opt?)`

챕터를 `set9.js` 와 같은 모양의 콘텐츠 팩으로 바꾼다. **챕터 하나를 그대로 시험으로 돌려
보는 것이 존재 이유다** — 원고가 진짜 시험으로 돌아가는지 확인하지 않으면 인쇄한 뒤에야
렌더링 실패를 안다.

- 섹션 배열은 `SECTION_ORDER`(reading→listening→writing→speaking) 순, 같은 권 안에서는
  `chapterNo` 순으로 정렬한다.
- 챕터 한 장만 넘기면 섹션 `id` 는 `'reading'` 그대로다 → `timing.toefl.json` 의 섹션별
  시간 배정이 손대지 않고 붙는다. **같은 권의 챕터를 두 장 이상** 넘기면 그 권만 섹션 `id`
  를 `slug` 로 밀어 낸다(`'reading-03'`). 섹션 id 충돌로 두 챕터가 서로를 가리는 것을 막는다.
- `audioRef` / `introAudioRef` 를 `paths.audio + id + '.mp3'` 경로로 편다.
- 정답표는 **문항에 붙어 있는 `answer` 만** 걷는다 — `set-import.js` `finalize()` 와 같은
  원칙이다. 정답을 두 곳에 두면 언젠가 한쪽만 고쳐지고, 그날 학생이 맞고도 틀린다.
- `pack.allQuestions()` / `pack.findQuestion(id)` 를 붙인다 —
  `set-import.js` `withHelpers()` 와 같은 시그니처.

```js
{
  code, title, paths: {audio, pics}, sections: [...],
  answerKey: {},
  buildWarnings: [], gates: [],
  summary: { questions, bySection, autoScored, humanScored, chapters: [...], gates: {stop, warn} },
  importedAt: null, source: 'book-schema',
  allQuestions(), findQuestion(id)
}
```

### 4-6. 문항 수 표가 두 곳에 있는 이유

`blueprint.book.json` 이 정본이지만, 브라우저 검산은 `fetch` 없이 즉시 돌아야 해서
`book-schema.js` 안에 같은 표의 사본(`SHAPE`)이 있다. 사본이 낡는 사고를 막는 문이
`useBlueprint(json)` 이다 — blueprint 파일을 실제로 읽은 화면은 이걸 불러 정본을 실어 준다.
그러면 파일이 사본을 이긴다. **숫자를 고칠 때는 두 곳을 같이 고친다.**

사본이 옮겨 적는 것은 '구조'뿐이다 — 모듈 id·순서, 블록 kind·순서, 블록별 문항 수,
문항 종류 구성. 지시문(`instruction`) 같은 문구는 검산하지 않는다. 문구는 편집으로 바뀌고,
문구가 달라졌다고 저장을 막으면 편집자가 검산을 꺼 버린다.

---

## 5. 챕터 구조표 (blueprint.book.json 요약)

| 권 | 모듈 | 블록 | 문항 | 권 합계 |
|---|---|---|---|---|
| **reading** | `R1` (600s) | cloze 10 · passage 2(mcq) · passage 3(mcq) | 15 | **30** |
| | `R2` (450s) | cloze 10 · passage 5(mcq 4 + insert 1) | 15 | |
| **listening** | `L1` | audio-set 6(문항별 음원) · conversation 2 · announcement 2 · talk 4 | 14 | **22** |
| | `L2` | audio-set 2(문항별 음원) · conversation 2 · talk 4 | 8 | |
| **speaking** | `S1` (600s) | record-set `repeat` 7 (prep 3s / respond 20s) | 7 | **11** |
| | `S2` (600s) | record-set `interview` 4 (prep 3s / respond 45s) | 4 | |
| **writing** | `W1` (600s) | build-set 10 | 10 | **12** |
| | `W2` (600s) | free-write `email` 1 (min 80 words) | 1 | |
| | `W3` (600s) | free-write `discussion` 1 (min 100 words) | 1 | |

리딩 챕터 `timeLimitSec` 은 1050(모의고사 2100 의 절반). 나머지 권은 조각 원본과 같이
섹션 `timeLimitSec` 은 `null` 이고 모듈 시계가 실제 상한이다.

스피킹·라이팅은 실제 시험과 **문항 수가 같다**. 이미 짧아서 더 줄이면 과제 종류가 빠진다.

---

## 6. 저장·파일명 규약

| 대상 | 규약 | 예 |
|---|---|---|
| 책 id | `reading` / `listening` / `speaking` / `writing` | `reading` |
| 챕터 슬러그 | `{book}-{NN}` (2자리 0패딩) | `reading-03` |
| localStorage 본문 | `sg2:book:{slug}` | `sg2:book:reading-03` |
| localStorage 목록 | `sg2:book-index` | `[{slug,book,chapterNo,title,savedAt,questions}]` |
| 문항 id | `{slug}-{moduleId}-q{NN}` | `reading-03-R1-q07` |
| 음원 트랙 id (블록) | `{slug}-{moduleId}-{from}-{to}` | `listening-03-L1-07-08` |
| 음원 트랙 id (문항) | `{slug}-{moduleId}-q{NN}` | `listening-03-L1-q03` |
| 음원 파일 | `media/audio/{slug}/{trackId}.mp3` | `media/audio/listening-03/listening-03-L1-07-08.mp3` |
| 그림 | `media/pictures/{slug}/{name}` | |
| 대본 사이드카 | `config/_book/{slug}_script.json` | `listening_script.json` 과 같은 모양 |
| 검색 사이드카 | `config/_book/{slug}.index.json` | |
| 학생용 PDF | `{slug}.student.pdf` | |
| 교사용 PDF | `{slug}.teacher.pdf` | |

`sg2:book:` 접두어는 `sg2:set:`(`assets/set-store.js`)와 **일부러 다르다**. 교재 챕터가
세트 목록에 섞여 뜨면 관리자가 시험 세트인 줄 알고 학생에게 배정한다. 챕터를 시험으로
돌리려면 `toPack()` 을 거쳐 명시적으로 세트를 만들어야 한다.

---

## 7. 트랙별 계약 (누가 무엇을 만지나)

| 트랙 | 쓰는 것 | 읽는 것 |
|---|---|---|
| 편집 화면 | 챕터 전체, `provenance` | `blankChapter`, `validate`, `blueprint.book.json` |
| 생성기(LLM) | `blankChapter()` 결과의 빈 칸만 | `blueprint.book.json` — 구조는 절대 만들지 않는다 |
| PDF 조판 | — | `modules/blocks/questions`, `teaching`, `glossary`, `title`, `targetSkills` |
| 교사판 PDF | — | 위 + `answer` 전부, `modelAnswers`, `teaching.commonErrors` |
| 음원 파이프라인 | 실제 mp3 파일 | `audio.tracks[]`, 대본 사이드카, `set9-voice-casting.json` |
| 세트 내보내기 | 팩(`sg2:set:*`) | `toPack()` |
| 색인 사이드카 | `{slug}.index.json` | `indexTerms`, `glossary`, `title` |

**어느 트랙도 `modules/blocks/questions` 의 모양을 바꾸지 않는다.** 그 모양은
`_set9_fragments/*.json` 과 시험 엔진이 공유하는 계약이고, 여기서 갈라지면 교재와 시험이
서로 다른 문항 포맷을 갖게 된다.

---

## 8. 인쇄 제약이 스키마에 남긴 자국

- **A4 흑백에서 읽혀야 한다.** 색으로만 구분되는 정보를 문항에 넣지 않는다.
  `blueprint.book.json` 이 `choices: 4` 를 고정하는 것도 조판 폭 때문이다.
- **`heading` 은 필수에 가깝다**(없으면 `warn`). 인쇄면은 스크롤이 없어 "Questions 7-8"
  라벨이 없으면 문항이 어느 지문에 속하는지 알 수 없다.
- **`no` 가 챕터 전체에서 연속**인 것도 인쇄 때문이다. §3-3 참조.
- **PDF 는 당분간 관리자·교사 전용 다운로드다.** 학생 배포·워터마크는 이번 범위 밖이고,
  그래서 챕터 스키마에 배포·라이선스 필드가 없다. 나중에 필요하면 최상위에 더한다
  (상위집합 원칙상 더하는 것은 언제나 안전하다).
