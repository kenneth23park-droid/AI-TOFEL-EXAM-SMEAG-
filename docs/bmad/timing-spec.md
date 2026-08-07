# 타이밍 규격 (timing.config)

**대상 파일**

| 파일 | 역할 | 상태 |
|---|---|---|
| `studyground/sg2/config/timing.toefl.json` | New TOEFL (SET 1) 타이밍 규격 | 신규 |
| `studyground/sg2/config/timing.ielts.json` | IELTS Academic 타이밍 규격 | 신규 |
| `docs/bmad/timing-spec.md` | 본 문서 — 스키마 레퍼런스·근거·변경절차 | 신규 |

두 JSON은 **완전히 동일한 키 구조**를 가진다. 런타임은 시험 종류를 몰라도 같은 코드로 두 파일을 읽을 수 있다(섹션 객체의 키 집합이 파일·섹션과 무관하게 동일하도록 정규화되어 있으며, 해당 시험에 해당 없는 필드는 `null`이다). 두 파일 모두 `node -e 'JSON.parse(...)'` 로 파싱 검증을 마쳤다.

---

## 1. 파일 최상위 구조

```
{
  schemaVersion, exam, sectionOrder, defaults,
  sections: { <sectionId>: <Section> },
  directions: [ <Direction> ],
  provenance: { levels, entries: [ <ProvenanceEntry> ] }
}
```

### 1-1. `exam`

| 필드 | 타입 | 의미 | TOEFL 값 | IELTS 값 | 읽는 주체 |
|---|---|---|---|---|---|
| `id` | string | 시험 식별자 | `"toefl-nt"` | `"ielts-academic"` | 런타임 라우팅, 제출 payload |
| `label` / `labelKo` | string | 표시명 (EN 기본 / KO 토글) | `New TOEFL` / `뉴토플` | `IELTS Academic` / `아이엘츠 아카데믹` | exam.html 상단바 |
| `scoreScale` | `"toefl120"` \| `"ielts9"` | 점수 어댑터 선택자 | `toefl120` | `ielts9` | 채점/성적화면 어댑터 |
| `scale.sectionMax` | int | 섹션 만점 | 30 | 9 | 성적화면 |
| `scale.totalMax` | int | 총점 만점 | 120 | 9 | 성적화면 |
| `scale.step` | number | 점수 단위 | 1 | 0.5 | 점수 반올림 |
| `scale.bandLabel` | string | 등급 라벨 | `CEFR` | `Band` | 성적화면 |
| `contentRef` | string\|null | 콘텐츠 전역 객체 | `window.SMEAG_SET1` | `null`(콘텐츠 미작성) | 콘텐츠 로더 |

> TOEFL의 `scale` 값은 백엔드 `app/models.py`의 `SECTION_MAX=30` / `TOTAL_MAX=120`과 일치한다. IELTS의 0.5 단위 밴드는 `smeag-local-ai/scoring/schemas/*.schema.json`의 `multipleOf: 0.5`와 일치한다.

### 1-2. `sectionOrder`

`string[]` — 섹션 진행 순서. TOEFL `["listening","speaking","reading","writing"]`(녹화 관찰 순서), IELTS `["listening","reading","writing","speaking"]`(공식 순서). 상태머신의 최상위 큐를 만든다.

### 1-3. `defaults`

섹션/모듈에 값이 없을 때 적용되는 폴백.

| 필드 | 타입 | 의미 | TOEFL | IELTS |
|---|---|---|---|---|
| `timerScope` | `"section"`\|`"module"`\|`"task"`\|`"question"`\|`"screen"` | 타이머 단위 기본값 (architecture.md 3.1 `TimerSpec.scope` 정본) | `module` | `section` |
| `timerFormat` | `"MM:SS"`\|`"HH:MM:SS"` | 타이머 표기 | `MM:SS` | `MM:SS` |
| `onExpire` | `"autoAdvance"`\|`"stopRecord"`\|`null` | 만료 동작 | `autoAdvance` | `autoAdvance` |
| `advance` | `"manual"`\|`"auto"` | 화면 전환 방식 | `manual` | `manual` |
| `audioMaxPlays` | int | 오디오 재생 허용 횟수 | 1 | 1 |
| `instructionMaxSec` | int\|null | 안내화면 상한(null=무제한) | `null` | `null` |
| `graceSec` | int | 만료 후 유예 | 0 | 0 |
| `warnAtSec` | int | 잔여 n초에서 경고 강조 | 60 | 120 |

