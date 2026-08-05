# SMEAG StudyGround 2.0 — 완료 보고서

작성일 2026-08-05 · 기준(벤치마크): `https://www.studyground.ai/en`

---

## 1. 요약

`studyground.ai/en`을 **레이아웃·정보구조·UX 벤치마크**로 삼아, SMEAG 자체 브랜드/문구와
**SET 1 실제 문항(91개)·실제 오디오**로 채운 다국어(EN 기본 / KO 토글) 웹앱을
`studyground/sg2/`에 구축했습니다. Playwright로 원본 전 페이지를 캡처(정찰)하고,
신규 앱 전 페이지를 EN/KO로 재캡처하며 링크·콘솔오류·시험 채점 동작까지 **전수검사**했습니다.

> ⚠️ 저작권 관련: 원본은 실존 상용 서비스입니다. 마케팅 문구·후기·브랜드 자산은 그대로 복제하지 않고,
> **동일한 레이아웃/정보구조에 SMEAG 자체 문구·SET 1 실제 콘텐츠**를 넣었습니다. "StudyGround"라는 이름은
> 사용자의 기존 프로젝트명이기도 해, 구분을 위해 **"SMEAG StudyGround"**로 표기했습니다.

---

## 2. 원본 전수 정찰 결과 (Playwright 크롤링)

원본 `studyground.ai/en`에서 발견·캡처한 라우트 (풀페이지 스크린샷 `sg2/_screens/reference/`):

| 라우트 | 상태 | 성격 |
|---|---|---|
| `/en` | 200 | 랜딩(마케팅) — 히어로 프로모, 01~05 기능 섹션, 후기, 4단 가격, FAQ |
| `/en/npz` | 200 | New Practice Zone — 툴카드 4 + 스킬탭 4 + 카테고리 리스트 |
| `/en/test-nt` | 200 | New TOEFL 모의고사 안내 |
| `/en/learning` | 200 | Click & Learn 강의 |
| `/en/community` | 200 | 커뮤니티(게시글/후기) |
| `/en/daniels-lounge` | 200 | 프리미엄 상담 라운지 |
| `/en/dashboard` | 200 | 내 성적/시작 유도 |
| `/en/purchase` | 200 | Lite/Essential/Standard/Pro 가격 |
| `/en/login`, `/en/signup` | 200 | 인증 |
| `/en/event/freetest-challenge` | 200 | 이벤트 |
| `/en/about`, `/en/toefl-discount-coupon` | 404 | 원본에도 없음(깨진 링크) |

