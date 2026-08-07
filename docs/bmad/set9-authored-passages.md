# SET 9 · Listening Module 2 Q4-15 — 보충 집필 지문 (원본 아님)

> ## ⚠️ 출처 경고 — 반드시 먼저 읽을 것
> **이 문서에 실린 4개 지문은 원본 SMEAG 자료가 아니다.**
> `SET 9 SCRIPT.docx` 의 MODULE 2 구간에는 Q1-3(짧은 응답형, 질문문이 곧 음원)만 전사가 있고,
> **Q4-15 가 묻는 대화·강의 본문은 존재하지 않는다.** 문항·선택지·정답키는 원본 그대로이므로,
> 아래 지문은 **"기존 정답키의 정답이 유일하게 성립하도록" 역으로 집필한 보충 지문**이다.
> **원본 전사가 확보되면 즉시 교체 대상이다.**
>
> 교체 절차: `studyground/sg2/config/_set9_l2/<blockId>.json` 의 `segments` 를 원본으로 갈아끼우고 →
> `studyground/.venv/bin/python studyground/tools/tts_set9.py --only <audioId> --force` →
> `studyground/.venv/bin/python studyground/tools/build_set9.py` →
> `studyground/.venv/bin/python studyground/tools/gen_set9_authored_doc.py` →
> `node studyground/tests/test_compile_set9.js`.

출처 표시가 남아 있는 곳 (한 군데만 고치면 안 된다):

| 위치 | 필드 |
|---|---|
| `sg2/config/_set9_l2/L2-B{2,3,4,5}.json` | `origin: "authored"`, `originNote`, `revisionNote` |
| `sg2/assets/set9.js` (L2 블록 4개) | `scriptOrigin: "authored"`, `scriptNote`, `script` |
| `sg2/tts-manifest.set9.json` | `authored_scripts[]` (`missing_scripts` 는 이제 빈 배열) |
| `tools/tts_set9.py` | 모듈 docstring + `AUTHORED_BLOCK_ORDER` 주석 |
| `tests/test_compile_set9.js` | `[7]` 상단 "결손 해소 이력" 주석 |
| 이 문서 | — |

---

## 산출물 요약

| 블록 | 문항 | 종류 | 단어수 | 음원 | 크기 | 재생시간 |
|---|---|---|---|---|---|---|
| `L2-B2` | Questions 4-5 | conversation | 245 | `media/audio/set9/set9-L2-04-05.mp3` | 1,045 KB | 89.2 s |
| `L2-B3` | Questions 6-7 | conversation | 250 | `media/audio/set9/set9-L2-06-07.mp3` | 1,029 KB | 87.8 s |
| `L2-B4` | Questions 8-11 | talk | 437 | `media/audio/set9/set9-L2-08-11.mp3` | 1,965 KB | 167.7 s |
| `L2-B5` | Questions 12-15 | talk | 446 | `media/audio/set9/set9-L2-12-15.mp3` | 2,041 KB | 174.2 s |

음성 정책은 기존 SET 9 음원 36개와 동일하다 (`tools/tts_set9.py`): macOS `say`,
`M:` = Alex / `W:` = Samantha, 165 wpm, 대화 화자 전환 0.40 s · 강의 문단 전환 0.55 s,
앞뒤 0.25 s 패딩, 22.05 kHz mono → lame 96 kbps. 강의는 L1 의 talk 2개와 같이 단일 남성 화자.

---

## 검증 이력

### rev1 → rev2 — 역채점(reverse-grading)

지문만 보고 문제를 푸는 독립 에이전트 4명이 블록별로 12문항을 풀었고,
**12/12 전부 `set9.js` 의 원본 정답키와 일치**했다. 즉 정답 불일치로 인한 지문 수정은 없었다.
다만 보고서가 지적한 **품질 결함**(질문문 어휘가 지문에 그대로 노출되는 verbatim leak,
오답이 명시적으로 부정돼 지문 이해 없이 소거법으로만 풀리는 설계)을 반영해 4개 지문을 개정했다(rev2).

### rev2 → rev3 — blind 검증 (정답을 모르는 독립 응시자 2명)

정답키를 보지 못한 응시자 2명이 rev2 지문만으로 12문항을 각각 풀었다.

- **정답 일치 24/24 (2명 × 12문항).** 정답의 유일성 자체는 rev2 에서 이미 성립했다.
- 그러나 두 응시자가 **독립적으로 같은 결함**을 지적했다. 응시자 B 는 15개 항목 중 **13개를
  `solvableByElimination`** 로 표시했고, 진단은 "오답 선택지를 먼저 만들고 그 부정문을 지문에
  심은 흔적"이었다. 즉 **내용을 이해하지 않고 '부정되지 않은 선택지'만 골라도 만점**에 가까웠다.

지적된 대표 문장(전부 rev3 에서 삭제됨):

| 지문 | rev2 문장 | 무엇을 지워 주었나 |
|---|---|---|
| L2-B5 | "It is not a feat of memory either" / "neither is the harmony" | L2-13 오답 [0][1] |
| L2-B5 | "I am not making a point about two people trading turns" | L2-14 오답 [2] |
| L2-B4 | "not there because the ledge suits it, or because the city shelters it" | L2-10 오답 [1][2] — **한 문장이 둘 동시에** |
| L2-B4 | "Last week was the machinery of migration... I won't return to any of it today" | L2-8 오답 [0][3] |
| L2-B2 | "we've never exchanged a word" / "I'm still in cognitive science" | L2-4 오답 [3][2] |
| L2-B2 | 남자의 3개 제안을 여자가 차례로 전부 기각 | L2-5 오답 [0][1][2] |

추가로 **정답 직전 신호어**("Here's what actually works", "Here is the difficulty",
"The whole problem is the number", "That arrangement is the only reason I bring the comparison up")가
화자의 목적을 그대로 말해 버려, 목적·주제 추론 문항이 세부사항 검색 문항으로 격하돼 있었다.

### rev3 집필 원칙

1. 오답은 **부정**이 아니라 **충돌**로 죽인다 — 화자가 "그건 아니다"라고 선언하는 대신,
   장면의 사실관계가 그 선택지와 양립할 수 없게 만들고 배제는 응시자의 추론에 맡긴다.
2. **한 문장이 오답 둘 이상을 동시에 죽이는 구조 금지** — 오답은 지문의 서로 다른 부분에서
   각각 다른 이유로 배제되어야 한다.
3. 주제·목적은 **선언하지 말고 실연**한다 — 도입부의 논지 선언과 정답 직전 신호어를 걷어낸다.
4. 그럼에도 **정답의 유일성은 유지**한다. 부정이 불가피하면 교정조("not X, but Y")가 아니라
   서술에 녹인 형태로만 쓴다.
5. 대화에서 제안을 줄줄이 기각하지 않는다 — 제안은 1개 이하, 권고는 적극적 이유와 함께.

블록별 구체적 변경 내역은 각 JSON 의 `revisionNote` 와 아래 블록 절에 있다.
`evidence[].whyOthersFail` 도 "화자가 아니라고 말함" 대신 "지문의 어느 사실과 어떻게
충돌하는지"로 rev3 에서 전면 재작성했다.

