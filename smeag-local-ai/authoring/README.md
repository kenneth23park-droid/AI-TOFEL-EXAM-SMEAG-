# authoring — 교재 챕터 집필 파이프라인

`TOEFL Practice Book — B2 Level Up` 의 챕터 한 장을 계획 → 초안 → 검산 → (수정) →
사람 검토 대기까지 끌고 가는 LangGraph 그래프다. **자동 승인은 없다.** 마지막 노드는
원고를 사람 앞에 세워 두는 일(park)만 한다.

원고는 챕터 JSON 한 벌이고 나머지(학생용 PDF, 교사판 PDF, 응시 세트, 음원, 색인)는
전부 파생물이다. 필드 계약은 `docs/bmad/book-schema.md`, 구조의 정본은
`studyground/sg2/config/blueprint.book.json` 이다. 이 패키지는 **그 둘을 읽기만 한다** —
새 콘텐츠 포맷을 만들지 않는다.

## 쓰는 법

```bash
cd smeag-local-ai

python3 -m authoring.cli --book reading --chapter 3 --out out/ \
        --corpus ../studyground/sg2/config/_set9_fragments

python3 -m authoring.cli --gates-only --chapter-file out/reading-03.chapter.json \
        --corpus ../studyground/sg2/config/_set9_fragments

python3 -m authoring.cli --selftest      # 두 백엔드 + 게이트 4종 전부
python3 -m authoring.cli --baseline      # CEFR 밴드의 근거(SET 9)를 다시 잰다
```

종료 코드: `0` stop 없음(검토 대기) · `2` stop 있음 · `1` 실행 실패.

`--out` 은 두 파일을 쓴다.

| 파일 | 내용 |
|---|---|
| `<slug>.chapter.json` | 원고. `book-schema.md` §2·§3 을 그대로 만족한다 |
| `<slug>.gates.json` | `{slug, status, rounds, backend, gates[]}` — 관리자 화면이 읽는 모양 |

LLM 은 `ANTHROPIC_API_KEY` 또는 `OPENAI_API_KEY` 가 있을 때만 붙는다. 없으면
`draft` 가 `offline: cannot draft` 로 접고, 그래프는 **끝까지 돈다** — 빈 뼈대가
게이트에 걸려 stop 목록으로 돌아온다. 죽지 않는 것이 요점이다.

## 그래프

```
plan → draft → cefr_gate → answer_gate → dup_gate → fact_gate → decide ─┬→ revise → (cefr_gate)
                                                                        └→ review → END
```

| 노드 | 입력 | 출력 | 실패 시 |
|---|---|---|---|
| `plan` | `book`, `chapter_no`, `blueprint` | `chapter`(빈 뼈대), `plan[]`(블록별 집필 지시), `rounds=0` | 예외 없음. blueprint 에 없는 book 이면 `ValueError`(설정 오류라 감추지 않는다) |
| `draft` | `plan[]`, `llm` | 채워진 `chapter`, `notes[]`, provenance.level=`generated` | **모든 예외 흡수.** 프로바이더 없음/HTTP 실패/JSON 아님 → 그 칸만 비운 채 진행, `status='offline'` |
| `cefr_gate` | `chapter` | `gate_results['cefr_gate']` | 순수 계산. 실패 없음 |
| `answer_gate` | `chapter`, `blueprint` | `gate_results['answer_gate']` | 순수 계산. blueprint 없으면 문항 수 검사만 `warn` 으로 건너뜀 |
| `dup_gate` | `chapter`, `corpus[]` | `gate_results['dup_gate']` | 순수 계산. corpus 가 비면 `warn`("검사하지 않았다") |
| `fact_gate` | `chapter`, `llm`(선택) | `gate_results['fact_gate']` | 온라인 실패 → 오프라인 경로(`warn` + 주장 목록)로 강등 |
| `decide` | `gate_results` | `gates[]`(고정 순서로 편 목록) | 순수 계산 |
| `revise` | `gates[]`(stop 만), `llm` | 패치가 적용된 `chapter`, `rounds+1` | 예외 흡수. 오프라인이면 `rounds` 를 상한으로 올려 즉시 `review` 로 보낸다 |
| `review` | `gates[]` | `provenance.gateResults[]`(status `open`), `status` = `parked`/`blocked` | 예외 없음. `reviewedAt` 은 **절대** 채우지 않는다 |