### 1-4. `Section` (모든 섹션이 동일한 15개 키를 가짐)

| 필드 | 타입 | 의미 | 기본값/부재시 | 읽는 주체 |
|---|---|---|---|---|
| `id` | string | 섹션 id | — | 상태머신 |
| `label`/`labelKo` | string | 표시명 | — | 상단바 |
| `screenType` | `"question"`\|`"speaking"` | 이 섹션 문제화면의 유형 | — | 렌더러 |

> 섹션의 `screenType`은 **문제화면**에만 해당한다. 전체 `ScreenType` 집합은 architecture.md 3.1이 정본이며 6종이다: `instruction` / `question` / `speaking` / `moduleEnd` / `hardwareCheck` / `review`.
| `timerScope` | enum | 타이머 단위 | `defaults.timerScope` | 타이머 |
| `timerFormat` | enum | 표기 형식 | `defaults.timerFormat` | 타이머 |
| `onExpire` | enum | 만료 동작 | `defaults.onExpire` | 타이머 |
| `audio` | object\|null | `{maxPlays, autoPlay, replayAllowed}` | `null`=오디오 없음 | 오디오 유닛 |
| `questionCountSource` | `"content"` | 문항 수는 항상 콘텐츠에서 유도 | `"content"` | 진행표시(`Question n of N`) |
| `sectionSec` | int\|null | 섹션 단위 총 배정시간 | `null` | `timerScope==="section"`일 때만 사용 |
| `modules` | Module[] | 모듈 목록(빈 배열 가능) | `[]` | 상태머신 |
| `tasks` | Task[]\|null | writing 전용 태스크 목록 | `null` | writing 렌더러 |
| `taskTypes` | {id: TaskType}\|null | speaking 전용 유형 정의 | `null` | speaking 렌더러 |
| `fallbackPerQuestionSec` | int\|null | 모듈 배정시간이 없을 때 문항당 배정 | `null` | 타이머 |
| `phases` | Phase[] | 섹션 부가 단계(예: IELTS transfer time) | `[]` | 상태머신 |

**Module**

| 필드 | 타입 | 의미 |
|---|---|---|
| `id` | string | 모듈 id — 콘텐츠(set1.js) 모듈 id와 동일해야 함 (`R1,R2,L1,L2,S1,S2`) |
| `contentRef` | string | 콘텐츠 조회 경로 표현식 (`listening.modules[id=L1]`) |
| `taskType` | string\|null | speaking에서 `taskTypes` 키 참조 |
| `allocatedSec` | int\|null | 모듈 배정시간 |
| `perQuestionSec` | int\|null | 문항 단위 배정(모듈 배정 대신 사용) |
| `onExpire` | enum\|null | 모듈별 override |
| `moduleEndScreen` | string\|null | 만료/종료 시 표시할 `directions[].id` |
| `introAudioSelfPaced` | bool\|null | 모듈 인트로 오디오를 self-paced로 둘지 |

**Task (writing)**

`id`, `contentRef`, `taskKind`, `perTaskSec`(int|null), `minWords`(int|null), `onExpire`, `moduleEndScreen`(string|null — 태스크 종료화면 `directions[].id`).

**TaskType (speaking)**

`id`, `label`, `mediaType`(`"audio"`|`"video"`), `promptSelfPaced`(bool), `listenReplays`(int), `prepSec`(int), `responseSec`(int), `responseSecMin`/`responseSecMax`(int|null, 공식 범위가 있을 때만), `recording`(bool), `onExpire`.

**Phase**

`id`, `label`, `screenType`, `position`(`"afterSection"` 등), `seconds`, `onExpire`, `advance`, `appliesTo`(예 `"paperBased"`). TOEFL은 전 섹션 `[]`.

### 1-5. `Direction` (안내/전환 화면)

| 필드 | 타입 | 의미 |
|---|---|---|
| `id` | string | 화면 id. 모듈의 `moduleEndScreen`이 이 값을 참조 |
| `label` | string | 화면 제목(원문 그대로) |
| `screenType` | `"instruction"`\|`"moduleEnd"`\|`"hardwareCheck"`\|`"review"` | 렌더러 분기 (architecture.md 3.1) |
| `insertAt.position` | `"beforeSection"`\|`"betweenModules"`\|`"afterSection"` | 삽입 지점 |
| `insertAt.section` | string | 대상 섹션 id |
| `insertAt.module` | string\|null | `betweenModules`일 때 선행 모듈 id (null=모든 모듈 사이) |
| `maxSec` | int\|null | 상한 타임아웃. **null이면 무제한 self-paced** |
| `advance` | `"manual"`\|`"auto"` | 진행 방식 |
| `controls` | string[] | 표시할 버튼/컨트롤 (`playTestAudio, volume, continue, micTest, speakerTest, begin, submit`) |