### rev3 회귀 검증 (실행 결과)

- `node studyground/tests/test_compile_set9.js` → **ALL PASS** (오디오 결손 0, buildWarnings 0,
  `scriptOrigin=authored` 블록 4, 오디오 없는 리스닝 블록/문항 0)
- `node studyground/tests/test_compile_screens.js` → **ALL PASS** (SET 1 회귀 없음)
- `studyground/tests/*.js` 6개 전부 PASS · `pytest studyground/tests` → **82 passed**
- **정답 index 무변경** — 오타 교정 전후 `answerKey` 97항목 및 L2 15문항의 `answer` 를 대조해 차이 0
- 헤드리스 Chrome (`exam-runtime.html?mode=exam&profile=toefl&set=set9#screen=listening.q.L2.04`)
  → 화면 렌더 OK, `<audio src="media/audio/set9/set9-L2-04-05.mp3">`, 페이지 콘솔 에러 0
  (정적 서버의 `/favicon.ico` 404 제외)
- 부정문 잔존 검사 — 4개 지문에서 `not`/`never`/`neither`/`no` 를 전수 훑은 결과,
  **선택지를 직접 지우는 문장은 0건**. 남은 용례는 관용구("You will not believe my morning"),
  정답 근거 자체("in four years I've never seen you counting days..." → L2-7),
  비유 내부 서술("Nobody handed you those sentences in advance" → L2-14 정답 근거)뿐이다.
- 문항→지문 어휘 누출 검사 — 질문문·정답 선택지와 해당 지문 사이의 3-gram 중복 **0건**.
  (오답 쪽 "the sun's", "rock and blues" 2건은 불가피한 내용어이며 정답 쪽이 아니다.)

---

## 원본 docx 오타 교정 (문항 텍스트, 지문과 무관)

blind 검증에서 **`NEW TOEFL MOCK TEST SET  9.docx` 자체의 오타** 6건이 발견됐다.
그중 문법 오류형은 응시자가 내용을 몰라도 **"비문인 선택지를 지우는" test-wiseness** 로
정답을 좁힐 수 있게 만든다. 화면에는 교정본을 쓰되 **원문 표기는 `promptRaw` / `choicesRaw` 에
보존**하고, 문항의 `sourceCorrections[]` 에 사유를 남긴다. 표는 `tools/build_set9.py` 의
`SOURCE_CORRECTIONS` / `SOURCE_NOTES` 에 있으므로 다음 빌드에도 그대로 유지된다.

**선택지 순서는 건드리지 않으므로 정답 index 는 교정 전후 동일하다** (빌드가 assert 로 강제).

| 문항 | 대상 | 원문 (docx) | 교정본 | 사유 |
|---|---|---|---|---|
| `L2-10` | 선택지 [3] | To describe how birds have adapted to modem environments | To describe how birds have adapted to modern environments | docx 원문 오타: modem 은 modern 의 OCR/타이핑 오류. |
| `L2-14` | 질문문 | What is the speaker’s purpose in complaining jazz improvisation to having a conversation? | What is the speaker’s purpose in comparing jazz improvisation to having a conversation? | docx 원문 오타: complaining X to Y 는 성립하지 않는 결합이고, 선택지 4개가 전부 "비유의 목적"을 묻는 형태다 → comparing 의 오타로 확정. 질문 자체가 뜻이 통하지 않으면 문항이 성립하지 않는다. |
| `L2-14` | 선택지 [3] | To explain why jazz feels more natural and accessible than others genres | To explain why jazz feels more natural and accessible than other genres | docx 원문 오타: others genres → other genres. |
| `L2-8` | 선택지 [0] | The physiology adaptations that allows birds to fly long distances | The physiological adaptations that allow birds to fly long distances | docx 원문 오타: 명사 physiology 가 한정어 자리에 쓰였고(→ physiological), 복수주어 adaptations 에 allows 가 붙어 수일치가 깨져 있다(→ allow). 오답 선택지만 비문이면 내용을 몰라도 소거되므로 test-wiseness 누출이다. |
| `L2-8` | 선택지 [3] | The evolutionary origins of migratory behavior in birds species | The evolutionary origins of migratory behavior in bird species | docx 원문 오타: birds species → bird species (복합명사의 앞 요소는 단수). |
| `L2-15` | choices[1] | Classical composers were initially reluctant | **교정하지 않음** | 문장이 미완성으로 보이나 NEW TOEFL MOCK TEST SET  9.docx 의 해당 문단이 그 자리에서 끝난다(런 구성: "B." + " Classical composers were initially reluctant"). 파싱 손실이 아니라 원본이 그렇게 짧다. 뒷부분을 지어낼 수 없으므로 원문을 그대로 둔다. 정답은 [2] 이므로 채점에는 영향이 없다. |

`L2-15` 선택지 [1] 은 원본 docx 를 `zipfile`+`re` 로 직접 다시 파싱해 확인했다.
해당 `<w:p>` 는 런 2개(`"B."` + `" Classical composers were initially reluctant"`)로
그 자리에서 끝난다 — 파싱 손실이나 절단이 아니라 **원본이 그렇게 짧다**. 뒷부분을 지어낼 수
없으므로 원문을 그대로 둔다. 정답은 [2] 이므로 채점에는 영향이 없다.

---

## L2-B2 — Questions 4-5 (`set9-L2-04-05`)

- 종류: **conversation** · 단어수 **245** · 음원 **89.2초**
- 개정 사유: rev3. blind 검증에서 이 블록이 소거법으로 풀린다는 지적을 받아 전면 재집필함. (1) L2-4 오답[3](교수 면담)을 지우던 직접 부정 'I never made it to his door, and we've never exchanged a word. The list did this, not him.' 을 통째로 삭제하고, 대신 자리 배정이 registrar 의 자동 대기열로만 처리되며 Hammond 는 개강 전 월요일에 명단을 '받는' 쪽이라는 사실을 대화 흐름에 심었다 — 교수와의 접촉은 지문 어디에도 근거가 없어 탈락한다. (2) L2-4 오답[2](전공 변경)를 지우던 마지막 턴 'Hardly. I'm still in cognitive science...' 을 삭제하고, 전공 화제 자체를 대화에서 제거했다 — 근거 없음으로 탈락. 여자가 '전공 바꿨냐'는 질문을 부인하는 구조가 사라졌다. (3) L2-4 오답[0](수강 철회)은 'Two students in the class dropped over the weekend' 로 명확히 3인칭 타인의 행위로만 등장하며, 여자 본인은 등록하는 쪽이다. 이전 rev2 의 'I'm not moving a single thing on my schedule' 같은 자기 부정 문장은 제거했다. (4) L2-5 는 남자가 이메일·첫수업 출석·다음 학기 대기 3안을 내고 여자가 셋 다 기각하던 구조를 해체했다. 남자의 제안은 0개이고 open question('What are my odds?')만 던진다. 여자는 대안 과목 등록을 금요일 add-drop 마감·남은 두 과목의 잔여석 소진이라는 적극적 시간 압박 근거와 함께 권한다. 'Here's what actually works' 류의 정답 직전 신호어도 삭제했다. (5) 각 오답이 지문의 서로 다른 사실과 충돌하도록 근거를 분산했다: 이메일 → 자동 대기열/registrar 소관, 첫수업 출석 → 세미나 첫 모임이 3주차이고 명단은 그 전 금요일에 잠김, 대기 → 이번 주 안에 움직이지 않으면 대체 과목 잔여석이 사라짐.

