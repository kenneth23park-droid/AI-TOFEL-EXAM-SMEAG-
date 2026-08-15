# smeag.com — 학생 성적 조회 · 다운로드

학생이 **나중에** 시험 성적을 다시 보고 내려받는 창구. 응시는 StudyGround(sg2)에서 하고,
조회·다운로드는 smeag.com 에서 한다.

- `scores.html` — 파일 하나로 끝나는 자립형 페이지. 외부 CSS/JS/CDN 없음, 빌드 없음.

## 배포

**지금 도는 곳**: <https://smeag-scores.vercel.app/scores.html> (Vercel 프로젝트 `smeag-scores`).
smeag.com 에 올리기 전까지 쓰는 임시 주소다 — 이 폴더에서 `vercel deploy --prod` 하면
갱신된다. `vercel.json` 은 루트(`/`)를 `scores.html` 로 보내는 한 줄이 전부라,
smeag.com 에 파일만 올릴 때는 딸려가도 그만이고 지워도 그만이다.

최종 자리는 그대로 smeag.com 이다. `scores.html` 을 아무 경로에나 올리면 된다.

```
/toefl/scores.html   →  https://smeag.com/toefl/scores.html
```

정적 파일 하나라 워드프레스든 PHP든 상관없다. 워드프레스라면 페이지 템플릿에
`<iframe src="/toefl/scores.html" style="width:100%;height:1400px;border:0"></iframe>`
로 끼워 넣어도 된다.

**Supabase CORS**: 브라우저가 smeag.com 에서 Supabase 로 직접 요청하므로, Supabase
프로젝트(`smeag-mocktest`, ref `qrmidnmlethqvdbmnyun`)의 허용 오리진에 `https://smeag.com`
이 들어가 있어야 한다. Edge Function `sg-auth` 의 CORS 헤더도 같이 확인할 것.

## 데이터 경로

```
sg2 응시 → 로컬 채점 → Supabase sg_results  ←── scores.html (본인 행만)
```

- 테이블: `sg_results` (owner, session, set_code, submitted_at, score, total, percent,
  by_section, answers, scale), 프로필은 `sg_profiles`.
- Writing·Speaking 채점은 `sg_task_scores` 에 과제 하나당 한 행으로 있다
  (`ai_score` 초안 / `teacher_score`·`confirmed_at` 확정, 둘 다 ETS 루브릭 0~5).
  이 페이지는 두 테이블을 함께 읽어 **TOEFL 1~6 밴드**를 만든다.
- 학생이 남의 성적을 못 보는 경계는 이 페이지가 아니라 **서버의 RLS** 다. 화면 코드를
  고쳐도 서버가 자기 행 말고는 돌려주지 않는다.
- 로그인은 sg2 와 같은 Edge Function `sg-auth` 를 쓴다 — 학번(`smeag###`) 또는 이메일.

## 성적표 한 장 (`#/report/<session>`)

학생·학부모에게 건네는 종이 한 장. 대시보드 목록의 **Report** 또는 리뷰 화면의
**Report card** 로 들어가고, **Print / PDF** 로 A4 한 장에 떨어진다.

리뷰 화면과 무엇이 다른가 — 리뷰는 영역(R·L·W·S)으로 말하고, 성적표는 **파트**로 편다.
라이팅 3.0 은 문장 만들기·이메일·토론 글 셋의 결과라, 무엇을 더 해야 하는지는 파트를
펴야 보이기 때문이다.

| 열 | 어디서 오나 |
|---|---|
| Scaled score | 그 **파트만** 놓고 다시 환산한 밴드(1.0–6.0) |
| Correct Answer · Total Items | 자동채점 파트만(리딩 · 리스닝 · Build a Sentence). 이메일·토론 글은 문항이 없어 비운다 |
| Average | **앱의 공식 밴드**(`BAND.of`) 그대로 — 대시보드에 뜬 수와 언제나 같다 |
| CEFR · Total | 채점된 영역 밴드의 평균과 그 등급 |

⚠️ 파트 점수를 평균 내도 Average 가 안 나올 수 있다. 라이팅·스피킹의 영역 밴드는 ETS
루브릭을 따르는 산출형 과제로 매기고, Build a Sentence 는 **진단용으로만** 싣기 때문이다.
성적표 밑줄이 이 사실을 스스로 밝힌다. 셋을 함께 평균 내려면 `BAND.of` 를 고쳐야 하고,
그건 이 화면 혼자 할 일이 아니다(밴드 표는 세 곳에 산다 — `test_band_table.js`).