TOEFL directions(10): `adjustVolume`, `listeningDirections`, `moduleEnd.listening`, `hardwareCheck`, `speakingDirections`, `readingDirections`, `moduleEnd.reading`, `writingDirections`, `taskEnd.writing`, `submitConfirm`.
IELTS directions(7): `adjustVolume`, `listeningDirections`, `readingDirections`, `writingDirections`, `hardwareCheck`, `cueCardPrep`, `submitConfirm`.

`moduleEnd` 화면의 `advance`는 **`manual`**(Continue 버튼)이고 `maxSec`은 **비표시 상한**이다(architecture.md 3.4).

---

## 2. 근거 표기(provenance) 설계

JSON에는 주석을 쓸 수 없으므로, **값 옆이 아니라 파일 끝의 `provenance` 블록에 경로(path) 기반으로 병렬 표기**한다. `_confidence` 같은 접미 키를 값마다 붙이는 방식은 (a) 스키마가 값 타입에 오염되고 (b) 배열 원소마다 중복되므로 채택하지 않았다.

```
provenance: {
  levels:  { <level>: <설명> },
  entries: [ { path, level, source, verify }, ... ]
}
```

| 필드 | 의미 |
|---|---|
| `path` | 값의 위치. 점 표기 + 배열 첨자. `[*]`=모든 원소, `[id=R1]`=id로 지정한 원소 |
| `level` | `observed` \| `official` \| `content` \| `assumed` |
| `source` | 그 값이 어디서 나왔는지 (녹화 타임코드 / 공식 규격 / 코드 파일 / 추정 근거) |
| `verify` | 확정하려면 무엇을 해야 하는가. 더 검증할 것이 없으면 `"없음(확정)"` / `"없음(공식)"` |

**레벨 정의**

| level | 의미 | 신뢰도 |
|---|---|---|
| `observed` | 57분53초 화면녹화에서 직접 관찰됨 | 확정 |
| `official` | 시험 주관사 공개 규격 (IELTS 전용) | 확정 |
| `content` | `studyground/sg2/assets/set1.js`에 이미 들어있는 값 | 코드 기준 확정, 규격과 불일치 가능 |
| `assumed` | ⚠️ 가설(검증필요) | 미확정 |

런타임은 `provenance`를 **읽지 않는다**(순수 문서용). 단 개발 모드에서 `assumed` 값이 사용되면 콘솔 경고를 띄우는 용도로 활용할 수 있다.

---

## 3. 확정 관찰값 vs 가설값

### 3-1. TOEFL (`timing.toefl.json`)