### 지문 전문

```text
W: You will not believe my morning. Six a.m., and the registrar's system sends me a seat confirmation. Sociolinguistics. The Thursday seminar. I read it four times.
M: You're in? That thing filled up before I finished typing my ID number. I'm fourteenth in the queue.
W: I'd stopped watching it, honestly. Two students in the class dropped over the weekend, the queue ran overnight, and it took the next two names off the top. Mine was one of them.
M: Overnight. So it's just the software moving people around.
W: Start to finish. Hammond gets the roster from the registrar the Monday before classes open, and whoever's on it is who he teaches that term.
M: Fourteenth. What are my odds here, realistically?
W: Low enough that you want a second plan moving this week. Look at what else clears the same methods requirement and get yourself registered for one of those before Friday, because Friday is when add-drop shuts. There are two courses that count for it and both were down to single seats yesterday afternoon. If those fill, you're carrying that requirement into next year.
M: And if my number does come up after I've signed for something?
W: Then you release the other one and walk into the seminar. It doesn't meet until week three anyway, and the roster locks the Friday before that, so it's all settled before anyone's in a classroom.
M: Two courses, one week. Right. There's a methods section Tuesday mornings. I'll register for it this afternoon.
```

### 정답 근거 대조표

#### L2-4 (Q4) — 정답키 **1** : She received a spot in a seminar.

> **문항:** What happened to the woman recently?

**정답 근거 문장 (지문에서 그대로):**

> Six a.m., and the registrar's system sends me a seat confirmation. Sociolinguistics. The Thursday seminar. ... the queue ran overnight, and it took the next two names off the top. Mine was one of them.

| # | 선택지 | 판정 | 근거 |
|---|---|---|---|
| 0 | She dropped a linguistics course. | 오답 | 철회한 사람은 이미 수강 중이던 다른 두 학생이며('Two students in the class dropped over the weekend'), 그 결과가 여자의 자리 확보다. 여자는 대기열에서 위로 올라와 등록이 확정된 쪽이므로, 그녀가 무언가를 철회했다는 것은 자리를 얻었다는 지문의 사실관계와 방향이 반대다. 지문에 여자 본인의 철회 행위는 존재하지 않는다. |
| **1** | **She received a spot in a seminar.** | **정답** | 위 근거 문장 |
| 2 | She changed her major to linguistics. | 오답 | 전공 변경은 지문의 어떤 사실과도 연결되지 않는다. 대화 전체가 특정 세미나의 좌석 배정과 금요일 add-drop 마감이라는 등록 절차에 국한되어 있고, 학과·전공·학위 요건 변경을 시사하는 사건이 한 건도 서술되지 않는다. |
| 3 | She met with Professor Hammond. | 오답 | 지문이 그리는 자리 배정 경로는 사람이 아니라 절차다: 새벽에 시스템이 좌석 확정 메일을 보냈고, 대기열이 밤사이 돌아 상위 두 명을 자동으로 올렸으며, Hammond 는 개강 전 월요일에 registrar 로부터 명단을 '받는' 쪽이다. 즉 교수는 여자가 자리를 얻은 시점 이후에야 명단을 보게 되므로, 그와의 면담이 이 사건을 만들어냈다는 선택지는 시간·권한 양면에서 지문과 양립하지 않는다. |

#### L2-5 (Q5) — 정답키 **3** : Prepare an alternative course option

> **문항:** What does the woman suggest the man do?

**정답 근거 문장 (지문에서 그대로):**

> Look at what else clears the same methods requirement and get yourself registered for one of those before Friday... Then you release the other one and walk into the seminar.

| # | 선택지 | 판정 | 근거 |
|---|---|---|---|
| 0 | Email the professor directly | 오답 | 여자가 설명한 배정 구조에서 좌석은 registrar 의 대기열이 야간에 자동 처리하고 교수는 확정된 명단을 나중에 전달받을 뿐이다. 교수에게 보내는 문의는 명단을 만드는 주체에게 닿지 않으므로, 이 선택지는 여자가 제시한 절차 서술과 충돌한다. 또한 여자의 권고는 '금요일 전에 등록하라'는 행위 지시이지 연락 지시가 아니다. |
| 1 | Attend the first class anyway | 오답 | 세미나의 첫 모임은 3주차이고 명단은 그 전 금요일에 이미 잠긴다. 교실에 사람이 모이는 시점에는 등록이 끝나 있으므로 첫 수업에 나타나는 행동은 남자의 문제(금요일까지 요건을 확보하는 것)를 시간상 해결할 수 없다. |
| 2 | Wait until next semester | 오답 | 여자의 근거 전체가 기다림과 반대 방향이다. 같은 요건을 채우는 대체 과목은 두 개뿐이고 전날 이미 잔여석이 한 자리 수준이며, 금요일에 add-drop 이 닫힌다. 이번 주에 움직이지 않으면 요건을 다음 해로 넘기게 된다는 서술과, 다음 학기까지 대기한다는 선택지는 양립할 수 없다. |
| **3** | **Prepare an alternative course option** | **정답** | 위 근거 문장 |

---

## L2-B3 — Questions 6-7 (`set9-L2-06-07`)

- 종류: **conversation** · 단어수 **250** · 음원 **87.8초**
- 개정 사유: rev3. blind 응시자 2명이 rev2 를 '소거법으로 풀린다'고 지적하여 오답 배제 방식을 '화자의 부정' 에서 '사실관계 충돌' 로 전면 교체했다. 항목별 변경: (1) 신호어 제거 — 'So the whole problem is the number.' / 'The whole problem is the number.' 2회 반복 왕복을 통째로 삭제했다. 인상 폭이 걱정거리라는 사실은 이제 남자의 행동과 수치로만 드러난다(봉투를 아홉 번 읽음, 새벽 두 시까지 부엌에서 계산, 사백 달러가 식비+버스 정기권+나머지 전부, 현재 임대료의 약 3분의 1). (2) 오답[2](계약 만료) 직접 부정 제거 — 'My renewal paperwork comes up at the end of the term anyway, so the date isn't what's bothering me.' 를 삭제하고, 갱신은 감정 없는 사실로만 흘렸다: 봉투 안에 9월분 갱신서가 이미 들어 있고 남자는 '오늘 밤에라도 서명할' 상태다. 즉 계약은 만료 위기가 아니라 갱신이 제시된 상태이며, 이 충돌은 응시자가 추론해야 한다. (3) 오답[3](집주인 연락난) 직접 부정 제거 — 'She answered on the second ring... She's reachable.' 를 삭제하고 장면으로 대체했다. 여자가 아무 설명 없이 'Call her tonight. She's downstairs at the desk till eight, same as always.' 라고 전제한다. 접근성에 대한 평가문은 한 줄도 없다. (4) 오답[1](직장이 멀다) 도 부정 없이, 도보 10분이라는 사실 한 줄로만 충돌시킨다. (5) L2-7 은 두 응시자 모두 세트 최고 문항으로 평가했으므로 간접 단서 구조('counting days at the end of the month' / 'yellow notices')를 그대로 보존했다. 다만 이사(강 건너 매물)와 룸메이트(친구 Dana) 소재는 각각 '10분 보다가 탭을 닫았다', 'Dana 가 그랬다' 수준으로 더 눈에 띄지 않게 다듬어 근거 없음 상태를 유지했다. (6) 부정문·신호어 제거로 253→250 단어(대화 상한 250 이내).

