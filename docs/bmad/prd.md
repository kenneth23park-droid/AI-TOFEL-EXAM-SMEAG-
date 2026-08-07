# SMEAG StudyGround — New TOEFL 시험 런타임 & 채점 백엔드 PRD

| 항목 | 값 |
|---|---|
| 문서 | Product Requirements Document (BMAD PM 산출물) |
| 제품 | SMEAG StudyGround 2.0 — Test Runtime + Scoring Backend |
| 버전 | v1.0 (Draft) |
| 작성일 | 2026-08-06 |
| 근거 자료 | ① TOEFL 모의고사 화면녹화 57분53초 분석 ② 코드베이스 실측 인벤토리(recon) |
| 대상 코드베이스 | `/Users/kwangseobpark/smeag-TOFEL 자료/studyground/` |

> **표기 규칙**
> - 본문은 한국어, 코드 식별자·필드명·화면 문구는 원문(영어) 그대로 유지한다.
> - **확정**: 화면녹화로 직접 관찰했거나 코드 실측 인벤토리로 확인된 사실.
> - **⚠️ 가설(검증필요)**: 관찰되지 않았거나 관찰값이 불충분해 추정한 값. 반드시 검증 후 확정으로 승격해야 한다.
> - **신규**: 현재 코드베이스에 존재하지 않으며 이번 작업에서 새로 만들어야 하는 파일/모듈/컬럼.

---

## 1. Goals and Background Context

### 1.1 Background — 지금 무엇이 문제인가

SMEAG는 두 개의 자산을 이미 보유하고 있다.

1. **콘텐츠 자산 (확정)** — `studyground/sg2/assets/set1.js`에 NEW TOEFL SET 1 전 문항이 구조화되어 있다. 총 **91문항**(Reading 35 · Listening 33 · Writing 12 · Speaking 11), 4개 section, 9개 module, 7종 block kind, 8종 question kind. 오디오 mp3와 일러스트 png도 `sg2/media/` 아래 실재한다.
2. **채점/리포트 자산 (확정)** — `studyground/app/`의 FastAPI + SQLAlchemy 백엔드. `attempts` / `section_scores` / `question_responses` / `rubric_scores` / `ai_feedback` 5개 테이블과, LangGraph 기반 피드백 파이프라인(`app/scoring/` : ingest → analyze → route → offline|online → compose)이 **이미 동작한다**. 성적 목록(`GET /`)과 성적 상세(`GET /attempts/{id}`) 화면도 구현되어 있다.

그런데 이 둘 사이가 **끊겨 있다.**

현재 `studyground/sg2/exam.html`은 **한 페이지에 91문항 전체를 세로로 렌더하는 "연습지(worksheet)" 방식**이다. 실측 확인된 현황:

| 현재 exam.html | 상태 |
|---|---|
| 전 문항 단일 스크롤 렌더 | 있음 |
| `makeAudioUnit()` — 캐릭터 이미지 + 오디오 잔여시간 카운터 | 있음 |
| 하단 "Grade section" 버튼 → `graders[]` 즉시 자동채점 | 있음 |
| 섹션/모듈 타이머 | **없음** |
| 화면 단위 상태머신 | **없음** |
| 모듈 전환 / End of Module 화면 | **없음** |
| 오디오 1회 재생 강제 | **없음** |
| 음성 녹음(Speaking) | **없음** |
| 진행 저장·재개 | **없음** |
| 백엔드로의 제출 경로 | **없음** (`app/crud.py`에 write helper 자체가 부재) |

즉 **"문제를 볼 수 있는 화면"은 있으나 "시험을 치를 수 있는 런타임"은 없다.** 응시자는 시간 압박 없이, 오디오를 무한 반복하며, 말하기 답변을 남기지 않고, 결과를 남기지 않은 채 문제를 훑을 수 있을 뿐이다. 이는 랜딩 카피가 약속하는 *"The same UI, timing, and question formats as the real TOEFL"* 과 정면으로 어긋난다.

동시에 **교사 측 워크플로우가 존재하지 않는다.** 관찰된 레퍼런스(`1.234.23.54/2026_newtoefl/admin/`)에는 3-Subject Answer Management, 문항별 학생답안 vs 정답 대조, 문항별 교사 피드백, FEEDBACK PROGRESS(%), Exam Statistics, Rankings by Grade가 갖춰져 있으나, 우리 쪽에는 seed 데이터를 읽어 보여주는 리포트 화면만 있고 **채점을 입력할 화면도, 답안을 받는 API도 없다.**

### 1.2 Goals — 이번 릴리즈가 달성할 것

| # | Goal | 성공의 정의 |
|---|---|---|
| G1 | 실제 시험 타이밍 재현 | 응시자가 sg2에서 SET 1을 처음부터 끝까지, 실제 TOEFL과 동일한 화면 전환·카운트다운·오디오 1회 제약 하에 완주할 수 있다 |
| G2 | 화면유형 상태머신 확립 | 모든 화면이 `instruction` / `question` / `speaking` / `moduleEnd` / `hardwareCheck` / `review` 6종 중 하나로 분류되고(architecture.md 3.1 정본), 각 유형의 타이머·진행 규칙이 코드가 아닌 선언으로 표현된다 |
| G3 | Speaking 응답 수집 | MediaRecorder로 11문항 음성 응답이 녹음·보관되고 채점 화면에서 재생된다 |
| G4 | 답안 제출 파이프라인 | 시험 완료 시 91문항 응답이 백엔드에 저장되고 `status`가 `in_progress → scoring → completed`로 전이된다 |
| G5 | 하이브리드 채점 백오피스 | 객관식 78문항은 자동 채점, 주관식 13건(free-write 2 + speaking 11)은 교사 수기 피드백(+AI 초안)으로 처리되며 FEEDBACK PROGRESS가 집계된다 |
| G6 | 통계·랭킹 | Exam Statistics와 Rankings by Grade가 attempt 데이터로부터 산출된다 |
| G7 | IELTS 이식 가능성 확보 | 타이밍·점수체계·루브릭이 config/어댑터로 외부화되어, TOEFL 런타임 코드를 재작성하지 않고 IELTS 모드를 얹을 수 있다 |
| G8 | 제약 준수 | 빌드 없는 vanilla JS 정적 사이트 유지, 오프라인 구동, EN 기본·KO 토글이 전 구간에서 깨지지 않는다 |

### 1.3 Non-Goals (요약)

상세는 6절. 요약하면 — 신규 SET(SET 2 이후) 콘텐츠 제작, 실시간 감독(proctoring), 결제 연동, 모바일 네이티브 앱, TOEFL 공식 점수 환산의 정확한 재현은 이번 범위가 아니다.

### 1.4 Change Log

| 날짜 | 버전 | 변경 | 작성자 |
|---|---|---|---|
| 2026-08-06 | v1.0 | 최초 작성 (녹화 분석 + 코드 실측 기반) | PM (BMAD) |

---

## 2. Requirements

### 2.1 Functional Requirements (FR)

#### A. 화면유형 & 상태머신

**FR1** — 시스템은 모든 시험 화면을 `screenType` **6종**(`instruction` | `question` | `speaking` | `moduleEnd` | `hardwareCheck` | `review`) 중 하나로 분류하여 렌더해야 한다. 화면 정의는 `TestScreen` 인터페이스(**architecture.md 3.1이 정본**)를 따른다. `hardwareCheck`는 `getUserMedia` 부작용 때문에, `review`는 제출 확인 단계이므로 `instruction`과 코드경로가 다르다.

**FR2** — `instruction` 화면(Adjusting the Volume, Hardware Check, Section Directions, Interview 지문 안내, End of Module 안내)은 **카운트다운을 표시하지 않으며(self-paced)**, Continue / Begin / Next 버튼 클릭으로만 다음 화면으로 진행한다. **(확정: 녹화 관찰)**

**FR3** — `question` 화면은 상단 중앙에 **빨간 pill 형태 MM:SS 카운트다운**을 표시하며, 타이머 scope는 **섹션별 config**(`sections.<id>.timerScope`)를 따른다 — Listening은 `question`, Reading은 `module`, Writing은 `task`(architecture.md 3.5 정본). **(확정: 녹화 관찰 — 상단 빨간 카운트다운 존재, 형식 MM:SS)**

