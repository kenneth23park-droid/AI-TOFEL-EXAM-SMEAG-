# 음원 검증 게이트

시험 음원이 **새로 들어오거나 교체될 때마다** 도는 검사. 잡으려는 사고는 실제로 났던 것들이다.

| # | 사고 | 잡는 계층 |
|---|---|---|
| 1 | 지문을 고쳤는데 mp3 를 다시 굽지 않아 옛 음원이 계속 나갔다 | 0 신선도 |
| 2 | 문항은 있는데 음원이 없어 무음 시험이 나갈 뻔했다 | 0 매핑 |
| 3 | 파일 이름이 뒤바뀌어 다른 문항의 음원이 붙었다 | 0 전역 해시 대조 |
| 4 | 생성이 중간에 끊겨 0바이트·잘린 mp3 가 남았다 | 1 무결성 · 2 길이 |
| 5 | 대화에서 화자 턴 하나가 통째로 빠졌다 | 2 턴 수 |
| 6 | **지문 대신 문항 질문문이 녹음됐다 / 아예 딴 지문이 붙었다** | **3 ASR 대본 대조** |

## 계층

| 계층 | 무엇을 보나 | 필요한 것 |
|---|---|---|
| 0 | 매핑·신선도·파일 뒤바뀜·고아 파일·콘텐츠 팩 교차확인 | 없음 |
| 1 | 코덱·샘플레이트·채널·크기 | `ffprobe` |
| 2 | 길이 비율·무음·발화 비율·턴 수·라우드니스 | `ffmpeg` |
| 3 | 음원을 다시 받아쓴 뒤 대본과 WER 대조 | ASR 백엔드 |

계층 3 의 WER 임계값(WARN > 2%, FAIL > 5%)과 짧은 세그먼트 예외는
`smeag-local-ai/qa/stt_loopback.py` 한 곳에만 있다. 어느 도구도 숫자를 복사하지 않는다.

ASR 백엔드는 `studyground/.venv` 의 **faster-whisper** 를 쓴다. 다른 인터프리터로 게이트를
부르면 백엔드를 못 찾으므로, `verify_audio.py` 가 스스로 `.venv/bin/python` 으로 갈아탄다.
백엔드가 정말 하나도 없으면 계층 3 은 조용히 통과하지 않고 `SKIP` 사유를 남긴다
(`--require-stt` 로 차단할 수 있다).

## 언제 도나

세 진입점 모두 같은 게이트 하나를 부른다.

1. **생성기** — `tts_set9.py` · `tts_multivoice.py` · `tts_google.py` · `tts_kokoro.py` ·
   `tts_generate.py` 는 생성이 끝나면 스스로 게이트를 돌리고, FAIL 이면 non-zero 로 끝난다.
2. **손으로 교체** — `tools/audio_gate.py` 를 직접 돌린다.
3. **커밋** — `.githooks/pre-commit` 이 스테이지에 mp3 가 있으면 자동으로 돌린다.
   급할 때만 `SKIP_AUDIO_GATE=1 git commit ...` (건너뛴 사실이 화면에 남는다).

훅은 `git config core.hooksPath .githooks` 로 켜져 있다. 새로 클론한 사본에서는 한 번 다시 켜야 한다.

## 무엇이 '바뀐 음원'인가

git 이 아니라 **사이드카 인덱스**(`media/*/.audio-index.<매니페스트>.json`)가 판단한다.
git 을 기준으로 삼으면 커밋하지 않은 교체나 git 밖에서 복사한 파일을 놓친다.
인덱스는 항목마다 이것을 들고 있다.

- `audioSha256` — mp3 바이트 해시
- `scriptHash` — 정규화 대본 + 음성정책(화자·gap)의 해시. 텍스트가 그대로여도 화자를
  바꿨으면 그 mp3 는 낡은 것이다.
- `sigVersion` — 해시 **정의**의 버전
- `stt` — 그 바이트·그 대본으로 받은 계층 3 판정

이 중 하나라도 어긋나면 다시 검사한다. 계층 3 기록이 아예 없는 항목도 대상이다 — 그러지
않으면 ASR 을 켜 놓고도 기존 음원은 영영 대조하지 않는다.

**FAIL 난 항목은 인덱스에 기준을 남기지 않는다.** 고칠 때까지 매 실행 다시 잡힌다.

### 왜 매니페스트별로 파일이 갈라져 있나

`media/audio/set9/` 를 두 매니페스트가 선언한다 — `tts-manifest.set9.json`(tts_set9.py 용)과
파생 매니페스트(`.verify-manifest.tts.json`, tts_multivoice.py 용). 사이드카가 한 벌이면 두
도구가 번갈아 덮어쓰며 서로의 기준을 STALE 로 몬다. 각자 파일을 들면 그 충돌이 사라진다.

같은 이유로 `scriptHash` 는 세그먼트에 `say_voice` 가 있으면 매니페스트 머리말의
voice/model/output 을 해시에 넣지 않는다 — `say_voice` 가 `model|output|voice_id` 를 이미
담고 있어 중복이고, 그 중복 때문에 내용이 글자까지 같은 항목의 해시가 갈렸다.

`sigVersion` 이 있는 이유도 같다. 해시 정의를 고친 날 옛 기준과 새 해시는 당연히 다른데,
그걸 STALE(=FAIL) 로 읽으면 전 항목이 발행 차단된다. 버전이 다르면 FAIL 이 아니라
"기준 재수립"(WARN)으로 다루고 한 번에 자가 복구한다.

## 명령

```bash
PY=studyground/.venv/bin/python

$PY studyground/tools/audio_gate.py             # 바뀐 음원만 검사 + 통과분 기준 갱신
$PY studyground/tools/audio_gate.py --dry-run   # 무엇이 왜 대상인지만 본다
$PY studyground/tools/audio_gate.py --all       # 전수 재검사 (80항목 ≈ 4분)
$PY studyground/tools/audio_gate.py --require-stt   # ASR 없으면 차단

# 계층별로 따로 보고 싶을 때
$PY studyground/tools/verify_audio.py --manifest sg2/tts-manifest.set9.json --changed-only
$PY studyground/tools/verify_audio.py --selftest        # 외부 도구 없이 로직만
$PY studyground/tools/verify_audio_stt.py --selftest    # ASR 없이 WER 판정만
```

전사는 항목당 2~3초다. 그래서 기본 스코프는 `changed` — 실제로 교체되는 건 보통 한두 개고,
그때 게이트는 몇 초면 끝난다. `--stt-scope all` 은 전수 전사, `none` 은 계층 3 을 끈다.
