# 시험 알림 메일 — 무엇이 언제 누구에게 가는가

발주(2026-08-13): "시험중 문제가 있거나 완료 및 채점등을 이메일로 받아볼수 있도록 해줘."
받는 곳: `jitnet57@gmail.com` · `ai@smeagschool.com`.

## 왜 필요했나

2026-08-12 시험에서 스피킹 녹음 61건이 전부 거절당했다(400 InvalidMimeType). 그 사실은
학생 화면에도 뜨지 않았고, 뜬 뒤에도 학생은 읽고 나가 버리고 감독 선생님은 그 PC 앞에
없었다. **화면에만 적는 알림은 그날 아무에게도 닿지 않는다.** 그래서 같은 사실을 사람이
반드시 여는 자리 — 메일함 — 으로도 보낸다.

## 두 가지만 보낸다

| 종류 | 언제 | 몇 통 |
| --- | --- | --- |
| `issue` | 무언가 어긋난 그 순간 | 한 응시에 사고 종류당 한 통 |
| `done` | 한 학생의 응시가 끝난 자리 | 한 응시에 한 통 |

`done` 한 통에 제출 사실 + 네 영역 밴드 + 총점 + 그 응시에서 있었던 문제가 함께 실린다.
제출과 채점을 따로 보내지 않는 이유는 하나다 — 학생 30명짜리 시험이 메일 60통이 되면
그 메일함은 곧 안 읽히고, 안 읽히는 알림은 없는 것과 같다.

### issue 코드

| 코드 | 뜻 |
| --- | --- |
| `media_upload_failed` | 제출 때 스피킹 녹음이 올라가지 못했다. 그 PC 에 아직 남아 있다 |
| `media_dropped` | 시험 중 녹음 한 건을 끝내 못 올렸다(재시도 소진·영구 거절) |
| `answers_not_uploaded` | 답안이 이 기기에만 남았다 |
| `offline` | 실시간 저장이 90초 넘게 막혀 있다 |
| `scoring_unavailable` | 채점이 거절당했다 — 선생님이 손으로 채점해야 한다 |
| `attempt_abandoned` | 응시를 처음부터 다시 시작했다 |
| `storage_blocked` | 브라우저 저장소를 쓸 수 없다 |

## 시험을 멈추지 않는다 (F12)

`assets/sg-notify.js` 의 모든 보내기는 fire-and-forget 이다.

- 로그인이 없거나 회선이 없으면 **던지지 않고** `localStorage` 큐에 눌러 둔다.
- 온라인이 되거나 학생이 대시보드를 열면 그때 마저 나간다(`dashboard.html` 도 이 파일을 싣는다).
- 알림이 실패했다고 화면이 달라지는 곳은 한 군데도 없다.
- 서버는 "설정이 없다·중복이다·한도를 넘었다" 를 전부 **200** 으로 답한다. 4xx 로 답하면
  클라이언트 큐가 그것을 "다시 보내야 할 실패" 로 오해해 재시도를 쌓는다.

## 같은 사고를 두 번 보내지 않는다

열쇠는 `(session, kind, code)` 하나다. 클라이언트가 기기에서 한 번 거르고,
서버(`api/notify.js`)가 10분 창으로 한 번 더 거른다 — 기기가 여러 대일 수 있어서다.
녹음이 여러 건 떨어져도 `media_dropped` 는 한 통이고, 총계는 `done` 메일이 싣는다.

## 학생이 보낸 글을 믿지 않는다

- "누가" 는 본문에서 읽지 않는다. Supabase 토큰이 말해 준다 — 학생이 남의 이름으로
  사고를 보고할 수 없어야 한다.
- 제목에는 개행·제어문자가 들어가지 않는다(메일 헤더 주입).
- 본문의 모든 값은 이스케이프하고 길이를 자른다.
- 로그인하지 않은 호출은 401 이다.

## Vercel 환경변수

| 변수 | 쓰임 |
| --- | --- |
| `RESEND_API_KEY` | **필수.** 없으면 알림은 조용히 물러난다(`{sent:false, reason:'not_configured'}`) |
| `NOTIFY_TO` | 받는 사람. 쉼표로 여럿. 기본 `jitnet57@gmail.com, ai@smeagschool.com` |
| `NOTIFY_FROM` | 보내는 사람. 기본 `SMEAG MockTest <onboarding@resend.dev>` |
| `NOTIFY_KINDS` | 보낼 종류. 기본 `issue,done`. `issue` 만 두면 완료 메일이 멎는다 |

보내는 길은 Resend HTTP API 다. 이 저장소의 `/api/*` 에는 `package.json` 이 없다 —
SMTP 라이브러리가 아니라 `fetch` 한 번으로 끝나는 길을 고른 이유다.

`NOTIFY_FROM` 은 운영에서 **인증된 도메인 주소**로 바꾼다. `onboarding@resend.dev` 는
Resend 의 시험용 발신자라 도메인 인증(SPF/DKIM) 없이 나가고, 그만큼 스팸함에 잘 들어간다.

## 확인하는 법

```
GET /api/notify        → { "configured": true, "kinds": ["issue","done"] }
node studyground/tests/test_exam_notify.js
```