**FR4** — `question` 화면의 카운트다운이 0에 도달하면 시스템은 **응시자 조작 없이 자동으로** 다음 module(또는 다음 section)로 전환하고, 그 사이에 `moduleEnd` 화면을 표시한다. (`onExpire: "autoAdvance"`) **(확정: 48:30 "End of Module 1 · Your time for Module 1 … has ended. Continue to Module 2" 자동 전환 관찰)**

**FR5** — `moduleEnd` 화면은 "End of Module {n}" 제목과 "Your time for Module {n} … has ended." 안내문, 그리고 다음 module로의 진행 컨트롤을 표시한다. 이 화면에서는 이전 module 문항으로 되돌아갈 수 없다.

**FR6** — `speaking` 화면은 `phases` 배열(`prompt` → `listen` → `prep`(선택) → `record`)로 진행되며, 각 phase 전이는 시스템이 자동 수행한다. record phase 진입 시 화면 중앙 하단에 **보라색 "RESPONSE TIME" 박스**가 나타나고 **HH:MM:SS** 형식 타이머와 🎤 인디케이터를 표시한다. **(확정: 녹화 관찰)**

**FR7** — 전체 시험은 다음 상태머신 순서를 따른다. **(확정: 녹화 타임라인)**

```
[Landing / NT 선택]
  → [Directions: Adjusting the Volume]
  → Listening (Module 1 … N)
  → [Hardware Check]
  → [Speaking Directions]
  → Speaking (Q1..11)
  → Reading (Module 1 → [End of Module 1] → Module 2)
  → Writing (tasks)
  → [Submit]
  → [Scoring / Feedback pending]
  → [Score Detail]
```

> ⚠️ **가설(검증필요)**: 녹화에서 관찰된 섹션 순서는 Listening → Speaking → Reading (→ Writing)이다. 그러나 `set1.js`의 `sections[]` 배열 순서는 `[reading, listening, writing, speaking]`이다. **런타임 순서는 콘텐츠 배열 순서와 분리하여 config로 지정**해야 하며, 어느 쪽이 정본인지 확인이 필요하다(7절 OQ-1).

#### B. 오디오 · 미디어

**FR8** — Listening `question` 화면 및 Speaking `listen` phase의 오디오는 **재생 횟수 1회로 강제**되어야 한다. 재생 완료 후 재생 컨트롤은 비활성화되며, 새로고침·재진입 시에도 재생 소진 상태가 유지되어야 한다. (`audio: { src, maxPlays: 1 }`) **(확정: 녹화 관찰 — "오디오 1회", "Listen and repeat only once")**

**FR9** — 오디오 재생 중에는 화면에 남은 재생 시간 카운터와 화자 일러스트(`block.image` 또는 `question.image`)를 표시한다. 기존 `exam.html`의 `makeAudioUnit()` 동작을 계승한다. **(확정: 코드 실측)**

**FR10** — Listening block 중 `perQuestionAudio: true`인 short-response set(L1 Q1–7, L2 Q1–3)은 **문항별 오디오**를, 그 외 audio-set block은 **block 단위 오디오 1개 + 다문항**을 사용한다. 후자의 경우 오디오는 block 진입 시 1회 재생되고, 그 block의 모든 문항이 같은 오디오를 공유한다. **(확정: 코드 실측)**

**FR11** — 시스템은 `set1.js`에 baked-in된 경로(`TOEFL MOCK TEST  SET 1/SET 1 AUDIO/`, `TOEFL LISTENING & WRITING PICTURES/`, `app/assets/speaking/`)를 실제 배포 경로(`media/audio/`, `media/pictures/`, `media/speaking/`)로 **런타임에 remap**해야 한다. `set1.js`는 수정하지 않는다. **(확정: 코드 실측 — 경로 불일치 존재, `audioSrc()`/`imgSrc()` 변환 규칙 이미 있음)**

#### C. Speaking 녹음

**FR12** — 시스템은 `MediaRecorder` API로 Speaking 응답을 녹음해야 한다. 녹음은 record phase 시작과 동시에 자동 시작되고, `respondSec` 만료 시 자동 정지한다(`onExpire: "stopRecord"`). 응시자는 조기 종료(Next)로 녹음을 앞당겨 정지할 수 있다.

**FR13** — 녹음 결과는 Blob으로 로컬 보관되고, 제출 시 백엔드로 업로드된다. 오프라인 모드에서는 IndexedDB에 보관되고 온라인 복귀 시 업로드된다.

**FR14** — 마이크 권한이 거부되었거나 `MediaRecorder`가 미지원인 경우, 시스템은 응시자에게 명확히 고지하고 Speaking 섹션을 "응답 미제출(NOT SUBMIT)"로 진행할 수 있어야 한다. 시험 전체가 중단되어서는 안 된다.

**FR15** — Speaking 문항 유형은 2종이며 각각 다른 phase 시퀀스를 갖는다. **(확정: 녹화 + 코드 실측 — S1 record-set 7문항 `kind:'repeat'`, S2 record-set 4문항 `kind:'interview'`, 합계 11)**

| 유형 | module | 문항 | phases | 코드상 필드 |
|---|---|---|---|---|
| Listen and Repeat | S1 | S-1 … S-7 | `listen`(1회) → `prep` → `record` | `prepSec: 3`, `respondSec: 20` |
| Take an Interview | S2 | S-8 … S-11 | `prompt`(self-paced) → `listen`(인터뷰어) → `prep` → `record` | `prepSec: 3`, `respondSec: 45` |

> ⚠️ **가설(검증필요)**: 녹화에서는 Listen and Repeat이 "준비시간 없이 1회 청취 후 즉시 응답"으로 관찰되었으나, `set1.js`는 `prepSec: 3`을 갖고 있다. 명세 2-4 예시 상수(`prep: 0`, `responseSec: 15`)와도 불일치한다. 정본 확정 필요(7절 OQ-3).

**FR16** — 각 record-set block의 `introAudio`(예: `SPEAKING/Listen and Repeat Instructions.mp3`)는 해당 module 최초 진입 시 Directions 화면에서 1회 재생한다. **(확정: 코드 실측)**

#### D. 사전 점검 화면

**FR17** — 시험 시작 직후 **Adjusting the Volume** 화면을 표시한다. 볼륨 슬라이더와 "Play Test Audio" 버튼을 제공하고, 타이머는 없으며 Continue로 진행한다. **(확정: 녹화 02:30)**

**FR18** — Listening 종료 후 Speaking Directions 이전에 **Hardware Check** 화면을 표시한다. 마이크 입력 레벨 시각화와 스피커 테스트 재생을 제공하고, 타이머 없이 Continue로 진행한다. **(확정: 녹화 21:30)**

**FR19** — 각 section 시작 전 **Section Directions** 화면을 표시한다. Speaking Directions에는 문항 수와 유형을 정리한 표(11문항 · 2유형)를 포함하고 Begin 버튼으로 진행한다. **(확정: 녹화 22:00)**

#### E. 상단바 · 네비게이션

**FR20** — 모든 시험 화면 상단바에 다음을 표시한다. **(확정: 녹화 관찰)**

| 위치 | 요소 |
|---|---|
| 좌측 | 시험 식별자 (`StudyGround NT-016` 형식 — 우리 구현에서는 `StudyGround SET 1` / module 라벨 `2026 (Module 1)`) |
| 중앙 | 빨간 pill 카운트다운 (`question` 화면에서만) |
| 우측 | Exit Test · Volume · Help · Continue/Begin/Next |
| 우측 상단/부제 | 현재 section 명 |
| 하단 우측 | 언어 토글 EN/KO |

**FR21** — `question` 화면은 진행 카운터 **"Question n of N"** 을 표시한다. N은 현재 module의 문항 수 또는 section 전체 문항 수 중 config로 지정된 scope를 따른다.

> ⚠️ **가설(검증필요)**: 녹화의 Listening은 "Question n of 32"(section 전체 기준)로 보였으나, 우리 SET 1 Listening은 L1 18 + L2 15 = **33문항**이다. 카운터 scope(section vs module)와 총량 표기 방식 확정 필요(7절 OQ-2).

**FR22** — Reading/Writing 등 되돌아보기가 허용되는 module에서는 **문항 그리드 네비게이션**(문항 번호 버튼 격자, 답변 완료/미완료/현재 상태 구분)을 제공한다. **(확정: 녹화 51:00 문항 그리드 관찰)**

**FR23** — Listening 및 Speaking module에서는 이전 문항으로 되돌아갈 수 없다(오디오 1회 제약과 정합).