엣지

| from | to | 종류 |
|---|---|---|
| `plan` | `draft` | 고정 |
| `draft` | `cefr_gate` | 고정 |
| `cefr_gate` → `answer_gate` → `dup_gate` → `fact_gate` → `decide` | | 고정 |
| `decide` | `revise` / `review` | **조건부** — `nodes.need_revision` |
| `revise` | `cefr_gate` | 고정(고친 뒤에는 네 게이트를 전부 다시 통과한다) |
| `review` | `__end__` | 고정 |

조건부 규칙: `gates` 에 `stop` 이 하나라도 있고 `rounds < max_rounds`(기본 3)면
`revise`, 아니면 `review`. 상한에 닿으면 stop 을 안은 채 `status='blocked'` 로 park 한다 —
"고칠 수 없었다" 가 사람에게 보이는 편이 조용히 도는 것보다 낫다.

### 게이트 넷을 왜 사슬로 거나

논리적으로는 병렬이지만 **고정된 사슬**로 실행한다. langgraph 에서 병렬로 두면 네
분기가 같은 상태 키를 동시에 써서 리듀서가 필요해지고, stdlib 폴백에는 리듀서가 없어
결국 두 백엔드의 방문 순서가 갈린다. 게이트는 서로의 결과를 보지 않고 각자
`gate_results[이름]` 에만 쓰므로, 사슬로 묶어도 판정은 같고 순서만 결정적이 된다.
`--selftest` 가 두 백엔드의 방문 순서가 **글자까지 같은지** 를 확인한다.

### 백엔드 두 개, 그래프 하나

`graph_spec.py` 가 구조의 단일 진실 소스다(`architecture.md` §8.4). `graph.py` 의
langgraph 빌더와 `_SequentialGraph` 워크리스트가 **같은 선언을 읽는다**. 노드를 더할 때
고치는 파일은 `graph_spec.py` 하나다.

langgraph 는 선택 의존성이다(`requirements.txt` 에 넣지 않는다 — 캠퍼스 박스는 망이
끊겨 있고 패키지 하나가 손으로 패치할 거리 하나다). 없으면 폴백이 **같은 그래프** 를
돈다. 폴백은 축소판이 아니다.

예외 정책도 §8.4 를 따른다: 실행기는 노드 예외를 삼키지 않는다. 밖으로 나가는 노드가
각자 안에서 흡수한다.

## 게이트 넷

전부 결정적이고 전부 오프라인에서 판정을 낸다. **어떤 게이트도 결론을 내기 위해 LLM 을
필요로 하지 않는다.** 게이트가 모델을 요구하면 망이 없는 날 "오늘은 검산 없이 넘긴다"
가 반드시 일어나고, 그 한 번이 정답 없는 문항을 인쇄까지 보낸다.

모양은 `set-import.js` 와 같다: `{level:'stop'|'warn'|'info', scope, message}`.
`scope` 는 되도록 `book-schema.md` §4-2 의 이름을 재사용한다(`answer`/`cloze`/
`choices`/`count`/`ids`/`structure`/`audio`). 새로 만든 scope 는 `cefr`/`dup`/`fact` 셋뿐이다.

### `cefr_gate` — 측정값 세 개

| 지표 | 무엇 | B2 구간(ok) | stop 구간 밖 |
|---|---|---|---|
| `meanSentenceLen` | 이어진 글의 평균 문장 길이 | 8.0–20.0 (말: 7.0–18.0) | <6.0 또는 >28.0 |
| `msttr100` | 100토큰 창 type-token ratio 평균 | 0.62–0.88 | <0.45 또는 >0.95 |
| `awlRatio` | 학술어휘(AWL) 비율 | 0.015–0.090 | <0.004 또는 >0.160 |

