# BMAD 문서 세트 — SMEAG New TOEFL / IELTS 모의고사 런타임

화면녹화(`TOEFL MOCK TEST SCREEN RECORDING.mp4`, 57분 53초) 분석 명세를 실행 가능한 구현 계약으로 옮긴 문서 묶음이다.

## 읽는 순서

| # | 문서 | 역할 | 언제 보는가 |
|---|---|---|---|
| 1 | [prd.md](prd.md) | **요구사항 정본.** FR1–FR58 / NFR1–NFR12 | "무엇을 만들어야 하는가"를 확인할 때 |
| 2 | [architecture.md](architecture.md) | **구조·계약 정본.** 상태머신, `TestScreen` 인터페이스, 스크린 컴파일러, DB 델타 DDL, API 표, LangGraph 확장, 스코어 스케일, 소스 트리 | 코드를 쓰기 직전. 문서 간 모순이 있으면 **이 문서가 이긴다** |
| 3 | [timing-spec.md](timing-spec.md) | 타이밍 config 스키마 레퍼런스 + **확정 관찰값 vs 가설값** 대장 | 시간 숫자를 만지기 전 |
| 4 | [epics-and-stories.md](epics-and-stories.md) | 실행 백로그. 7에픽 38스토리, 각 스토리의 AC·Files·Verification + **병렬 실행 가능 그룹** | 작업을 배분하고 착수할 때 |
| 5 | [open-questions.md](open-questions.md) | 미결 사항 대장 (항목 / 왜 미결 / 누가 답하나 / 잠정 결정값) | 가설값을 실측으로 승격할 때 |

정본 우선순위: **architecture.md > prd.md > timing-spec.md > epics-and-stories.md**. 구현 중 불일치를 발견하면 architecture.md에 맞추고, architecture.md 자체가 틀렸다면 문서를 고친 뒤 코드를 쓴다.

## 교재(Practice Book) 모듈

같은 시험을 **연습북**으로 내보내는 갈래다. 런타임 문서와 한 묶음으로 두는 이유는, 교재의 장(chapter)이 시험 세트와 **같은 콘텐츠 스키마**를 쓰기 때문이다 — 장 하나를 저작하면 PDF도 되고 응시 가능한 세트도 된다. 새 포맷을 만들지 않았으므로 위 다섯 문서의 계약이 그대로 적용된다.

| # | 문서 | 역할 | 언제 보는가 |
|---|---|---|---|
| 6 | [book-prd.md](book-prd.md) | **교재 요구사항 정본.** BFR / BNFR, 권별 10장 주제표, 범위 밖 항목 | 연습북이 무엇을 만족해야 하는지 확인할 때 |
| 7 | [book-schema.md](book-schema.md) | **챕터 스키마 정본.** 기존 섹션 조각의 상위집합, `SG_BOOK_SCHEMA` API, gate 모양, 파일명 규약, 트랙별 소유 파일 | 교재 관련 코드를 쓰기 직전 |
| 8 | [book-epics-and-stories.md](book-epics-and-stories.md) | 교재 실행 백로그. 스토리별 AC·Files·Verification + 병렬 실행 그룹 | 교재 작업을 배분·착수할 때 |

교재 모듈도 **architecture.md가 최종 우선**이다. 특히 저작 파이프라인은 8.4절의 `graph_spec` + `_SequentialGraph` 폴백 패턴을 그대로 따른다 — 캠퍼스 장비가 에어갭이라 langgraph는 선택 의존성이어야 한다.

## 신뢰도 표기 규약

명세 7절의 구분을 문서 전반에서 유지한다.

| 태그 | 뜻 | 예 |
|---|---|---|
| **확정(관찰)** | 화면녹화에서 직접 확인됨 | Listening 상단 빨간 카운트다운 `00:20`, "End of Module 1" 자동 전환, Speaking 11문항 2유형 |
| **확정(코드)** | `set1.js` 등 기존 코드에서 실측됨 | `prepSec:3`, S1 `respondSec:20`, S2 `respondSec:45`, W1–W3 `timeLimitSec:600`, `reading.timeLimitSec:2100` |
| **official** | IELTS 공개 규격 | Listening 30분 + transfer 10분, Reading 60분, Writing 20분/40분 |
| **⚠️ 가설(검증필요)** | 근거 없이 배분·추정한 값 | Reading R1 1080초 / R2 1020초 분배, `moduleEnd` 상한 30초 |

