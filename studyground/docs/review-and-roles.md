# 채점 리뷰와 권한 (학생 · 선생님 · 관리자)

제출한 시험을 문항별로 다시 보는 길이다. 셋이 같은 데이터를 보되, 들어오는 문이 다르다.

| 사람 | 문 | 보이는 범위 |
| --- | --- | --- |
| 학생 | `dashboard.html` → **Review** | 자기 응시만 |
| 선생님 | `admin-results.html` | **자기에게 배정된 학생만** |
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

## 선생님 계정과 담당 학생

권한의 정본은 `sg_profiles.role` (`student` | `teacher` | `admin`) 이고, **누구를 볼 수
있는가**의 정본은 `sg_profiles.teacher_id` 다. 실제 방어선은 Supabase RLS 의
`sg_can_see(owner)` — 본인이거나, 관리자이거나, 그 학생의 담당 선생님일 때만 행이 나온다.
화면에서 막는 건 안내일 뿐이다(`supabase/teacher_scope.sql`).

### 만들기 — `admin-teachers.html`

관리자로 로그인해 **관리자 홈 → 선생님과 담당 학생**으로 들어간다.

- **선생님 계정 만들기**: 이름 · 로그인 아이디 · 비밀번호. 아이디가 곧 로그인이다
  (`kevin` → 로그인 화면에 `kevin`, 내부 이메일은 `kevin@smeagstudyground.com`).
  계정 생성과 `role='teacher'` 승격을 Edge Function `sg-auth` 가 한 번에 한다 —
  호출자가 정말 관리자인지 서버가 토큰으로 다시 확인하므로 화면을 속여도 소용없다.
- **담당 배정 바꾸기**: 학생 표의 드롭다운. 비우면(`— none —`) 관리자만 보게 된다.

### 가입 화면의 드롭다운

`signup.html` 은 로그인 전이라 `sg_profiles` 를 못 읽는다. 선생님 목록은 Edge Function
(`action: "teachers"`)이 이름만 추려서 내려 준다. 선생님 계정이 하나라도 있으면 학생은
반드시 하나를 골라야 하고(서버도 `missing_teacher` 로 되돌린다), 하나도 없으면 그 칸을
아예 그리지 않는다 — 고를 것이 없는 필수 항목은 가입을 막을 뿐이다.

### SQL 로 직접 손보기

```sql
-- 선생님으로 올리기
update public.sg_profiles set role = 'teacher' where email = '<선생님 이메일>';

-- 관리자로 올리기
update public.sg_profiles set role = 'admin', is_admin = true where email = '<이메일>';

-- 담당 배정
update public.sg_profiles set teacher_id = '<선생님 uuid>' where student_id = 'smeag007';

-- 되돌리기
update public.sg_profiles set role = 'student', is_admin = false where email = '<이메일>';
```

바꾼 뒤에는 그 사람이 한 번 로그아웃했다 들어오거나 대시보드를 새로 고쳐야 한다 —
`SG_AUTH` 가 프로필을 기기에 캐시해 두기 때문이다(`SG_AUTH.profile(true)` 로 강제 갱신).

> 담당이 비어 있는(`teacher_id is null`) 학생은 관리자에게만 보인다. 기존 학생들은
> 전부 이 상태이므로, 첫 배포 뒤에 `admin-teachers.html` 에서 한 번 배정해야 한다.

## 관련 파일

- `sg2/assets/sg-results.js` — 채점 · 목록 · 업로드
- `sg2/assets/sg-auth.js` — `role()` · `isStaff()` · `teachers()` · `createTeacher()`
- `sg2/admin-teachers.html` — 선생님 계정 · 담당 배정 (관리자 전용)
- `supabase/teacher_scope.sql` — `teacher_id` · `sg_can_see()` · 정책
- `supabase/functions/sg-auth/index.ts` — 가입 · 로그인 · 선생님 계정 생성
- `sg2/review.html` · `sg2/admin-results.html` · `sg2/dashboard.html`
- `sg2/assets/exam-shell.js` — 제출 직후 채점 · 업로드 · 리뷰 안내

## 코멘트 — 선생님이 쓰고, AI 가 거들고, 학생이 읽는다

`sg_comments` 한 표에 선생님 코멘트와 AI 코멘트가 함께 산다. 학생 화면에서는 한자리에
나란히 보여야 하고, 출처는 `source` 로만 갈리기 때문이다.

- 대상은 `scope` + `question_id` 로 정한다 — `overall`(전체 총평) · 영역명(`reading` 등) ·
  `question`(문항별, `question_id` 필수).
- 같은 대상·같은 출처는 한 벌뿐이다. 다시 쓰면 덮어쓴다(선생님은 고쳐 쓰고, AI 는 다시 돌린다).
- RLS: 읽기는 답안지 주인 + 그를 볼 수 있는 사람(`sg_can_see`), 쓰기·삭제는 그중 staff 만.
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
