# SMEAG TOEFL 웹앱 — 모듈 인터페이스 계약서

병렬 작업자 전원이 이 문서를 **단일 진실 소스**로 삼는다. 여기 적힌 시그니처는
협의 없이 바꾸지 않는다. 자기 소유 파일 외에는 절대 수정하지 않는다.

## 절대 규칙

1. **빌드 없음 · ES module 없음 · npm 없음.** 모든 파일은 `<script src="...">` 로
   로드되는 클래식 스크립트이며 `window.<전역>` 하나를 정의한다.
   `import` / `export` / `type="module"` 금지 — `file://` 더블클릭으로도 열려야 한다.
2. **`fetch()` 로 로컬 파일을 읽지 않는다.** `file://` 에서 CORS 로 막힌다.
   데이터는 이미 `window.SMEAG_SET1` 로 로드되어 있다.
3. 즉시실행 함수로 감싸고 `'use strict';` 를 쓴다.
4. 주석·UI 문구는 한국어. 시험 지문/문제는 영어 원문 그대로.
5. 미디어 경로에는 공백이 있다 (`TOEFL MOCK TEST  SET 1/...`).
   `<audio src>` / `<img src>` 에 넣을 때 반드시 `SMEAG.encodePath(p)` 를 쓴다.
6. 외부 CDN 의존 금지. 예외는 `sync.js` 의 Supabase JS 한 개뿐이며,
   로드 실패해도 앱 전체가 정상 동작해야 한다.

## 로드 순서 (exam.html / results.html / index.html 공통)

```html
<link rel="stylesheet" href="app/css/app.css">
<script src="app/js/config.js"></script>
<script src="app/js/data/set1.js"></script>
<script src="app/js/util.js"></script>
<script src="app/js/store.js"></script>
<script src="app/js/timer.js"></script>
<script src="app/js/audio.js"></script>
<script src="app/js/recorder.js"></script>
<script src="app/js/grade.js"></script>
<script src="app/js/sync.js"></script>
<script src="app/js/sections/reading.js"></script>
<script src="app/js/sections/listening.js"></script>
<script src="app/js/sections/writing.js"></script>
<script src="app/js/sections/speaking.js"></script>
<script src="app/js/exam.js"></script>
```

---

## 데이터 스키마 (`window.SMEAG_SET1` — 이미 완성됨, 수정 금지)

```
SMEAG_SET1 = {
  code:'SET1', title:'NEW TOEFL SET 1',
  paths:{audio, pics, speaking},
  sections:[ Section, ... ],          // reading, listening, writing, speaking
  allQuestions() -> [{q, block, module, section}, ...]   // 91개
  findQuestion(id) -> {q, block, module, section} | null
}

Section = { id, label, labelKo, timeLimitSec|null, modules:[Module] }
Module  = { id, label, timeLimitSec?, blocks:[Block] }
Block   = { kind, heading, instruction?, questions:[Question], ...kind별 필드 }
```

### Block.kind 별 추가 필드

| kind | 추가 필드 |
|---|---|
| `cloze` | `template` — `{{1}}`~`{{10}}` 자리표시자를 가진 지문 |
| `passage` | `title`, `paragraphs[]` (Roman Roads 3번째 문단엔 `{{A}}`~`{{D}}` 삽입점) |
| `chat` | `messages[] = {name, time, side:'left'\|'right', text}` |
| `audio-set` | `audio?` (블록 공용), `image?`, `perQuestionAudio?:true` |
| `build-set` | 없음 |
| `free-write` | 없음 |
| `record-set` | `introAudio` |

### Question.kind 별 필드