| path | 값 | level | 근거 | 검증 방법 |
|---|---|---|---|---|
| `defaults.timerFormat` / 화면유형 3종 | `MM:SS` / `HH:MM:SS` | observed | 문제화면 서브바 우측 타이머=MM:SS, RESPONSE TIME 박스=HH:MM:SS | 없음(확정) |
| `sections.listening.audio.maxPlays` | 1 | observed | 녹화 03:00~21:00 오디오 1회 | 없음(확정) |
| `sections.speaking.taskTypes.listenAndRepeat.listenReplays` | 1 | observed | 녹화 22:30~29:30 "Listen and repeat only once" | 없음(확정) |
| `sections.speaking.taskTypes.interview.promptSelfPaced` | true | observed | 녹화 30:00 프롬프트에 카운트다운 없음 | 없음(확정) |
| `sections.speaking.taskTypes.interview.mediaType` | `video` | observed | 녹화 30:30~33:30 인터뷰어 영상 | sg2 콘텐츠는 현재 mp3만 보유 → 영상 자산 존재 확인 필요 |
| `sections.reading.modules[id=R1].moduleEndScreen` | `moduleEnd.reading` | observed | 녹화 48:30 "End of Module 1 … Continue to Module 2" 자동 전환 | 없음(확정) |
| `directions[*].maxSec` (안내화면·moduleEnd) | `null` | observed | 녹화 02:30 / 21:30 / 22:00 안내화면, 그리고 2910s `End of Module 1` 프레임 모두 서브바 우측이 비어 있다(타이머·Hide Time 둘 다 없음) | 없음(확정) |
| `sectionOrder` | L→S→R→W | observed(부분) | 녹화 03:00 / 22:00 / 45:30 관찰. Writing 위치는 51:00 문항으로 추정 | ⚠️ Writing 배치를 SMEAG 운영 규격서로 확인 |
| `sections.writing.tasks[*].perTaskSec` | 600 | content | `set1.js` W1/W2/W3 `timeLimitSec: 600` | ⚠️ 명세 2-4는 `writing.perTaskSec: null`(미확정) — 규격문서 조회 |
| `sections.writing.tasks[*].minWords` | 80 / 100 | content | `set1.js` `W-EMAIL.minWords=80`, `W-DISC.minWords=100` | 없음(콘텐츠 확정) |
| `…listenAndRepeat.prepSec` | 3 | content ⚠️ | `set1.js repeatQ() prepSec:3` | ⚠️ 명세 2-4는 prep **0** — 녹화 22:30 구간에서 청취 종료↔RESPONSE TIME 등장 간격 측정 |
| `…listenAndRepeat.responseSec` | 20 | content ⚠️ | `set1.js repeatQ() respondSec:20` | ⚠️ 명세 2-4는 **15초** — 녹화 RESPONSE TIME 시작값 확인 |
| `…interview.responseSec` | 45 | content | `set1.js interviewQ() respondSec:45` (명세 2-4와 일치) | 녹화 30:30~33:30 RESPONSE TIME 시작값 확인 |
| `sections.reading.modules[id=R1].allocatedSec` / `[id=R2]` | **1200 / 540** | **확정(관찰)** | 프레임 실측(§8). R1: 2730s→19:22, 2745s→19:08 (15초 경과에 14초 감소 = 1배속, 시작값 20:00). R2: 2930s→08:43, 2960s→08:13, 3000s→07:33, 3030s→07:04 (시작값 09:00) | 없음(확정). 구 가설값 1080/1020 폐기 |
| `sections.reading.sectionSec` | **1740** | **확정(관찰)** | 실측 모듈 합계 1200+540. `set1.js reading.timeLimitSec`(2100)은 콘텐츠 파일의 구값이며 런타임은 읽지 않는다(F11) | 없음(확정) — `timerScope`가 `module`인 동안 비표시 2차 deadline |
| `sections.listening.modules[id=L1].allocatedSec` | 1080 | **assumed** ⚠️ | 문항수(L1=18) × 여유 배분 추정 | ⚠️ SMEAG 규격문서에서 Listening 모듈 배정시간 조회 |
| `sections.listening.modules[id=L2].allocatedSec` | 900 | **assumed** ⚠️ | 문항수(L2=15) 기반 추정 | 위와 동일 |
| `sections.listening.modules[*].perQuestionSec` | **30** | **확정(관찰)** | 프레임 실측(§8) Q29 답변 구간: 884s→00:29, 888s→00:25, 892s→00:21, 896s→00:17, 900s→00:13, 904s→00:09 → 4초 간격 4초 감소, 시작값 00:30 | 없음(확정). 구 가설값 20 폐기 |
| `sections.listening.fallbackPerQuestionSec` | **30** | **확정(관찰)** | 위와 동일 근거 | 없음(확정) |
| `sections.listening.timerScope` | `question` | **확정(관찰)** | 오디오 재생 화면(700s, Q25)에는 타이머가 아예 없고 답변 화면(900s, Q29)에만 00:13 이 뜬다 → 타이머는 문항 단위로 **답변 화면에만** 걸린다. `allocatedSec`은 비표시 모듈 상한으로 공존 | 없음(확정) |
| `sections.writing.timerScope` / `sections.speaking.timerScope` | `task` / `screen` | content / 설계 | architecture.md 3.5 scope 표 | 없음(구조 확정) |
| `directions[id=moduleEnd.*].maxSec` | **null** | **확정(관찰)** | 2910s `End of Module 1` 프레임에 타이머 미표시(`docs/reference/screens/reading-module-end-2910s.png`). 가설이던 30초 비표시 상한을 제거 — Continue 버튼으로만 진행 | 없음(확정) |
| 리스닝 **오디오 화면 / 답변 화면 분리** | 분리 | **확정(관찰)** | 700s 프레임은 제목+화자사진만(선택지·타이머 없음), 900s 프레임은 선택지 4개+타이머. `exam-compile.js` 가 `blockKind:"audio-play"` 화면을 답변 화면 앞에 넣는다 | 없음(확정) |

