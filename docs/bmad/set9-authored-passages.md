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
| `L2-B2` | Questions 4-5 | conversation | 112 | `media/audio/set9/set9-L2-04-05.mp3` | 919 KB | 92.8 s |
| `L2-B3` | Questions 6-7 | conversation | 97 | `media/audio/set9/set9-L2-06-07.mp3` | 756 KB | 80.2 s |
| `L2-B4` | Questions 8-11 | talk | 300 | `media/audio/set9/set9-L2-08-11.mp3` | 1,728 KB | 179.2 s |
| `L2-B5` | Questions 12-15 | talk | 306 | `media/audio/set9/set9-L2-12-15.mp3` | 1,520 KB | 151.5 s |

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

- 종류: **conversation** · 단어수 **112** · 음원 **92.8초**
- 개정 사유: rev4 — 집필본 폐기, 원본 전사로 전면 교체. rev1~rev3 의 blind 검증 대응(소거법 차단, 오답 근거 분산 등)은 집필본을 전제로 한 작업이므로 함께 폐기했다. 원본은 원본 그대로 둔다 — 문제 난도나 오답 매력도를 이유로 원문을 손보지 않는다. 정답키 대조는 evidence[] 에 남겼고, 네 블록 12문항 모두 원문에 직접 근거가 있다.

### 지문 전문

```text
Hey, did you manage to get into Professor Hammond’s linguistics seminar? I know it fills up fast. Not initially. I was number four on the waitlist, but I just got an email saying a spot opened up. That’s great news! I’m still stuck at number seven. I’m keeping my fingers crossed, but I’m not holding my breath. You might want to have a backup plan. The add/drop deadline is next Friday, and the list doesn’t usually move that quickly. Yeah, I’ve been looking at a sociolinguistics course as an alternative. It fits my schedule, but it’s not my first choice. Well, sometimes those unexpected courses turn out to be the best ones.
```

### 정답 근거 대조표

#### L2-4 (Q4) — 정답키 **1** : She received a spot in a seminar.

> **문항:** What happened to the woman recently?

**정답 근거 문장 (지문에서 그대로):**

> I was number four on the waitlist, but I just got an email saying a spot opened up.

| # | 선택지 | 판정 | 근거 |
|---|---|---|---|
| 0 | She dropped a linguistics course. | 오답 | 수강 철회는 대화에 없다. 여자는 대기자 명단에서 자리를 '받은' 쪽이고, 강좌를 뺀 사람 이야기는 나오지 않는다. |
| **1** | **She received a spot in a seminar.** | **정답** | 위 근거 문장 |
| 2 | She changed her major to linguistics. | 오답 | 전공 변경은 화제가 아니다. 언급되는 것은 세미나 한 자리와 대안 과목뿐이다. |
| 3 | She met with Professor Hammond. | 오답 | Hammond 교수는 세미나의 담당자로 이름만 나오고, 만남·면담은 어디에도 없다. 자리는 이메일 통보로 났다. |

#### L2-5 (Q5) — 정답키 **3** : Prepare an alternative course option

> **문항:** What does the woman suggest the man do?

**정답 근거 문장 (지문에서 그대로):**

> You might want to have a backup plan. The add/drop deadline is next Friday, and the list doesn’t usually move that quickly.

| # | 선택지 | 판정 | 근거 |
|---|---|---|---|
| 0 | Email the professor directly | 오답 | 교수에게 이메일을 보내라는 제안은 없다. 이메일은 여자가 '받은' 자리 통보일 뿐 남자의 행동 방안이 아니다. |
| 1 | Attend the first class anyway | 오답 | 첫 수업에 그냥 들어가 보라는 말은 나오지 않는다. 여자가 드는 시한은 add/drop 마감이지 개강일이 아니다. |
| 2 | Wait until next semester | 오답 | 다음 학기까지 기다리라는 말은 없다. 여자는 오히려 다음 주 금요일 마감 전에 움직이라는 쪽이다. |
| **3** | **Prepare an alternative course option** | **정답** | 위 근거 문장 |

---

## L2-B3 — Questions 6-7 (`set9-L2-06-07`)