### 지문 전문

```text
M: My landlord slid an envelope under my door yesterday. I've read it about nine times since.
W: Nine times. What was in it?
M: Two things. The renewal form for September, which I'd sign tonight if you handed me a pen. And a new figure. Four hundred dollars more a month.
W: Four hundred? On what the lab pays you?
M: It's about a third on top of what I pay now. Four hundred is my groceries, my bus pass, and whatever's left over at the end, all of it. I stood in the kitchen running the arithmetic until two in the morning and it never came out.
W: And you like that apartment.
M: Ten minutes on foot to the lab. I've been in that lab since sophomore year and I've never once had to think about how I'd get there.
W: Then go talk to her before you sign anything. Four years in that unit, and in four years I've never seen you counting days at the end of the month, or peeling one of those yellow notices off your door. That goes in a file somewhere. Two empty months would cost her more than four hundred.
M: Huh. I'd been picturing it as begging.
W: It's the opposite. Call her tonight. She's downstairs at the desk until eight, same as always.
M: I did scroll listings across the river for ten minutes last night, out of spite, and closed the tab. Dana took in two roommates when hers went up.
W: Sign nothing until you've talked to her.
```

### 정답 근거 대조표

#### L2-6 (Q6) — 정답키 **0** : His rent is increasing significantly.

> **문항:** What is the man’s main concern?

**정답 근거 문장 (지문에서 그대로):**

> And a new figure. Four hundred dollars more a month. ... It's about a third on top of what I pay now. Four hundred is my groceries, my bus pass, and whatever's left over at the end, all of it. I stood in the kitchen running the arithmetic until two in the morning and it never came out.

| # | 선택지 | 판정 | 근거 |
|---|---|---|---|
| **0** | **His rent is increasing significantly.** | **정답** | 위 근거 문장 |
| 1 | His apartment is too far from work. | 오답 | 지문의 거리 서술과 충돌한다. 연구실까지 도보 10분이고, 그는 학부 2학년 이래 '어떻게 갈지 생각해 본 적조차 없다'고 말한다. 이동에 드는 비용이 문제였다면 그 집을 오늘 밤이라도 갱신하겠다는 태도가 성립하지 않는다. (화자가 '멀지 않다'고 말해 주는 문장은 없다 — 응시자가 도보 10분이라는 사실에서 추론해야 한다.) |
| 2 | His lease is about to expire. | 오답 | 계약이 만료 위기라는 전제와 충돌한다. 봉투 안에는 9월분 '갱신서(renewal form)'가 이미 들어 있고, 남자는 '펜만 주면 오늘 밤 서명하겠다'고 한다. 즉 계약 연장은 이미 제안된 상태이며 그를 붙잡는 것은 서류가 아니라 금액이다. 마지막 줄에서 여자가 '얘기하기 전엔 서명하지 마라'라고 만류하는 것도, 서명 자체는 언제든 가능하다는 사실을 다시 확인시킨다. 갱신 시점은 감정적 무게 없이 사실로만 등장한다. |
| 3 | His landlord is difficult to contact. | 오답 | 집주인의 접근성에 대한 평가문은 지문에 없고, 대신 장면이 그것을 무너뜨린다. 여자가 아무런 설명이나 조건 없이 '오늘 밤 전화해라, 그 사람 늘 그렇듯 여덟 시까지 아래층 데스크에 있다'고 전제하며, 남자도 이의 없이 넘어간다. 매일 같은 자리에 앉아 있는 사람을 '연락하기 어렵다'고 볼 수 없다. |

#### L2-7 (Q7) — 정답키 **2** : He has a history of paying rent on time.

> **문항:** What can be inferred about the man?

**정답 근거 문장 (지문에서 그대로):**

> Four years in that unit, and in four years I've never seen you counting days at the end of the month, or peeling one of those yellow notices off your door. That goes in a file somewhere. Two empty months would cost her more than four hundred.

| # | 선택지 | 판정 | 근거 |
|---|---|---|---|
| 0 | He plans to move to a new city soon. | 오답 | 지문 속 그의 행동과 충돌한다. 그가 본 매물은 '강 건너', 즉 같은 도시 안이고, 10분 보다가 홧김에 탭을 닫았다. 그리고 그가 실제로 하려는 일은 갱신서에 서명하는 것이다('펜만 주면 오늘 밤 서명하겠다'). 다른 도시로 옮긴다는 계획은 지문 어디에도 근거가 없다. |
| 1 | He recently started a new job. | 오답 | 재직 기간 서술과 충돌한다. 'I've been in that lab since sophomore year' 는 최소 2년 이상 같은 자리라는 뜻이며, 같은 유닛에 4년째 살고 있다는 여자의 말과도 맞물린다. 최근에 새 일을 시작했다면 성립하지 않는 시간선이다. |
| **2** | **He has a history of paying rent on time.** | **정답** | 위 근거 문장 |
| 3 | He prefers to live with roommates. | 오답 | 룸메이트를 들인 주체가 그가 아니다. 임대료가 올랐을 때 두 명을 들인 사람은 친구 Dana 이고, 남자는 그것을 자기 계획으로 제시하지 않으며 여자도 그 문장을 받지 않고 곧장 '얘기하기 전엔 서명하지 마라'로 넘어간다. 그가 4년간 혼자 그 유닛에 살아온 사실과도 어긋난다. |

*설계 메모: 정답은 여전히 직접 진술되지 않는다. '월말에 날짜를 세는 모습을 본 적이 없다', '문에 노란 통지서를 뗀 적이 없다', '집주인 쪽에 그런 기록이 남는다' 라는 세 개의 간접 단서를 종합해야만 '연체 이력이 없다 → 제때 냈다'가 나온다. rev2 대비 이 구조는 손대지 않았고(두 blind 응시자 모두 세트 최고 문항으로 평가), 이사·룸메이트 소재만 눈에 덜 띄게 다듬었다.*

---

## L2-B4 — Questions 8-11 (`set9-L2-08-11`)

