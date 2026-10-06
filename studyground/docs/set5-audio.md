# SET 5 음원 재생성 및 검증

전체 Set 5는 로컬 Kokoro ONNX v1.0 F32로 생성한다. ElevenLabs 키를 재조회할 수 없어
키 없는 로컬 엔진을 사용한다. 한 세트 안의 엔진은 동일하다. 원본 대사와 출력 경로는
그대로이며 기존 화자 배역을 Kokoro preset으로 대응시킨다. AU-Lily는 호주 preset이
없어 영국 `bf_lily`로 대체한다. ElevenLabs 계획은 `active: false`로 참조 보존한다.

## 생성

Python 3.12와 `kokoro-onnx`, `soundfile` 및 ffmpeg가 필요하다. 모델·voice 파일은
프로젝트 밖에 저장한다. 사용한 공식 자산:
[Kokoro ONNX v1.0](https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0).

```powershell
& 'C:/Users/jitne/.codex/tmp/set5-kokoro-venv/Scripts/python.exe' studyground/sg2/tools/tts_kokoro_onnx.py --manifest studyground/sg2/tts-voices-set5exam-kokoro.json --model-file 'C:/Users/jitne/.codex/tmp/set5-kokoro-model/kokoro-v1.0.onnx' --voices-file 'C:/Users/jitne/.codex/tmp/set5-kokoro-model/voices-v1.0.bin' --cache-dir 'C:/Users/jitne/.codex/tmp/set5-kokoro-segments' --threads 2 --skip-existing
```

일부 재생성은 `--only set5-l1-q01`처럼 항목을 지정한다. 기존 mp3는 자동 백업한다.
실제 파일은 `media/audio/set5/` 아래에 쓰며 결과 metadata는 manifest 옆의
`.generated.json`에 남긴다. 생성 성공만으로 시험 사용 검증이 끝난 것은 아니다.

## 음원 검증

`tts-manifest.set5.json`은 실제 음성 정책을 가진 33개 검증 대본이다. 세트 전용
매니페스트로 검사하여 다른 세트의 음원·인덱스를 변경하지 않는다. 받아쓰기 backend는
독립 `set5-audio-venv`의 faster-whisper 1.2.1, av 16.1.0과 캐시된 `small.en` 모델을 사용한다.
전수 실행은 CPU 스레드 2, worker 1로 제한하고 음성 생성과 순차 실행했다.

```powershell
& 'C:/Users/jitne/.codex/tmp/set5-audio-venv/Scripts/python.exe' studyground/tools/verify_audio.py --manifest studyground/sg2/tts-manifest.set5.json --stt-scope all --require-stt --stt-model small.en --stt-backend faster_whisper --update-index --stamp-on-pass --json studyground/sg2/config/audio-verify.set5.json
```

누락·손상·무음·대본 불일치를 해결한 뒤 오프라인 목록과 빌드 리포트를 다시 만든다.
자동 검사 WARN은 음성/전사 오류 원인을 확인해야 하며, 기준을 완화해 숨기지 않는다.

```powershell
python studyground/sg2/tools/finalize_set5.py
python studyground/sg2/tools/build_version.py
node studyground/sg2/tools/build_set5.mjs
node studyground/tests/test_set_import_set5.mjs
node studyground/tests/test_set_complete.js
```

## 최종 검증 결과

실제 ASR 전수 33개: 29개 WER 0%, 나머지 최대 1.30%. 콘텐츠·길이·피크 경고 없음.
최초 전수 검사에서 인덱스 초기화만 WARN으로 표시됐으며 실제 전사 PASS 33개를 기록한 뒤
동일 음원/대본 해시로 strict 재검증하여 PASS 33 / WARN 0 / FAIL 0을 확인했다.
검사 기준과 원본 대사는 변경하지 않았다.

- 전수 ASR 실행 증거: `sg2/config/audio-asr.set5.json` (`transcribed: 33`).
- 엄격 재검증: `sg2/config/audio-verify.set5.json` (33개 전사 해시 확인 후 재사용).
- 관리자 대본 비교: `sg2/config/audio-check.set5.json`.
- Chrome: 시험 화면 79개 렌더, MP3 33개 디코딩, JS 오류/깨진 이미지 0.
- 원본 회귀 및 세트 완성도 검사 통과. 오프라인 미디어 52개, 누락 0.
- 로컬 구현 완료. 배포와 Drive 동기화는 수행하지 않았다.