- 종류: **conversation** · 단어수 **97** · 음원 **80.2초**
- 개정 사유: rev4 — 집필본 폐기, 원본 전사로 전면 교체. rev1~rev3 의 blind 검증 대응(소거법 차단, 오답 근거 분산 등)은 집필본을 전제로 한 작업이므로 함께 폐기했다. 원본은 원본 그대로 둔다 — 문제 난도나 오답 매력도를 이유로 원문을 손보지 않는다. 정답키 대조는 evidence[] 에 남겼고, 네 블록 12문항 모두 원문에 직접 근거가 있다.

### 지문 전문

```text
My landlord just sent me a notice about renewing my lease. The rent is going up by 15 percent. Ouch. That’s a pretty steep increase. Are you going to stay? I’m torn. The location is perfect—it’s a stone’s throw from my office—but that’s a lot more money every month. Have you thought about negotiating? Sometimes landlords are willing to meet you halfway, especially if you’ve been a reliable tenant. That’s not a bad idea. I’ve never missed a payment in three years. Maybe I can use that as leverage. Exactly. The worst they can say is no.
```

### 정답 근거 대조표

#### L2-6 (Q6) — 정답키 **0** : His rent is increasing significantly.

> **문항:** What is the man’s main concern?

**정답 근거 문장 (지문에서 그대로):**

> The rent is going up by 15 percent.

| # | 선택지 | 판정 | 근거 |
|---|---|---|---|
| **0** | **His rent is increasing significantly.** | **정답** | 위 근거 문장 |
| 1 | His apartment is too far from work. | 오답 | 위치는 오히려 장점으로 서술된다 — 'The location is perfect—it’s a stone’s throw from my office'. |
| 2 | His lease is about to expire. | 오답 | 계약은 갱신 통지를 받은 상태이고, 만료가 걱정거리로 제시되지 않는다. 걱정의 대상은 갱신 조건(인상액)이다. |
| 3 | His landlord is difficult to contact. | 오답 | 집주인과 연락이 안 된다는 서술은 없다. 오히려 먼저 통지를 보내 왔고, 여자는 협상을 권한다. |

#### L2-7 (Q7) — 정답키 **2** : He has a history of paying rent on time.

> **문항:** What can be inferred about the man?

**정답 근거 문장 (지문에서 그대로):**

> I’ve never missed a payment in three years.

| # | 선택지 | 판정 | 근거 |
|---|---|---|---|
| 0 | He plans to move to a new city soon. | 오답 | 이사 계획은 나오지 않는다. 남자는 남을지 말지를 저울질하는 단계다. |
| 1 | He recently started a new job. | 오답 | 새 직장 이야기는 없다. 사무실은 3년째 다니는 곳으로 전제되어 있다. |
| **2** | **He has a history of paying rent on time.** | **정답** | 위 근거 문장 |
| 3 | He prefers to live with roommates. | 오답 | 룸메이트는 대화에 등장하지 않는다. |

---

## L2-B4 — Questions 8-11 (`set9-L2-08-11`)

- 종류: **talk** · 단어수 **300** · 음원 **179.2초**
- 개정 사유: rev4 — 집필본 폐기, 원본 전사로 전면 교체. rev1~rev3 의 blind 검증 대응(소거법 차단, 오답 근거 분산 등)은 집필본을 전제로 한 작업이므로 함께 폐기했다. 원본은 원본 그대로 둔다 — 문제 난도나 오답 매력도를 이유로 원문을 손보지 않는다. 정답키 대조는 evidence[] 에 남겼고, 네 블록 12문항 모두 원문에 직접 근거가 있다.

### 지문 전문