문항 수는 config에 **하드코딩하지 않는다**(`questionCountSource: "content"`). 실측 문항 수는 콘텐츠에서 유도: R1=20, R2=15, L1=18, L2=15, W1=10(build)+W2=1+W3=1, S1=7(repeat)+S2=4(interview) → 총 91문항.

### 3-2. IELTS (`timing.ielts.json`)

| path | 값 | level | 근거 | 검증 방법 |
|---|---|---|---|---|
| `sectionOrder` | L→R→W→S | official | IELTS 시험 순서 | 없음(공식). Speaking 별도 일자 시행 가능 |
| `exam.scale` | 9 / 0.5 단위 | official | Band 0–9 | 없음(공식) |
| `sections.listening.sectionSec` | 1800 | official | Listening 30분 / 4파트 | 없음(공식) |
| `sections.listening.audio.maxPlays` | 1 | official | 오디오 1회 재생 | 없음(공식) |
| `sections.listening.phases[id=transferTime].seconds` | 600 | official | 지필 시행 전사시간 10분 | 없음(공식). CBT는 2분 → `appliesTo:"paperBased"`로 분기 |
| `sections.listening.modules[*].allocatedSec` | `null` | official | 파트별 개별 배정 없음(오디오 길이가 진행 결정) | 없음(공식) |
| `sections.reading.sectionSec` | 3600 | official | Academic Reading 60분 / 3지문, 전사시간 없음 | 없음(공식) |
| `sections.writing.sectionSec` | 3600 | official | Writing 60분 | 없음(공식) |
| `sections.writing.tasks[id=TASK1]` | 1200초 / 150단어 | official | Task 1 권장 20분·최소 150단어 | ⚠️ 실제 시험은 60분 단일 타이머 — 태스크별 강제 타이머로 쓸지 **정책 결정 필요** |
| `sections.writing.tasks[id=TASK2]` | 2400초 / 250단어 | official | Task 2 권장 40분·최소 250단어 | 위와 동일 |
| `sections.speaking.taskTypes.part2.prepSec` | 60 | official | cue card 준비 1분 | 없음(공식) |
| `sections.speaking.taskTypes.part2.responseSec` | 120 (min 60/max 120) | official | 발표 1–2분 | 없음(공식) |
| `sections.speaking.modules[id=SP1].allocatedSec` | 300 | official | Part 1 = 4–5분(상한) | 없음(공식 상한) |
| `sections.speaking.modules[id=SP3].allocatedSec` | 300 | official | Part 3 = 4–5분(상한) | 없음(공식 상한) |
| `sections.speaking.modules[id=SP2].allocatedSec` | 240 | **assumed** ⚠️ | 60 준비 + 120 발표 + 60 여유 | ⚠️ 공식은 총 11–14분만 규정 — 자체 정책으로 확정 |
| `sections.speaking.taskTypes.part1.responseSec` | 30 | **assumed** ⚠️ | 대면 인터뷰를 비대면 녹음으로 대체하기 위한 문항당 배분 | ⚠️ SMEAG IELTS 모의고사 운영안에서 확정 |
| `sections.speaking.taskTypes.part3.responseSec` | 45 | **assumed** ⚠️ | TOEFL interview 값 차용 | 위와 동일 |
| `sections.*.modules[*].contentRef` | 예약 문자열 | **assumed** ⚠️ | IELTS 콘텐츠 파일이 아직 없음 | ⚠️ IELTS 세트 작성 시 모듈 id를 이 값과 일치시킬 것 |
| `directions[*]` | — | **assumed** ⚠️ | TOEFL 안내화면 구성을 이식한 가설 | ⚠️ IELTS 모의고사 UX 확정 시 재검토 |

---

## 4. TOEFL ↔ IELTS 타이밍 대조