**FR24** — **Exit Test** 는 확인 다이얼로그를 거쳐 시험을 중단하고, 진행 상태를 `in_progress`로 보존한 채 대시보드로 복귀시킨다. 답안은 유실되지 않는다.

**FR25** — **Help** 는 현재 화면 유형에 맞는 조작 안내를 오버레이로 표시한다. Help 표시 중에도 카운트다운은 계속 진행된다.

**FR26** — **Volume** 은 오디오 볼륨을 조절하며 설정은 세션 내 유지된다.

#### F. 문항 렌더링 (7종 block × 8종 question)

**FR27** — 시스템은 `set1.js`의 모든 block kind를 렌더할 수 있어야 한다. **(확정: 코드 실측)**

| block kind | 렌더 요구 | 소속 |
|---|---|---|
| `cloze` | `template`의 `{{n}}` 자리에 입력 필드 인라인 삽입, `question.hint`(선행 글자) 표시 | R1, R2 |
| `passage` | `title` + `paragraphs[]` 렌더, `\n`은 줄바꿈, `{{A}}~{{D}}` 삽입 마커는 클릭 가능한 위치 표식으로 | R1, R2 |
| `chat` | `messages[]`를 `side`(left/right) 기준 말풍선 레이아웃, `name`·`time` 표시 | R1 |
| `audio-set` | 오디오 유닛 + 문항 목록 (FR10 규칙 적용) | L1, L2 |
| `build-set` | 드래그 타일 배열 UI (`slots[]` 고정/빈칸, `tiles[]` 드래그 소스) | W1 |
| `free-write` | textarea + 실시간 단어 수 카운터 + `minWords` 미달 경고 | W2, W3 |
| `record-set` | `introAudio` 재생 + 녹음 UI | S1, S2 |

**FR28** — question kind별 입력 위젯. **(확정: 코드 실측)**

| question kind | 입력 | 정답 형식 |
|---|---|---|
| `blank` | 텍스트 입력 (인라인) | 소문자 문자열 |
| `mcq` | 라디오 4지선다 | 0-based index |
| `mcq` (`layout: 'short-response'`) | 오디오 + 화자 이미지 + 라디오 4지선다 | 0-based index |
| `insert` | 위치 A~D 중 택1 (지문 마커와 연동) | 0-based index |
| `build` | 드래그 타일 → 빈 슬롯 배치 | `answerTokens[]` 순서 |
| `email` | textarea (to/subject/situation/bullets 표시, `minWords: 80`) | 없음 (주관식) |
| `discussion` | textarea (professor prompt + posts 표시, `minWords: 100`) | 없음 (주관식) |
| `repeat` / `interview` | 녹음 | 없음 (주관식) |

**FR29** — short-response mcq의 `prompt`가 한국어 하드코딩(`'오디오를 듣고 가장 알맞은 응답을 고르세요.'`)이므로, 시스템은 EN 기본 원칙에 따라 **영문 prompt("Choose the best response.")를 우선 표시**하고 KO 토글 시에만 원문을 노출해야 한다. `set1.js`는 수정하지 않고 렌더 계층에서 처리한다. **(확정: 코드 실측 — 한국어 하드코딩 존재)**

#### G. 저장 · 재개

**FR30** — 시험은 `sessionId`로 식별된다. 응답·타이머 잔여시간·현재 화면 포인터·오디오 재생 소진 상태를 포함한 세션 상태를 로컬(localStorage/IndexedDB)에 지속 저장한다.

**FR31** — 브라우저 새로고침·비정상 종료 후 재진입 시, 시스템은 저장된 `sessionId`의 **마지막 화면과 잔여 시간으로 복원**해야 한다. 잔여 시간은 wall-clock 기준으로 계산하여, 이탈 중 경과 시간이 반영되도록 한다.

> ⚠️ **가설(검증필요)**: 이탈 시간을 타이머에서 차감할지(엄격) 정지할지(관대) 정책 확정 필요(7절 OQ-6).

**FR32** — URL 계약은 관찰된 형태를 따른다: `/en/test-nt/{section}?testId=..&sessionId=..&mode=practice&section=..`. sg2는 정적 사이트이므로 실제 구현은 `exam.html?testId=..&sessionId=..&mode=..&section=..` 쿼리스트링 + 해시 라우팅으로 대응한다. **(확정: 녹화 URL 관찰 / 구현 방식은 신규 결정)**

**FR33** — `mode` 파라미터로 `practice`(연습: 타이머 완화·즉시 채점 허용)와 `exam`(실전: 전 제약 적용) 두 모드를 구분한다.

#### H. 제출 · 채점 파이프라인

**FR34** — 시험 완료(또는 마지막 module 만료) 시 시스템은 91문항 응답 + Speaking 오디오를 백엔드에 제출한다. **신규 API** `POST /api/attempts` (attempt 생성) 및 `POST /api/attempts/{id}/submit` (응답 일괄 저장)가 필요하다.

**FR35** — 제출 시 `attempts.status`는 `in_progress → scoring → completed`로 전이한다. 현행 모델의 `status` 허용값은 `scored | pending | reviewing`이므로 **값 집합 확장 또는 매핑 정의가 필요하다(신규)**. **(확정: 코드 실측 — 현행 값 집합 상이)**

| 런타임 상태 | 의미 | 현행 컬럼 매핑(제안) |
|---|---|---|
| `in_progress` | 응시 중 / 미제출 | `pending` |
| `scoring` | 자동채점 완료, 교사 피드백 대기 | `reviewing` |
| `completed` | 피드백 100% 완료, 성적 공개 | `scored` |

> ⚠️ **가설(검증필요)**: 컬럼 값을 확장할지 매핑할지 결정 필요(7절 OQ-7).

**FR36** — 제출 즉시 시스템은 **자동 채점 가능한 78문항**(reading 35 + listening 33 + writing build 10)을 채점하여 `question_responses`(`is_correct`)와 `section_scores`(`raw_correct`, `raw_total`, `scaled`)를 기록한다.

**FR37** — 채점 규칙. **(확정: 코드 실측한 정답 형식 기반)**

| 유형 | 규칙 |
|---|---|
| `mcq` / `insert` | 선택 index == `answer` |
| `blank` | 대소문자·전후 공백 무시 후 `answer`와 완전 일치 |
| `build` | 배치 토큰 순서가 `answerTokens[]`와 완전 일치 (부분점수 없음) |

> ⚠️ **가설(검증필요)**: `blank`의 철자 오류 허용(예: Levenshtein 1) 여부, `build`의 부분점수 부여 여부 확정 필요(7절 OQ-8).

**FR38** — `section_scores.scaled`는 `SECTION_MAX = 30` 기준으로 환산되고, `attempts.total_score`는 4개 섹션 합(`TOTAL_MAX = 120`), `grade`는 `cefr_for(total)`로 산출된다. 기존 `crud.recalc_totals()`를 재사용한다. **(확정: 코드 실측)**

**FR39** — 주관식(free-write 2건 + speaking 11건)은 자동 채점하지 않고 교사 채점 대기 상태로 둔다. 단, 기존 LangGraph 파이프라인(`app/scoring/graph.run()`)으로 **AI 초안 피드백**을 생성해 교사에게 제시할 수 있어야 한다(`POST /api/attempts/{id}/rescore` 활용).

#### I. 관리자 채점 백오피스 (신규)

**FR40** — **3-Subject Answer Management 목록 화면(신규)**. 검색 조건: Session, Student Name/ID, Exam Date(From/To). 목록 컬럼: **(확정: 녹화 관찰)**

`SESSION | EXAM NAME | STUDENT | CAMPUS | EXAM DATE | SUBMITTED QUESTIONS | FEEDBACK PROGRESS | MANAGE(View / Write Answer)`

**FR41** — `SUBMITTED QUESTIONS`는 응시자가 실제로 답을 남긴 문항 수를 `"NN ITEMS"` 형태로 표시한다.

**FR42** — `FEEDBACK PROGRESS`는 `(피드백 작성된 문항 수 / 피드백 필요 문항 수) × 100`을 %로 표시한다.

> ⚠️ **가설(검증필요)**: 분모가 "전 문항"인지 "주관식 문항만"인지 확정 필요(7절 OQ-9).

**FR43** — **문항 상세 화면(신규)**. 헤더에 session · year · Campus · Exam Date를 표시하고, **READING / LISTENING / WRITING 탭 전환**으로 단일 화면에서 답안을 검토한다. SPEAKING은 별도 메뉴로 분리한다. **(확정: 녹화 관찰)**

