# 미해결 항목 대장 (Open Questions)

> **작성** — PO 정합성 검수(2026-08-06) 산출물.
> **역할** — 문서 간 모순 중 **문서 수정만으로는 결정할 수 없는 것**, 즉 실측·규격문서·운영 정책이 있어야 닫히는 항목만 모은다. 문서끼리 이름·수치가 어긋난 것은 이미 `architecture.md`를 정본으로 삼아 수정했고 여기 남기지 않는다.
> **잠정 결정값** — 확정 전까지 코드·config가 사용할 값. 반드시 `config/timing.*.json`의 `provenance.level="assumed"` 또는 본 문서의 행과 1:1 대응해야 한다.
> **닫는 방법** — 근거가 확보되면 (1) 값/정책을 반영하고 (2) 해당 provenance entry를 승격하고 (3) 본 문서의 행을 `해소` 처리한다(Story 7.2).

---

## 1. 타이밍 값 (Story 7.2에서 일괄 처리)

| # | 항목 | 왜 미결인가 | 누가 답할 수 있는가 | 잠정 결정값 |
|---|---|---|---|---|
| OQ-T1 | Reading 모듈별 배정시간 | `set1.js`는 섹션 총 2100초만 제공하고 R1/R2 분할이 없다. 녹화에는 타이머 초기값이 잡히지 않았다 | SMEAG 시험 운영팀(규격서) 또는 45:30–48:30 구간 재캡처 | `R1 1080` / `R2 1020` (합 2100 = 콘텐츠값) |
| OQ-T2 | Listening 타이머 scope | 녹화 36:00~44:00에 카운트다운은 보이나 문항 전환 시 리셋되는지 판별 불가. `timerScope=question`과 `module`이 결과가 완전히 다르다 | 녹화 재확인(문항 전환 프레임) 또는 운영팀 | `timerScope:"question"`, `perQuestionSec:20`, 모듈 상한 `allocatedSec` 병행 |
| OQ-T3 | Listening 모듈 배정시간 | `set1.js` `listening.timeLimitSec = null`. 모듈 상한 자체가 존재하는지도 미확인 | 운영팀 규격서 | `L1 1080` / `L2 900` (문항 수 기반 추정) |
| OQ-T4 | Speaking Listen&Repeat `prepSec` | **3자 상충**: `set1.js` 3초 / 녹화 "즉시 응답"(0초) / 명세 2-4 예시 0초 | 녹화 22:30–29:30 프레임 단위 측정 | `3` (콘텐츠값 채택). `seconds:0`이면 엔진이 즉시 통과하므로 값만 바꾸면 됨 |
| OQ-T5 | Speaking Listen&Repeat `responseSec` | `set1.js` 20초 vs 명세 예시 15초 상충 | 녹화 RESPONSE TIME 시작값 확인 | `20` |
| OQ-T6 | Writing 태스크 시간 | `set1.js` 600×3은 코드 실측이지만 실제 시험 규격 반영인지 불명. 녹화에 Writing 타이머 구간이 없다 | 운영팀 / Writing 구간 녹화 확보 | `600` × 3 |
| OQ-T7 | `moduleEnd` 상한 타임아웃 | 자동 전환은 관찰됐으나 지연 초가 미측정 | 녹화 48:30–49:00 프레임 카운트 | `maxSec 30`, 비표시, `advance:"manual"` |
| OQ-T8 | 섹션 실행 순서 | 녹화 L→S→R→W vs `set1.js` 배열 R→L→W→S. Writing 위치는 51:00 문항으로만 추정 | 운영팀 규격서 / 다른 NT 세트 확인 | `sectionOrder: ["listening","speaking","reading","writing"]` (`set1.js` 배열은 무시) |
| OQ-T9 | instruction 화면 상한 타임아웃 | 방치 시 동작이 관찰되지 않음 | 실제 시험 방치 테스트 | `maxSec: null`(무제한 self-paced) |
| OQ-T10 | "Question n of N"의 N scope | 녹화는 32(section 기준), 우리 SET 1 Listening은 33 | 원본 시험지와 `set1.js` 대조 감사 | section 전체 기준 + `total`은 콘텐츠에서 산출(하드코딩 금지) |
| OQ-T11 | Interview 프롬프트 미디어 종류 | 녹화 30:30~33:30은 **영상**인데 `sg2/media/speaking/`에는 mp3만 있다 | 콘텐츠 담당(영상 자산 존재 여부) | `mediaType:"video"`로 두되 자산이 없으면 audio로 degrade |
| OQ-T12 | Reading 모듈 내 되돌아가기 | 녹화에서 뒤로가기 조작이 관찰되지 않음. 문항 그리드는 허용을 시사 | 녹화 재확인 / 운영팀 | `allowBack: true` (Reading/Writing만) |
| OQ-T13 | 이탈 중 타이머 정책 | 새로고침·탭 종료 시간을 차감(엄격)할지 정지(관대)할지 정책 미정 | 운영팀 | **엄격** — wall-clock deadline 유지(architecture 5.5). `mode=practice`에서만 완화 |

---

## 2. 정책·운영 결정

