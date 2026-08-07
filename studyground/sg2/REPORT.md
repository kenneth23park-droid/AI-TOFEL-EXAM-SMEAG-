# SMEAG StudyGround — 완료 보고서

작성일: 2026-08-06 · 대상: `studyground/sg2/` (오프라인 우선 웹앱) + `studyground/desktop/` (완전 설치형)

---

## 1. 개요

`studyground.ai/en` 을 **레이아웃·UX·정보구조 벤치마크**로 삼아, SMEAG **자체 브랜드·문구·SET 1 실제 문항**으로 채운 New TOEFL 대비 웹앱을 구축했습니다. 원본의 마케팅 문구·후기·브랜드 자산은 복제하지 않았고, 동일한 구조 위에 SMEAG 콘텐츠를 올렸습니다.

핵심 원칙 4가지:
- **오프라인 우선** — 외부 서버·CDN 의존성 0. 전 자산이 폴더 내부.
- **실제 콘텐츠** — SET 1 문항 91개 + 실제 리스닝/스피킹 오디오 + docx 파생 데이터.
- **EN 기본 · KO 토글** — UI 기본 영어, 우상단 토글로 한국어 전환(쿠키 유지).
- **BMAD · LangGraph 어시스트** — 매니페스트를 계약(contract)으로 병렬 스트림 진행, TTS는 LangGraph 파이프라인으로 오케스트레이션.

---

## 2. 산출물 집계

| 항목 | 수량 |
|---|---|
| 페이지 | **11** (index·npz·tests·dashboard·exam·learning·community·tools·purchase·login·signup) |
| SET 1 문항 | **91** (Reading 35 · Listening 33 · Writing 12 · Speaking 11) |
| 리스닝/스피킹 실음성 mp3 | **32** |
| TTS 생성 mp3 (다양 캐릭터) | **6** |
| 화자 이미지 | 8 (pictures) + 8 (speaking) |
| 벤치마크 대조 스크린샷 | 14 |
| 전체 용량 | ~33MB |

---

## 3. 벤치마크 대조 (studyground.ai/en → SMEAG sg2)

Playwright로 원본 전 라우트를 크롤링(13개 라우트, 풀페이지 캡처)해 정보구조를 추출한 뒤 재현.

| studyground.ai | SMEAG sg2 | 상태 |
|---|---|---|
| `/en` 랜딩(히어로·프로모·기능 01–05·후기·요금·FAQ) | `index.html` | ✅ 동일 구조, SMEAG 문구 |
| `/en/npz` New Practice Zone | `npz.html` | ✅ 4툴카드 + R·L·W·S 탭 + 카테고리 리스트 |
| `/en/test-nt` 모의고사 | `tests.html` | ✅ SET 1 카드 |
| `/en/dashboard` | `dashboard.html` | ✅ 영역별 점수 + 최근 성적 |
| `/en/learning` 강의 | `learning.html` | ✅ |
| `/en/community` | `community.html` | ✅ |
| `/en/purchase` 요금제 | `purchase.html` | ✅ Lite·Essential·Standard·Pro |
| `/en/login`·`/signup` | `login.html`·`signup.html` | ✅ |
| (원본에 없음) 실동작 시험 | `exam.html` | ➕ SET 1 렌더링·채점·오디오 |