추가로 25단어 넘는 문장이 20% 를 넘으면 `warn`.

- 숫자의 출처는 **이 저장소의 SET 9** 다. `config/_set9_fragments/*.json` 을 같은
  코드로 재서 ok 구간이 그 실측을 전부 포함하도록 잡았다(`--baseline` 이 재현한다).
  이론적 B2 가 아니라 "이미 승인된 원고가 들어가는 구간"이다.
- 문장 길이는 **이어진 글에서만** 잰다. 선택지는 문장이 아니라 명사구여서, 함께 세면
  SET 9 리딩의 평균이 9.25 → 7.87 단어로 내려간다. 선택지 수는 blueprint 가 고정하므로
  그 값이 섞이면 문체가 아니라 문항 수를 재게 된다. 어휘 지표는 선택지까지 포함해서
  잰다(낱말 단위라 짧은 조각에 왜곡되지 않는다).
- AWL 은 Coxhead(2000) 서브리스트 1·2 의 표제어 120개를 `gates.AWL_HEADWORDS` 에
  **데이터로 싣고**, 굴절형은 접두 일치로 본다. 목록을 늘리면 위 밴드도 다시 재야 한다.
- 표본이 120단어 미만이면 판정 전체를 `warn` 으로 낮춘다. **못 잰 것과 재서 벗어난
  것은 다른 말이다** — 빈 뼈대에 "B2 가 아니다" 를 47줄 쏟으면 정작 읽어야 할
  `answer_gate` 의 '내용이 없다' 가 그 안에 묻힌다.
- MSTTR-100 을 쓰는 이유: 맨 TTR 은 글이 길수록 내려가서 200단어 지문과 500단어
  대본을 같은 자로 잴 수 없다.

### `answer_gate` — 전부 사실 확인, 취향 없음

`stop`: 문항 id/번호 없음·중복, 번호가 1..N 연속이 아님, cloze 정답 없음, 힌트가 정답의
접두가 아님, 힌트가 정답 전체, cloze 템플릿의 `{{n}}` 자리표시자 불일치, 선택지 3개 미만,
빈 선택지, 같은 선택지 두 개(정답이 둘이 된다), 정답 색인이 선택지 범위 밖, build 의
`answerTokens` 가 `sentence` 를 복원하지 못함, 정답 토큰이 타일에 없음, 스피킹 프롬프트에
대본도 음원도 없음, blueprint 와 다른 모듈·블록·문항 수·문항 종류 구성·선택지 수.

`warn`: cloze 정답이 두 낱말 이상, 타일이 남는데 `trapTiles` 로 선언되지 않음,
이메일 불릿 3개 미만·토론 post 2개 미만, blueprint 를 안 줘서 개수를 못 셈.

### `dup_gate` — `dup-core.js` 와 같은 자

정규화(스마트따옴표·대시 통일, `{{n}}` 제거, 소문자, 영숫자·아포스트로피 외 제거),
4-gram shingle, 자카드·containment·최장연속·선택지 일치까지 `studyground/sg2/assets/dup-core.js`
의 `compare()` 를 그대로 옮겼다. **임계값의 출처는 그 파일 하나다** — `TH` 표를 여기에
다시 적은 것은 사본이고, 저쪽 주석에 함정 팩 실측 근거가 있다(예: `containmentWatch
0.25` 는 SET9 L2-B2 지문의 44단어 패러프레이즈를 잡으려고 고른 값. 0.35 에서 이미
소음이 1건 늘고 0.25 까지 더 늘지 않아서 같은 소음으로 탐지력만 얻는 값을 썼다).
`--selftest` 가 `dup-core.js` 에서 숫자를 긁어와 **한 줄씩 대조**한다.

등급 대응: `high → stop`, `watch → warn`, `info → info`.

