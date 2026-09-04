# 세트 만들기 — 순서와 검산

세트 하나는 문서 세 장(문제지·스크립트·정답지)에서 나온다. 이 문서는 그 세 장이 시험이 될
때까지 반드시 지나야 하는 다섯 관문을 적는다. **각 관문은 사람 눈이 아니라 코드가 막는다** —
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
| 팩의 문장이 원본에 그대로 없음 | `verbatimGaps()` (scope `source`) |
| 스크립트·정답지 문서를 안 올림 | 빌드 자체가 막힘 |

**표식만으로는 모자란다.** 위의 표는 전부 `...Origin` 표식, 곧 **파서가 스스로 신고한 것**을
본다. 신고하지 않고 문장이 달라지는 길(줄을 잇다 낱말이 빠지거나, 손으로 고친 팩을 다시
커밋하거나, 나중에 누가 매끄럽게 다듬거나)은 그 표식에 걸리지 않는다. 그래서 결과물 쪽에서
한 번 더 본다 — **팩에 적힌 모든 문장이 원본 문서에 그대로 있는가**
(`set-import.js` 의 `verbatimGaps()`, gate scope `source`, strict source mode 에서 `stop`).

* 문장 단위로 본다. 팩은 원본의 여러 문단을 한 필드로 잇는다(W2 이메일의 상황문 + 요구사항,
  표의 칸). 통째로 찾으면 이어 붙였다는 이유만으로 전부 걸리므로, 문장 하나가 원본에 그대로
  있는지만 본다 — 순서를 바꿔 잇는 것은 지나가고 **낱말을 고치는 것은 걸린다.**
* 원본은 세 장 전부다(문제지·스크립트·정답지). 굽은 따옴표·긴 대시·표 구분자·공백·대소문자
  차이는 고침으로 세지 않는다. `{{1}}` · `{{B}}` 는 빈칸·삽입 자리 표시라 사이의 글만 본다.
* 원본에 없는 것이 정상인 화면 문구는 `GENERATED_UI_TEXT` 에 적힌 것뿐이다
  (`Fill in the blank.` · `Listen to the question and select the best response.`).
  이 목록이 길어지면 그만큼 "원본 그대로"가 아니니, 늘리기 전에 다시 생각한다.

규칙은 `tests/test_verbatim_gate.js` 가 고정한다.

`tools/build_set<N>.mjs` 로 명령줄에서 짓는 경우도 **같은 잣대**다 — `strictSource: true` 를
명시적으로 넘기고, `stop` 이 하나라도 있으면 0 이 아닌 값으로 끝난다. 이 둘이 어긋나면
"명령줄로는 지어지는데 화면에서는 저장이 막히는" 팩이 생기고, 그 팩은 이미 시험에 나간 뒤다.

## 2. 오디오 — 스크립트로 ElevenLabs 에서 만들고, 스크립트와 100% 맞춘다

```
cd studyground/sg2
ELEVENLABS_API_KEY=... sh tools/make_set_audio.sh <N>
```

하는 일은 셋이다.
1. `tools/build_voices_manifest.mjs` — 원본 docx 를 같은 파서에 물려 배역 매니페스트를 짓는다.
   대사는 스크립트 문서에서 그대로 온다(사람이 옮겨 적지 않는다). 원본 문서의 **이름은
   세트마다 다르다** — 적어 두지 않고 폴더에서 골라 온다(`tools/source_docs.mjs`,
   `tests/test_source_docs.js` 가 지금까지 온 이름 네 벌을 고정한다).
2. `tools/build_listening_images.mjs` — 듣기 화자 사진(`config/set<N>-listening-images.json`).
   같은 배역표에서 나오므로 목소리와 얼굴의 성별이 어긋나지 않고, 한 세트 안에서 같은
   목소리는 늘 같은 얼굴이다. 손으로 적지 않는다.
3. `tools/tts_multivoice.py` — mp3 를 뽑고, **만든 음성을 다시 받아쓰기해 스크립트와 대조한다**
   (`tools/verify_audio.py`, WER 기준). 하나라도 FAIL 이면 이 명령이 0 이 아닌 값으로 끝난다.

받아쓰기 대조를 건너뛰는 `--no-verify` 는 실험용이다. 시험에 나갈 음성에는 쓰지 않는다.
판정 규칙 자체는 `tests/test_audio_script_check.js` 가 고정한다.

듣기 사진은 소리와 함께 이 명령 하나로 끝난다 — 음성만 만들고 사진을 잊으면 듣기 화면만
그림 없이 뜬다(SET 12 가 그랬다). 화면으로 세트를 가져올 때도 `admin-set-import.html` 이
같은 파일을 읽어 붙이고, 없으면 검산 줄에 적는다. `tests/test_listening_pictures.js` ·
`tests/test_set_audio_cli.js` 가 이 둘을 고정한다.

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

