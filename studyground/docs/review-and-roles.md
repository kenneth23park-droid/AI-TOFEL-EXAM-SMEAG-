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