**FR44** — 문항 카드는 다음을 포함한다: 문항유형 태그(예 `WORD FILLING`), 지문/prompt, `STUDENT ANSWER`(미제출 시 `No answer submitted` / `NOT SUBMIT`), `CORRECT ANSWER`, `Feedback` 자유입력(placeholder: *"Write your comments, model answer, or grading notes…"*). **(확정: 녹화 관찰)**

**FR45** — **SPEAKING ANSWERS 화면(신규)**: 문항별 녹음 오디오 플레이어 + 루브릭 점수 입력 + 코멘트 입력.

**FR46** — 교사 피드백 저장을 위해 **`question_responses.feedback` 컬럼(신규)** 또는 별도 피드백 테이블이 필요하다. 현행 `question_responses`에는 피드백 컬럼이 없다. **(확정: 코드 실측 — 컬럼 부재)**

**FR47** — 관리자 좌측 내비게이션(신규): `Dashboard · Exam Management · Question Bank · Students Management · TOEFL Simulation · Answer REGISTER · TOEFL(2) ANSWERS · SPEAKING ANSWERS · Exam Statistics · Rankings by Grade`. **(확정: 녹화 관찰)** 이번 릴리즈 필수 구현은 **3-Subject Answer Management(목록/상세) · SPEAKING ANSWERS · Exam Statistics · Rankings by Grade** 4종이며 나머지는 placeholder로 둔다.

**FR48** — **Exam Statistics(신규)**: exam 단위 응시자 수, 평균/중앙 total_score, 섹션별 평균 scaled, 문항별 정답률(오답률 상위 문항 노출).

**FR49** — **Rankings by Grade(신규)**: CEFR grade(`_CEFR_BANDS`: C1 / B2+ / B2 / B1+ / B1 / A2 / A1) 구간별 인원 분포와 구간 내 순위표. **(확정: 코드 실측 — `cefr_for()` 존재)**

#### J. 응시자 성적 화면 연동

**FR50** — 시험 완료 후 응시자는 기존 성적 상세 화면(`GET /attempts/{id}`)으로 이동한다. 이 화면은 이미 다음을 렌더한다: 도넛 차트(total/120 + CEFR grade), 섹션별 막대, AI 피드백(overall/reading/listening/speaking/writing 순), 수용기능(reading/listening) 문항 리뷰 테이블, 생산기능(speaking/writing) 루브릭 그리드. **(확정: 코드 실측 — `detail.html`)**

**FR51** — 문항 리뷰 테이블에 **교사 피드백 컬럼을 추가(신규)** 하여 FR46의 피드백을 응시자에게 노출한다.

**FR52** — `status`가 `completed`가 아닌 attempt는 성적 상세에서 "채점 중" 상태 배지를 표시하고 점수를 감춘다.

**FR53** — 최근 성적 추이(동일 학생의 attempt 시계열 차트)를 성적 화면에 추가한다(신규).

#### K. IELTS 이식

**FR54** — 타이밍·모듈 구조는 `timing.config.json`(신규)으로 외부화하여, 파일 교체만으로 IELTS 구조를 표현할 수 있어야 한다.

**FR55** — 점수 체계는 `scoreScale` 어댑터(신규)를 통해 TOEFL `/120` ↔ IELTS Band `0–9(0.5 단위)` 를 전환할 수 있어야 한다.

**FR56** — IELTS Speaking Part 2를 위해 `phase: "prep"` 준비시간 타이머가 필요하다. TOEFL 런타임에서도 `prepSec` 필드가 이미 존재하므로 동일 메커니즘을 사용한다. **(확정: 코드 실측 — `prepSec` 존재)**

**FR57** — IELTS 루브릭은 `smeag-local-ai/scoring/rubrics/` 및 `schemas/`의 기존 자산(Writing Task 2: TR/CC/LR/GRA, Speaking: FC/LR/GRA/PRO, band 1.0–9.0 step 0.5)을 그대로 채택한다. **(확정: 파일 실측)**

**FR58** — IELTS 섹션 매핑. **(⚠️ 가설(검증필요) — 실제 IELTS 규격 대조 필요)**

| IELTS | 구조 | TOEFL 런타임 대응 |
|---|---|---|
| Listening | 4파트 총 30분 + transfer 10분 | module 4개 + `moduleEnd` 변형(transfer 화면) |
| Reading | 3지문 총 60분 단일 카운트다운 | module 1개, `perModuleSec: 3600` |
| Writing | Task1 20분/150단어 + Task2 40분/250단어 | module 2개, 각 `timeLimitSec` |
| Speaking | Part1 4–5분 / Part2 1분 prep + 2분 발표 / Part3 4–5분 | `speaking` 화면 + `prep` phase |

### 2.2 Non-Functional Requirements (NFR)

**NFR1 — 빌드 없는 vanilla JS 정적 사이트 유지 (필수 제약)**
sg2는 번들러·트랜스파일러·패키지 매니저 없이 동작해야 한다. React/Vue/Svelte 등 프레임워크 도입 금지, CDN 스크립트/스타일 참조 금지. 모든 JS는 `<script src>`로 직접 로드되는 IIFE 또는 native ES module이며, 외부 의존성은 0이다.

**NFR2 — 오프라인 구동 (필수 제약)**
전 시험 흐름이 네트워크 없이 완주 가능해야 한다. 이미 존재하는 `sw.js`(PWA Service Worker), `manifest.webmanifest`, `media/tts/`, `start-mac.command` / `start-windows.bat` 자산을 활용한다. 오디오·이미지·set1.js는 사전 캐시 대상이다. 제출은 오프라인 시 로컬 큐에 적재되고 온라인 복귀 시 동기화된다.

**NFR3 — EN 기본 · KO 토글 (전역 사용자 규칙)**
UI 기본 언어는 영어이며 한국어는 토글이다. sg2의 기존 메커니즘(`[data-ko]{display:none}`, `html[lang="ko"] [data-en]{display:none}`, `localStorage 'sg2_lang'`)을 그대로 사용한다. 신규 문자열은 반드시 `data-en` / `data-ko` 이중 표기한다. 백엔드는 `resolve_lang()`(query > cookie > `DEFAULT_LANG`) 규칙을 유지한다.

**NFR4 — SQLite / Postgres 이중모드 호환**
모든 신규 컬럼·테이블은 SQLAlchemy portable type만 사용하고, `schema.sql`(Supabase Postgres DDL 계약 파일)과 1:1로 동기화되어야 한다. `APP_MODE=local`(SQLite) / `cloud`(Supabase Postgres) 양쪽에서 동일하게 동작해야 한다.

**NFR5 — 타이밍 상수의 코드 외부화**
module별 배정 시간, Speaking 유형별 prep/response 초, Writing task별 시간, 오디오 재생 허용 횟수는 **JS 코드에 하드코딩하지 않고** `timing.config.json`(신규)에 둔다. 가설값 검증 후 값만 교체하면 되도록 한다.

**NFR6 — 디자인 시스템 재사용**
신규 화면은 `sg2/assets/app.css`의 기존 CSS 변수(`--brand #e8481f`, `--brand-ink`, `--line`, `--muted`, `--cream`, `--cream-2`, `--peach-2`, `--ok`, `--radius`, `--shadow` 등 25개)와 기존 클래스(`.wrap`, `.card`, `.btn`, `.pill`, `.chip`, `.field` 등)를 우선 사용한다. 시험 전용 신규 클래스는 `app.css` 하단에 별도 섹션으로 추가한다(신규: `.qcard`, 타이머, 오디오 플레이어, 선택지, 드래그 타일, 문항 그리드 스타일 — 현재 파일에 부재함이 실측 확인됨).

**NFR7 — 타이머 정확도**
카운트다운은 `setInterval` 누적 오차에 의존하지 않고 **wall-clock 기준 절대 종료시각(epoch ms)** 으로 계산한다. 탭 비활성화·백그라운드 스로틀링 상황에서도 실제 경과 시간이 반영되어야 한다. 표시 오차 허용치는 ±1초.

**NFR8 — 성능**
화면 전환 체감 지연 100ms 이하. 91문항 전체를 한 번에 DOM에 올리지 않고 **현재 화면만 렌더**한다(현행 exam.html 전량 렌더 방식 폐기). 오디오는 다음 문항 것을 선행 preload한다.