옮기지 않은 것 두 개: `frameDf`, `clusterJaccard`. JS 는 자카드 0.5 이상을 한 군집으로
묶는 union-find 로 정형문 df 를 세고, 여기서는 **정규화 후 완전일치**만 한 군집으로 본다.
파이썬 쪽 군집이 더 잘게 쪼개지므로 df 가 작거나 같게 나오고 → 정형문 강등이 **덜**
일어난다. 즉 이 구현은 엄한 쪽으로만 어긋나며, JS 가 잡는 것을 놓치지 않는다.

### `fact_gate` — 조용히 통과시키지 않는다

연도·수량·백분율·`the first/largest/…`·`invented/founded/…`·`according to/studies show`
가 든 문장을 '확인할 수 있는 주장' 으로 뽑는다(물음표로 끝나는 발문은 뺀다 — 질문은
주장이 아니다). LLM 이 없으면 **`warn` + 주장 목록**이다. `info` 로 적어 두면 아무도 안
읽고 그대로 인쇄된다. `warn` 은 `provenance.gateResults` 에 `status:'open'` 으로 박혀서
사람이 `accepted` 로 바꾸기 전까지 검토 대시보드에서 사라지지 않는다.

LLM 이 있으면 의심스러운 주장만 골라 `warn` 으로 올린다. 모델의 부정이 곧 오류 확정은
아니다 — 그렇게 두면 모델 하나가 원고를 지울 수 있다. 판정은 여전히 사람이 한다.

## LLM 프로바이더

`studyground/sg2/api/_llm.js` 의 계약을 옮긴 얇은 껍데기다(`nodes.py`).

```python
provider.chat(system, user, opts) -> LLMResult(text, usage={'in','out'}, truncated, model)
```

- 프로바이더는 키가 있는 쪽만 후보(`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`), 없으면
  `OfflineProvider`. **`None` 을 돌려주지 않는다** — 호출부가 None 검사를 한 군데
  빠뜨리면 거기서 터진다.
- 토큰 사용량을 같이 돌려주는 이유는 돈이다. 금액 환산은 여기서 하지 않는다(단가표는
  파이썬 한 곳에만).
- OpenAI 가 온도 필드로 400 을 내면 온도만 떼고 한 번 더 부른다 — `_llm.js` 와 같은 처리.
- 모델은 **빈 칸만 채운다**. `apply_fill()` 이 화이트리스트 밖의 키와 뼈대에 없는
  문항·블록·트랙을 버리고, 버린 것을 `notes` 에 적는다. `revise` 는 더 좁아서
  `{questionId, field, value}` 패치만 받는다 — 통째로 다시 쓴 원고를 받으면 이미
  통과한 문항까지 같이 흔들린다.

## 픽스처

| 파일 | 쓰임 |
|---|---|
| `fixtures/stub_script.json` | 스텁 LLM 대본. reading 1챕터(30문항) 전체. **3번 힌트와 13번 정답이 일부러 틀려 있고** `revise#1` 이 그 둘만 고친다 |
| `fixtures/reading-01.chapter.json` | 위 대본으로 만들어진 완성 챕터. `--gates-only` 예제 |
| `fixtures/corpus_clean.json` | 겹치지 않는 기존 세트 — 무고한 챕터를 물지 않는지 |
| `fixtures/corpus_overlap.json` | 지문 통째 복사 + 선택지 3개 재활용 — 물어야 하는지 |

`--selftest` 는 27개 확인을 돌린다: 두 백엔드의 방문 순서·산출 챕터 일치, revise 왕복,
`book-schema.md` 필드 계약(+ node 가 있으면 `assets/book-schema.js` `validate()` 실행),
게이트 넷을 각각 물리는 입력과 물지 않는 입력, 오프라인 동작, `dup-core.js` 임계값 대조.

## 손댈 때

- 임계값은 `dup-core.js` 를 고치고 `gates.TH` 에 옮긴다. 반대로 하지 않는다.
- CEFR 밴드를 고치면 `--baseline` 을 돌려 SET 9 실측이 여전히 ok 구간에 드는지 본다.
- 문항 수·구조는 `blueprint.book.json` 에서만 바꾼다. 이 패키지는 그 파일을 읽을 뿐이다.
- 새 의존성은 넣지 않는다. langgraph 조차 선택이다.
