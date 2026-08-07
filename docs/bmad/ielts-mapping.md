# TOEFL ↔ IELTS 이식 구현 노트 (Epic 6 · 6.1 / 6.2 / 6.3 / 6.5)

이 문서는 **구현된 결과의 기록**이다. 요구사항 정본은 prd.md, 구조 정본은 architecture.md,
숫자 정본은 `studyground/sg2/config/timing.*.json` 이다. 여기와 저 문서들이 어긋나면 저쪽이 이긴다.

핵심 결론부터: **런타임 코드는 포크되지 않았다.** IELTS 는 config(`timing.ielts.json`) +
콘텐츠(`config/ielts-sample.js`) 교체로 구동되며, 컴파일러·렌더러에 추가된 것은
"config/콘텐츠에 그 필드가 있으면 화면을 하나 더 만든다" 수준의 분기뿐이다.
TOEFL 프로파일의 컴파일 출력은 **JSON 직렬화 기준으로 변경 전과 동일**하다
(`tests/test_compile_screens.js` + `test_compile_ielts.js §6`).

---

## 1. 섹션 대조표

| 항목 | TOEFL (`timing.toefl.json`) | IELTS (`timing.ielts.json`) | 구현 경로 |
|---|---|---|---|
| 섹션 순서 | listening → speaking → reading → writing | listening → reading → writing → speaking | `sectionOrder` (코드 변경 없음) |
| Listening 시간 | 모듈별 배정 L1 1080s · L2 900s, 문항당 20s | **섹션 단일 1800s** (4파트 P1–P4) | `sections.listening.sectionSec` |
| Listening 전사시간 | 없음 | **600s transfer time** | `sections.listening.phases[id=transferTime]` → moduleEnd + `transfer` |
| Reading 시간 | 모듈별 R1 1080s · R2 1020s (섹션 2100s 은 숨김 상한) | **섹션 단일 3600s** (3지문) | `sections.reading.sectionSec`, `timerScope:"section"` |
| Writing 시간 | W1/W2/W3 각 600s | TASK1 1200s · TASK2 2400s (섹션 3600s 은 숨김) | `tasks[].perTaskSec`, `timer.scope:"task"` |
| Writing 최소 단어 | W2 80 · W3 100 | TASK1 150 · TASK2 250 | `tasks[].minWords` |
| Speaking 유형 | listenAndRepeat / interview | part1 / part2 / part3 | `sections.speaking.taskTypes.*` |
| Speaking 준비시간 | 3초 | Part1 0 · **Part2 60초** · Part3 0 | `taskTypes.*.prepSec` → phase `prep.seconds` |
| Speaking 응답시간 | S1 20s · S2 45s | Part1 30s · **Part2 120s** · Part3 45s | `taskTypes.*.responseSec` |
| 점수 스케일 | `toefl120` (섹션 30 / 총 120 / CEFR) | `ielts9` (Band 0–9, 0.5 단위) | `exam.scoreScale`, `exam.scale` |

두 config 의 **키 집합은 동일**하다. 유일한 허용 차이는 `sections.speaking.taskTypes` 의
**키 이름**(유형 id)이며, 각 항목의 내부 키 구조는 같다. `test_compile_ielts.js §7` 이 이를 검사한다.

## 2. 화면 컴파일 결과 (샘플 콘텐츠 기준)

`config/ielts-sample.js` 는 구조 검증용 소형 팩이다(각 파트 2문항, Speaking Part 2 는 성격상 1문항).

| 섹션 | 문항 | 문항 화면 | 표시 시계 |
|---|---|---|---|
| Listening | 8 (P1–P4 × 2) | 8 | `section` 1800s, `sharedDeadline`, 4파트 공유 |
| — transfer | — | 1 (`listening.transfer.transferTime`) | `screen` 600s |
| Reading | 6 (지문 3 × 2) | 3 (지문=1화면) | `section` 3600s, 3지문 공유 |
| Writing | 2 | 2 | `task` 1200s / 2400s |
| Speaking | 5 (2 + 1 + 2) | 5 | `screen` response 30/120/45s |

## 3. 각 요구의 구현 방식

### 3.1 Listening transfer time (Story 6.3)

- config 의 `sections.<id>.phases[]` 항목 하나 = 화면 하나. `position:"afterSection"` 이고
  `seconds > 0` 일 때만 만들어진다. **TOEFL 은 모든 섹션이 `phases: []` 이므로 화면이 생기지 않는다**(AC5).
- 화면 계약상 `instruction` 은 `timer === null` 이어야 하므로(exam-types.js AC3-a),
  config 의 `screenType:"instruction"` 을 그대로 쓰지 않고 **`moduleEnd` 로 컴파일**한다.
  `transfer:{enabled:true, editable:true, targetScreenIds:[...]}` 가 붙으면
  `exam-render-instruction.js` 의 moduleEnd 분기가 이전 답안 편집 패널을 그린다(§3.4 기존 구현).
- `targetScreenIds` 는 **해당 섹션의 문항 화면 전체**를 컴파일 시점에 채운다.
  렌더러의 "미지정 시 앞선 화면 전부" 폴백에 의존하지 않는다.
