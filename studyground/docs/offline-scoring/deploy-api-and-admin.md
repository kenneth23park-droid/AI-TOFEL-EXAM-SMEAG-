---
title: API·관리자 배포 절차
tags: [deploy, ops, admin, vercel]
status: 대기 — 실행 필요
updated: 2026-08-11
---

# API·관리자 배포 절차

← [[offline-scoring-moc]] · 구조는 [[campus-architecture]]

> [!warning] 지금 라이브에 무엇이 없는가
> `smeag-studyground.vercel.app` 은 **`sg2/` 정적 폴더만** 배포한다
> (`studyground/sg2/.vercel/project.json`, 프로젝트명 `smeag-studyground`).
> FastAPI 앱은 `vercel.json` 까지 준비돼 있지만 **어디에도 배포된 적이 없다.**
>
> | 주소 | 지금 |
> |---|---|
> | `/`, `/exam-runtime.html`, `/admin.html` | 200 — sg2 정적 |
> | `/admin/usage` | **404** |
> | `/api/attempts` | **404** |
>
> 그래서 [[campus-architecture|답안 동기화]]도 라이브에서는 붙을 서버가 없다.
> 설계대로 조용히 실패하고 답안은 로컬에 남으므로 시험은 정상 진행되지만, 올라가지는 않는다.

## 이 배포가 한 번에 푸는 것 둘

1. `/admin/usage` — AI 사용량·비용 (학생별 / 시험 일정별 / 월별)
2. `/api/attempts/*` — 답안 수집. `exam-sync-boot.js` 가 이걸 기다리고 있다

## 선행 조건 (완료됨)

- [x] 관리자 접근 통제 — `require_admin`, `tests/test_admin_gate.py`
  - **cloud + 자격증명 없음 → 503.** 무인증 백오피스가 공개 URL 에 뜨는 일은 없다
  - local + 자격증명 없음 → 루프백만 (교실 LAN 의 학생 PC 차단)
  - 자격증명 있음 → HTTP Basic

## 실행 절차

Vercel 인증이 필요해 사람이 해야 한다.

### 1. 새 프로젝트를 만든다

```bash
cd studyground          # sg2/ 가 아니라 studyground/ 다 — vercel.json 이 여기 있다
vercel link             # 새 프로젝트: smeag-studyground-api
vercel env add ADMIN_USER production
vercel env add ADMIN_PASSWORD production      # 길게. 이 하나가 백오피스 전체를 지킨다
vercel env add DATABASE_URL production        # Supabase Postgres 연결 문자열
vercel --prod
```

> [!danger] `DATABASE_URL` 을 반드시 준다
> 주지 않으면 `config.py` 가 SQLite 로 떨어지고, Vercel 은 `/tmp` 만 쓸 수 있어
> **배포할 때마다 DB 가 사라진다.** 시험 답안이 그렇게 날아가면 복구할 곳이 없다.

### 2. 학생 앱이 그 주소를 보게 한다

같은 오리진이 아니므로 `?server=` 로 알려 준다.

```
https://smeag-studyground.vercel.app/exam-runtime.html?server=https://smeag-studyground-api.vercel.app
```

한 번 성공하면 주소가 `localStorage.sg2_server_url` 에 남아 다음부터는 없어도 된다.

> [!note] CORS 를 확인할 것
> 오리진이 갈리면 브라우저가 `POST /api/attempts` 를 막을 수 있다.
> `app/main.py` 에 CORSMiddleware 가 없다 — **배포 후 첫 확인 항목이다.**

### 3. 확인

```bash
API=https://smeag-studyground-api.vercel.app
curl -s -o /dev/null -w "%{http_code}\n" $API/admin/usage          # 401 기대 (로그인 창)
curl -s -o /dev/null -w "%{http_code}\n" -u smeag:<비번> $API/admin/usage   # 200 기대
curl -s -o /dev/null -w "%{http_code}\n" $API/api/attempts         # 405 기대 (POST 전용 = 살아 있음)
```

`/admin/usage` 가 503 이면 `ADMIN_USER`/`ADMIN_PASSWORD` 가 안 들어간 것이다 — 게이트가
의도대로 닫은 상태이므로, 열지 말고 환경변수를 채운다.

## 교실 서버는 이 배포와 무관하다

시험장 노트북은 지금도 그대로 된다. 같은 앱이 `APP_MODE=local` 로 뜬다.

```bash
cd studyground && ./run_local.sh        # → http://<LAN IP>:8000
```

학생 기기는 `?server=http://192.168.0.10:8000` 으로 붙고, 시험이 끝나면
[[campus-architecture|3단 계단]]의 마지막 칸을 `tools/sync_to_supabase.py` 가 채운다.

## 남은 것

- [ ] `sg_process_imports()` 정규화 본문 — Supabase 대상 스키마 확정 후
- [ ] CORS 설정 — 오리진이 갈리는 경우에만
- [ ] `/admin` 게이트를 Basic 에서 세션 로그인으로 — Basic 은 로그아웃이 없다