## 5. 세트는 통째로 나간다 — 반쪽이면 막는다

앞의 넷은 전부 **팩이 있다**를 전제한다. 팩이 없는 세트는 검사할 대상이 없어서 조용히
지나간다. SET 12 가 그렇게 나갔다: 음성(`media/audio/set12`)·배역표·사진 배정표까지
지어져 커밋됐는데 문항 팩(`assets/set12.js`)이 없었다. 팩은 `admin-set-import.html` 로
가져온 **그 브라우저의 localStorage 안에만** 있었고, 그래서 그 브라우저 밖에서는
존재하지 않는 세트였다 — 로그인 목록에도, 시험 라이브러리에도, 리뷰에도 뜨지 않았다.
"세트가 안 보인다"는 화면의 결함처럼 보이지만, 세트가 파일로 지어진 적이 없다는 뜻이었다.

그래서 판정을 뒤집는다 — **세트의 흔적이 하나라도 있으면 전부 있어야 한다.**

강제하는 곳 — `studyground/tests/test_set_complete.js`. 세트 번호를 흔적의 합집합에서
모은다(팩·빌더·배역표·사진표·음성 폴더·사진 폴더·오프라인 목록). 하나라도 있으면
그 세트는 "짓는 중"이고, 아래가 전부 있어야 한다.

| 갖춰야 할 것 | 없으면 |
| --- | --- |
| `assets/set<N>.js` | 가져온 브라우저 밖에 세트가 존재하지 않는다 |
| `tools/build_set<N>.mjs` | 팩을 다시 지을 길이 없다 |
| `tests/test_set_import_set<N>.mjs` | 원본 회귀를 잡는 그물이 없다 |
| `tts-voices-set<N>exam-11labs.json` · `config/set<N>-listening-images.json` | 목소리·얼굴이 없다 |
| `config/offline.set<N>.json` · `media/audio/set<N>/` | 시험장에서 클립마다 회선을 탄다 |
| 등록 열여섯 자리 | 그 화면에서만 조용히 사라진다 |
| 팩이 가리키는 `media/` 파일 | 학생 화면은 `Audio unavailable` 만 본다 |
| 듣기 문항의 화자 사진 | 듣기만 그림 없이 뜬다 |

**등록 열여섯 자리** — 세트 하나가 보이려면 이름이 여기 전부 있어야 한다. 하나만
빠져도 그 화면에서만 사라지므로, 검사가 실패하면 어느 파일에 어떤 문자열이 없는지와
그 자리가 무엇을 하는지를 같이 적어 준다.

```
login.html                       계정 목록
dashboard.html · exam-runtime.html · review.html · admin-set-view.html   팩 스크립트 태그
tests.html                       시험 라이브러리 카드
assets/question-config.js        문항 편집기 후킹
assets/exam-shell.js             ?set= 로 팩 고르기 · ?testId= 추론
assets/offline-prep.js           오프라인 준비가 같은 세트를 본다(어긋나면 다른 세트 음성을 튼다)
assets/admin-session.js          관리자 계정 · SET 선택기
config/offline.sets.json         오프라인 사전 다운로드 목록
sw.js                            프리캐시(팩 · 오프라인 목록) + VERSION 판올림
tools/build_offline_manifest.py  오프라인 목록 생성기
```

SET 1·9 는 이 규칙이 생기기 전에 만들어져 모양이 다르다. 검사 안의 `LEGACY` 에 사유와
함께 적어 면제한다. **면제는 그 둘뿐이고, 새로 짓는 세트는 예외 없이 전부 지나야 한다.**

돌리는 자리는 둘이다. `studyground/tools/hooks/pre-commit` 이 세트 관련 파일이 커밋에
들어 있을 때 돌고, `.github/workflows/deploy-sg2.yml` 이 배포 직전에 다시 돈다 —
훅은 `git commit --no-verify` 로 넘길 수 있지만 배포 앞의 문은 넘을 수 없다.

---

## 세트 하나를 끝낼 때 돌리는 것

```
node studyground/tests/test_answer_crosscheck.js      # 3
node studyground/tests/test_set_save_verify.js        # 4
node studyground/tests/test_audio_script_check.js     # 2 의 판정 규칙
node studyground/tests/test_set_import_set<N>.mjs     # 그 세트의 실제 문서 회귀
node studyground/tests/test_listening_pictures.js     # 2 — 듣기 화자 사진이 빠지지 않았는가
node studyground/tests/test_set_complete.js           # 5 — 세트가 반쪽이 아닌가 (훅·CI 가 자동으로 돈다)
```

세트마다 `test_set_import_set<N>.mjs` 를 하나씩 둔다. 문항 수·모듈별 번호·원문 그대로인지를
그 세트의 실제 docx 로 확인하는 자리이고, 파서를 고칠 때 예전 세트가 조용히 바뀌는 것을
막는 유일한 그물이다.
