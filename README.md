# SMEAG TOEFL 모의고사 웹앱

`NEW TOEFL SET 1` 실물 자료(문제·정답키·오디오 31개·이미지 17장)를 실제로 응시할 수
있는 **단독 정적 웹앱**. 빌드 도구 · 번들러 · npm 없이 브라우저에서 바로 돌아간다.

## 실행

```bash
python3 -m http.server 8080     # → http://localhost:8080
```

`index.html` 을 더블클릭해 `file://` 로 열어도 동작한다 (ES module·fetch 를 쓰지 않음).
단, 스피킹 녹음(마이크)과 Supabase 동기화는 `http://` 에서만 정상 동작한다.

- `index.html` — 대시보드 (성적·오답노트·응시 이력)
- `exam.html?set=1` — 시험 응시
- `results.html?attempt=<id>` — 결과 · 문항별 리뷰

## 시험 구성

| 영역 | 구성 | 문항 | 자동채점 |
|---|---|---|---|
| Reading | Module 1 (20) + Module 2 (15) | 35 | ✅ |
| Listening | Module 1 (18) + Module 2 (15) · 오디오 1회 재생 | 33 | ✅ |
| Writing | Build a Sentence (10) + Email + Academic Discussion | 12 | 10문항만 |
| Speaking | Listen & Repeat (7) + Interview (4) · 녹음 제출 | 11 | ❌ |

자동 채점 만점 **78점**. 이메일·토론·스피킹은 `채점 대기` 로 저장된다.

## 구조

```
index.html / exam.html / results.html
app/
  INTERFACES.md          모듈 간 계약서 (수정 전 반드시 읽을 것)
  css/app.css
  js/
    config.js            Supabase URL/키, 응시자 정보
    data/set1.js         문제·정답 단일 진실 소스 (직접 수정 금지)
    util.js store.js timer.js audio.js recorder.js
    grade.js sync.js exam.js
    sections/            reading · listening · writing · speaking 렌더러
  assets/speaking/       docx 에서 추출한 스피킹 그림 8장
tools/
  extract_set1.py        원본 docx 추출 + 대조 검증
  smoke_test.js          채점 로직 회귀 테스트
supabase/schema.sql      테이블 · RLS · Storage 정책
TOEFL MOCK TEST  SET 1/  원본 문제·정답·오디오
TOEFL LISTENING & WRITING PICTURES/
```

## 데이터 저장

응시 중에는 **localStorage** 에 매 응답마다 즉시 저장된다(새로고침해도 이어하기).
녹음은 IndexedDB. 제출 시 **Supabase** 로 동기화하고, 실패하면 큐에 남겨
대시보드에서 재시도할 수 있다. `config.js` 의 키가 비어 있으면 동기화만 꺼지고
앱은 그대로 동작한다.

프로젝트: `smeag-toefl` (ap-northeast-2)

> ⚠️ Supabase 대시보드에서 **Authentication → Sign In / Providers → Anonymous
> sign-ins** 를 켜야 동기화가 동작한다. 앱이 익명 로그인으로 `auth.uid()` 를 얻는다.

## 검증

```bash
python3 tools/extract_set1.py verify   # 문제/정답이 원본 docx 와 일치하는가
node tools/smoke_test.js               # 정답만 고르면 78/78 인가
```

문제 데이터(`app/js/data/set1.js`)를 손댔다면 두 명령이 모두 통과해야 한다.
