# SET 9 · Reading R2-15 — 삽입 지점 마커 A~D (원본 아님)

> ## ⚠️ 출처 경고 — 반드시 먼저 읽을 것
> **"Benefits of Green Roofs" 지문의 `{{A}}`~`{{D}}` 네 자리는 원본 SMEAG 자료가 아니다.**
> `NEW TOEFL MOCK TEST SET  9.docx` 는 이 지문을 두 번 싣고 있는데(문단 284-289, 290-295)
> **두 사본 모두 A/B/C/D 표식이 없다.** 해당 `<w:p>` 안에 `w:sym`·도형·텍스트박스도 없으므로
> 파싱 손실이 아니라 원본 자체의 결손이다. 15번 문항의 지시문
> ("Look at the four letters (A, B, C, and D) in the passage …"), 선택지 4개(Position A~D),
> 삽입 문장, 정답키(D = `answer:3`) 는 모두 원본 그대로다.
> **원본 마커 위치가 확보되면 즉시 교체 대상이다.**
>
> 교체 절차: `studyground/tools/build_set9.py` 의 `INSERT_MARKERS['R2-15']['placements']` 를
> 원본 위치로 갈아끼우고 `origin`/`note` 필드를 제거 →
> `studyground/.venv/bin/python studyground/tools/build_set9.py` →
> `node studyground/tests/test_compile_set9.js`.

## 왜 고쳐야 했나

`sg2/assets/exam-render-reading.js` 의 `markerTokens()` 가 `/\{\{([A-D])\}\}/` 로 본문을 쪼개
클릭 가능한 삽입 지점 버튼(`rd-marker`)을 만든다. 마커가 0개면 버튼이 하나도 생기지 않고
학생 화면에는 "Position A~D" 라디오 4개만 뜬 채 본문 어디에도 A/B/C/D 가 없다 —
즉 R2-15 는 정상적으로 풀 수 없는 상태였다. SET 1(`sg2/assets/set1.js` 의 로마 도로 지문)은
한 문단 안에 `{{A}}`~`{{D}}` 를 갖고 있고, 그 구조가 정본이다.

## 배치와 근거

삽입 문장: *"These factors must be carefully weighed against the environmental and economic
benefits described above."* → 정답 D(`answer:3`).
`These factors` 는 복수 선행사(비용·유지관리·하중·구조보강)를, `benefits described above` 는
앞의 이점 서술이 끝나 있을 것을 요구한다. 따라서 정답은 단점 문단이 다 끝난 자리다.
오답도 문법적으로 붙을 만한 자리에 두었다(너무 뻔하면 문항이 죽는다).

| 마커 | 자리 (paragraphs index) | 근거 |
|---|---|---|
| A | 3 — `… in otherwise barren urban environments.` 뒤 | 앞에 복수 명사(insects, birds, wildlife)가 있어 지시어가 걸리는 듯 보인다 |
| B | 3 — `… supply local restaurants and community markets.` 뒤 | 바로 뒤가 `However` 단점 문단이라 "요약 자리"로 착각하기 쉽다 |
| C | 4 — `… ongoing maintenance costs.` 뒤 | investment + maintenance 두 factor 로 복수 선행사가 성립하지만, 뒤에 하중·구조보강이 더 나오므로 요약이 이르다 |
| D | 4 — `… installation options for older buildings.` 뒤 | factor 가 전부 열거된 뒤 앞의 이점과 견주는 마무리 — **정답** |

## 출처 표시가 남아 있는 곳 (한 군데만 고치면 안 된다)

| 위치 | 필드 |
|---|---|
| `tools/build_set9.py` | `INSERT_MARKERS` 표 + 그 위 주석(원본 확인 결과 포함) |
| `sg2/assets/set9.js` (R2 passage 블록) | `markerOrigin: "authored"`, `markerNote` |
| `tests/test_compile_set9.js` | `[11]` insert 문항 지문의 `{{A}}~{{D}}` 마커 |
| 이 문서 | — |

## 회귀 방어

`tests/test_compile_set9.js` `[11]` 이 계약을 고정한다 — insert 문항이 있는 passage 블록은
본문 전체에 `{{A}},{{B}},{{C}},{{D}}` 가 정확히 하나씩 있어야 하고, insert 문항의 `answer`
index 에 대응하는 마커가 본문에 존재해야 한다. 수정 전 팩에서는 이 검사가 실패했다
(마커 개수 위반 4, 정답 마커 결손 1).