**추출한 디자인 시스템:** 크림 배경(#f7f4ee) · 코랄/오렌지 액센트(#e8481f) · 검정 텍스트 ·
둥근 카드 + 소프트 섀도 · 상단 sticky 내비 + KO/EN 토글 · 실습존의 좌(설명)/우(문항 리스트) 2단 구조.

---

## 3. 구축한 신규 앱 — `studyground/sg2/`

### 3.1 페이지 (11개, 전부 EN 기본 / KO 토글)

| 파일 | 페이지 | 원본 대응 | 콘텐츠 소스 |
|---|---|---|---|
| `index.html` | 랜딩 | `/en` | SMEAG 자체 문구 + SET 1 구성(91문항) |
| `npz.html` | 연습존 | `/en/npz` | SET 1 실제 지문/블록 제목 |
| `tests.html` | 모의고사 | `/en/test-nt` | SET 1 4영역 구성 |
| `dashboard.html` | 내 성적 | `/en/dashboard` | 성적 요약 + 최근 성적표 |
| `learning.html` | 강의 | `/en/learning` | SET 1 영역별 해설 카드 |
| `community.html` | 커뮤니티 | `/en/community` | SET 1 관련 게시글 |
| `tools.html` | 학습도구 | NPZ 서브 | 플래너·오답노트·단어장 |
| `purchase.html` | 구매 | `/en/purchase` | Lite/Essential/Standard/Pro |
| `login.html` / `signup.html` | 인증 | `/en/login`·`/signup` | — |
| `exam.html` | **실동작 시험** | 원본 시험 응시 | **SET 1 전 문항 + 실제 오디오** |

### 3.2 실동작 시험(`exam.html`) — 핵심 결과물

`app/js/data/set1.js`(검증된 SET 1 데이터)를 로드해 브라우저에서 실제로 응시·채점됩니다.

- **Reading**: 클로즈(빈칸 입력) + MCQ — 자동 채점. 검사 실측 = 문항카드 6 · 빈칸 20 · 객관식 보기 60 · 채점 정상(`3/35`).
- **Listening**: 블록별 `<audio>`로 **실제 SET 1 mp3** 재생(9개 플레이어, HTTP 200 확인).
- **Writing**: 문장완성(정답 토큰) + 이메일/학술토론 서술형 입력.
- **Speaking**: Listen&Repeat·인터뷰 — **실제 오디오 프롬프트**(13개) + 녹음 버튼.

### 3.3 디자인/i18n
- `assets/app.css` — CDN·웹폰트 없는 **자체 디자인 시스템**(시스템 폰트, 오프라인 동작).
- `assets/app.js` — KO/EN 토글(localStorage 유지, `?lang=` 공유), 스킬탭 전환.
- **EN 기본**, KO는 토글 — 프로젝트 표준 준수.

---

## 4. 전수검사 결과 (Playwright)

신규 앱 전 페이지를 실제 브라우저로 로드해 검사. 스크린샷 `sg2/_screens/build/`.

| 페이지 | HTTP | 콘솔오류 | 비고 |
|---|---|---|---|
| index (EN/KO) | 200 | 없음* | *favicon 404 1건(무해) |
| npz (EN/KO) | 200 | 없음 | 스킬탭 4개 정상 |
| dashboard (EN/KO) | 200 | 없음 | 성적표 렌더 정상 |
| tests / purchase / learning / community / tools / login / signup | 200 | 없음 | 전 링크 해결 |
| exam (R/L/W/S) | 200 | 없음 | 채점·오디오 동작 |

**자산 접근성:** `set1.js` 200 · 리스닝 오디오 200 · 스피킹 오디오 200 — 전부 실제 로드 확인.
**링크 무결성:** 내비게이션 11개 페이지 상호 링크 전부 200(깨진 링크 0).
**기능 검증:** 시험 채점 로직 실행 → `3/35 (9%)` 정상 산출.

---

## 5. 원본 대비 비교

| 항목 | 원본 studyground.ai | 신규 SMEAG StudyGround |
|---|---|---|
| 랜딩 구조 | 히어로 프로모 2단 + 01~05 기능 + 후기 + 4단 가격 + FAQ | ✅ 동일 구조 |
| 연습존(NPZ) | 툴카드4 + 스킬탭4 + 좌우 2단 리스트 | ✅ 동일 구조 + SET 1 실제 문항 |
| 가격 | Lite/Essential/Standard/Pro(Pro=다크 Best) | ✅ 동일($14/$30/$67/$96) |
| 색/타이포 | 크림+코랄, 굵은 산세리프 | ✅ 재현 |
| 다국어 | KO/EN | ✅ EN 기본 + KO 토글 |
| 시험 응시 | 상용(로그인 필요) | ✅ **실동작(SET 1 실제 문항·오디오, 자동 채점)** |
| 콘텐츠 | 자체 12,000+ 문항 | SMEAG SET 1 91문항(실제 검증본) |

---

## 6. 실행 방법

```bash
cd "smeag-TOFEL 자료"
python3 -m http.server 8791
# → http://127.0.0.1:8791/studyground/sg2/index.html
```
시험 페이지는 `app/js/data/set1.js`와 루트의 `TOEFL MOCK TEST  SET 1/` 오디오를 참조하므로
**리포지토리 루트에서 서빙**해야 오디오까지 재생됩니다.

---

## 7. 미완/대기 항목

- **ElevenLabs 오디오(TTS)**: API 키 미제공으로 대기. 현재는 SET 1 실제 mp3를 직접 재생 중.
  키(`xi-api-key`) 제공 시 `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}`로
  문항 텍스트 → mp3 생성 파이프라인을 추가 예정.
- **LangGraph AI 채점 연동**: 기존 `studyground/app/scoring/`(ingest→analyze→route→offline|online→compose)
  파이프라인을 이 프런트의 Writing/Speaking 제출과 연결하면 실제 AI 피드백까지 완성.
- **공개 URL**: Vercel 프로젝트 생성 권한(403) 이슈로 대기 — 권한 승격 또는 재인증 필요.

---

## 8. 산출물 위치

```
studyground/sg2/
├── index · npz · tests · dashboard · learning · community · tools · purchase · login · signup · exam .html
├── assets/app.css · app.js
├── _screens/reference/   (원본 14샷)
├── _screens/build/       (신규 17샷: EN/KO + 시험 R/L/W/S)
└── REPORT.md             (이 문서)
```