| # | 항목 | 왜 미결인가 | 누가 답할 수 있는가 | 잠정 결정값 |
|---|---|---|---|---|
| OQ-P1 | FEEDBACK PROGRESS 분모 | 녹화만으로 "전 문항" vs "주관식만"을 판별할 수 없다 | 레거시 e-test 운영자 | 주관식만 = `qtype IN ('WRITING','SPEAKING')` → SET 1 기준 13. `crud_write.FEEDBACK_SCOPE` 상수로 전환 가능 |
| OQ-P2 | 채점 관용도 | `blank` 철자 오류 허용(Levenshtein 1) 여부, `build` 부분점수 여부는 채점 신뢰도·이의제기와 직결된 교육 정책 | 교무/채점 책임자 | **완전일치**(`strip().lower()`). 부분점수 없음 |
| OQ-P3 | 관리자 인증 방식 | 현재 백엔드에 인증이 전혀 없다. 관리자 화면 공개 전 필수 | 인프라/운영 책임자 | 단순 비밀번호 + 세션 쿠키(최소). Supabase Auth는 후속 |
| OQ-P4 | Speaking 오디오 보관 정책 | 개인식별 가능 데이터의 보존 기간·접근 권한·저장 위치가 법무 검토 대상 | 법무/운영 | 로컬=파일, 클라우드=Supabase Storage(`media_assets.storage`로 혼재 허용). 보존기간·삭제 절차 **미정** |
| OQ-P5 | 정답 노출 정책 | 오프라인 필수(NFR2)와 정답 서버 분리가 **원리적으로 상충**한다. 문서 수정으로 해결 불가 | 제품 책임자 | 현행 유지(클라이언트 평문) + `mode=exam`에서 즉시채점 UI 비활성. 정답 분리는 온라인 전용 모드 도입 시 재검토 |
| OQ-P6 | 성적 공개 시점 | 자동채점 직후 부분 공개 vs 교사 피드백 100% 후 전체 공개 | 교무 | `status="completed"` 후 전체 공개(FR52). 그 전엔 "채점 중" 배너 |
| OQ-P7 | IELTS 이식 범위 | 4스킬 전체인지 Writing/Speaking 채점만인지에 따라 Epic 6 규모가 2배 차이 | 제품 책임자 | 4스킬 런타임 + Band 스케일까지. IELTS **콘텐츠 세트는 범위 밖** |
| OQ-P8 | IELTS raw→Band 변환표 | 공식 표가 시험지마다 다르고 미확보 | IELTS 공식 자료 / 운영팀 | `ielts_band_table.json` 자리만 만들고 값은 비워둔다. 범위 밖 raw는 하위 구간 적용 + 로그 |
| OQ-P9 | IELTS Writing 태스크 타이머 | 실제 IELTS는 60분 단일 타이머인데 config는 Task1 1200 / Task2 2400을 갖고 있다. 강제 타이머로 쓸지 권장 시간으로만 표시할지 정책 | 운영팀 | `timerScope:"section"` 3600초를 강제하고 태스크 값은 **권장 표시용** |
| OQ-P10 | IELTS Speaking 비대면 응답시간 | 대면 인터뷰를 녹음으로 대체할 때 문항당 배분은 공식 규격에 없다 | SMEAG IELTS 운영안 | Part1 30초 / Part2 120초 / Part3 45초 |
| OQ-P11 | RESPONSE TIME 박스 정확한 색상 | 녹화 캡처에서 색을 추출하지 않았다 | 디자인 담당 | `--record: #6d4aff` (신규 토큰, 캡처 대조 후 확정) |
| OQ-P12 | short-response mcq 영문 prompt 문구 | `set1.js`에 한국어가 하드코딩되어 있고 EN 원문이 확정되지 않음 | 콘텐츠 담당 | `"Choose the best response."` (녹화 관찰 문구) |
| OQ-P13 | Speaking 녹음 파일 크기 가정 | 20초 ≈ 40KB는 추정치이며 저장 전략(인라인 vs 오브젝트) 판단 근거 | 실측 | 40KB/20초. 실측 후 `media_assets.bytes` 통계로 재산정 |

---

## 3. 이번 검수에서 **해소된** 항목 (참고)

| 이전 ID | 항목 | 결정 |
|---|---|---|
| PRD OQ-7 | `attempts.status` 처리 | `in_progress/scoring/completed`로 **통합**하고 기존 값은 UPDATE 마이그레이션 후 CHECK (architecture 6.2.2/6.3) |
| PRD OQ-13 | CAMPUS 값 출처 | `students.campus`가 정본, 응시 시점 값을 `attempts.campus`에 스냅샷 |
| architecture V9 | `_SequentialGraph` 예외 처리 | 코드 실측 — `try/except` 없음, 노드 예외가 그대로 전파. 워크리스트 루프로 일반화할 때 이 성질 유지 |
| — | 두 timing JSON의 스키마 동일성 | `node`로 경로 집합 대조 검증 완료. `sections.speaking.taskTypes`의 **키 이름만** 시험별로 다르고 나머지 경로는 100% 일치 |
| — | Reading 모듈 합계 불일치(2160 vs 2100) | R2를 1020으로 수정해 합계 2100 = `set1.js reading.timeLimitSec` |
