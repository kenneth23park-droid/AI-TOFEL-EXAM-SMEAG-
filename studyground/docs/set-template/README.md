# 새 세트 원본 docx — 빈 틀과 채우는 규칙

[English](README.en.md)

세트 하나는 문서 세 장에서 나온다. 이 폴더의 세 장이 그 빈 틀이다.

| 틀 | 새 세트에서의 이름 (예: SET 13) |
| --- | --- |
| `NEW TOEFL SET XX.docx` | `NEW TOEFL SET 13.docx` — 문제지 |
| `SET XX SCRIPT.docx` | `SET 13 SCRIPT.docx` — 듣기·말하기 대본 |
| `SET XX ANSWER KEY.docx` | `SET 13 ANSWER KEY.docx` — 정답지 |

**노란 형광 `[대괄호]` 가 바꿔 넣을 자리다.** 대괄호째 지우고 내용을 적는다. 나머지 줄
(섹션·모듈 머리글, `Questions a-b`, `Read a passage.`, `Listen to a talk.` 같은 안내 줄)은
파서가 문항을 찾는 표지라 그대로 둔다.

틀은 그대로 가져와도 120문항이 strict source mode 에서 stop 없이 지어진다
(`tests/test_set_template.mjs` 가 매번 확인한다). 채운 뒤에도 같은 모양을 지키면 그대로 가져와진다.

파일 이름은 `SET <번호>` 만 들어 있으면 된다 — `SCRIPT` 가 들어간 것은 대본, `ANSWER KEY`
(`ANWER KEY` 오타도 받는다)가 들어간 것은 정답지, 나머지 하나가 문제지다
(`sg2/tools/source_docs.mjs`). 한 폴더에 같은 세트 번호의 후보가 둘이면 멈춘다.

---

## 문항 수 (SET 12 와 같은 구성, 120)

| 섹션 | 모듈 | 구성 |
| --- | --- | --- |
| Reading | Module 1 (35) | 빈칸 1-10 · 빈칸 11-20 · 공지 21-22 · 공지 23-25 · 지문 26-30 · 지문 31-35 |
| | Module 2 (15) | 빈칸 1-10 · 지문 11-15 |
| Listening | Module 1 (32) | 짧은 응답 1-12 · 대화 13-14·15-16·17-18 · 안내 19-20·21-22·23-24 · 강의 25-28·29-32 |
| | Module 2 (15) | 짧은 응답 1-3 · 대화 4-5·6-7 · 강의 8-11·12-15 |
| Writing | 12 | 문장 만들기 1-10 · 이메일 · 학술 토론 |
| Speaking | 11 | Task 1 따라 읽기 7 · Task 2 인터뷰 4 |

구성을 바꿔도 된다(블록을 늘리거나 줄이기). 다만 **모듈 안의 번호는 1부터 빈틈없이** 이어지고,
정답지의 그 모듈 줄 수와 같아야 한다.

---

## 문제지 — `NEW TOEFL SET XX.docx`

### 공통
* 섹션 머리글은 한 줄에 `READING SECTION` · `LISTENING SECTION` · `WRITING SECTION` · `SPEAKING SECTION`.
* 모듈 머리글은 한 줄에 `MODULE 1` / `MODULE 2`.
* 블록 머리글은 한 줄에 `Questions 21-22` (한 문항이면 `Questions 5`).
* 객관식은 `21. 질문` 다음 줄부터 `A. 보기` … `D. 보기`. 워드의 자동 번호 목록으로 A~D 를 매겨도 된다.
* 문항 사이는 빈 줄 하나.

### Reading — 빈칸 채우기
```
Questions 1-10
Fill in the blanks.
Honeybees live in large colonies. A 1col_ _ _ can 2con_ _ _ _ tens of thousands 3o_ bees, …
```
* 지문은 **한 문단**. 빈칸은 `번호 + 보여 줄 글자 + 빠진 글자마다 _ ` (예: `1col_ _ _` → colony).
* 번호는 지문마다 1 부터 다시 센다 — `Questions 11-20` 아래의 지문도 1…10 이다.
* 정답지의 낱말은 보여 준 글자로 시작해야 한다(`col` → `colony`). 다르면 경고가 뜬다.

### Reading — 지문 + 객관식
```
Questions 26-30
Read a passage.
지문 제목
지문 문단 1
지문 문단 2

26. 질문
A. …
```
* 안내 줄은 `Read a passage.` / `Read a notice.` / `Read an article.` 처럼 `Read a/an/the …` 로 시작.
* 안내 줄 다음 첫 줄이 **제목**, 그 뒤가 문단(한 줄 = 한 문단).
* 문장 넣기 문항은 지문에 `(A)` `(B)` `(C)` `(D)` 를 적고, 질문을
  `Look at the four letters (A, B, C, and D) …` 로 쓴 뒤 넣을 문장을 다음 줄에 적는다.

### Listening — 짧은 응답
```
Questions 1-12

Listen to the question and select the best response from the choices.

1.
A. 응답
B. 응답
C. 응답
D. 응답
```
* 질문 문장은 문제지에 없다 — 대본에 있다. 문제지에는 `번호.` 한 줄과 보기 네 줄만.

