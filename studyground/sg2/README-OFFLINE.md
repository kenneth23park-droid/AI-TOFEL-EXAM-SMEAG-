# SMEAG StudyGround — 오프라인 실행 안내

인터넷 없이 로컬 PC에서 구동되는 정적 앱입니다. 외부 서버·CDN에 전혀 의존하지 않습니다
(모든 CSS·JS·문제 데이터·오디오·이미지가 이 폴더 안에 포함).

## 실행 방법 (택1)

### A. 더블클릭 런처 — 권장
- **macOS**: `start-mac.command` 더블클릭 → 브라우저가 자동으로 열립니다.
  - 처음 한 번은 우클릭 → "열기"로 실행(미확인 개발자 경고 회피).
- **Windows**: `start-windows.bat` 더블클릭 → 브라우저가 자동으로 열립니다.
- 필요 조건: **Python 3** (macOS 기본 포함 / Windows는 python.org에서 1회 설치).
- 로컬 주소 `http://localhost:8130/index.html` 에서 동작하며, 창을 닫으면 종료됩니다.

### B. 브라우저에 "앱 설치" (PWA) — 오프라인 캐시
1. 위 A 방법으로 한 번 실행합니다.
2. 브라우저 주소창의 **설치(⊕) 아이콘** → "SMEAG StudyGround 설치".
3. 이후에는 **독립 앱 창**으로 열리고, 서비스워커가 자산을 캐시하므로 인터넷 없이 동작합니다.
   - 오디오는 한 번 재생하면 캐시되어 다음부터 오프라인 재생됩니다.

### C. 파일 직접 열기
- `index.html` 을 브라우저로 바로 열어도 대부분 동작합니다.
- 단, 일부 브라우저는 `file://` 에서 서비스워커/일부 오디오를 제한하므로 **A 방법을 권장**합니다.

## 폴더 구성
```
sg2/
├── index · npz · tests · dashboard · exam · learning · community · tools · purchase · login · signup .html
├── assets/            CSS · JS · SET1 데이터(set1.js) · 앱 아이콘
├── media/
│   ├── audio/         SET 1 실제 리스닝·스피킹 오디오 (mp3)
│   ├── pictures/      리스닝 화자 이미지 (리사이즈됨)
│   └── speaking/      스피킹 과제 이미지
├── manifest.webmanifest · sw.js   (PWA 설치·오프라인 캐시)
├── start-mac.command · start-windows.bat   (더블클릭 런처)
└── README-OFFLINE.md
```

## 설치형 배포(선택)
- 이 `sg2` 폴더를 통째로 USB나 압축파일로 배포하면, 대상 PC에서 위 A 방법으로 즉시 실행됩니다.
- 완전한 "설치 프로그램(.app/.exe)" 형태가 필요하면 Electron/Tauri 패키징으로 확장할 수 있습니다(요청 시).

## ElevenLabs 읽어주기(TTS) — 선택
리딩 지문·라이팅 프롬프트에 **🔊 Read aloud / 읽어주기** 버튼이 있습니다.
- **키 없이**: 브라우저 내장 음성으로 오프라인 재생(자동 폴백).
- **스튜디오 음질**(선택): 아래로 mp3를 1회 생성해 번들하면, 이후 오프라인에서 그 음성을 우선 재생합니다.
  ```bash
  # elevenlabs.io → 프로필 → API Keys → Create
  export ELEVENLABS_API_KEY=xi_xxx
  cd sg2 && python3 tools/tts_generate.py          # media/tts/*.mp3 + index.json 생성
  python3 tools/tts_generate.py --dry-run          # 과금(문자수) 미리보기, API 호출 없음
  ```
  대상·보이스는 `tts-manifest.json`에서 조정합니다(기본 보이스 "George").

## 참고
- 언어: 기본 **영어(EN)**, 우상단 토글로 **한국어(KO)** 전환 — 새로고침해도 유지.
- 오디오/화자 이미지/카운트다운 타이머는 리스닝·스피킹 문항에 포함되어 있습니다.
- 온라인 전용 기능(ElevenLabs TTS 실시간 생성, 클라우드 AI 채점)은 인터넷 연결 시에만 동작하며,
  오프라인에서는 번들된 실제 오디오와 규칙 기반 채점으로 대체됩니다.
```
