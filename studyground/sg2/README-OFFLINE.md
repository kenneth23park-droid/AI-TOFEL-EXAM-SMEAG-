# SMEAG StudyGround — 오프라인 실행 안내

인터넷 없이 로컬 PC에서 구동되는 정적 앱입니다. 외부 서버·CDN에 전혀 의존하지 않습니다
(모든 CSS·JS·문제 데이터·오디오·이미지가 이 폴더 안에 포함).

## 실행 방법 (택1)

### A. 주소만 열어 둔다 — 권장 · 학생용
와이파이가 있는 곳에서 **주소를 한 번 열기만** 하면 됩니다. 누를 버튼은 없습니다.

1. 학원 등 인터넷이 되는 곳에서 StudyGround 주소를 엽니다.
2. 앱이 그 SET 의 오디오 **92개 · 24.6 MB** 를 스스로 내려받습니다
   (구석에 진행률이 뜨고, 끝나면 "오프라인 준비 완료" 후 사라집니다).
3. 이후에는 인터넷이 끊겨도 리스닝·스피킹 오디오가 그대로 재생됩니다.

**업데이트도 자동입니다.** 온라인 상태로 페이지를 열 때마다 목록(`config/offline.set9.json`)을
새로 읽어 기기가 가진 것과 맞춰 봅니다.

- 서버에서 오디오가 바뀌면(**주소가 같아도**) 그 파일만 다시 받습니다 — 25 MB 전체가 아니라.
  파일마다 내용 해시를 비교하므로, 음성을 다시 생성해 같은 이름으로 덮어써도 알아챕니다.
- 문항이 교체되어 목록에서 빠진 오디오는 캐시에서 지웁니다.
- 중간에 끊겨도 다음에 열면 **이어받습니다** (있는 파일은 건너뜀).
- 오프라인으로 열었다가 와이파이에 붙으면 그 순간 다시 확인합니다.
- 데이터 절약 모드나 이미 오프라인인 경우에는 말없이 당기지 않고 **"지금 받기" 버튼**만 보여줍니다.
- 시험 화면(`exam-runtime.html`)에서는 받지 않습니다 — 응시 중 회선을 오디오 재생과 다투지 않기 위해서이고,
  대신 빠진 파일이나 바뀐 파일이 있으면 경고만 띄웁니다.
- 브라우저 주소창의 **설치(⊕) 아이콘**으로 "앱 설치"까지 해 두면 독립 앱 창으로 열립니다(선택).

> 오디오나 문항을 바꿨다면 `python3 tools/build_offline_manifest.py` 로 목록을 다시 만들고
> 배포하세요. 목록이 옛것이면 학생 기기는 바뀐 줄 모르고 "최신"이라고 답합니다.

### 실제 필요분만 따로 받기 (백업·USB용)

`media/` 폴더는 145 MB 지만 그중 120 MB 는 음성을 만들며 남은 중간물(`_backup_*` ·
`_segments_*`)입니다. 시험에 실제로 쓰이는 것만 같은 경로 구조로 떠냅니다.

```bash
python3 tools/build_offline_manifest.py --export ../dist/offline-media
```

```
studyground/dist/offline-media/set9/
├── media/audio/set9/       40개  12.5 MB   리스닝·스피킹 mp3
├── media/tts/              34개   8.5 MB   지문·스크립트 음성
├── media/pictures/set9/    18개   3.7 MB   화자 이미지
└── offline.set9.json                       그 시점의 목록(해시 포함)
```

`set9/` 안의 `media/` 를 `sg2/` 위에 그대로 덮으면 됩니다.

### B. 더블클릭 런처 — 인터넷이 아예 없는 시험장용
- **macOS**: `start-mac.command` 더블클릭 → 브라우저가 자동으로 열립니다.
  - 처음 한 번은 우클릭 → "열기"로 실행(미확인 개발자 경고 회피).
- **Windows**: `start-windows.bat` 더블클릭 → 브라우저가 자동으로 열립니다.
- 필요 조건: **Python 3** (macOS 기본 포함 / Windows는 python.org에서 1회 설치).
- 로컬 주소 `http://localhost:8130/index.html` 에서 동작하며, 창을 닫으면 종료됩니다.
- USB 배포용 압축본은 `bash tools/build_usb_bundle.sh` 로 만듭니다
  (→ `studyground/dist/smeag-studyground-offline.zip`, 약 42 MB — 생성 중간물은 빠집니다).

### C. 파일 직접 열기
- `index.html` 을 브라우저로 바로 열어도 대부분 동작합니다.
- 단, `file://` 에서는 서비스워커가 아예 뜨지 않아 **사전 다운로드도 오프라인 캐시도 동작하지 않습니다**.
  일부 브라우저는 오디오도 제한합니다. 실전에서는 **A 또는 B** 를 쓰세요.

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
- 이 `sg2` 폴더를 통째로 USB나 압축파일로 배포하면, 대상 PC에서 위 B 방법으로 즉시 실행됩니다.
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
