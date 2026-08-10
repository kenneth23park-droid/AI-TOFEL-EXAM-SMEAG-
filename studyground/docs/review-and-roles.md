# 채점 리뷰와 권한 (학생 · 선생님 · 관리자)

제출한 시험을 문항별로 다시 보는 길이다. 셋이 같은 데이터를 보되, 들어오는 문이 다르다.

| 사람 | 문 | 보이는 범위 |
| --- | --- | --- |
| 학생 | `dashboard.html` → **Review** | 자기 응시만 |
| 선생님 | `admin-results.html` | 모든 학생 |
| 관리자 | `admin-results.html` | 모든 학생 |

문항별 화면은 셋 다 같은 `review.html` 이다.

- `review.html?session=<세션 id>` — 내 응시
- `review.html?session=<세션 id>&owner=<user uuid>` — 남의 응시(선생님·관리자)

## 데이터가 흐르는 길

1. 시험 중 답안은 기기의 `localStorage`(`sg2_attempt::<세션>::answers`)에 쌓인다.
2. 제출하면 `assets/exam-shell.js` 가 제출 시각을 박고(`meta.submittedAt`), 그 자리에서
   채점해 점수를 보여 준 뒤, 로그인 상태면 `sg_results` 로 사본을 올린다.
3. `dashboard.html` 은 로컬 기록과 서버 사본을 합쳐 보여 준다. 같은 세션이면 **로컬이 이긴다**
   — 기기 쪽이 언제나 가장 최신이기 때문이다.

채점은 전부 브라우저에서 돈다(`assets/sg-results.js`). 정답은 콘텐츠 팩
(`assets/set9.js` 의 `ANSWER_KEY`)에 들어 있어서 네트워크 없이도 결과가 나온다.
자동 채점 대상은 리딩·리스닝(SET 9 기준 97문항)이고, 라이팅·스피킹은 "선생님 채점"으로
남아 제출물만 그대로 보여 준다. 스피킹 녹음은 그 기기의 IndexedDB 에만 있으므로,
응시한 기기에서 리뷰를 열었을 때만 재생기가 붙는다.

## 선생님 계정 만들기

권한의 정본은 `sg_profiles.role` (`student` | `teacher` | `admin`) 이고, 실제 방어선은
Supabase RLS 의 `sg_is_staff()` 다. 화면에서 막는 건 안내일 뿐이다.

`role` 은 본인이 못 바꾼다. 승격은 service_role(Supabase SQL 편집기)에서만 한다.

```sql
-- 선생님으로 올리기
update public.sg_profiles set role = 'teacher' where email = '<선생님 이메일>';

-- 관리자로 올리기
update public.sg_profiles set role = 'admin', is_admin = true where email = '<이메일>';

-- 되돌리기
update public.sg_profiles set role = 'student', is_admin = false where email = '<이메일>';
```

바꾼 뒤에는 그 사람이 한 번 로그아웃했다 들어오거나 대시보드를 새로 고쳐야 한다 —
`SG_AUTH` 가 프로필을 기기에 캐시해 두기 때문이다(`SG_AUTH.profile(true)` 로 강제 갱신).

## 관련 파일

- `sg2/assets/sg-results.js` — 채점 · 목록 · 업로드
- `sg2/assets/sg-auth.js` — `role()` · `isStaff()`
- `sg2/review.html` · `sg2/admin-results.html` · `sg2/dashboard.html`
- `sg2/assets/exam-shell.js` — 제출 직후 채점 · 업로드 · 리뷰 안내

## 코멘트 — 선생님이 쓰고, AI 가 거들고, 학생이 읽는다

`sg_comments` 한 표에 선생님 코멘트와 AI 코멘트가 함께 산다. 학생 화면에서는 한자리에
나란히 보여야 하고, 출처는 `source` 로만 갈리기 때문이다.

- 대상은 `scope` + `question_id` 로 정한다 — `overall`(전체 총평) · 영역명(`reading` 등) ·
  `question`(문항별, `question_id` 필수).
- 같은 대상·같은 출처는 한 벌뿐이다. 다시 쓰면 덮어쓴다(선생님은 고쳐 쓰고, AI 는 다시 돌린다).
- RLS: 읽기는 답안지 주인 + staff, 쓰기·삭제는 staff 전용.
- **학생 화면에는 편집 장치가 아예 그려지지 않는다** — 숨기는 게 아니라 DOM 에 넣지 않는다.

### AI 코멘트 (`/api/feedback`)

키는 Vercel 환경변수에만 둔다. 브라우저는 채점 요약만 보내고, **이름·학번·이메일은 보내지 않는다.**
호출자가 선생님·관리자인지는 서버가 Supabase 토큰으로 다시 확인한다(공용 토큰 없음).

| 환경변수 | 쓰임 |
| --- | --- |
| `OPENAI_API_KEY` | OpenAI. 설정됨 |
| `OPENAI_MODEL` | 기본 모델. 없으면 `gpt-4o` |
| `ANTHROPIC_API_KEY` | Claude. 넣으면 목록에 함께 뜬다 |
| `ANTHROPIC_MODEL` | 기본 모델. 없으면 `claude-sonnet-5` |

모델은 리뷰 화면의 선생님 줄에서 고른다. 목록은 프로바이더의 `/models` 를 실제로 물어서
채우므로, 새 모델이 나와도 코드를 고칠 필요가 없다(못 물어보면 최소 후보로 떨어진다).
생성은 **선생님이 버튼을 누를 때만** 돈다 — 응시마다 자동으로 돌지 않으므로 비용이 통제된다.