**NFR9 — 접근성**
키보드만으로 전 시험 진행 가능(선택지 이동/선택, Next, 그리드 이동). 타이머는 `aria-live="polite"`로 잔여 시간 변화를 과도하지 않게 안내(분 단위 및 마지막 60/30/10초). 드래그 타일은 키보드 대체 조작(선택 후 슬롯 지정)을 반드시 제공한다. 색만으로 상태를 구분하지 않는다(정답/오답, 답변완료/미완료에 아이콘·텍스트 병기).

**NFR10 — 데이터 무결성**
답안 로컬 저장은 매 응답 변경 시 즉시 반영(디바운스 300ms 이내). 제출 API는 멱등해야 하며 동일 `sessionId` 중복 제출은 갱신으로 처리한다.

**NFR11 — 개인정보 및 미디어 보관**
Speaking 오디오는 학생·attempt와 결합된 개인식별 가능 데이터다. 보관 위치(로컬 파일시스템 vs Supabase Storage), 보존 기간, 접근 권한(교사/관리자만)을 정의해야 한다. **⚠️ 가설(검증필요)** — 보존 정책 미정(7절 OQ-10).

**NFR12 — 브라우저 지원**
최신 Chrome / Edge / Safari 기준. `MediaRecorder`는 Safari 지원 편차가 있으므로 mimeType 협상(`audio/webm;codecs=opus` → `audio/mp4`) 폴백을 구현한다. IE 및 레거시 브라우저 미지원.

**NFR13 — 보안**
정답(`answer`, `answerTokens`)은 현재 `set1.js`에 평문으로 클라이언트에 노출된다. `mode=exam`에서는 최소한 즉시 채점 UI를 비활성화하고, 향후 정답 분리 배포를 검토한다. **⚠️ 가설(검증필요)** — 오프라인 구동(NFR2)과 정답 서버 분리는 상충하므로 정책 결정 필요(7절 OQ-11).

**NFR14 — 로깅/관측**
attempt별 화면 전환 타임스탬프, 오디오 재생 이벤트, 타이머 만료 이벤트를 로컬 로그로 남겨 문제 재현과 타이밍 가설 검증에 활용한다.

---

## 3. User Interface Design Goals

### 3.1 전체 UX 원칙

| 원칙 | 설명 |
|---|---|
| 시험장 몰입 | 마케팅 사이트 크롬(`.nav`, `.subnav`, `.foot`)을 시험 중에는 제거하고, 시험 전용 상단바만 남긴다. 화면 전체가 문항에 집중되도록 한다 |
| 한 화면 한 과업 | 스크롤 연습지 폐기. `screenType` 단위로 한 화면에 하나의 과업만 |
| 시간의 가시성 | 남은 시간은 항상 같은 위치(상단 중앙)에 있고, 형식이 화면 유형에 따라 일관되게 달라진다 |
| 되돌릴 수 없음의 명시 | 오디오 1회, module 되돌아가기 불가, Exit Test는 사전에 명확히 고지 |
| 브랜드 연속성 | SMEAG 크림/브릭 팔레트를 유지하되, 시험 화면은 채도를 낮추고 여백을 늘려 시각 피로를 줄인다 |

### 3.2 상단바 (Exam Top Bar) — 신규 컴포넌트

```
┌──────────────────────────────────────────────────────────────────────┐
│ StudyGround SET 1        ┌──────────┐          Exit Test  🔊  ? Help │
│ 2026 (Module 1)          │  12:34   │  ← 빨간 pill      Listening    │
│                          └──────────┘                                │
└──────────────────────────────────────────────────────────────────────┘
```

| 요소 | 사양 |
|---|---|
| 좌측 상단 | 시험 코드 · 굵게. 하단 보조 라인에 `2026 (Module {n})` |
| 중앙 | 카운트다운 pill (`question` 화면 전용) |
| 우측 | Exit Test(ghost) · Volume(아이콘) · Help(아이콘) · 주 액션 버튼(Continue/Begin/Next, `.btn.brand`) |
| 우측 하단 보조 | 현재 section 명 |
| 하단 우측 고정 | 언어 토글 EN/KO (`.lang` 재사용) |
| 높이 | 데스크톱 64px, 모바일 56px, `position: sticky; top:0` |

### 3.3 빨간 pill 카운트다운

| 속성 | 값 |
|---|---|
| 형식 | `MM:SS` |
| 배경 | `var(--brand)` `#e8481f` |
| 텍스트 | 흰색, tabular-nums, 자간 0 |
| 형태 | `border-radius: 999px`, padding `6px 18px` |
| 상태 | 남은 시간 ≤ 60초 시 pulse 애니메이션(`prefers-reduced-motion` 존중하여 비활성 가능) |
| 접근성 | `role="timer"` `aria-live="polite"`, 분 단위 + 마지막 60/30/10초에만 announce |
| 위치 | 상단바 중앙, `question` 화면에서만 표시 (`instruction` / `speaking` / `moduleEnd`에서는 비표시) |

### 3.4 보라색 RESPONSE TIME 박스

| 속성 | 값 |
|---|---|
| 형식 | `HH:MM:SS` **(확정: 녹화 관찰 — Speaking만 시:분:초 3단)** |
| 위치 | 화면 중앙 하단 |
| 색 | 보라 계열 (**신규 토큰 필요** — `--record: #6d4aff` / `--record-soft` ⚠️ 정확한 색상값은 녹화 캡처 대조 필요) |
| 구성 | 라벨 `RESPONSE TIME` (대문자, 자간 확대) + 타이머 + 🎤 아이콘 |
| 상태 | 녹음 중 마이크 아이콘 pulse, 입력 레벨 미터 병기 |
| 접근성 | 색상 외에 "Recording" 텍스트 병기 |

### 3.5 문항 그리드 네비게이션

- Reading / Writing module 하단(또는 접이식 패널)에 문항 번호 격자.
- 상태 4종: `answered`(채워짐) / `unanswered`(외곽선) / `current`(브랜드 강조) / `flagged`(북마크 — 신규 기능, 선택)
- 색만이 아니라 아이콘·굵기로도 구분(NFR9).
- Listening / Speaking에서는 그리드가 **읽기 전용 진행 표시기**로만 동작(FR23).

### 3.6 화면 유형별 레이아웃

| screenType | 레이아웃 |
|---|---|
| `instruction` | 중앙 정렬 단일 카드(`.card`, max-width 720px). 제목 · 본문 · (필요 시 표) · 하단 우측 단일 CTA |
| `question` | 2단 레이아웃(좌: 지문/오디오, 우: 문항·선택지). cloze/build는 단일 컬럼 전폭 |
| `speaking` | 중앙 일러스트(`question.image`) + phase 인디케이터 + 하단 RESPONSE TIME 박스 |
| `hardwareCheck` | `instruction` 골격 + 마이크 레벨 미터·스피커 테스트(`getUserMedia`) |
| `review` | 제출 전 확인 — 섹션별 응답/미응답 요약 + `Submit Test` |
| `moduleEnd` | `instruction`과 동일 골격, 상단에 완료 체크 아이콘, 본문은 "End of Module {n}" 안내 |

### 3.7 기존 CSS 토큰 재사용 매핑

| 용도 | 재사용 토큰/클래스 |
|---|---|
| 카드 표면 | `.card`, `--card`, `--line`, `--radius`, `--shadow` |
| 주 액션 | `.btn.brand`, `--brand`, `--brand-ink` |
| 보조 액션 | `.btn.ghost` |
| 배경 | `--cream`, `--cream-2` |
| 보조 텍스트 | `--muted`, `--dim`, `.muted` |
| 정답/성공 | `--ok`, `--ok-soft` |
| 경고 | `--warn` |
| 잠금/비활성 | `--lock` |
| 태그/배지 | `.tag`, `.chip`, `.pill` |
| 입력 | `.field`, `.field input` |
| 언어 토글 | `.lang`, `.lang button.on` |

**신규로 추가해야 하는 스타일 (현 app.css에 부재 — 실측 확인)**: `.exam-bar`, `.timer-pill`, `.response-box`, `.qcard`, `.choice`, `.audio-unit`, `.tile` / `.slot`(드래그), `.qgrid`, `.phase-dots`, `.mic-meter`, 시험용 textarea 스타일, 인쇄 스타일(불필요 시 생략).

### 3.8 관리자 백오피스 UI

