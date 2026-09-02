# 세트 만들기 — 순서와 검산

세트 하나는 문서 세 장(문제지·스크립트·정답지)에서 나온다. 이 문서는 그 세 장이 시험이 될
때까지 반드시 지나야 하는 네 관문을 적는다. **각 관문은 사람 눈이 아니라 코드가 막는다** —
아래에 어느 코드가 무엇을 막는지 같이 적어 둔 이유다. 사람이 확인하기로 한 것은 언젠가
확인하지 않게 되고, 그 사실은 시험장에서만 드러난다.

원본 문서
```
kenneth-brain/smeag-TOFEL 자료/NEW TOEFL SET <N>.docx      문제지
kenneth-brain/smeag-TOFEL 자료/SET <N> SCRIPT.docx         듣기 스크립트
kenneth-brain/smeag-TOFEL 자료/SET <N> ANWER KEY.docx      정답지
```

---

## 1. 문제지 — 원본 문서에 100% 맞춘다. 가공하지 않는다

문항·보기·지시문·지문은 문서에 적힌 그대로 들어간다. 문장을 다듬거나, 빠진 보기를 채우거나,
없는 제목을 지어내지 않는다. 문서가 틀렸으면 **문서를 고치고 다시 짓는다.**

강제하는 곳 — `sg2/assets/set-import.js` 의 strict source mode
(`admin-set-import.html` 의 `STRICT_SOURCE_ONLY = true`, 끌 수 없다). 다음은 전부 `stop` 이라
저장 단추가 잠긴다.

| 상황 | gate |
| --- | --- |
| 문서에 없는 제목을 만들어 넣음 | `headingOrigin === 'generated'` |
| 원본 문구를 고침 | `headingOrigin === 'corrected-from-source'` |
| 보기를 만들어 채움 | `choicesOrigin === 'generated'` |
| 타일을 정답에서 역산함 | `tilesOrigin === 'derived-from-answer'` |
| AI 가 채운 내용 | `scriptOrigin === 'ai'` · `answerOrigin === 'ai'` |
| 스크립트·정답지 문서를 안 올림 | 빌드 자체가 막힘 |

`build_set11.mjs` 처럼 명령줄로 짓는 경우도 같은 코드 경로를 탄다 — `stop` 이 하나라도 있으면
스크립트가 0 이 아닌 값으로 끝난다.

## 2. 오디오 — 스크립트로 ElevenLabs 에서 만들고, 스크립트와 100% 맞춘다

```
cd studyground/sg2
ELEVENLABS_API_KEY=... sh tools/make_set_audio.sh <N>
```

하는 일은 둘이다.
1. `tools/build_voices_manifest.mjs` — 원본 docx 를 같은 파서에 물려 배역 매니페스트를 짓는다.
   대사는 스크립트 문서에서 그대로 온다(사람이 옮겨 적지 않는다).
2. `tools/tts_multivoice.py` — mp3 를 뽑고, **만든 음성을 다시 받아쓰기해 스크립트와 대조한다**
   (`tools/verify_audio.py`, WER 기준). 하나라도 FAIL 이면 이 명령이 0 이 아닌 값으로 끝난다.

받아쓰기 대조를 건너뛰는 `--no-verify` 는 실험용이다. 시험에 나갈 음성에는 쓰지 않는다.
판정 규칙 자체는 `tests/test_audio_script_check.js` 가 고정한다.

## 3. 정답지 ↔ 문제지 크로스체크 — 전수로 맞는지 확인한다

정답을 "붙였다" 는 것과 붙은 정답이 그 문항에서 "성립한다" 는 것은 다르다. 정답지가 한 줄
밀리면 문항마다 정답이 하나씩 있는 상태 그대로 전부 틀린다.

강제하는 곳 — `set-import.js` 의 `crossCheckAnswers()`. 문항 전수로 본다.

* 객관식: 정답이 **그 문항의 보기 안에** 있는 번호인가 (범위 밖·본문 불일치 모두 잡는다)
* 빈칸: 글자 정답이 비어 있지 않은가
* `Click on the sentence …`: 보기가 없는 게 정상이므로 정답 존재만 본다
* 모듈 단위: 문항 수와 정답 수가 같은가 (다르면 `stop` — 정답지 번호가 문제지와 다른 것이다)

strict source mode 에서는 전부 `stop` 이다. 규칙은 `tests/test_answer_crosscheck.js` 가 고정한다.

## 4. 저장 — 눌렀으면 제대로 저장됐는지 되읽어 확인한다

`STORE.put()` 은 저장한 뒤 **되읽어 대조한 뒤에만** `ok` 를 돌려준다
(`sg2/assets/set-store.js` 의 `verify()`). 대조하는 것은 문항 수, 문항별 정답, 듣기 음원 경로,
그리고 저장 목록의 문항 수다. 하나라도 다르면 실패로 보고하고 세트를 활성화하지 않는다 —
반쯤 저장된 세트를 열면 정답이 빠진 채로 시험이 시작된다.

localStorage 는 조용히 반쯤 실패하는 자리가 많아서(용량 초과로 잘림, 시크릿 모드, 다른 탭의
덮어쓰기) `setItem` 이 던지지 않았다는 것만으로 "저장됨" 이라고 말할 수 없다. 화면은 검산까지
지난 뒤에야 `saved and verified (N questions read back)` 라고 적는다.

규칙은 `tests/test_set_save_verify.js` 가 고정한다.

---

## 세트 하나를 끝낼 때 돌리는 것

```
node studyground/tests/test_answer_crosscheck.js      # 3
node studyground/tests/test_set_save_verify.js        # 4
node studyground/tests/test_audio_script_check.js     # 2 의 판정 규칙
node studyground/tests/test_set_import_set<N>.mjs     # 그 세트의 실제 문서 회귀
```

세트마다 `test_set_import_set<N>.mjs` 를 하나씩 둔다. 문항 수·모듈별 번호·원문 그대로인지를
그 세트의 실제 docx 로 확인하는 자리이고, 파서를 고칠 때 예전 세트가 조용히 바뀌는 것을
막는 유일한 그물이다.