- 종류: **talk** · 단어수 **437** · 음원 **167.7초**
- 개정 사유: rev3 — 2차 blind 검증에서 이 블록이 '오답을 부정문으로 직접 지워 소거법으로 풀린다'는 지적을 가장 많이 받아 전면 재집필함. 항목별 변경: (1) L2-8 도입부의 주제 선언('Today is one bird and two questions... the knowing and the failing, are the whole hour')과 오답 선제 배제 두 문장('Last week was the machinery of migration, wingbeat and fat loading, and I won't return to any of it today' / 'Where the habit came from originally is a fine question for another week')을 통째로 삭제했다. 대신 새 한 마리의 여정을 제시한 뒤 곧바로 항법(2~3문단)과 위협(4~5문단)을 실제로 다룬다. 오답 [0] 생리적 적응과 [3] 진화적 기원은 지문에 아예 등장하지 않으므로 근거 부재로 탈락하고, [1] 먹이 계절성은 마지막 한 문단(전체의 5분의 1)에만 나오므로 비중으로 탈락한다. (2) L2-9 의 'They read the pattern the whole sky makes, not any single star' 를 삭제했다(응시자 A 가 이 부정문 때문에 오히려 정답 선택지에서 멀어질 뻔했다고 지적). 플라네타륨 실험은 투영 하늘을 회전시키자 새들이 따라 돌아 새 방위를 유지했다는 '장면'만 남겼다. 오답 [2] 지형지물은 부정문 대신 '자정 2000미터 상공에서는 아래가 끊김 없는 어둠 한 덩어리'라는 묘사와, 지형지물이 2문단에서 처음부터 주간 수단으로만 배정된다는 사실 배치로 충돌 탈락시킨다. 'Sun's magnetic field' 라는 표현은 지문에 쓰지 않고 태양 위치와 지구 자기장을 서로 다른 문장에 분리했다. (3) L2-10 의 'A warbler on a downtown ledge at sunrise is not there because the ledge suits it, or because the city shelters it'(한 문장이 오답 [1][2] 를 동시에 제거하던 최우선 삭제 대상)을 없앴다. 대신 새벽 난간의 휘파람새를 '스스로 몸을 띄우지 못해 사람 손에 주워 담기는' 탈진 상태로 묘사해 '난간이 마음에 들어서'([1])나 '도시가 피난처라서'([2])와 내용상 양립 불가능하게 했다. 'Nothing in a bird's history prepares it...' 와 'the bill for our construction is paid by them'(정답 선택지 취지를 그대로 진술) 도 삭제하고, 유리 건물의 주간 반사 충돌·야간 조명 유인을 사실 서술로만 남겼다. (4) L2-11 의 'the northern breeding ground, not the tropics where they winter' 교정조를 삭제했다. 번식지는 1문단의 캐나다 가문비나무 숲, 5문단의 boreal forest 로 일관되게 북부로만 묘사하고, 열대(Central America)는 1문단에서 '9월에 내려가 겨울을 나는 곳'으로만 따로 등장시켜 오답 [3] 이 충돌로 탈락하게 했다. 결론 문장 'Do the arithmetic: the nestlings... arrive at a table already cleared' 도 삭제하고 전제 두 개(4월 일조시간은 100년 전 그대로라 도착일이 고정 / 온난화로 애벌레 정점이 앞당겨짐)만 남겨 응시자가 결합 추론하도록 했다. (5) 정답 직전 신호어 제거 및 493→437단어로 축소.

### 지문 전문

```text
A blackpoll warbler weighs less than a candy bar. Some evening in September it lifts out of a spruce forest in northern Canada, and weeks later it drops into the same few acres of Central America where it spent the previous winter. So let's take up the steering.

By day a migrant has references we would recognize. The sun's position, read against an internal clock that stays accurate to within minutes. And the ground underneath: a coastline, a river cut, a ridge running the right way, which a bird can follow the way you would follow a highway. Underneath both of those is a magnetic sense, and the Earth's field gives a rough bearing even through heavy cloud.

Most songbirds, though, do their traveling between dusk and dawn. Two thousand meters up at midnight, what lies below is one unbroken dark, and the shoreline that served so well at noon is somewhere down inside it. What the bird still has is overhead. In the planetarium work of the sixties, warblers kept indoors settled onto their normal autumn heading under a projected sky, and when the projector was turned, the birds swung around with it and held the new bearing. It was the arrangement above them they were steering by.

Now, a tower sheathed in glass does two things to a night migrant. In daylight the glass hands back a copy of the sky and the trees behind the bird, and the bird flies hard into what it reads as open air. Collisions with buildings kill birds by the hundreds of millions a year in North America alone. On an overcast night the lit floors of that same tower pull migrants off their line, and they circle the glow for hours, spending fuel they were carrying for a thousand kilometers of flight. Walk downtown at sunrise in May and you will find a warbler on a window ledge too spent to lift itself off the stone. Volunteers pick those birds up by hand, one at a time, and carry them out in paper bags.

There is one more pressure, and it works more slowly. The trip north runs off the same clock. Day length starts them out of the wintering grounds, and April day length is exactly what it was a century ago, so they reach the boreal forest on the old date and their chicks hatch on the old date. That forest, though, is warming. Spring there now opens a week or two ahead of where it sat forty years ago, and caterpillars take their cue from temperature. They hatch, and they peak, on the new spring.
```

### 정답 근거 대조표

#### L2-8 (Q8) — 정답키 **2** : The navigation methods birds use and challenges to migration

> **문항:** What aspect of bird behavior does the speaker mainly discuss in this talk?

**정답 근거 문장 (지문에서 그대로):**

> By day a migrant has references we would recognize. ... Most songbirds, though, do their traveling between dusk and dawn. ... Now, a tower sheathed in glass does two things to a night migrant. ... There is one more pressure, and it works more slowly.

| # | 선택지 | 판정 | 근거 |
|---|---|---|---|
| 0 | The physiological adaptations that allow birds to fly long distances | 오답 | 생리적 적응(비행 근육, 지방 축적, 대사 등)은 지문 어디에도 등장하지 않는다. 새의 몸에 대한 유일한 언급은 1문단의 무게 비유와 4문단의 탈진 묘사이며, 둘 다 적응 기제를 설명하지 않는다. 근거가 존재하지 않아 탈락한다. |
| 1 | The seasonal patterns of food availability in different regions | 오답 | 먹이 계절성은 마지막 문단에만 나오고 5개 문단 중 1개, 그것도 'one more pressure' 로 도입되는 하위 소재다. 앞의 세 문단은 먹이를 전혀 다루지 않으므로 강의 전체의 주제가 될 수 없다. |
| **2** | **The navigation methods birds use and challenges to migration** | **정답** | 위 근거 문장 |
| 3 | The evolutionary origins of migratory behavior in bird species | 오답 | 이동 습성의 진화적 기원은 지문에서 한 번도 화제가 되지 않는다. 지문은 새가 지금 무엇을 단서로 삼는지(현재의 기제)와 지금 무엇이 그 기제를 무너뜨리는지만 서술하며, 그 습성이 어떻게 생겨났는지는 질문조차 되지 않는다. |

*설계 메모: 주제 문항이므로 단일 근거 문장이 없다 — 위 네 줄은 강의의 골격이고, 정답은 그 종합으로만 성립한다. 2~3문단이 주간 단서(태양 위치·지형지물·자기장)와 야간 단서(플라네타륨 실험, 머리 위 배치)를 다루고, 4~5문단이 유리 건물 충돌·야간 조명 유인·번식지 온난화라는 위협을 다룬다. 화자는 어느 지점에서도 오늘의 주제를 선언하지 않는다. (rev3 정비: 이 필드에는 지문 원문만 들어가야 하는데 rev2→rev3 개정 때 해설이 들어가 gen_set9_authored_doc.py 의 '근거 문장이 지문에 존재하는가' 검사를 깨뜨렸다. 해설은 이 메모로 옮겼다.)*

#### L2-9 (Q9) — 정답키 **3** : Observing positions of stars

> **문항:** According to the speaker, which navigation method do migrating birds use during nighttime travel?

**정답 근거 문장 (지문에서 그대로):**

> In the planetarium work of the sixties, warblers kept indoors settled onto their normal autumn heading under a projected sky, and when the projector was turned, the birds swung around with it and held the new bearing. It was the arrangement above them they were steering by.

| # | 선택지 | 판정 | 근거 |
|---|---|---|---|
| 0 | Detecting changes in air temperature | 오답 | 기온은 항법 단서 목록(태양 위치, 지형지물, 자기장, 머리 위 하늘)에 들어 있지 않다. 지문에서 온도가 나오는 유일한 자리는 5문단의 애벌레 부화 시점이며, 항법이 아니라 먹이 시기를 지배하는 변수로 서술된다. 항법 단서로 쓰였다면 야간에 방위를 유지할 수 있어야 하는데 지문은 그런 역할을 온도에 부여한 적이 없다. |
| 1 | Following the Sun’s magnetic field patterns | 오답 | 지문은 태양과 자기장을 서로 다른 문장에서 별개의 것으로 서술한다. 태양은 '위치를 체내 시계에 대조해 읽는' 주간 단서이고, 자기장은 'the Earth's field' 로 지구에 귀속된다. 태양에 자기장을 귀속시키는 서술은 지문의 이 두 문장과 동시에 성립할 수 없다. |
| 2 | Recognizing landscape features below | 오답 | 지형지물(해안선·강줄기·능선)은 2문단에서 'By day' 로 시작하는 주간 단서로 배정된다. 3문단은 명금류가 해질녘부터 새벽까지 이동한다는 사실과, 자정 2000미터 상공에서 아래가 끊김 없는 어둠 한 덩어리이고 정오에 유용했던 해안선이 그 안 어딘가에 있다는 상황을 제시한다. 야간 비행 중 지형지물을 읽는다는 답은 이 두 사실과 양립하지 않는다. |
| **3** | **Observing positions of stars** | **정답** | 위 근거 문장 |

#### L2-10 (Q10) — 정답키 **0** : To give an example of how human development harms migrating birds

> **문항:** Why does the speaker discuss glass buildings in relation to bird migration?

**정답 근거 문장 (지문에서 그대로):**

> In daylight the glass hands back a copy of the sky and the trees behind the bird, and the bird flies hard into what it reads as open air. Collisions with buildings kill birds by the hundreds of millions a year in North America alone. On an overcast night the lit floors of that same tower pull migrants off their line, and they circle the glow for hours, spending fuel they were carrying for a thousand kilometers of flight.

| # | 선택지 | 판정 | 근거 |
|---|---|---|---|
| **0** | **To give an example of how human development harms migrating birds** | **정답** | 위 근거 문장 |
| 1 | To explain why birds prefer to rest on artificial structures | 오답 | 인공 구조물을 선호한다는 답은 난간 위 새의 상태와 충돌한다. 그 새는 돌에서 몸을 띄우지도 못할 만큼 소진돼 있고 자원봉사자가 손으로 주워 종이봉투에 담아 내보낸다. 스스로 고른 자리에 앉아 있는 새의 모습이 아니라, 밤새 불빛 주위를 돌며 연료를 다 쓴 뒤 더 갈 수 없어 멈춘 자리다. |
| 2 | To suggest that urban areas provide shelter for migratory species | 오답 | 도시가 피난처라는 답은 이 문단이 도시에 귀속시킨 유일한 두 작용과 충돌한다. 낮에는 유리가 하늘과 나무를 되비쳐 새를 정면 충돌시키고, 밤에는 불 켜진 층이 새를 항로에서 끌어낸다. 북미에서만 연간 수억 마리가 건물 충돌로 죽는다는 수치가 제시되는 곳을 보호처로 볼 수 없다. |
| 3 | To describe how birds have adapted to modern environments | 오답 | 도시 환경 적응이라는 답은 사망 규모와 충돌한다. 적응이 성립했다면 같은 자극이 반복적으로 치명적일 수 없는데, 지문의 새들은 낮에는 반사된 하늘을 열린 하늘로 계속 오독하고 밤에는 조명에 계속 끌려 들어간다. |

#### L2-11 (Q11) — 정답키 **1** : Misaligned timing between arrival and food sources threatens birds

> **문항:** Based on the talk, what can be inferred about the effects of climate change on bird migration?

**정답 근거 문장 (지문에서 그대로):**

> Day length starts them out of the wintering grounds, and April day length is exactly what it was a century ago, so they reach the boreal forest on the old date and their chicks hatch on the old date. ... Spring there now opens a week or two ahead of where it sat forty years ago, and caterpillars take their cue from temperature. They hatch, and they peak, on the new spring.

| # | 선택지 | 판정 | 근거 |
|---|---|---|---|
| 0 | Birds developing new navigation systems to cope with changes | 오답 | 새로운 항법 체계를 개발하고 있다는 답은 5문단의 전제와 충돌한다. 이 새들은 여전히 100년 전과 같은 일조시간 신호로 출발해 예년과 같은 날짜에 번식지에 닿는다. 단서를 바꾼 흔적이 없고, 4문단에서도 반사된 하늘을 계속 열린 하늘로 읽는다. |
| **1** | **Misaligned timing between arrival and food sources threatens birds** | **정답** | 위 근거 문장 |
| 2 | Warmer temperatures have made migration unnecessary for most species | 오답 | 이동이 더는 필요 없어졌다는 답은 지문 전체와 충돌한다. 새들은 여전히 9월에 캐나다를 떠나 중미로 내려가고 봄에 북쪽으로 돌아오며, 5문단은 그 왕복이 계속된다는 것을 전제로 시기 문제를 설명한다. |
| 3 | Climate shifts affect birds in tropical breeding grounds | 오답 | 열대 번식지라는 답은 지문의 지리 배치와 충돌한다. 번식과 육추가 일어나는 곳은 1문단의 캐나다 가문비나무 숲이자 5문단의 boreal forest 이고, 온난화가 일어난다고 서술된 곳도 그 숲이다. 중미 열대는 1문단에서 9월에 내려가 겨울을 나는 곳으로만, 5문단에서 'the wintering grounds' 로만 등장한다. |

*설계 메모: 정답은 두 전제를 응시자가 직접 이어야 나온다. (a) 출발 신호인 4월 일조시간이 100년 전 그대로여서 도착일과 부화일이 고정돼 있다. (b) 번식지가 따뜻해져 애벌레의 부화·정점이 앞당겨졌다. 화자는 결론을 말하지 않는다. rev2 의 'Do the arithmetic: the nestlings... arrive at a table already cleared' 는 결론을 넘겨주므로 삭제했다.*

---

## L2-B5 — Questions 12-15 (`set9-L2-12-15`)

- 종류: **talk** · 단어수 **446** · 음원 **174.2초**
- 개정 사유: rev3. blind 검증에서 '오답 선택지를 먼저 만들고 그 부정문을 지문에 심은 흔적'이 지적되어, 오답을 부정문으로 지우던 설계를 전부 걷어내고 '충돌 또는 근거 없음'으로만 탈락하도록 다시 씀. 항목별: (1) L2-12 — 도입부의 논지 선언('By the time you leave I want two things settled: what a player is actually doing... and why a band is built around that moment')을 삭제. 또한 오답 두 개를 한 문장 묶음으로 지우던 'I am not going to tell you where the music came from, and I am not going to tell you what your hands should be doing on a horn or a keyboard' 를 통째로 삭제했다. 이제 강의는 주제를 선언하지 않고, 솔로 순간의 실제 작동·그것을 감싸는 규칙 틀·그 방식의 확산을 차례로 '실연'하며, 응시자가 전체를 종합해야 주제에 도달한다. 연주 기술(오답0)과 역사 비교(오답1)는 지문에 아예 다뤄지지 않아 탈락한다. (2) L2-13 — 'the blank page is not the difficulty, and neither is the harmony', 'It is not a feat of memory either', 'Here is the difficulty' 를 전부 삭제. 대신 장면으로 대체했다: 연주자가 오후에 집에서 다섯째 마디용 프레이즈를 짜 두었는데, 실연에서 베이스가 박자를 뒤로 놓고 드러머가 앞서 나가며 피아니스트가 다섯째 마디에 다른 코드를 대입해, 준비해 둔 프레이즈가 걸릴 마디 자체가 사라진다. 암기(오답0)는 '아니라고 선언'되는 대신 장면과 양립 불가능해진다. 화성 복잡도(오답1)와 악보 해석(오답2)은 이제 지문에서 아예 언급되지 않는다 — 특히 오답2를 지우던 'There is no written part for a solo, nothing on the page saying which note comes next' 문장을 삭제했고, 3문단의 'students hear that nothing is written down' 도 'students hear the word improvisation' 으로 바꿔 표기법 화제를 지문에서 완전히 제거했다. (3) L2-14 — 오답2를 직접 부정하던 'I am not making a point about two people trading turns; I am making a point about the rules neither of you is allowed to drop' 와 목적 선언 'That arrangement is the only reason I bring the comparison up' 을 삭제. 대신 비유 자체를 한 사람의 발화로 다시 썼다(룸메이트에게 주말 얘기를 '내가' 한다). 주고받기 요소가 비유에서 사라졌으므로 오답2는 부정 없이 근거를 잃는다. 비유의 내용은 '단어는 즉석에서 고르지만 문법과 문장의 완결은 유지된다'로, 자유+틀이라는 취지가 서술만으로 드러난다. 개성(오답1)은 종전대로 다음 문단의 별개 논점으로 유지. (4) L2-15 — 결론을 넘겨주던 서술과 두 개의 직접 부정, 즉 'the crowds turned up for it exactly as they always had'(오답3)와 'These were not people sitting in theory classes... They picked it up by ear, off the records'(오답0)를 삭제. 1935년 댄스밴드 장면을 담백한 서술로만 남겨 오답0·3이 근거 없음으로 탈락하게 했다. (5) 부정문 제거로 분량이 543 → 446단어로 줄어 규격(300~450) 안에 들어왔다.

### 지문 전문

```text
Every book on jazz gets to the same word by about page three. Improvisation. It gets used loosely, so let's look at where it actually happens: the bandstand.

So picture the second set. The tune comes around and it is your turn to step out. That afternoon, in your apartment, you worked something out that you liked, a climbing figure you were saving for the fifth bar. You get eight bars in and the bass player starts placing the beat later than you expected. The drummer leans ahead of him. The pianist arrives at the fifth bar and substitutes a chord from somewhere else entirely, and your climbing figure now belongs to a bar that has stopped existing. Whatever comes out of your horn next has to come out in the same second all of that reaches you; you are still holding a note while you decide. That is the job up there. You are taking in four other people continuously and bending the line you are already in the middle of so that it fits what they just did to it.

Now, students hear the word improvisation and take it to mean anything goes. So consider breakfast. You sit down and start telling your roommate about your weekend. Nobody handed you those sentences in advance. You pick the words as you go, and starting a sentence you have no clear idea how you will land it. And yet the grammar holds all the way through, and you finish the thought you opened, or your roommate stops following you. The freedom lives inside a set of things you keep. On the bandstand those things are the key, the chord changes, the form, and how many bars before the whole thing comes around again. All of it is settled before anyone plays. What goes inside it is yours. Made up as you go, yes. Made up out of thin air, no.

And because what goes inside is yours, a strong improviser is recognizable in about four notes. The phrasing is as particular as handwriting. This way of working also spread outward. Picture a dance band in 1935, before recordings circulated widely. You played the arrangement. The arrangement was the point. Tuesday's version and Saturday's version were the same version, and what a listener weighed was how cleanly a settled piece had been executed. The concert hall ran on that same principle and largely still does. Then the records got around, and by the sixties you had rock and blues bands leaving whole stretches of a song open, a chorus where the notes had been fixed by nobody in advance and the thing came out different every night.
```

### 정답 근거 대조표

#### L2-12 (Q12) — 정답키 **3** : The nature and function of improvisation in jazz performance

> **문항:** What is the speaker primarily explaining in this talk about jazz music?

**정답 근거 문장 (지문에서 그대로):**

> Every book on jazz gets to the same word by about page three. Improvisation. It gets used loosely, so let's look at where it actually happens: the bandstand.

| # | 선택지 | 판정 | 근거 |
|---|---|---|---|
| 0 | The technical skills required to master jazz instruments | 오답 | 연주 기술 향상 방법과 충돌한다. 지문은 손·주법·연습법을 한 번도 다루지 않고, 유일하게 나오는 개인 연습 장면('That afternoon, in your apartment, you worked something out')조차 그 준비물이 실연에서 무력해지는 사례로 쓰인다. 기술 습득을 가르치는 강의라면 그 준비를 살려 써야 하므로 양립하지 않는다. |
| 1 | How jazz developed differently from classical music traditions | 오답 | 재즈와 클래식의 발전사 비교와 충돌한다. concert hall 은 1935년 댄스밴드와 나란히 '고정된 악곡을 연주하던 관행'의 예로 한 문장 등장할 뿐이고, 그 문장에도 재즈의 역사적 기원·시대 구분·양자 대조 서술이 없다. 발전사 비교 강의라면 필수인 연대기 자체가 지문에 존재하지 않는다. |
| 2 | The way jazz musicians collaborate with their audiences | 오답 | 연주자와 청중의 협업과 충돌한다. 지문에서 상호작용이 일어나는 상대는 시종 밴드 내부의 네 명(베이스·드럼·피아노)이고, 청중이 나오는 단 한 대목('what a listener weighed')에서 청중은 완성된 연주를 사후에 평가하는 쪽이지 연주에 참여하는 쪽이 아니다. |
| **3** | **The nature and function of improvisation in jazz performance** | **정답** | 위 근거 문장 |

#### L2-13 (Q13) — 정답키 **3** : They must listen and respond to other players instantaneously

> **문항:** According to the speaker, what makes jazz improvisation particularly demanding for musicians?

**정답 근거 문장 (지문에서 그대로):**

> Whatever comes out of your horn next has to come out in the same second all of that reaches you; you are still holding a note while you decide. ... You are taking in four other people continuously and bending the line you are already in the middle of so that it fits what they just did to it.

| # | 선택지 | 판정 | 근거 |
|---|---|---|---|
| 0 | They must memorize numerous melodic variations before performing | 오답 | 장면과 정면으로 충돌한다. 연주자는 실제로 프레이즈를 미리 준비했지만, 베이스가 박자를 뒤로 밀고 피아니스트가 다섯째 마디에 다른 코드를 대입하는 순간 '그 프레이즈가 걸릴 마디 자체가 사라진다'. 즉 지문은 암기해 둔 자료가 실연에서 쓸모없어지는 과정을 보여주므로, 암기가 요구되는 능력이라는 해석은 성립할 수 없다. |
| 1 | Chord progressions in jazz are more complex than in other genres | 오답 | 근거가 없다. 지문은 화성을 '미리 합의되어 고정된 것(the key, the chord changes ... settled before anyone plays)'으로만 취급하고, 진행의 난이도나 복잡성은 어디에서도 화제가 되지 않는다. 어려움의 소재는 화성이 아니라 그것이 실시간으로 어긋나는 순간이다. |
| 2 | Written scores require different interpretations at each concert | 오답 | 근거가 없다. 지문 전체에 악보·기보·페이지에 대한 언급이 한 마디도 없다. 솔로에 관해 서술되는 행위는 듣기와 즉각적인 응답뿐이다. |
| **3** | **They must listen and respond to other players instantaneously** | **정답** | 위 근거 문장 |

#### L2-14 (Q14) — 정답키 **0** : To illustrate how improvisation combines freedom with underlying structure

> **문항:** What is the speaker’s purpose in comparing jazz improvisation to having a conversation?

**정답 근거 문장 (지문에서 그대로):**

> You pick the words as you go, and starting a sentence you have no clear idea how you will land it. And yet the grammar holds all the way through, and you finish the thought you opened, or your roommate stops following you. The freedom lives inside a set of things you keep.

| # | 선택지 | 판정 | 근거 |
|---|---|---|---|
| **0** | **To illustrate how improvisation combines freedom with underlying structure** | **정답** | 위 근거 문장 |
| 1 | To emphasize that each musician develops a distinctive personal voice | 오답 | 비유의 내용과 충돌한다. 비유가 드는 두 항목(문법, 문장의 완결)은 화자마다 달라지는 특징이 아니라 누구에게나 동일하게 적용되는 공통 제약이다. 개인 고유성 논점은 비유가 끝난 뒤 다음 문단에서 별개 소재('recognizable in about four notes ... as particular as handwriting')로 따로 제시된다. |
| 2 | To suggest that performers exchange musical ideas with one another | 오답 | 비유의 구성과 충돌한다. 이 비유에서 말하는 사람은 처음부터 끝까지 한 명이다. 룸메이트는 발화를 주고받는 상대가 아니라 이해가 끊기는지를 가늠하는 청자로만 등장하므로, 두 연주자가 아이디어를 교환한다는 취지를 이 장면에서 끌어낼 근거가 없다. |
| 3 | To explain why jazz feels more natural and accessible than other genres | 오답 | 비유의 귀결과 충돌한다. 대화 비유가 도달하는 지점은 '자유가 유지되는 항목들 안에 놓여 있다'이고, 곧이어 재즈 쪽에도 동일하게 사전 고정 항목(key, changes, form, 마디 수)이 열거된다. 즉 비유는 재즈가 더 자연스럽거나 쉽다는 쪽이 아니라 제약이 동등하게 존재한다는 쪽으로 닫힌다. |

#### L2-15 (Q15) — 정답키 **2** : Other genres previously placed greater emphasis on performing fixed compositions

> **문항:** What can be inferred from the discussion about how jazz influenced other musical genres?

**정답 근거 문장 (지문에서 그대로):**

> Picture a dance band in 1935, before recordings circulated widely. You played the arrangement. The arrangement was the point. Tuesday's version and Saturday's version were the same version, and what a listener weighed was how cleanly a settled piece had been executed. The concert hall ran on that same principle and largely still does.

| # | 선택지 | 판정 | 근거 |
|---|---|---|---|
| 0 | Rock and blues musicians formally studied jazz theory before changing their approach | 오답 | 근거가 없다. 지문은 다른 장르 연주자들이 무엇을 어떻게 배웠는지, 이론 교육을 받았는지 여부를 한 번도 다루지 않는다. 1935년 장면에서 서술되는 것은 학습 경로가 아니라 무엇이 평가 대상이었는가(연주의 정확성)뿐이다. |
| 1 | Classical composers were initially reluctant | 오답 | 지문의 서술과 충돌한다. concert hall 은 즉흥을 놓고 망설이는 주체로 나오지 않고, 고정된 악곡 연주라는 원칙을 '지금도 대체로 유지하는' 사례로 제시된다. 즉 지문이 concert hall 에 대해 진술하는 것은 태도나 판단이 아니라 관행의 지속이다. |
| **2** | **Other genres previously placed greater emphasis on performing fixed compositions** | **정답** | 위 근거 문장 |
| 3 | Audiences in rock and blues gradually lost interest in predictable performances | 오답 | 근거가 없다. 즉흥이 도입된 뒤의 청중 반응은 지문에 전혀 서술되지 않는다. 청중이 언급되는 유일한 대목은 1935년 이전 상황의 평가 기준이며, 60년대 대목에서 서술되는 것은 밴드가 무엇을 했는가(곡 안에 미정 구간을 남겼다)와 그 결과 연주가 매일 달라졌다는 사실뿐이다. |

*설계 메모: 정답을 요약 문장으로 진술하지 않고 1935년 댄스밴드라는 구체 장면으로만 제시해, 일반화를 거쳐야 선택지에 도달하도록 했다.*

---

*지문 원문의 단일 진실원천은 `sg2/config/_set9_l2/*.json` 이며, 이 문서는
`tools/gen_set9_authored_doc.py` 가 그 파일들에서 생성한 읽기용 사본이다.*