- 기존 FastAPI 템플릿(`base.html`)을 확장하여 **좌측 사이드바 내비게이션(신규)** 을 추가한다.
- 목록 화면은 `list.html`의 테이블 패턴을, 상세 화면은 `detail.html`의 `.qtable` / `.review` / `.rubric-grid` 패턴을 재사용한다.
- FEEDBACK PROGRESS는 `detail.html`의 `.bar-row` / `.bar > i` 막대 패턴을 그대로 사용한다.
- 탭 전환(READING / LISTENING / WRITING)은 서버 렌더 + 쿼리 파라미터 방식(무빌드 원칙 유지).

### 3.9 접근성 체크리스트

| 항목 | 요구 |
|---|---|
| 키보드 | 전 화면 Tab 순회 가능, 선택지는 화살표 이동, Enter/Space 선택 |
| 드래그 대체 | build 문항은 "타일 선택 → 슬롯 선택" 2단계 키보드 조작 필수 |
| 포커스 | 화면 전환 시 새 화면의 제목(h1/h2)으로 포커스 이동 |
| 대비 | 본문 텍스트 4.5:1 이상, pill 흰 텍스트/브랜드 배경 대비 검증 |
| 모션 | `prefers-reduced-motion: reduce` 시 pulse·전환 애니메이션 비활성 |
| 스크린리더 | 오디오 재생 상태·남은 재생 횟수·녹음 상태를 텍스트로 안내 |
| 다크모드 | 현 `app.css`에 다크 블록 없음 → 이번 범위에서도 라이트 전용 유지 |

---

## 4. Technical Assumptions

### 4.1 Repository & Service Architecture

| 결정 | 내용 | 이유 |
|---|---|---|
| Repository | 단일 저장소(monorepo) 유지 | 이미 sg2(정적) + studyground/app(FastAPI)가 한 저장소에 공존하며, Vercel 설정(`api/index.py`, `vercel.json`)도 그 전제로 구성됨 |
| Service | 정적 프론트 + 단일 FastAPI 백엔드 | 마이크로서비스 도입 근거 없음. 규모 대비 과설계 |
| 프론트 빌드 | 없음 (vanilla JS, IIFE) | 사용자 전역 제약(NFR1) 및 오프라인 실행 파일(`start-mac.command`) 전제 |

### 4.2 프론트엔드 기술 결정

| 결정 | 내용 | 이유 |
|---|---|---|
| 콘텐츠 소스 | `window.SMEAG_SET1` 그대로 사용, `set1.js` **불변** | 실측된 스키마가 안정적이고, 수정 시 회귀 위험. 경로 remap·EN prompt 대체는 렌더 계층에서 처리(FR11, FR29) |
| 신규 모듈 (신규) | architecture.md 10절 소스트리가 정본: `assets/exam-compile.js`, `exam-engine.js`, `exam-clock.js`, `exam-render*.js`, `exam-store.js`, `exam-recorder.js`, `exam-media.js`, `exam-sync.js`, `exam-timing.js`, `exam-types.js` + 설정 파일 `config/timing.toefl.json` / `config/timing.ielts.json` | 단일 파일 비대화 방지, 역할 분리로 IELTS 이식 시 교체 지점 명확화 |
| 로드 방식 | `<script src>` 순차 로드 + 전역 네임스페이스 `window.SG_EXAM` | 무빌드 제약 하 가장 단순. 기존 `window.SG_TTS` 패턴과 일관 |
| 상태 지속화 | 응답/포인터/타이머는 localStorage, 오디오 Blob은 IndexedDB | Blob은 localStorage에 못 넣음. 오디오만 IndexedDB로 분리 |
| 라우팅 | `exam-runtime.html` 단일 페이지 + 쿼리스트링/해시 (기존 `exam.html` 연습지는 보존) | 정적 호스팅에서 서버 라우팅 불가 |
| 오디오 | 네이티브 `<audio>` + 재생 카운터 | 외부 라이브러리 금지 |
| 녹음 | 네이티브 `MediaRecorder` + mimeType 폴백 | 동일 |
| 드래그 | 네이티브 HTML5 DnD + 키보드 대체 경로 | 동일 |

### 4.3 백엔드 기술 결정

| 결정 | 내용 | 이유 |
|---|---|---|
| 스택 유지 | FastAPI + SQLAlchemy 2.x + Pydantic v2 + Jinja2 | 이미 구축·검증됨. 변경 이득 없음 |
| DB | SQLite(local) / Postgres(cloud) 이중모드 유지 | `config.get_settings()`가 이미 처리. `schema.sql`이 계약 파일 |
| 신규 write 경로 | `app/crud.py`에 create 계열 헬퍼 추가(신규) | 현재 crud에는 read/recalc/save_feedback만 존재 — 실측 확인 |
| 신규 라우터 (신규) | `app/routers/attempts_write.py`(제출), `app/routers/admin.py`(백오피스 HTML) | 기존 `scores.py`(API) / `pages.py`(HTML) 분리 관례 계승 |
| 스키마 변경 (신규) | `question_responses.feedback` Text 추가, `attempts.status` 값 집합 확장, `speaking_recordings` 테이블 또는 `question_responses.media_ref` 추가, `attempts.session_id` / `campus` 추가 | FR44/FR46, FR40의 CAMPUS 컬럼, FR30의 sessionId 요구 |
| AI 채점 | 기존 `app/scoring/graph.run(detail, lang, mode)` 재사용 | 이미 offline(rules) / online(Anthropic) 이중 경로와 폴백이 구현됨. 재발명 금지 |
| AI 결과 취급 | 교사 검수 전 초안(draft)으로만 노출 | 자동 확정 시 채점 신뢰도 리스크 |
| 인증 | ⚠️ 가설(검증필요) — 현재 백엔드에 인증 없음. 관리자 화면 도입 시 최소 인증 필요 | OQ-12 |

### 4.4 데이터 모델 변경 요약

> **컬럼명 정본은 architecture.md 6.1/6.2절**이다. 아래는 요약이며 이름이 어긋나면 architecture를 따른다.

| 테이블 | 변경 | 구분 |
|---|---|---|
| `attempts` | `session String(64)` (부분 unique index) 추가 | 신규 |
| `attempts` | `campus`, `exam_date`, `submitted_count`, `total_questions`, `feedback_progress`, `profile`, `scale`, `band_score`, `started_at`, `submitted_at`, `content_hash` 추가 | 신규 |
| `attempts` | `status` 값 집합을 `in_progress\|scoring\|completed`로 **통합**하고 기존 값(`scored/pending/reviewing`)은 마이그레이션 (architecture 6.3 보존 전략) | 신규 (OQ-7 해소) |
| `question_responses` | `question_key String(32)` (`R1-1`, `S-8`), `qtype String(24)`, `module String(8)`, `auto_score`, `max_score`, `feedback Text`, `audio_ref`, `graded_by`, `graded_at` 추가 | 신규 |
| `section_scores` | `module String(8)` 추가 | 신규 |
| `rubric_scores` | `band NUMERIC(2,1)` 추가(IELTS 0.5 단위) | 신규 |
| `attempt_events` (신규 테이블) | `id, attempt_id FK, ts, type, screen_id, detail` | 신규 |
| `media_assets` (신규 테이블) | `id, attempt_id FK, question_key, kind, storage, uri, inline_b64, mime, bytes, duration_ms, sha256` — Speaking 녹음 메타 | 신규 |
| `students` | `campus String(64)` 추가 (OQ-13 해소) | 신규 |
| `ai_feedback` | 변경 없음 | 기존 |

> 모든 신규 컬럼은 SQLAlchemy portable type만 사용하며(NFR4), `schema.sql`에 대응 DDL을 동시 반영한다.

### 4.5 타이밍 설정 파일 계약

**실재 파일**: `studyground/sg2/config/timing.toefl.json` · `studyground/sg2/config/timing.ielts.json`
**스키마 정본**: `docs/bmad/timing-spec.md` (필드 정의·provenance·값 변경 절차) / 요약은 architecture.md 4.4절.

최상위 키는 `schemaVersion, exam, sectionOrder, defaults, sections, directions, provenance` 7개이며 두 프로파일이 **완전히 동일한 키 구조**를 갖는다. 값의 근거(`observed` / `official` / `content` / `assumed`)는 파일 끝 `provenance.entries[]`에 path 기반으로 병렬 표기한다.