- 파트 구성: `scores.html` 의 `PARTS`. 산출형 한 줄이 어느 파트인지는 `sg_task_scores.task_kind`
  가 정하고, 그 칸이 빈 옛 행은 문항 번호로 짐작한다(`partOf`).
- 이름은 프로필에서 채운다. **E-name · S.A Teacher · 코멘트**는 점선 칸이라 인쇄 전에 직접
  치면 되고, 그 글자는 **이 기기에만** 남는다(localStorage) — 학생 토큰으로는 `sg_comments`
  에 쓸 수 없고, 쓸 수 있게 하면 '선생님이 남긴 말' 과 구별이 사라진다.
- 선생님이 서버에 남긴 총평(`sg_comments`, `scope='overall'`, `source='teacher'`)이 있으면
  그것이 코멘트 칸의 정본이고, 누가 언제 썼는지까지 인쇄된다.
- 판정: `studyground/tests/test_report_card.js`

## 스피킹 녹음 듣기

리뷰의 **Speaking** 줄(요약 카드의 `Details` 든 Speaking 탭이든)을 누르면 그 문항의
녹음이 그 자리에서 열린다. 표에 남던 `idb:set9-S1-q01` 은 답이 아니라 **응시한 그 기기의
IndexedDB 를 가리키는 쪽지**라, 이 화면에서는 아무 뜻도 없어 더 이상 답 자리에 쓰지 않는다.

```
sg_task_scores.media_path            ← 채점기(api/score.js)가 적어 둔 자리
없으면 {owner}/{session}/{qid}.{ext} ← 업로더 규칙으로 직접 찾는다(webm·m4a·ogg·mp3·wav)
      → POST /storage/v1/object/sign/toefl-recordings/…  (1시간짜리 서명 URL)
```

- 공개 주소가 아니다. 버킷은 비공개이고 서명은 **자기 폴더만** 된다(Storage RLS) —
  화면 코드를 고쳐도 남의 녹음은 열리지 않는다. 선생님은 `recordings staff read` 정책으로 연다.
- 녹음 보존은 90일. 지난 응시는 점수만 남고 재생은 "열 수 없습니다" 로 떨어진다.
- 파일이 버킷에 아예 없으면(업로드 실패) 회수는 sg2 의 `recover-recordings.html` 몫이다 —
  시험을 친 그 PC 에서 원본을 꺼내야 한다.
- 같은 규칙이 sg2 리뷰 화면에도 있다(`sg2/assets/sg-review-speaking.js`).
- 판정: `studyground/tests/test_scores_recording.js`

## 설정 (`scores.html` 상단 `CFG`)

| 키 | 뜻 |
|---|---|
| `url` / `anon` | Supabase 프로젝트 주소와 공개(anon) 키 |
| `reviewFn` | 문항·정답을 내려주는 Edge Function 이름(`sg-review`). 이 화면은 정답을 스스로 들고 있지 않다 |
| `showAnswerKey` | `false` 로 두면 정답 열을 감추고 O/X 만 보여준다. ⚠️ 화면의 예의일 뿐 경계가 아니다 — 진짜 경계는 아래의 열람 기한이다 |
| `reportUrl` | 성적 보고서(Word·PDF·Excel) 생성기 주소. **비워 두면 '성적 보고서' 버튼이 아예 안 나온다** |

## 리뷰 열람 기한 (문항·정답)

**점수는 계속 보인다. 문항과 정답에만 기한이 있다.**

```
기한 = max(응시일, 교사 리뷰일) + 7일        교사 리뷰가 없으면 응시일 기준
지나면 → 서버가 문항을 주지 않는다 (questions: [])
다시 보려면 → 관리자가 그 응시를 7일 열어 준다
```

경계는 화면이 아니라 서버다. 문항과 정답은 `sg_set_questions` 에 있고 그 표에는
**RLS 정책이 하나도 없다** — service_role 말고는 아무도 읽지 못한다. 학생 화면은
Edge Function `sg-review` 에게 물어야 하고, 그 함수가 셋을 확인한 뒤에만 내려준다.

1. 이 응시를 볼 자격 — 학생의 토큰으로 `sg_results` 를 읽어 본다(판정은 RLS 의 `sg_can_see`)
2. 기한 — `sg_review_status()`
3. 관리자 해제 — `sg_review_grants` 의 살아 있는 행

선생님·관리자는 기한과 무관하게 본다(채점하려면 봐야 한다).

- SQL: [`../supabase/review_window.sql`](../supabase/review_window.sql)
- 함수: [`../../supabase/functions/sg-review/index.ts`](../../supabase/functions/sg-review/index.ts)
- 관리자 조작: sg2 `admin-results.html` 의 **Review window** 열 — `7일 열기` · `지금 닫기`
- 판정: `studyground/tests/test_review_window.js`