| kind | 필드 | 응답값(response) 타입 |
|---|---|---|
| `blank` | `no, hint, answer` | `string` — 학생이 입력한 **전체 단어** (hint 포함된 완성형) |
| `mcq` | `no, prompt, choices[4], answer:0-3`, (+`layout:'short-response'`, `audio`, `image`) | `number` 0-3, 미응답 `null` |
| `insert` | `no, prompt, sentence, choices[4], answer:0-3` | `number` 0-3 |
| `build` | `no, context, slots[], tiles[], sentence, answerTokens[]` | `string[]` — blank 슬롯에 놓인 토큰 배열 |
| `email` | `no, to, subject, situation, bullets[], minWords` | `string` — 작성 본문 |
| `discussion` | `no, professor, prompt, posts[], minWords` | `string` |
| `repeat` / `interview` | `no, audio, image, prepSec, respondSec` | `{recorded:boolean, durationMs:number, skipped?:boolean}` |

`slots[]` 원소: `{t:'f', text}` 고정 표시 · `{t:'b', a:'정답토큰'}` 타일 자리.
blank 슬롯 순서 = `answerTokens` 순서.

---

## 파일별 소유자 & 계약

### `app/js/config.js` — 담당 A
```js
window.SMEAG_CONFIG = {
  supabaseUrl: '',            // 비어 있으면 동기화 비활성
  supabaseAnonKey: '',
  supabaseJsCdn: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js',
  storageBucket: 'toefl-recordings',
  student: { name: 'Sunny', code: 's2025001' },
  debug: false
};
```

### `app/js/util.js` — 담당 A → `window.SMEAG`
```js
SMEAG.encodePath(p)        // 공백 포함 경로를 src 에 안전하게 (encodeURI, 이미 인코딩된 건 중복 방지)
SMEAG.el(tag, attrs, kids) // 엘리먼트 생성 헬퍼. attrs.class/text/html/on* 지원
SMEAG.esc(s)               // HTML 이스케이프
SMEAG.fmtTime(sec)         // 754 -> '12:34'
SMEAG.fmtDate(iso)         // '2026-08-03'
SMEAG.uid()                // 'a1b2c3d4e5' (crypto.randomUUID 있으면 그걸로)
SMEAG.tokenize(s)          // 채점용: 소문자화, 구두점/따옴표 정규화 → string[]
SMEAG.normWord(s)          // 빈칸 채점용: trim + 소문자 + 내부공백제거
SMEAG.qs(name)             // location.search 파라미터
```

### `app/js/store.js` — 담당 A → `window.SMEAG_STORE`
localStorage 키: `smeag.toefl.attempts`(목록) · `smeag.toefl.current`(진행중) · `smeag.toefl.syncQueue`
녹음 Blob 은 IndexedDB `smeag-toefl` / store `recordings`, 키 `<attemptId>:<questionId>`.

```js
Attempt = {
  id, setCode:'SET1', startedAt:ISO, submittedAt:ISO|null,
  status:'in_progress'|'submitted'|'synced',
  cursor:{ sectionId, moduleId, blockIndex, questionIndex },
  answers:{ [questionId]: response },      // 위 표의 response 타입
  played:{ [audioKeyOrQuestionId]: true }, // 1회 재생 기록
  elapsed:{ [sectionId]: seconds },
  score: null | ScoreReport                 // grade.js 산출물
}

SMEAG_STORE.current()                 -> Attempt | null   (status==='in_progress')
SMEAG_STORE.start()                   -> Attempt          (기존 진행중이 있으면 폐기하고 새로)
SMEAG_STORE.resume()                  -> Attempt | null
SMEAG_STORE.save(attempt)             -> void             (즉시 write)
SMEAG_STORE.setAnswer(qid, response)  -> void             (current 에 반영 + save)
SMEAG_STORE.getAnswer(qid)            -> response | undefined
SMEAG_STORE.markPlayed(key)           -> void
SMEAG_STORE.hasPlayed(key)            -> boolean
SMEAG_STORE.setCursor(cursor)         -> void
SMEAG_STORE.submit(scoreReport)       -> Attempt          (status='submitted', submittedAt 기록)
SMEAG_STORE.list()                    -> Attempt[]        (최신순)
SMEAG_STORE.get(id)                   -> Attempt | null
SMEAG_STORE.remove(id)                -> void
SMEAG_STORE.bests()                   -> {reading, listening, writing, total, attempts}  // 대시보드용
SMEAG_STORE.putRecording(attemptId,qid,blob) -> Promise<void>
SMEAG_STORE.getRecording(attemptId,qid)      -> Promise<Blob|null>
SMEAG_STORE.listRecordings(attemptId)        -> Promise<[{qid, blob}]>
```