**확정 근거가 있는 값**: `writing.tasks[*].perTaskSec` 600×3 (set1.js `module.timeLimitSec`), `speaking.taskTypes.*.prepSec/responseSec` (set1.js `prepSec:3`, `respondSec:20|45`), `reading.sectionSec` 2100 (set1.js `timeLimitSec`), `audio.maxPlays: 1` (녹화 관찰).
**⚠️ 가설**: Reading 모듈 분할(R1 1080 / R2 1020), Listening 모듈 배정시간 및 문항당 20초, `moduleEnd.maxSec` 30, 섹션 순서.

### 4.6 테스트 전략

| 레벨 | 대상 | 방법 |
|---|---|---|
| 단위 | 채점 규칙(FR37), 타이머 잔여시간 계산, 경로 remap | 순수 함수로 분리해 브라우저 콘솔 하네스 또는 Python 측 pytest |
| 통합 | 제출 API → 자동채점 → section_scores/총점/CEFR | pytest + SQLite in-memory |
| 시나리오 | 91문항 완주 스모크, 새로고침 재개, 오디오 소진 유지, 마이크 거부 폴백 | 수동 체크리스트 + 녹화 대조 |
| 타이밍 검증 | 실제 시험 화면녹화와 우리 런타임을 나란히 재생해 화면 전환 시점 대조 | OQ 해소 수단 |

---

## 5. Epic List

> 각 에픽은 독립 배포 가능한 수직 슬라이스를 지향한다. **스토리 상세는 `docs/bmad/epics-and-stories.md`가 정본**이며, 그 문서는 아래 13개 목표를 7개 실행 에픽으로 재편성했다. 매핑은 다음과 같다.

| PRD 에픽 | epics-and-stories.md |
|---|---|
| E1 Exam Runtime Foundation | Epic 1 (1.1~1.8) |
| E2 Reading & Writing Module Runtime | Story 2.3, 2.4, 2.7 |
| E3 Listening Runtime & Audio Discipline | Story 2.2 |
| E4 Speaking Runtime & Recording | Story 2.1(HW check), 2.5 |
| E5 Session Persistence & Resume | Story 1.6, 1.8 |
| E6 Submission & Auto-Scoring Pipeline | Epic 3 (3.1~3.5) |
| E7 Admin — 3-Subject Answer Management | Story 4.1, 4.2, 4.3, 4.5 |
| E8 Admin — Speaking Answers & AI Draft | Story 4.4, 5.1, 5.2 |
| E9 Statistics & Rankings | Story 4.6, 4.7 |
| E10 Student Score Report Integration | Story 5.3, 5.4 |
| E11 Offline & PWA Hardening | Story 7.1 |
| E12 IELTS Adapter | Epic 6 (6.1~6.5) |
| E13 Timing Calibration | Story 7.2 |


| # | Epic | 한 줄 목표 |
|---|---|---|
| **E1** | Exam Runtime Foundation | `screenType` 4종 상태머신·화면 렌더 셸·wall-clock 타이머·`timing.config.json` 로더를 세워 한 화면 단위로 시험이 흐르게 한다 |
| **E2** | Reading & Writing Module Runtime | cloze/passage/chat/build-set/free-write 렌더러와 module 카운트다운·`moduleEnd` 자동전환·문항 그리드 네비게이션을 완성한다 |
| **E3** | Listening Runtime & Audio Discipline | audio-set 두 방식(block 오디오 / perQuestionAudio)을 렌더하고 오디오 1회 재생 강제와 되돌아가기 차단을 보장한다 |
| **E4** | Speaking Runtime & Recording | Hardware Check, phase 시퀀스, 보라색 RESPONSE TIME 박스, MediaRecorder 녹음·폴백·로컬 보관을 구현한다 |
| **E5** | Session Persistence & Resume | `sessionId` 기반 응답·포인터·타이머·오디오 소진 상태 지속화와 새로고침 재개, Exit Test 안전 중단을 제공한다 |
| **E6** | Submission & Auto-Scoring Pipeline | 답안 제출 API·스키마 확장·78문항 자동채점·`section_scores`/총점/CEFR 산출과 `in_progress→scoring→completed` 전이를 구축한다 |
| **E7** | Admin — 3-Subject Answer Management | 채점 목록(검색·SUBMITTED QUESTIONS·FEEDBACK PROGRESS)과 문항 상세(READING/LISTENING/WRITING 탭·문항별 피드백 입력)를 만든다 |
| **E8** | Admin — Speaking Answers & AI Draft | 녹음 재생·루브릭 입력 화면과 기존 LangGraph 파이프라인 기반 AI 피드백 초안 제시를 붙인다 |
| **E9** | Statistics & Rankings | Exam Statistics(평균·문항별 정답률)와 Rankings by Grade(CEFR 구간 분포·순위)를 산출·시각화한다 |
| **E10** | Student Score Report Integration | 성적 상세에 교사 피드백 컬럼·채점중 상태 배지·최근 성적 추이를 추가해 응시 결과 루프를 닫는다 |
| **E11** | Offline & PWA Hardening | 오디오·이미지·설정 파일 사전 캐시, 오프라인 제출 큐, 온라인 복귀 동기화로 무네트워크 완주를 보장한다 |
| **E12** | IELTS Adapter | `timing.config.json` 교체·`scoreScale` 어댑터·IELTS 루브릭 연결·Speaking `prep` phase로 IELTS 모드를 얹는다 |
| **E13** | Timing Calibration | 7절 Open Questions의 가설 타이밍 값을 실측 대조로 확정하고 config에 반영한다 |

**권장 진행 순서**: E1 → E2 → E3 → E4 → E5 → E6 → E10 → E7 → E8 → E9 → E11 → E13 → E12
(E13은 E1~E5 완료 직후부터 병행 가능하며, 확정값 반영은 config 교체만으로 끝나야 한다.)

---

## 6. Out of Scope

이번 릴리즈에서 **하지 않는 것**을 명시한다.

| # | 제외 항목 | 사유 / 대안 |
|---|---|---|
| OS1 | SET 2 이후 신규 문항 콘텐츠 제작 | 런타임은 `set1.js` 스키마를 따르는 모든 SET을 수용하도록 만든다. 콘텐츠 제작은 별도 트랙 |
| OS2 | Question Bank / Exam Management 관리자 CRUD | 내비게이션 항목은 두되 placeholder. 문항 편집기는 별도 릴리즈 |
| OS3 | 실시간 감독(proctoring), 웹캠 촬영, 화면 이탈 감지 | 규제·개인정보 검토 선행 필요 |
| OS4 | 부정행위 방지 강화(정답 클라이언트 분리, 전체화면 강제, 복사 차단) | NFR2(오프라인)와 상충. NFR13 수준의 최소 조치만 |
| OS5 | 결제/구독 연동 (`purchase.html` 실제 결제) | 기존 정적 페이지 유지 |
| OS6 | 모바일 네이티브 앱 | PWA로 대응 |
| OS7 | TOEFL 공식 점수 환산표의 정확한 재현 | `SECTION_MAX 30 / TOTAL_MAX 120` 선형 환산 유지. 공식 환산표 확보 시 어댑터로 교체 |
| OS8 | 자동 STT 기반 Speaking 자동 채점 | `smeag-local-ai/qa/stt_loopback.py` 자산은 있으나 이번 범위 밖. 교사 채점 + AI 텍스트 초안까지만 |
| OS9 | 다국어(EN/KO 외) 지원 | `rules.build_items()`가 en/ko만 지원 — 실측 확인 |
| OS10 | 다크 모드 | 현 `app.css`에 다크 블록 없음. 라이트 전용 유지 |
| OS11 | 관리자 SSO / 역할 기반 세분 권한 | 최소 인증만(OQ-12 결정에 따름) |
| OS12 | 문항 flag/bookmark 고급 기능, 메모 기능 | 그리드 상태 4번째 값으로 여지만 남김 |
| OS13 | 레거시 e-test PHP 사이트와의 실시간 데이터 동기화 | 참조 모델로만 사용 |

---

## 7. Open Questions

### 7.1 타이밍 가설값 검증 (최우선 — E13)