### Listening — 대화·안내·강의
```
Questions 13-14
Listen to a conversation.

13. 질문
A. …
```
* 안내 줄은 `Listen to a conversation.` / `Listen to an announcement.` / `Listen to a talk.`

### Writing
* `Build a sentence` → `Questions 1-10` → `Make an appropriate sentence.` 다음에 문항마다 **세 줄**:
  1. 문맥 줄 — `1. Did you finish the report?`
  2. 빈칸 줄 — 밑줄 두 개 이상이 한 칸. 고정 글을 섞어도 된다: `Yes, ______ ______ ______ ______.`
  3. 타일 줄 — 타일 사이를 **Tab**(또는 스페이스 두 칸 이상)으로 가른다: `I sent it⇥to⇥the manager⇥this morning⇥sending`
  * 타일로 정답지 문장을 **남김없이** 만들 수 있어야 한다. 빈칸보다 많은 타일은 함정 타일이 된다.
  * 타일 줄이 없으면 strict 모드에서 막힌다(정답에서 타일을 만들지 않는다).
* `WRITE AN EMAIL` → `To: …` → `Subject: …` → `SITUATION` → 상황 한 문단 → `YOUR EMAIL SHOULD` → 요구 사항 한 줄씩.
* `WRITE for an ACADEMIC DISCUSSION` →
  `Professor – 과목` (대시 포함, 70자 미만) → 교수 질문(**80자 넘게**) →
  학생 이름(짧게, 마침표 없이) → 그 학생 글 → 다음 학생 이름 → 글.
  얼굴 사진은 문서가 아니라 `config/set<N>-writing-images.json` 에서 이름으로 붙는다.

### Speaking
* `Task 1` → `Listen and Repeat` → 그림 + `1.` 을 문장 수만큼(틀은 7).
* `Task 2` → `Answer the interviewer’s questions.` → 그림 한 장(네 질문이 같이 쓴다).
* 틀의 회색 그림은 자리표시다. 워드에서 그림을 오른쪽 클릭 → **그림 바꾸기**.
* 문항 수는 그림이 아니라 **대본의 문장 수**가 정한다.

---

## 대본 — `SET XX SCRIPT.docx`

```
Listening
Module 1
QUESTIONS 1-12
Where is the guest lecture going to take place?      ← 짧은 응답: 문항마다 한 줄, 순서대로
…
QUESTIONS 13-14
M: You mentioned you tried that new Thai restaurant…   ← 대화: M: / W: 로 화자
W: Yeah, we went to the one on Baker Street…
Questions 19-20
Class, one quick thing before we start…                ← 안내·강의: 한 줄 = 한 문단
Module 2
…
SPEAKING
Listen and Repeat
You are training to use the student portal. Listen to the officer and repeat what she says.   ← 상황 한 줄
Here is how we navigate the student portal.            ← 따라 읽을 문장, 한 줄씩
…
INTERVIEW
You have volunteered for a research study … Please answer the interviewer’s questions.       ← 상황 한 줄
1. Thank you for joining today. …                      ← 질문(번호는 음성에서 뗀다)
```
* 대본의 `QUESTIONS a-b` 는 문제지의 블록과 **번호가 겹치게** 적는다. 짧은 응답은 줄 수 = 문항 수.
* 블록의 첫 줄이 **20자 미만이면서 마침표·물음표로 끝나지 않으면** 머리글로 읽혀 대사에서 빠진다.
  짧은 첫 대사(`M: Hi.`)는 문장부호로 끝낸다.
* 음성은 이 문서에서 그대로 만든다(`sh tools/make_set_audio.sh <N>`) — 적힌 대로 읽힌다.

---

## 정답지 — `SET XX ANSWER KEY.docx`

```
READING
Module 1
colony          ← 빈칸은 낱말 전체
…
A               ← 객관식은 글자 하나
…
Module 2
…
LISTENING
Module 1
…
WRITING
Yes, I sent it to the manager this morning.   ← 문장 만들기 정답 문장, 1번부터
```
* **번호를 적지 않는다 — 줄 순서가 곧 번호다.** 한 줄이 빠지면 뒤가 전부 한 칸씩 밀린다
  (그래서 모듈마다 줄 수가 문항 수와 다르면 저장이 막힌다).
* 빈 줄은 세지 않는다. 섹션 머리글은 `READING` · `LISTENING` · `WRITING`.

---

## 채운 뒤

1. 세 장을 저장소 루트(`smeag-TOFEL 자료/`) 또는 `kenneth-brain/smeag-TOFEL 자료/` 에 둔다.
2. `admin-set-import.html` 에 세 장을 올리면 검산 줄이 바로 뜬다 — `stop` 이 있으면 저장이 잠긴다.
   메시지가 가리키는 **문서를 고치고 다시 올린다**(팩을 손으로 고치지 않는다).
3. 이후는 `docs/set-build.md` 의 다섯 관문(음성·정답 크로스체크·저장 검산·완결성) 그대로.

틀을 바꾸려면 docx 를 손으로 고치지 말고 `tools/make_set_template.mjs` 를 고친 뒤
`node studyground/tools/make_set_template.mjs` 로 다시 짓는다.