### `app/js/timer.js` — 담당 A → `window.SMEAG_TIMER`
```js
var t = SMEAG_TIMER.create({ seconds, onTick(remaining), onExpire() });
t.start(); t.pause(); t.resume(); t.stop(); t.remaining();
```

### `app/js/audio.js` — 담당 A → `window.SMEAG_AUDIO`
컨트롤 없는 `<audio>`. **재생 1회만 허용** (`SMEAG_STORE.hasPlayed(key)` 로 판정).
```js
var p = SMEAG_AUDIO.create({
  src, playKey,               // playKey 로 1회 재생 제어
  autoplay:true,
  onEnded(), onBlocked()      // onBlocked: 브라우저 자동재생 차단 → 사용자 클릭 유도
});
p.element   // 화면에 붙일 DOM (재생 상태 표시 + 차단 시 '재생' 버튼)
p.play(); p.stop(); p.isDone();
```

### `app/js/recorder.js` — 담당 A → `window.SMEAG_REC`
```js
SMEAG_REC.available()                 -> boolean   (MediaRecorder + getUserMedia)
SMEAG_REC.requestPermission()         -> Promise<boolean>
SMEAG_REC.start()                     -> Promise<void>
SMEAG_REC.stop()                      -> Promise<{blob, durationMs, mime}>
SMEAG_REC.release()                   -> void      (트랙 종료)
```
권한 거부 시 절대 throw 하지 말 것 — `available()`/`requestPermission()` 이 `false` 를
돌려주고, 스피킹은 `{recorded:false, skipped:true}` 로 기록하며 시험은 계속 진행한다.

### `app/js/sections/*.js` — 담당 B → `window.SMEAG_SECTIONS[id]`
네 파일 모두 **동일한 렌더러 인터페이스**를 구현한다.
```js
window.SMEAG_SECTIONS = window.SMEAG_SECTIONS || {};
window.SMEAG_SECTIONS.reading = {   // 'listening' | 'writing' | 'speaking'
  /**
   * 한 블록을 화면에 그린다.
   * @param ctx {
   *   root:     HTMLElement       // 여기에 append (호출 전 비워짐)
   *   section, module, block      // SMEAG_SET1 노드
   *   getAnswer(qid), setAnswer(qid, response),
   *   hasPlayed(key), markPlayed(key),
   *   attemptId,
   *   onReady()      // 이 블록에서 '다음' 버튼을 활성화해도 될 때 호출
   *   onAutoAdvance()// 스피킹처럼 스스로 다음으로 넘어가야 할 때 호출
   * }
   * @returns {{ destroy():void }}   // 타이머/오디오/스트림 정리
   */
  renderBlock: function (ctx) { ... }
};
```
- 리스닝/스피킹은 오디오 재생이 끝나기 전 `onReady()` 를 호출하지 않는다.
- 리딩/라이팅은 렌더 직후 `onReady()` 를 호출한다.
- 블록 안 문항이 여러 개면 한 화면에 전부 표시한다 (블록 = 한 페이지).
- 답변 변경 시 즉시 `ctx.setAnswer(...)` 를 호출한다 (자동저장).