| ID | 항목 | 현재 가설값 | 근거 상태 | 검증 방법 | 영향 |
|---|---|---|---|---|---|
| **T-1** | Reading Module 1 배정 시간 | 1080초(18분) | ⚠️ 가설. set1.js는 섹션 총 2100초만 제공, module 분할 없음 | 실제 시험 녹화 45:30–48:30 구간 타이머 초기값 캡처 | 자동전환 시점 |
| **T-2** | Reading Module 2 배정 시간 | 1020초(17분) | ⚠️ 가설. 2100 − T-1로 역산 | 동일 | 동일 |
| **T-3** | Listening module 총 시간 | 미정(null) | ⚠️ 가설. set1.js `timeLimitSec: null` | 녹화 03:00–21:00(약 18분) 구간과 문항 수 대조 | 타이머 존재 여부 자체 |
| **T-4** | Listening 문항당 시간 | 20초 | ⚠️ 가설. 녹화에서 관찰된 카운트다운 값 `00:20`은 신형 모듈 화면(36:00–44:00)에서 관찰 | 문항 전환 간격 실측 | 카운터 scope |
| **T-5** | Speaking Listen&Repeat prepSec | 3초 (set1.js) vs 0초 (녹화 관찰 "즉시 응답") vs 명세 예시 0 | 상충 | 녹화 22:30–29:30 구간 프레임 단위 확인 | phase 시퀀스 |
| **T-6** | Speaking Listen&Repeat respondSec | 20초 (set1.js) vs 15초 (명세 예시) | 상충 | 동일 | 녹음 길이 |
| **T-7** | Speaking Interview respondSec | 45초 (set1.js) | 확정에 가까움(코드) but 녹화 미측정 | 녹화 30:30–33:30 구간 | 녹음 길이 |
| **T-8** | Writing task별 시간 | W1/W2/W3 각 600초 | **확정 (set1.js `module.timeLimitSec: 600`)** — 단 실제 시험 대조는 미완 | 실제 시험 Writing 구간 확보 필요(녹화에 Writing 타이머 미관찰) | 타이머 값 |
| **T-9** | 오디오 재생 허용 횟수 | 1회 | **확정 (녹화 + "only once" 문구)** | — | — |
| **T-10** | instruction 화면 상한 타임아웃 | 없음(무제한) | ⚠️ 가설. 명세는 "옵션으로 상한 허용" | 실제 시험에서 방치 시 동작 확인 | 세션 관리 |

### 7.2 구조·정책 결정 필요

| ID | 질문 | 선택지 | 현 상태 | 결정 필요 시점 |
|---|---|---|---|---|
| **OQ-1** | section 실행 순서의 정본은? | (a) 녹화 관찰 순서 L→S→R→W (b) set1.js 배열 순서 R→L→W→S | **잠정 (a)** — `sectionOrder`가 정본이고 `set.sections[]` 순서는 무시(architecture 4.1). 실제 규격 확인은 미결 | E1 착수 전 |
| **OQ-2** | "Question n of N"의 N scope | (a) section 전체 (b) 현재 module | 녹화는 32(section), 우리 SET은 33 | E1 |
| **OQ-3** | Speaking prep 단계 존재 여부 | (a) prepSec 3초 유지 (b) 0으로 제거 | T-5와 동일 이슈 | E4 |
| **OQ-4** | Listening 타이머 scope | (a) module 단위 (b) 문항 단위 (c) 없음 | T-3/T-4 미해소 | E3 |
| **OQ-5** | Reading module 되돌아가기 허용 여부 | (a) module 내 자유 이동 (b) 순차 진행만 | 녹화의 문항 그리드는 (a)를 시사 | E2 |
| **OQ-6** | 이탈 중 타이머 정책 | (a) 계속 흐름(엄격) (b) 정지(관대) (c) mode별 상이 | 미정 | E5 |
| ~~**OQ-7**~~ | `attempts.status` 처리 | (b) **결정됨** — `in_progress/scoring/completed`로 통합하고 기존 값은 UPDATE 마이그레이션 후 CHECK 제약 (architecture 6.2.2 / 6.3) | 해소 2026-08-06 | — |
| **OQ-8** | 채점 관용도 | `blank` 철자 오류 허용 여부 / `build` 부분점수 여부 | 현재 완전일치 가정 | E6 |
| **OQ-9** | FEEDBACK PROGRESS 분모 | (a) 전 문항 91 (b) 주관식 13건만 (c) 제출 문항 수 | 녹화만으로 판별 불가 | E7 |
| **OQ-10** | Speaking 오디오 보관 정책 | 저장 위치·보존 기간·접근 권한 | 미정 (NFR11) | E4 |
| **OQ-11** | 정답 노출 정책 | 오프라인 필수 vs 정답 서버 분리 (상충) | 현재 클라이언트 평문 | E6 |
| **OQ-12** | 관리자 인증 방식 | (a) 단순 비밀번호 (b) Supabase Auth (c) 기존 e-test 연동 | 현 백엔드 인증 없음 | E7 착수 전 |
| ~~**OQ-13**~~ | CAMPUS 값 출처 | (a)+(b) **결정됨** — `students.campus`를 정본으로 두고 응시 시점 값을 `attempts.campus`에 스냅샷 (architecture 6.2.1/6.2.2) | 해소 2026-08-06 | — |
| **OQ-14** | 응시자 성적 공개 시점 | (a) 자동채점 직후 부분 공개 (b) 교사 피드백 100% 후 전체 공개 | FR52와 연동 | E10 |
| **OQ-15** | short-response mcq 영문 prompt 문구 | "Choose the best response." 로 확정? | 녹화에 동일 문구 관찰됨 | E3 |
| **OQ-16** | RESPONSE TIME 박스 정확한 보라색 값 | 녹화 캡처에서 색 추출 필요 | 신규 토큰 미정 | E4 |
| **OQ-17** | IELTS 이식 범위·우선순위 | 4스킬 전체 vs Writing/Speaking 채점만 | 루브릭 자산은 IELTS만 존재 | E12 착수 전 |

### 7.3 검증 산출물

OQ/T 항목이 해소될 때마다 다음을 갱신한다.

1. `sg2/assets/timing.config.json` — 값 교체(코드 변경 없이)
2. 본 PRD 7절 — 해당 행을 **확정**으로 승격하고 근거 기재
3. `docs/bmad/architecture.md`(신규) — 구조 결정이 바뀐 경우

---

## 부록 A — 콘텐츠 인벤토리 요약 (확정, set1.js 실측)

| Section | Module | Block(kind × 개수) | 문항 수 | ID 범위 |
|---|---|---|---|---|
| Reading (35) | R1 | cloze 1 · passage 2 · chat 1 | 20 | `R1-1` … `R1-20` |
| | R2 | cloze 1 · passage 1 | 15 | `R2-1` … `R2-15` |
| Listening (33) | L1 | audio-set 6 (1개는 perQuestionAudio) | 18 | `L1-1` … `L1-18` |
| | L2 | audio-set 5 (1개는 perQuestionAudio) | 15 | `L2-1` … `L2-15` |
| Writing (12) | W1 | build-set 1 | 10 | `W-1` … `W-10` |
| | W2 | free-write 1 | 1 | `W-EMAIL` |
| | W3 | free-write 1 | 1 | `W-DISC` |
| Speaking (11) | S1 | record-set 1 | 7 | `S-1` … `S-7` |
| | S2 | record-set 1 | 4 | `S-8` … `S-11` |
| **합계** | 9 modules | 7 kinds | **91** | — |

자동 채점 대상 **78**문항 (R 35 + L 33 + W build 10) · 교사/AI 채점 대상 **13**건 (free-write 2 + speaking 11).

## 부록 B — 화면유형 × 타이머 매트릭스 (확정)

| screenType | 타이머 표시 | 형식 | scope | onExpire | 진행 |
|---|---|---|---|---|---|
| `instruction` | 없음 | — | — | — | `manual` (Continue/Begin/Next) |
| `question` | 빨간 pill (상단 중앙) | `MM:SS` | 섹션별: listening=question / reading=module / writing=task | `autoAdvance` | `auto` 또는 `manual` |
| `speaking` | 보라 RESPONSE TIME (중앙 하단) | `HH:MM:SS` | screen (phase 단위) | `stopRecord` | `auto` |
| `moduleEnd` | 없음(비표시 상한 `maxSec` 30초) | — | `screen` | `autoAdvance` | `manual` (Continue 버튼) |
| `hardwareCheck` | 없음 | — | `screen` | — | `manual` |
| `review` | 없음 | — | — | — | `manual` (Submit) |

---

*문서 끝. 본 PRD의 모든 ⚠️ 가설 항목은 7절 Open Questions와 1:1로 대응하며, 확정 전에는 구현 코드에 하드코딩하지 않고 `timing.config.json`을 경유해야 한다.*