- 편집은 `SG_STORE.upsertAnswer(qid, v, {source:'transfer'})` 로 직접 기록된다
  (엔진 `answer()` 는 현재 화면 소속 문항만 받기 때문). 화면을 떠날 때 `flushAnswers()` 를
  강제해 만료 시점의 답안이 최종이 되게 한다(AC3).
- `Finish early` 는 **2단계 확인**을 거친다(AC4). 별도 모달 컴포넌트가 없어 같은 카드 안에서
  확인 행을 노출/숨김한다 — 새 CSS 를 만들지 않기 위한 선택이다.
- transfer 화면에는 미디어가 붙지 않는다(AC6) — 컴파일러가 `audio` 를 넣지 않고,
  화면 유형이 moduleEnd 라 오디오 유닛 자체가 렌더되지 않는다.

### 3.2 Speaking Part 2 — prep 60초 + cue card (Story 6.2)

**§3.3 설계의 핵심 검증점: Part 2 는 TOEFL 과 코드경로가 같고 숫자만 다르다.**

```
TOEFL  S1   phases = [listen(0), prep(3),  record(20)]
IELTS  Part2 phases = [read(0),  prep(60), record(120)]
```

- `exam-render-speaking.js` 의 phase 루프(`nextPhase`)는 이름과 종료조건만 본다.
  prep 이 3초든 60초든 분기가 없다. `test_compile_ielts.js §5`, `test_speaking_phases.js` 로 고정.
- cue card 는 **콘텐츠에서 온다**: 문항의 `cueCard:{topicEn,topicKo,bullets[],bulletsKo[],image?}`
  를 컴파일러가 `phase.cue` 로 정규화해 `read` 와 `prep` phase 에 싣는다.
  TOEFL 문항에는 이 필드가 없어 분기가 실행되지 않는다(AC5 회귀 없음).
- cue card 패널(주제 + 불릿 + 메모창)은 phase 별이 아니라 **화면 골격에 한 번** 붙는다 —
  read → prep → record 내내 남아야 하기 때문(AC3).
- 메모는 **답안이 아니다**(AC4). `exam-render-speaking.js` 의 세션 메모리 맵에만 남고
  `SG_STORE`/서버로 가지 않는다.
- prep 조기 종료(AC6)는 `Start speaking now` 버튼 → `fire('force')`. 버튼은 **cue 가 있고
  prep 이 0초보다 길 때만** 렌더된다 → TOEFL 3초 prep 화면은 변화 없음.

### 3.3 Reading 60분 단일 카운트다운 / Writing task 타이머

`buildClocks()` 의 섹션 시계 한 줄만 바뀌었다: 섹션 시계는 **더 좁은 시계가 있을 때만 숨긴다**
(`visible: out.length === 0`).

- TOEFL reading — module 시계가 먼저 들어가므로 섹션 시계는 종전대로 `visible:false`. **무변경.**
- IELTS reading/listening — 섹션 시계가 유일하므로 그것이 표시 시계가 된다.
- IELTS writing — task 시계가 표시, 섹션 시계(3600s)는 숨은 상한으로 공존.

### 3.4 점수 표기 (Band 0–9)

프런트는 **표기만** 전환한다. 환산은 백엔드 `app/scoring/scale.py`(Story 6.4, 다른 담당) 몫이다.

- `SG_TIMING.scoreScale()` → `"toefl120" | "ielts9"`
- `SG_TIMING.scaleInfo()` → `{sectionMax, totalMax, step, bandLabel}`
- `SG_TIMING.formatScore(value, grade)` → `"98/120 · B2"` / `"Band 7.0"`
  (`step:0.5` 면 0.5 단위로 반올림해 소수 1자리로 찍는다)

### 3.5 루브릭 (Story 6.5 중 프런트/문서 몫)

- `smeag-local-ai/scoring/rubrics/ielts_writing_task1.md` 신규.
  `ielts_writing_task2.md` 와 같은 형식이며, 다른 것은 첫 criterion 이 **TA(Task Achievement)** 라는 점,
  overview 필수 규칙, 데이터 정확성 규칙, 150/100 단어 페널티다.
- 스키마는 `schemas/ielts_writing_task2.schema.json` 을 **그대로 재사용**한다.
  TA 밴드는 `TR` 키로 출력하라고 루브릭 본문에 명시했다(신규 스키마 파일을 만들지 않기 위함).
- criterion 순서(Writing `TR/TA, CC, LR, GRA`)와 0.5 단위 검증, `PRO ≤ 7.0` 캡 등
  **백엔드 강제**는 `app/scoring/rubric.py` 몫이며 이 작업 범위 밖이다.

---

## 4. 문서와 다르게 구현한 지점 (이유 포함)