### 세트를 새로 만들면

문항과 정답을 잠긴 표에 올려야 그 세트의 리뷰가 열린다.

```
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
  node studyground/tools/load_set_questions.js SET10
```

⚠️ service_role 키는 서버에만 둔다. 키 없이 SQL 만 보려면 `--print`.

### ⚠️ 아직 남은 구멍

시험 앱(sg2)의 팩 파일 `assets/set9.js` 에는 **여전히 정답이 들어 있고**, 그 파일은
공개 주소로 받을 수 있다. 오프라인 채점이 그 파일에 기대고 있어서 이 작업만으로는
닫히지 않는다. 닫으려면 팩에서 정답을 떼어내고 채점을 서버로 옮기거나, 팩 자체를
인증 뒤로 넣어야 한다 — 둘 다 sg2 의 오프라인 동작을 건드리는 별도 작업이다.

## 성적 보고서 연동

`CFG.reportUrl` 을 채우면 응시 상세에 **성적 보고서** 버튼이 붙는다.
지금 연결된 곳은 <https://smeag-report-alpha.vercel.app/> (Vercel 프로젝트 `smeag-report`). 누르면 리포트
생성기(`AI 토플 평가시스템(smeag)/TOFEL RESULT/report-generator`)가 새 탭에서 열리고,
거기서 그래프·형식·교사 코멘트를 골라 Word·PDF·Excel 을 내려받는다.

- **환산은 이 페이지가 한다.** `sg_results` 에는 원점수(맞은 개수)만 있으므로
  `REPORT` 모듈이 시험 눈금으로 바꾼다 — TOEFL 은 **1~6 밴드**(`band` 필드)와
  전환기 병기용 영역 /30·총점 /120·CEFR, IELTS 는 IELTS 밴드. 규칙은
  `app/scoring/scale.py` 와 짝이고, 두 밴드표(`ielts_band_table.json`,
  `toefl6_band_table.json`)의 **사본**이 이 파일 안에 있다(⚠️ 고칠 땐 함께).
  TOEFL 1~6 표는 `sg2/assets/sg-band.js` 에도 같은 사본이 있으며, 세 벌이 어긋나면
  `studyground/tests/test_band_table.js` 가 실패한다.
- 시험 구분은 `set_code` 로 한다 — `IELTS` 로 시작하면 IELTS, 아니면 TOEFL.
- 아직 채점되지 않은 영역(선생님 채점 대기)은 점수 칸을 비우고 총점에서 빼며,
  그 경우 등급은 매기지 않는다(낮게 보이는 것을 막는다).
- 점수는 URL 조각(`#d=`)으로 넘어간다. 조각은 서버로 전송되지 않으므로 리포트
  서버 로그에 학생 점수가 남지 않는다.

## 화면

화면은 둘이고, 주소의 해시가 어느 쪽인지 정한다.

| 해시 | 화면 |
|---|---|
| `#/` | **대시보드** — 내 최고 점수(R·L·W·S + 종합) → 전체/영역 시험 기록 표 |
| `#/review/<session>` | **리뷰** — 한 응시의 요약(종합 + 네 영역) → 영역 카드 |
| `#/review/<session>/reading` | 리뷰의 영역 탭. 그 영역의 문항(또는 과제 점수)만 편다 |

탭이 주소에 실리므로 뒤로 가기가 요약으로 돌아오고, 링크 하나로 특정 영역을
바로 열 수 있다.

- **최고 점수 줄**: 영역별 최고는 응시 종류를 가리지 않지만(영역만 본 시험도 내
  최고다), **종합**의 최고는 네 영역이 다 채점된 응시에서만 고른다 — 리딩만 본
  시험의 '종합' 은 리딩 점수일 뿐이라 그대로 두면 총점이 부풀어 보인다.
- **전체 시험 / 영역별 시험**은 `sg_results.mode` 로 갈리지 않는다(그건 채점 방식,
  offline/online 이다). 몇 영역을 건드렸는지로 가른다 — 세 영역 이상이면 전체.
- **옛 눈금(`/120`, CONVENTIONAL)** 은 네 영역이 모두 채점됐을 때만 나온다.
  아니면 '채점 중' 으로 남는다. 판정은 `studyground/tests/test_scores_dashboard.js`.
- 내려받기: **CSV(전체 목록)**, **CSV(한 응시의 문항별)**, **인쇄 · PDF**,
  **성적 보고서**(`reportUrl` 설정 시)
- 화면 문구는 영어 하나. 모바일 폭까지 접힌다(390px 에서 표는 옆으로 구른다).