| 항목 | TOEFL (`timing.toefl.json`) | IELTS (`timing.ielts.json`) | 스키마 상 차이 |
|---|---|---|---|
| 섹션 순서 | Listening → Speaking → Reading → Writing | Listening → Reading → Writing → Speaking | `sectionOrder` 배열만 다름 |
| Listening 구조 | Module 2개 (L1/L2) | Part 4개 (P1~P4) | 둘 다 `modules[]` |
| Listening 타이머 | 문항 단위 (`timerScope:"question"`, **30초 관찰확정**, 답변 화면에만) + 모듈 상한 1080/900초 ⚠️가설 | 섹션 단위 (`timerScope:"section"`, 1800초) | `timerScope` + `perQuestionSec`/`allocatedSec` vs `sectionSec` |
| Listening 오디오 | 1회 | 1회 | 동일 |
| Listening 부가단계 | 없음 (`phases: []`) | transfer time 600초 (`phases[0]`) | `phases[]` |
| Reading | Module 2개, **1200 + 540초 관찰확정** (합 1740) | 3지문, 3600초 단일 카운트다운 | 동일 필드, 값만 다름 |
| Reading 모듈 전환 | `moduleEnd.reading` 자동 전환(관찰) | 없음 (`moduleEndScreen: null`) | `moduleEndScreen` |
| Writing | 3태스크 각 600초 (build / email / academic discussion), `timerScope:"task"` | 2태스크 1200 + 2400초, `timerScope:"section"` | `tasks[]` + `timerScope` |
| Writing 최소 단어 | 80 / 100 | 150 / 250 | `tasks[].minWords` |
| Speaking 유형 | `listenAndRepeat`, `interview` | `part1`, `part2`, `part3` | `taskTypes` 키만 다름 |
| Speaking 준비시간 | 3초(콘텐츠값 ⚠️명세는 0) | Part2 60초, 그 외 0 | `taskTypes[].prepSec` |
| Speaking 응답시간 | 20초 / 45초 | 30 / 120 / 45초 | `taskTypes[].responseSec` |
| Speaking 미디어 | audio / **video**(interview) | audio | `taskTypes[].mediaType` |
| 점수 | `toefl120` (섹션 30, 총 120, 1점 단위, CEFR) | `ielts9` (밴드 0–9, 0.5 단위) | `exam.scale` |

**이식 시 신규로 필요한 것**: IELTS Part 2의 `prepSec` 준비단계 화면(TOEFL 런타임에는 준비 타이머 화면이 없음)과 Listening `phases[].transferTime` 화면 — 둘 다 **신규 구현 대상**이다.

---

## 5. 값 변경 절차

| 바꾸고 싶은 것 | 고치는 위치 | 런타임에 나타나는 변화 | 함께 해야 할 일 |
|---|---|---|---|
| Reading 모듈 배정시간 | `timing.toefl.json → sections.reading.modules[id=R1|R2].allocatedSec` | 서브바 우측 타이머 시작값, 만료 시 `moduleEnd.reading` 전환 시점 | 두 모듈 합계를 `sections.reading.sectionSec`(현재 1740)와 일치시킨 뒤, `provenance`의 해당 entry `level`을 `observed`/`official`로 승격하고 `verify`를 `"없음(확정)"`으로 |
| Listening 타이머 단위 | `sections.listening.timerScope` (`question`↔`module`) | 타이머 리셋 지점. `question`이면 `modules[].perQuestionSec` → 없으면 `fallbackPerQuestionSec` | provenance entry 갱신 |
| Speaking 응답시간 | `sections.speaking.taskTypes.<type>.responseSec` | RESPONSE TIME 박스 시작값, 녹음 자동 종료 시점 | `set1.js`의 `respondSec`와 이중 관리 중 — **config가 단일 소스이고 set1.js 값은 무시**한다(architecture.md P6 / 코딩표준 F11) |
| Speaking 준비시간 | `…taskTypes.<type>.prepSec` | 청취 종료 후 녹음 시작까지의 대기 | 동상 (`set1.js prepSec`) |
| Writing 태스크 시간 | `sections.writing.tasks[id=W1…].perTaskSec` | 태스크별 카운트다운 | `set1.js` 모듈 `timeLimitSec`와 이중 관리 — config 우선 |
| 안내화면 상한 | `directions[].maxSec` (`null`=무제한) | 안내화면 자동 넘김 여부 | 없음 |
| 안내화면 추가/삭제 | `directions[]` 원소 추가 + 필요 시 모듈의 `moduleEndScreen`이 그 `id`를 참조 | 상태머신 큐에 화면 삽입 | 렌더러에 해당 `controls` 지원 여부 확인 |
| 섹션 순서 | `sectionOrder` | 전체 진행 순서 | 없음 |
| 점수 스케일 | `exam.scoreScale` / `exam.scale` | 성적화면 만점·단위·등급 라벨 | 백엔드 `SECTION_MAX`/`TOTAL_MAX`와 정합 확인 |