가설값은 전부 `studyground/sg2/config/timing.*.json`의 `provenance` 블록에 `level:"assumed"`로 등록돼 있어, **코드를 고치지 않고 JSON 값만 교체**하면 실측으로 승격된다. 승격 절차는 timing-spec.md와 Story 7.2 참조.

## 타이밍 설정 파일 (정본은 JSON, 설명은 timing-spec.md)

- `studyground/sg2/config/timing.toefl.json` — `scoreScale: "toefl120"`
- `studyground/sg2/config/timing.ielts.json` — `scoreScale: "ielts9"`

두 파일은 **동일 스키마**다. 런타임은 시험 종류를 모른 채 읽는다. 문항 수는 config에 넣지 않고 항상 콘텐츠(`set1.js`)에서 유도한다.

## FR → Story 추적 매트릭스

PRD의 FR 58건 전부가 스토리로 커버된다. (스토리 본문에 FR 번호가 일관되게 태깅돼 있지 않아, 아래 매핑은 내용 기준 수동 대조 결과다 — 스토리 본문을 고칠 때 이 표도 함께 갱신할 것.)

| FR | 요지 | 담당 Story |
|---|---|---|
| FR1 | `screenType` 6종 · `TestScreen` 인터페이스 | 1.2, 1.3 |
| FR2 | instruction 화면은 self-paced (타이머 없음) | 2.1 |
| FR3 | question 화면 빨간 pill MM:SS · 섹션별 timer scope | 1.1, 1.5 |
| FR4 | 카운트다운 0 → 무조작 자동 전환 | 1.4, 1.5 |
| FR5 | `moduleEnd` 화면 문구·컨트롤 | 2.1 |
| FR6 | speaking `phases` + 보라 RESPONSE TIME 박스 HH:MM:SS | 2.5 |
| FR7 | 전체 시험 상태머신 순서 | 1.4, 2.6 |
| FR8 | 오디오 재생 1회 강제 (재진입에도 소진 유지) | 2.2, 2.5 |
| FR9 | 재생 잔여시간 카운터 + 화자 일러스트 | 2.2 |
| FR10 | `perQuestionAudio` 2종 분기 | 1.3, 2.2 |
| FR11 | `set1.js` baked-in 경로 → 배포 경로 런타임 remap | 1.3 |
| FR12 | MediaRecorder 자동 시작/정지 | 2.5 |
| FR13 | 녹음 Blob 로컬 보관 → 온라인 복귀 시 업로드 | 1.6, 3.3 |
| FR14 | 마이크 거부·미지원 시 NOT SUBMIT으로 진행 (시험 중단 금지) | 2.5 |
| FR15 | Speaking 2유형별 phase 시퀀스 | 1.3, 2.5 |
| FR16 | `introAudio` Directions 화면에서 1회 | 1.3, 2.1 |
| FR17 | Adjusting the Volume 화면 | 2.1 |
| FR18 | Hardware Check 화면 | 2.1 |
| FR19 | Section Directions (Speaking은 11문항·2유형 표) | 2.1 |
| FR20 | 상단바 구성 | 1.7 |
| FR21 | 진행 카운터 "Question n of N" | 1.3, 1.7 |
| FR22 | 문항 그리드 네비게이션 | 2.7 |
| FR23 | Listening·Speaking 되돌아가기 금지 | 2.7 |
| FR24 | Exit Test — 확인 후 `in_progress` 보존 | 1.7, 2.7 |
| FR25 | Help 오버레이 (카운트다운 계속 진행) | 2.7 |
| FR26 | Volume 컨트롤 (세션 내 유지) | 2.7 |
| FR27 | 모든 block kind 렌더 | 2.2, 2.3, 2.4, 2.5 |
| FR28 | question kind별 입력 위젯 | 2.2, 2.3, 2.4 |
| FR29 | 한국어 하드코딩 prompt → EN 우선 표시 | 2.2 |
| FR30 | `sessionId` 기반 세션 상태 지속 저장 | 1.6 |
| FR31 | 새로고침 복원 (wall-clock 잔여시간) | 1.5, 1.6 |
| FR32 | URL 계약 | 1.8 |
| FR33 | `mode` = practice / exam | 1.8 |
| FR34 | 제출 API | 3.2 |
| FR35 | `status` in_progress → scoring → completed | 3.1, 3.5 |
| FR36 | 자동 채점 가능 78문항 즉시 채점 | 3.4 |
| FR37 | qtype별 채점 규칙 | 3.4 |
| FR38 | scaled /30 · total /120 · CEFR grade | 3.4 |
| FR39 | 주관식은 교사 대기 + LangGraph AI 초안 | 5.1 |
| FR40 | 3-Subject Answer Management 목록·검색 | 4.2 |
| FR41 | SUBMITTED QUESTIONS "NN ITEMS" | 3.5, 4.2 |
| FR42 | FEEDBACK PROGRESS % | 3.5, 4.5 |
| FR43 | 문항 상세 READING/LISTENING/WRITING 탭 | 4.3 |
| FR44 | 문항 카드 구성 (유형태그·학생답안·정답·피드백) | 4.3 |
| FR45 | SPEAKING ANSWERS 화면 | 4.4 |
| FR46 | `question_responses.feedback` 컬럼 신규 | 3.1, 4.5 |
| FR47 | 관리자 좌측 내비 10항목 | 4.1 |
| FR48 | Exam Statistics | 4.6 |
| FR49 | Rankings by Grade (CEFR) | 4.7 |
| FR50 | 완료 후 기존 성적 상세로 이동 | 5.3 |
| FR51 | 문항 리뷰에 교사 피드백 컬럼 노출 | 5.3 |
| FR52 | 미완료 attempt는 "채점 중" 배지 + 점수 은닉 | 5.3 |
| FR53 | 최근 성적 추이 시계열 | 5.4 |
| FR54 | 타이밍·모듈 구조 config 외부화 | 1.1, 6.1 |
| FR55 | `scoreScale` 어댑터 (/120 ↔ Band 0–9) | 6.4 |
| FR56 | `phase:"prep"` 준비시간 | 6.2 |
| FR57 | IELTS 루브릭 채택 | 6.5 |
| FR58 | IELTS 섹션 매핑 ⚠️가설 | 6.1, 6.3 |

