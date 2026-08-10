# smeag.com — 학생 성적 조회 · 다운로드

학생이 **나중에** 시험 성적을 다시 보고 내려받는 창구. 응시는 StudyGround(sg2)에서 하고,
조회·다운로드는 smeag.com 에서 한다.

- `scores.html` — 파일 하나로 끝나는 자립형 페이지. 외부 CSS/JS/CDN 없음, 빌드 없음.

## 배포

`scores.html` 을 smeag.com 아무 경로에나 올리면 된다.

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
  by_section, answers), 프로필은 `sg_profiles`.
- 학생이 남의 성적을 못 보는 경계는 이 페이지가 아니라 **서버의 RLS** 다. 화면 코드를
  고쳐도 서버가 자기 행 말고는 돌려주지 않는다.
- 로그인은 sg2 와 같은 Edge Function `sg-auth` 를 쓴다 — 학번(`smeag###`) 또는 이메일.

## 설정 (`scores.html` 상단 `CFG`)

| 키 | 뜻 |
|---|---|
| `url` / `anon` | Supabase 프로젝트 주소와 공개(anon) 키 |
| `packBase` | sg2 콘텐츠 팩(`set1.js`, `set9.js`)이 있는 주소. **비워 두면 문항별 정답을 못 그린다** — 점수·영역별 요약과 '내 답'까지만 나온다 |
| `packs` | 세트 코드 → 팩 파일 이름 |
| `showAnswerKey` | `false` 로 두면 정답 열을 감추고 O/X 만 보여준다 |
| `reportUrl` | 성적 보고서(Word·PDF·Excel) 생성기 주소. **비워 두면 '성적 보고서' 버튼이 아예 안 나온다** |

`packBase` 를 채우는 순간 그 주소의 팩 파일에 담긴 **정답이 학생 브라우저로 내려간다**.
sg2 번들도 지금은 같은 상태다. 정답을 감추려면 `showAnswerKey: false` 만으로는 부족하고
(팩 파일 자체에 답이 있다) `packBase` 를 비우거나, 채점 결과를 서버에서 내려주는 쪽으로
바꿔야 한다.

## 성적 보고서 연동

`CFG.reportUrl` 을 채우면 응시 상세에 **성적 보고서** 버튼이 붙는다. 누르면 리포트
생성기(`AI 토플 평가시스템(smeag)/TOFEL RESULT/report-generator`)가 새 탭에서 열리고,
거기서 그래프·형식·교사 코멘트를 골라 Word·PDF·Excel 을 내려받는다.

- **환산은 이 페이지가 한다.** `sg_results` 에는 원점수(맞은 개수)만 있으므로
  `REPORT` 모듈이 시험 눈금으로 바꾼다 — TOEFL 영역 /30·총점 /120·CEFR,
  IELTS 는 밴드. 규칙은 `app/scoring/scale.py` 와 짝이고, IELTS 밴드표는
  `app/scoring/ielts_band_table.json` 의 **사본**이다(⚠️ 실측 표로 바꿀 땐 두 곳 함께).
- 시험 구분은 `set_code` 로 한다 — `IELTS` 로 시작하면 IELTS, 아니면 TOEFL.
- 아직 채점되지 않은 영역(선생님 채점 대기)은 점수 칸을 비우고 총점에서 빼며,
  그 경우 등급은 매기지 않는다(낮게 보이는 것을 막는다).
- 점수는 URL 조각(`#d=`)으로 넘어간다. 조각은 서버로 전송되지 않으므로 리포트
  서버 로그에 학생 점수가 남지 않는다.

## 화면

- 로그인 → 요약(응시 횟수 · 평균 · 최고 · 최근) → 응시 목록 → 문항별 리뷰
- 내려받기: **CSV(전체 목록)**, **CSV(한 응시의 문항별)**, **인쇄 · PDF**,
  **성적 보고서**(`reportUrl` 설정 시)
- 기본 언어는 영어, KO 는 토글. 모바일 폭까지 접힌다.