디자인 시스템: 크림 배경(#f7f4ee) · 코럴 액센트(#e8481f) · 라운드 카드 · 시스템 폰트. 원본 톤을 벤치마크하되 SMEAG 자체 구현.

---

## 4. 실동작 시험 페이지 (exam.html)

- **Reading** — cloze(빈칸)·passage·chat 렌더 + 자동 채점. 지문 read-aloud 버튼.
- **Listening** — 문항별/블록별 **실제 SET 1 오디오** + **화자 캐릭터 이미지** + **카운트다운 타이머**. 단문응답 1–7·1–3 각자 오디오·화자·타이머.
- **Writing** — build-a-sentence·email·academic discussion + 프롬프트 read-aloud.
- **Speaking** — Listen & Repeat·Interview 실음성 + 녹음 버튼.

수정된 버그: 리딩 지문이 `paragraphs` 필드를 써서 화면에 안 나오던 문제 → 렌더링 복구.

---

## 5. 오디오 · TTS (ElevenLabs + LangGraph)

### 5.1 구조
**온라인 1회 생성 → mp3 번들 → 오프라인 재생** + **키 없을 때 브라우저 내장 음성 폴백**.

### 5.2 다양한 캐릭터 (LangGraph 멀티보이스 파이프라인)
`tools/tts_multivoice.py` — LangGraph StateGraph: `plan → synth → stitch → verify`
- **plan**: `tts-voices.json`에서 화자별 세그먼트 로드
- **synth**: 세그먼트별 ElevenLabs 합성(스레드 병렬, 콘텐츠 해시 캐시)
- **stitch**: ffmpeg로 화자 간 0.4초 간격 두고 1개 mp3로 결합
- **verify**: 산출물 유효성 확인
- langgraph 미설치 시 동일 노드 순차 실행(폴백)

검증 로스터 (계정에서 HTTP 200): **여성 6**(Sarah·Matilda·Alice·Jessica·Laura·Lily) · **남성 9**(George·Adam·Antoni·Daniel·Brian·Eric·Will·Chris·Bill).

### 5.3 제공자: Google Cloud TTS (현재 활성)
ElevenLabs 무료 quota(10,000자) 소진으로 **Google Cloud TTS로 전환**. 서비스 계정(project `elspa-497623`) OAuth2 Bearer 인증, `tools/tts_google.py` 동일 LangGraph 파이프라인. **6/6 전건 성공**(실패 0), quota 여유.

| 항목 | 유형 | Google 보이스 | 길이 |
|---|---|---|---|
| community-garden | 공지 | GB-Alice | — |
| questions-13-15 | **채팅(다화자)** | US-Noah·US-Ava·US-Liam (7세그 스티칭) | 67.0s |
| roman-roads | 학술 | US-Noah | 87.0s |
| ancient-irrigation | 학술 | US-Emma | — |
| write-email | 프롬프트 | GB-Oliver | — |
| write-disc | **토론(다화자)** | US-Liam·US-Zoe·GB-Oliver (Professor/Lena/Omar) | 67.3s |

**보이스 다양성**: 7개 서로 다른 Neural2 보이스 · US/GB 액센트 · 남녀 혼합. 다화자(채팅·토론)는 화자별 보이스를 ffmpeg로 스티칭해 한 mp3에 여러 캐릭터.

- Google 도구: [tools/tts_google.py](tools/tts_google.py) — 서비스 계정/API키 겸용, LangGraph, 세그먼트 병렬
- ElevenLabs 도구도 보존: [tools/tts_multivoice.py](tools/tts_multivoice.py)
- 두 공급자 모두 `media/tts/index.json`에 `provider` 기록 → 앱은 provider 무관하게 재생

---

## 6. 오프라인 구동

- 외부 URL/네트워크 의존성 **0** (전수 grep 확인).
- **PWA**: `manifest.webmanifest` + `sw.js`(셸 프리캐시 + 미디어 지연 캐시). 전 11페이지에 등록 주입.
- **더블클릭 런처**: `start-mac.command` / `start-windows.bat` (Python http.server + 브라우저 자동 실행).
- 검증: 외부망 전면 차단 상태에서 홈 로드·SW 등록·리스닝(오디오·이미지·타이머)·리딩 채점·read-aloud(브라우저 음성) **모두 정상, 외부요청 0 · 오류 0**.

---

## 7. 완전 설치형 (Electron) — 완료

`studyground/desktop/` — 번들된 정적 사이트를 `file://`로 로드하는 Electron 앱(네트워크 불필요).
- `main.js`·`preload.js`·`package.json`(electron-builder) + `site/`(sg2 전체)
- **산출물**: `release/SMEAG StudyGround-1.0.0-arm64.dmg` (**114MB**) + `release/mac-arm64/SMEAG StudyGround.app` (251MB)
- **검증**: 앱 프로세스 정상 구동 확인 · app.asar 내부에 **11 페이지 · 리스닝 32 mp3 · TTS 6 mp3(+세그먼트 캐시)** 전부 패킹 → 오프라인 동작
- 코드서명 미적용(로컬 배포본) — 최초 실행 시 우클릭 → "열기" 필요
- Windows: `package.json`에 `nsis` 타깃 설정 포함(맥에서 크로스빌드 시 별도 확인 필요)
- 실행: `npm start`(개발) / `npm run dmg`(배포본 빌드)

---

## 8. 배포 현황

- **임시 공개 URL**: cloudflare 터널(로컬 구동 중에만 유효).
- **Vercel 정식 배포**: 연결 계정이 **프로젝트 생성 권한 없음(403)** — 계정 역할 승격 또는 재인증 필요.
- **오프라인 배포**: sg2 폴더 통째 배포(USB/압축) 또는 Electron 설치본 — 인터넷 불필요.

---

## 9. 남은 작업 / 권장

1. **write-disc 멀티보이스 완성** — ElevenLabs quota 리셋/업그레이드 후 재실행(캐시로 누락분만).
2. **리스닝 TTS 다양화** — 현재는 실제 사람 음성(품질 우위). TTS 재생성하려면 리스닝 스크립트(transcript)가 필요 — set1.js엔 미포함.
3. **Vercel 정식 배포** — 계정 권한 해제 시 즉시 가능.
4. **Speaking AI 시험관** — ElevenLabs Conversational AI + MCP tool-config(온라인 실시간). 별도 큰 작업.
5. **보안** — 채팅에 노출된 ElevenLabs 키는 작업 후 **폐기·재발급** 권장.