```text
Alright, so today we’re going to look at one of the most remarkable phenomena in the animal kingdom—bird migration. Now, many bird species travel thousands of miles each year, and the question is, how exactly do they do this? Well, birds rely on several different navigation systems working together. They use the sun’s position during the day to orient themselves, tracking how it moves across the sky. At night, they actually follow star patterns—particularly the North Star and surrounding constellations. Additionally, many species can detect Earth’s magnetic field through special proteins in their eyes, which essentially gives them a built-in compass. Some researchers believe birds may even use smell to recognize familiar landscapes, though this is still being studied. Now, why do birds go through all this trouble? Basically, it comes down to survival. They’re moving between breeding grounds in temperate regions and feeding areas in warmer climates. This seasonal movement allows them to take advantage of food resources that vary throughout the year. For instance, insects are abundant in northern areas during summer but disappear in winter, so insect-eating birds must travel south to find food. However, here’s where things get problematic. Human activities are increasingly disrupting these ancient migration routes. Light pollution from cities confuses birds that navigate by starlight, causing them to become disoriented and exhausted as they circle illuminated buildings. Building designs, particularly glass structures, pose another serious threat—birds can’t see glass and fly directly into windows, leading to millions of collisions annually. Climate change is also shifting the timing of food availability, which means birds may arrive at their destinations only to find their food sources, like certain insects or plants, haven’t appeared yet. These disruptions can have serious ecological consequences, potentially threatening entire populations that have followed the same routes for thousands of years.
```

### 정답 근거 대조표

#### L2-8 (Q8) — 정답키 **2** : The navigation methods birds use and challenges to migration

> **문항:** What aspect of bird behavior does the speaker mainly discuss in this talk?

**정답 근거 문장 (지문에서 그대로):**

> Well, birds rely on several different navigation systems working together.

| # | 선택지 | 판정 | 근거 |
|---|---|---|---|
| 0 | The physiological adaptations that allow birds to fly long distances | 오답 | 생리적 적응(비행 근육·지방 축적·대사)은 강의에 등장하지 않는다. 눈 속 단백질은 항법 감각의 기제로만 언급된다. |
| 1 | The seasonal patterns of food availability in different regions | 오답 | 먹이의 계절 변동은 2문단에서 '왜 이동하는가'의 답으로 한 번 나올 뿐, 강의 전체의 화제가 아니다. |
| **2** | **The navigation methods birds use and challenges to migration** | **정답** | 위 근거 문장 |
| 3 | The evolutionary origins of migratory behavior in bird species | 오답 | 이동 습성의 진화적 기원은 한 번도 다뤄지지 않는다. |

*설계 메모: 주제 문항이다. 1문단이 항법 체계, 3문단이 인간 활동에 의한 교란을 다루고, 정답은 그 두 축의 종합이다.*

#### L2-9 (Q9) — 정답키 **3** : Observing positions of stars

> **문항:** According to the speaker, which navigation method do migrating birds use during nighttime travel?

**정답 근거 문장 (지문에서 그대로):**

> At night, they actually follow star patterns—particularly the North Star and surrounding constellations.

| # | 선택지 | 판정 | 근거 |
|---|---|---|---|
| 0 | Detecting changes in air temperature | 오답 | 기온 변화는 항법 단서 목록(태양 위치, 별자리, 자기장, 냄새)에 없다. |
| 1 | Following the Sun’s magnetic field patterns | 오답 | 태양과 자기장은 서로 다른 문장에서 별개의 단서로 서술된다. 자기장은 'Earth’s magnetic field' 로 지구에 귀속되며 태양의 것이 아니다. |
| 2 | Recognizing landscape features below | 오답 | 지형 인식은 냄새와 묶여 'still being studied' 로 유보되고, 야간 단서로 배정되지 않았다. 야간 항법은 별자리다. |
| **3** | **Observing positions of stars** | **정답** | 위 근거 문장 |

#### L2-10 (Q10) — 정답키 **0** : To give an example of how human development harms migrating birds

> **문항:** Why does the speaker discuss glass buildings in relation to bird migration?

**정답 근거 문장 (지문에서 그대로):**

> Building designs, particularly glass structures, pose another serious threat—birds can’t see glass and fly directly into windows, leading to millions of collisions annually.

| # | 선택지 | 판정 | 근거 |
|---|---|---|---|
| **0** | **To give an example of how human development harms migrating birds** | **정답** | 위 근거 문장 |
| 1 | To explain why birds prefer to rest on artificial structures | 오답 | 인공 구조물에서 쉰다는 서술은 없다. 유리 건물은 충돌 원인으로만 나온다. |
| 2 | To suggest that urban areas provide shelter for migratory species | 오답 | 도시가 은신처를 제공한다는 서술은 없다. 도시는 광공해의 출처로 제시된다. |
| 3 | To describe how birds have adapted to modern environments | 오답 | 적응이 아니라 적응 실패다 — 새는 유리를 보지 못한다. |