### `app/js/grade.js` — 담당 C → `window.SMEAG_GRADE`
```js
SMEAG_GRADE.run(attempt) -> ScoreReport

ScoreReport = {
  perQuestion: { [qid]: { correct:boolean|null, response, expected, kind } },
                                  // correct=null → 자동채점 불가(이메일/토론/스피킹)
  sections: {
    reading:   {correct, total:35, pct},
    listening: {correct, total:33, pct},
    writing:   {correct, total:10, pct},   // Build a Sentence 만
    speaking:  {submitted, total:11}
  },
  autoScore: {correct, total:78, pct},
  pending: ['W-EMAIL','W-DISC','S-1', ...],   // 채점 대기 항목
  gradedAt: ISO
}
```
채점 규칙 — `blank`: `SMEAG.normWord` 비교. `mcq`/`insert`: 인덱스 비교.
`build`: `SMEAG.tokenize(제출문장) === SMEAG.tokenize(answerTokens.join(' '))`.

### `results.html` — 담당 C
`?attempt=<id>` 로 특정 회차. 없으면 최신 submitted.
영역별 점수 · 문항별 정오 리뷰(내 답/정답/원문 지문·오디오 다시 듣기) ·
오답만 필터 · 이메일/토론 답안 · 녹음 재생(IndexedDB) · 동기화 상태 배지.

### `app/js/sync.js` — 담당 D → `window.SMEAG_SYNC`
```js
SMEAG_SYNC.enabled()            -> boolean   (config 에 URL/키가 있는가)
SMEAG_SYNC.push(attempt)        -> Promise<{ok:boolean, error?:string}>
SMEAG_SYNC.retryQueue()         -> Promise<{done:number, failed:number}>
SMEAG_SYNC.queueSize()          -> number
```
Supabase JS 를 CDN 에서 동적 `<script>` 로 로드하고, 실패하면 `enabled()` 가 계속
true 여도 `push()` 가 `{ok:false}` 를 돌려주며 큐에 남긴다. 절대 throw 금지.
익명 인증(`signInAnonymously`) 으로 `auth.uid()` 확보 후 upsert.

### `supabase/schema.sql` — 담당 D
`toefl_attempts` / `toefl_answers` / `toefl_submissions` + RLS + Storage 버킷 정책.

### `exam.html` + `app/js/exam.js` — 담당 E
블록 단위 페이지 진행. 상단: 섹션명 · 진행률 · 남은시간 · 문항 팔레트.
하단: 이전/다음/섹션 제출. 새로고침 시 `SMEAG_STORE.resume()` 로 이어하기 모달.
마지막 섹션 종료 → `SMEAG_GRADE.run()` → `SMEAG_STORE.submit()` →
`SMEAG_SYNC.push()` (실패해도 진행) → `results.html?attempt=<id>` 이동.

### `index.html` — 담당 F
기존 SMEAG 디자인/사이드바 유지. 대시보드 카드·성적표·오답노트·연습이력을
`SMEAG_STORE` 실데이터로 교체. 모의고사 탭의 TOEFL 타일 → `exam.html?set=1`.

---

## 디자인 토큰 (`app/css/app.css` — 담당 A)

기존 `index.html` 의 값을 그대로 승계한다.
```css
--brand:#5b5ef4; --brand-soft:#eef0ff; --accent:#ff5a36;
--bg:#f5f5fb; --card:#fff; --text:#1c1c28; --muted:#8a8aa0;
--line:#ececf4; --radius:16px;
--ok:#12a150; --bad:#e5484d; --warn:#f5a524;
```
폰트 `'Segoe UI', system-ui, -apple-system, sans-serif`. 900px/680px 반응형 유지.

시험 화면 전용 클래스 (담당 A 가 정의, B/C/E 가 사용):
`.exam-shell .exam-top .exam-body .exam-foot .qpalette .qpalette b.done`
`.choice .choice.sel .cloze-input .tile .tile.used .slot .slot.filled`
`.audio-box .rec-dot .badge-ok .badge-bad .review-row .stat-tile`