**원칙**
1. 문항 수는 절대 config에 넣지 않는다. `questionCountSource: "content"` 를 유지하고 콘텐츠에서 센다.
2. 값을 바꾸면 반드시 같은 커밋에서 `provenance.entries` 의 해당 항목(`level`/`source`/`verify`)도 갱신한다.
3. `assumed` → `observed`/`official` 승격은 근거(녹화 타임코드 또는 규격문서 출처)를 `source`에 남긴 뒤에만 한다.
4. 두 파일 중 하나에 새 필드를 추가하면 **다른 파일에도 같은 키를 `null`로 추가**한다(스키마 대칭 유지).

---

## 6. 런타임 로딩 규칙 (오프라인 정적 사이트)

sg2는 빌드·CDN 없는 vanilla JS 정적 사이트이고 `file://` 로도 열려야 한다. `fetch()`는 `file://`에서 실패하므로 **fetch는 최선 시도(best effort)이고, 실패는 정상 경로**로 취급한다.

로딩 우선순위:

1. `window.SG_TIMING_OVERRIDE` (개발/디버그용 인라인 객체) — 있으면 그대로 사용.
2. `fetch('config/timing.<exam>.json')` 성공 → 파싱 → 검증 통과 시 사용 (`<exam>` = `toefl` | `ielts`, 선택은 `?exam=` 쿼리 → `localStorage('sg2_exam_profile')` → 기본 `toefl`).
3. 실패(네트워크/CORS/`file://`/JSON 파싱 오류/검증 실패) → **런타임에 인라인 하드코딩된 내장 기본값(`SG_TIMING_FALLBACK`, `assets/exam-timing.js` 내부)으로 degrade**. 이 내장값은 `timing.toefl.json`과 동일한 수치를 담은 복사본이며, 콘솔에 `warn` 한 줄과 화면 하단에 조용한 배지(`config: builtin`)만 남긴다. **시험 진행을 막지 않는다.**
4. 어떤 경로로도 값이 없으면(예: 알 수 없는 섹션) `defaults` → 그래도 없으면 타이머 없이 `advance:"manual"`로 진행(안전측 degrade: 시간 부족으로 답안이 날아가는 것보다 무제한이 낫다).

검증(로드 직후 수행할 최소 체크):

| 체크 | 실패 시 |
|---|---|
| `schemaVersion` 이 런타임이 아는 major와 같은가 | 내장 기본값으로 degrade |
| `sectionOrder`의 모든 id가 `sections`에 존재하는가 | 없는 id는 건너뛰고 `warn` |
| 각 `modules[].id`가 콘텐츠(`set1.js`)의 모듈 id와 매칭되는가 | 매칭 실패 모듈은 건너뛰고 `warn` |
| `moduleEndScreen` / `insertAt.section`이 실제 존재하는 id를 가리키는가 | 해당 화면 생략 |
| 두 프로파일의 키 집합이 동일한가(개발 모드에서만) | `warn` — 스키마 드리프트 경고 |
| `allocatedSec`·`perTaskSec`·`responseSec`이 양의 정수 또는 null인가 | 해당 값만 `defaults`로 대체 |

캐싱: `sw.js`의 precache 목록에 `config/timing.toefl.json`, `config/timing.ielts.json`을 추가한다(신규 작업). 캐시 전략은 **stale-while-revalidate가 아니라 cache-first** — 시험 중 타이밍 규격이 바뀌면 안 되므로, 세션 시작 시 한 번 읽어 메모리에 고정하고 세션 도중에는 재로딩하지 않는다.

PWA 오프라인 상태에서 파일이 캐시에 없더라도 3단계 폴백으로 시험은 그대로 진행된다.

---

## 7. ⚠️ 두 시스템을 섞지 말 것 (2026-08-07)

녹화에는 **두 개의 서로 다른 UI** 가 등장한다. 값 근거를 인용할 때 어느 쪽인지 반드시 밝힌다.