#### L2-11 (Q11) — 정답키 **1** : Misaligned timing between arrival and food sources threatens birds

> **문항:** Based on the talk, what can be inferred about the effects of climate change on bird migration?

**정답 근거 문장 (지문에서 그대로):**

> Climate change is also shifting the timing of food availability, which means birds may arrive at their destinations only to find their food sources, like certain insects or plants, haven’t appeared yet.

| # | 선택지 | 판정 | 근거 |
|---|---|---|---|
| 0 | Birds developing new navigation systems to cope with changes | 오답 | 새 항법 체계를 개발한다는 서술은 없다. 기존 단서가 교란된다는 서술만 있다. |
| **1** | **Misaligned timing between arrival and food sources threatens birds** | **정답** | 위 근거 문장 |
| 2 | Warmer temperatures have made migration unnecessary for most species | 오답 | 이동이 불필요해졌다는 말은 없다. 강의는 이동이 계속되는 것을 전제로 위협을 열거한다. |
| 3 | Climate shifts affect birds in tropical breeding grounds | 오답 | 번식지는 temperate regions 로 명시된다. 열대 번식지는 등장하지 않는다. |

---

## L2-B5 — Questions 12-15 (`set9-L2-12-15`)

- 종류: **talk** · 단어수 **306** · 음원 **151.5초**
- 개정 사유: rev4 — 집필본 폐기, 원본 전사로 전면 교체. rev1~rev3 의 blind 검증 대응(소거법 차단, 오답 근거 분산 등)은 집필본을 전제로 한 작업이므로 함께 폐기했다. 원본은 원본 그대로 둔다 — 문제 난도나 오답 매력도를 이유로 원문을 손보지 않는다. 정답키 대조는 evidence[] 에 남겼고, 네 블록 12문항 모두 원문에 직접 근거가 있다.

### 지문 전문

```text
So, let’s talk about something that makes jazz really unique as a musical form—improvisation. In other words, the ability of musicians to create music spontaneously during a performance. Now, this might sound like musicians are just playing whatever comes to mind, but actually, there’s a lot of structure involved. It’s not random at all. Jazz improvisation typically works within a framework. Musicians follow chord progressions and melodic themes established at the beginning of a piece, but within those boundaries, they have freedom to create original phrases and explore different musical ideas. Think of it like a conversation where you know the topic but choose your own words. A saxophone player, for example, might take a familiar melody and transform it through variations in rhythm, pitch, and phrasing. A trumpet player might respond by building on that variation, adding their own interpretation. Each musician brings something personal to the performance. One interesting challenge with improvisation is that it requires musicians to listen very carefully to each other. They need to respond in real time to what their fellow performers are doing, adjusting their playing moment by moment. If the drummer shifts the rhythm slightly, everyone else has to notice and adapt. This means a jazz performance is never quite the same twice, which is part of what attracts audiences to live jazz. You’re witnessing something being created right in front of you. What makes this particularly significant is how improvisation influenced other music genres over time. Rock musicians began incorporating guitar solos that weren’t strictly scripted. Blues artists embraced spontaneous vocal variations. Even some classical composers started leaving room for performer interpretation in their works. So jazz didn’t just develop its own tradition—it fundamentally changed how we think about musical creativity altogether, encouraging musicians across genres to see performance as an act of creation, not just reproduction.
```

### 정답 근거 대조표

#### L2-12 (Q12) — 정답키 **3** : The nature and function of improvisation in jazz performance

> **문항:** What is the speaker primarily explaining in this talk about jazz music?

**정답 근거 문장 (지문에서 그대로):**

> So, let’s talk about something that makes jazz really unique as a musical form—improvisation.

| # | 선택지 | 판정 | 근거 |
|---|---|---|---|
| 0 | The technical skills required to master jazz instruments | 오답 | 악기 숙련이나 연주 기술 훈련은 다뤄지지 않는다. |
| 1 | How jazz developed differently from classical music traditions | 오답 | 클래식은 마지막 문단에서 영향을 받은 쪽으로 한 번 언급될 뿐, 발전 경로의 비교가 아니다. |
| 2 | The way jazz musicians collaborate with their audiences | 오답 | 청중은 'attracts audiences to live jazz' 로 지켜보는 쪽이며, 연주자와 협업하지 않는다. |
| **3** | **The nature and function of improvisation in jazz performance** | **정답** | 위 근거 문장 |