NFR(빌드 없는 vanilla JS 유지, 오프라인 구동, EN 기본·KO 토글, SQLite/Postgres 이중모드, 신규 의존성 금지 등)은 전 스토리에 걸친 횡단 제약이며 Story 7.1에서 별도로 하드닝한다.

## 에픽 요약

| Epic | 범위 | 스토리 |
|---|---|---|
| 1 | 시험 런타임 코어 — 화면 계약, 컴파일러, 상태머신, 타이머, 지속성 | 1.1–1.8 |
| 2 | 섹션별 화면 구현 + 안내화면 + 그리드/Help/Volume | 2.1–2.7 |
| 3 | 제출과 채점 데이터 — 모델 델타, 제출 API, 자동채점, status 전이 | 3.1–3.5 |
| 4 | 관리자 채점 백엔드 — 3-Subject 목록/상세, SPEAKING, 통계, 랭킹 | 4.1–4.7 |
| 5 | AI 채점 확장 — LangGraph 루브릭 노드, 교사 검수, 성적 반영 | 5.1–5.4 |
| 6 | IELTS 이식 — 프로파일 전환, prep phase, transfer time, Band 스케일, 루브릭 | 6.1–6.5 |
| 7 | 오프라인·PWA 하드닝, 타이밍 캘리브레이션 | 7.1–7.2 |

병렬 착수 가능 조합은 epics-and-stories.md §8 "병렬 실행 가능 그룹"에 파일 충돌 근거와 함께 판정돼 있다.

## 검산 기준값

구현이 맞게 돌아가는지 확인하는 고정 수치. 컴파일러가 이 값을 내지 못하면 구현이 틀린 것이다.

| 항목 | 값 |
|---|---|
| 총 화면 수 (SET 1, TOEFL 프로파일) | **78** (listening 36 · speaking 15 · reading 9 · writing 16 · 공통 2) |
| 총 문항 수 | **91** (reading 35 · listening 33 · writing 12 · speaking 11) |
| 자동 채점 가능 문항 | 78 (reading 35 + listening 33 + writing build 10) |
| 주관식 문항 | 13 (free-write 2 + speaking 11) |

근거는 architecture.md §4.3 검산표.