| | SMEAG 관리자 미리보기 | **StudyGround (응시자용 — 우리 구현 대상)** |
|---|---|---|
| URL | `1.234.23.54/2026_newtoefl/admin/test_listening.php` | `studyground.ai/en/test-nt/...` |
| 타이머 | 상단 **중앙 빨간 알약(pill)** 카운트다운 | 서브바 **우측** 등폭 `MM:SS` + `Hide Time` 토글 |
| 진행 표시 | 없음 | 서브바 좌측 `Listening | Question 25 of 32` / `Reading | Questions 1-10 of 35` |

이 문서(및 architecture.md)의 이전 판이 인용하던 "상단 중앙 빨간 pill" 은 **관리자 미리보기** 화면이다.
sg2 는 StudyGround 쪽에 맞춘다 — 빨간 중앙 pill 은 제거 대상이다.

---

## 8. 타이밍 실측 절차 (ffmpeg 프레임 추출)

`assumed` → `확정(관찰)` 승격의 근거는 **추측이 아니라 프레임 실측**이어야 한다. 절차는 다음과 같다.

원본: `TOEFL MOCK TEST SCREEN RECORDING.mp4` (1906×1130, 30fps, 3472s)

```
# 0) 원본 제원 확인
ffprobe -v error -select_streams v:0 \
  -show_entries stream=width,height,r_frame_rate,nb_frames \
  -show_entries format=duration -of default=nw=1 "TOEFL MOCK TEST SCREEN RECORDING.mp4"

# 1) 관심 구간의 단일 프레임을 초 단위로 뽑는다 (-ss 를 -i 앞에 두면 키프레임 seek 로 빠르다)
ffmpeg -y -ss 2730 -i "TOEFL MOCK TEST SCREEN RECORDING.mp4" -frames:v 1 \
  docs/reference/screens/reading-2730s.png

# 2) 같은 화면을 4초 간격으로 6장 뽑아 감소분을 확인한다 (카운트다운 증명)
for t in 884 888 892 896 900 904; do \
  ffmpeg -y -ss $t -i "TOEFL MOCK TEST SCREEN RECORDING.mp4" -frames:v 1 /tmp/f_$t.png; done

# 3) 타이머 영역만 잘라 한 장으로 이어 붙여 증거 이미지를 만든다
#    (서브바 우측 타이머는 대략 x≈1650..1760, y≈170..200 부근)
ffmpeg -y -i /tmp/f_884.png -vf "crop=200:44:1630:162" /tmp/c_884.png
ffmpeg -y -i /tmp/c_884.png -i /tmp/c_888.png ... -filter_complex vstack=inputs=6 \
  docs/reference/screens/timer-countdown-proof.png
```

**판독 규칙**

1. 최소 **3점 이상** 을 찍고 "경과 초 ↔ 감소 초" 가 1:1 인지 확인한다. 1:1 이면 실시간 카운트다운이고,
   가장 이른 프레임의 표시값 + 그때까지의 경과 시간 = **시작값** 이다.
   예) R2 는 2930s→08:43, 3030s→07:04 → 100초 경과에 99초 감소(1프레임 반올림 오차) → 시작값 09:00 = 540s.
2. 타이머가 **없는** 것도 관찰값이다. 서브바 우측이 비어 있으면(타이머·`Hide Time` 둘 다 없음) 그 화면은 self-paced 이고
   config 는 `maxSec: null` / `timer: null` 이어야 한다. (End of Module 2910s, 리스닝 오디오 화면 700s 가 이 경우)
3. 판독에 쓴 프레임은 `docs/reference/screens/` 에 커밋하고, 파일명에 초를 넣는다(`<화면>-<초>s.png`).
4. 승격한 값은 같은 커밋에서 `provenance.entries[].source` 에 **프레임 초와 읽은 표시값을 그대로** 적는다
   (예: `"recording 2730s→19:22, 2745s→19:08"`). "약 20분" 같은 요약은 근거가 아니다.

### 8-1. 이번에 확정된 값 (2026-08-07)

| 항목 | 확정값 | 프레임 근거 |
|---|---|---|
| Reading Module 1 | 1200s (20:00) | 2730s→19:22, 2745s→19:08 |
| Reading Module 2 | 540s (9:00) | 2930s→08:43, 2960s→08:13, 3000s→07:33, 3030s→07:04 |
| Listening 문항당 답변시간 | 30s | 884s→00:29, 888→00:25, 892→00:21, 896→00:17, 900→00:13, 904→00:09 |
| Listening 오디오 재생 화면 | 타이머 없음 | 700s (Q25, 제목+화자사진만) |
| End of Module 화면 | 타이머 없음 | 2910s |