#### L2-13 (Q13) — 정답키 **3** : They must listen and respond to other players instantaneously

> **문항:** According to the speaker, what makes jazz improvisation particularly demanding for musicians?

**정답 근거 문장 (지문에서 그대로):**

> They need to respond in real time to what their fellow performers are doing, adjusting their playing moment by moment.

| # | 선택지 | 판정 | 근거 |
|---|---|---|---|
| 0 | They must memorize numerous melodic variations before performing | 오답 | 변주를 미리 외운다는 서술은 없다. 즉흥은 현장에서 만들어진다. |
| 1 | Chord progressions in jazz are more complex than in other genres | 오답 | 코드 진행이 다른 장르보다 복잡하다는 비교는 나오지 않는다. |
| 2 | Written scores require different interpretations at each concert | 오답 | 악보 해석 문제가 아니다. 강의는 악보가 아니라 서로 듣고 반응하는 일을 어려움으로 든다. |
| **3** | **They must listen and respond to other players instantaneously** | **정답** | 위 근거 문장 |

#### L2-14 (Q14) — 정답키 **0** : To illustrate how improvisation combines freedom with underlying structure

> **문항:** What is the speaker’s purpose in comparing jazz improvisation to having a conversation?

**정답 근거 문장 (지문에서 그대로):**

> Think of it like a conversation where you know the topic but choose your own words.

| # | 선택지 | 판정 | 근거 |
|---|---|---|---|
| **0** | **To illustrate how improvisation combines freedom with underlying structure** | **정답** | 위 근거 문장 |
| 1 | To emphasize that each musician develops a distinctive personal voice | 오답 | 개성은 같은 문단의 다른 문장('Each musician brings something personal')에서 다뤄지고, 대화 비유가 떠받치는 것은 '주제=제약 / 단어 선택=자유' 라는 짝이다. |
| 2 | To suggest that performers exchange musical ideas with one another | 오답 | 연주자 간 주고받음은 비유 뒤의 색소폰—트럼펫 예시가 맡는다. 비유 문장 자체는 아는 주제와 고르는 단어의 대비다. |
| 3 | To explain why jazz feels more natural and accessible than other genres | 오답 | 재즈가 더 자연스럽거나 접근하기 쉽다는 주장은 강의에 없다. |

#### L2-15 (Q15) — 정답키 **2** : Other genres previously placed greater emphasis on performing fixed compositions

> **문항:** What can be inferred from the discussion about how jazz influenced other musical genres?

**정답 근거 문장 (지문에서 그대로):**

> Rock musicians began incorporating guitar solos that weren’t strictly scripted. Blues artists embraced spontaneous vocal variations. Even some classical composers started leaving room for performer interpretation in their works.

| # | 선택지 | 판정 | 근거 |
|---|---|---|---|
| 0 | Rock and blues musicians formally studied jazz theory before changing their approach | 오답 | 록·블루스 연주자가 재즈 이론을 정식으로 배웠다는 서술은 없다. |
| 1 | Classical composers were initially reluctant | 오답 | 클래식 작곡가는 'started leaving room' 으로 받아들이는 쪽으로만 나오고, 처음에 꺼렸다는 서술은 없다. |
| **2** | **Other genres previously placed greater emphasis on performing fixed compositions** | **정답** | 위 근거 문장 |
| 3 | Audiences in rock and blues gradually lost interest in predictable performances | 오답 | 청중이 흥미를 잃었다는 서술은 없다. 청중 언급은 라이브 재즈에 끌린다는 것뿐이다. |

*설계 메모: 추론 문항이다. 'began'·'started'·'weren’t strictly scripted' 가 그 이전 상태를 함의하고, 마지막 문장의 'not just reproduction' 이 이를 확정한다.*

---

*지문 원문의 단일 진실원천은 `sg2/config/_set9_l2/*.json` 이며, 이 문서는
`tools/gen_set9_authored_doc.py` 가 그 파일들에서 생성한 읽기용 사본이다.*