| # | 문서 | 실제 구현 | 이유 |
|---|---|---|---|
| 1 | Story 6.3 AC1 "`moduleEnd` 계열의 신규 변형 화면 `transfer`", config 는 `screenType:"instruction"` | `screenType:"moduleEnd"` + `transfer` 필드 | `instruction` 은 계약상 `timer===null` 이라 10분 카운트다운을 달 수 없다. moduleEnd 는 `scope:"screen"` 상한 타이머를 허용하고, 렌더러에 transfer 분기가 이미 있다. |
| 2 | Story 6.3 Files 에 `exam-render.js (transfer 변형)` 신규 | 신규 파일 없음 — 기존 `exam-render-instruction.js` moduleEnd 렌더러 확장 | transfer 패널이 이미 그 파일에 구현돼 있었다. 새 파일은 중복이다. |
| 3 | Story 6.2 AC1 "`exam-types.js` 의 phases 정식 필드" | `exam-types.js` **미수정** | `phases[].name` 유니언은 이미 `read/prep/record` 를 포함하고, `validateScreen` 은 알 수 없는 phase 필드(`cue`)를 거부하지 않는다. 담당 파일 밖이라 손대지 않았다. **후속**: `SpeakingPhase` typedef 에 `cue` 를 문서화할 것. |
| 4 | `timing.ielts.json` 의 `sections.speaking.timerFormat: "MM:SS"` | 컴파일러가 record 화면에 한해 `HH:MM:SS` 로 교정 + warning | speaking 화면의 record phase 는 계약상 `HH:MM:SS` 다(exam-types.js AC4). 그대로 두면 5개 화면 전부 `makeScreen` degrade(타이머 제거)로 떨어진다. config 파일이 담당 파일 밖이라 코드에서 교정했다. **후속**: `timing.ielts.json` 의 값을 `HH:MM:SS` 로 고치면 warning 이 사라진다. |
| 5 | Story 6.2 AC2 prep 만료 → record 자동 전이 | phase 의 `onExpire:"startRecord"` 로 이미 구현돼 있음 | 6.2 이전 스토리에서 완성. 이번 작업에서 추가한 것은 cue/메모/조기시작뿐. |
| 6 | `timing.ielts.json` `directions[id=cueCardPrep]` (`betweenModules`, 60초) | 컴파일되지 않음(무시) | 준비시간은 phase 로 구현된다(§3.3 설계). 같은 60초를 화면으로도 만들면 준비시간이 두 번 생긴다. 컴파일러는 `betweenModules` direction 을 `modules[].moduleEndScreen` 참조로만 삽입하므로 자연히 제외된다. **후속**: config 에서 이 항목을 지울지 결정 필요. |
| 7 | Story 6.1 AC6 "`exam-selftest.html` 이 키 집합 드리프트에 FAIL" | selftest 미수정 — 동일 검사를 `tests/test_compile_ielts.js §7` 에 구현 | `exam-selftest.html` 은 배정 파일이 아니다. node 테스트가 같은 판정을 CI 가능한 형태로 수행한다. |

## 5. 알려진 갭 / 후속 과제

1. **미디어 자산 없음.** `ielts-sample.js` 의 오디오 경로(`media/ielts/audio/*.mp3`, 4건)는 예약만 돼 있다.
   리맵 검사(`SG_MEDIA.isMapped`)는 통과하지만 파일이 없어 재생은 404 → 렌더러가 다음 단계로 넘긴다(F12).
   Writing Task 1 의 차트 이미지도 없어 데이터가 본문 텍스트로 들어가 있다.
2. **Writing 렌더러 제목 고정.** `exam-render-writing.js` 의 비-email 분기 제목이
   "Write for an Academic Discussion" 으로 하드코딩돼 있어 IELTS Task 1/2 에도 그대로 나온다.
   담당 파일 밖이라 손대지 않았다. `q.kind` 로 제목을 고르는 수정이 필요하다.
3. **IELTS Listening 문항 유형.** 실제 IELTS 는 note/form completion, matching 비중이 크지만
   샘플은 전부 `mcq` 다(기존 `audio-set` 렌더러로 구조를 먼저 검증하기 위함).
   completion 유형을 넣으려면 새 blockKind 렌더러를 `SG_QRENDER.register()` 로 붙이면 된다.
4. **Speaking 대면성.** IELTS Speaking 은 본래 대면 인터뷰다. 비대면 녹음으로 대체하며 생긴
   문항당 응답시간(part1 30s / part3 45s)은 `provenance.level:"assumed"` 로 표시돼 있다 — 운영 정책 확정 필요.
5. **CBT(computer-delivered) 전사시간.** IELTS 컴퓨터 시행은 전사시간이 2분이다.
   컴파일러는 `opts.delivery === 'computer'` 일 때 `appliesTo:"paperBased"` phase 를 건너뛴다.
   2분 화면이 필요하면 config 에 `appliesTo:"computerBased"` 항목을 하나 더 넣으면 되고, 코드 변경은 없다.

## 6. 검증

```
node "studyground/tests/test_compile_ielts.js"        # IELTS 컴파일 + 렌더 (9개 섹션)
node "studyground/tests/test_compile_screens.js"      # TOEFL 무회귀 (78화면/91문항)
node "studyground/tests/test_speaking_phases.js"      # phase 상태기계
node "studyground/tests/test_render_instruction_listening.js"
node "studyground/tests/test_render_reading.js"
node "studyground/tests/test_render_writing.js"
```
