"""
집필 그래프의 구조 — 단일 진실 소스. docs/bmad/architecture.md §8.4 의 패턴 그대로.

왜 구조를 따로 떼어 두나
----------------------
채점 쪽에서 한 번 데인 자리다. `_SequentialGraph.invoke` 가 노드 순서를 코드에
하드코딩하고 있어서, langgraph 빌더에 노드를 하나 추가하면 폴백이 조용히 옛 순서로
돌았다. 두 백엔드가 서로 다른 그래프를 실행하는데 둘 다 결과를 내놓기 때문에,
망이 없는 캠퍼스 장비에서만 다른 답이 나오는 형태로 발현된다 — 가장 늦게 발견되는
종류의 버그다.

그래서 구조는 여기 한 곳에만 적는다. graph.py 의 두 백엔드는 이 파일을 **읽어서**
자기 그래프를 만든다. 노드를 더할 때 고치는 파일은 여기 하나다.

이 모듈은 nodes 말고는 아무것도 import 하지 않는다(nodes 는 표준 라이브러리만 쓴다).
langgraph 가 없어도 import 된다는 뜻이고, 그게 폴백이 성립하는 조건이다.

그래프
------
    plan → draft → cefr_gate → answer_gate → dup_gate → fact_gate → decide
                                                                      │
                                              need_revision(state) ───┤
                                     stop 있고 라운드 남음 → revise ──┘ (→ cefr_gate)
                                                    그 외 → review → __end__

게이트 넷은 논리적으로는 서로 독립이라 병렬로 그려도 되지만, **고정된 사슬**로
실행한다. langgraph 에서 병렬로 두면 각 분기가 같은 키를 동시에 쓰므로 리듀서를
붙여야 하고, 폴백은 리듀서가 없어 순서대로 돌 수밖에 없다 — 두 백엔드의 방문 순서가
갈린다. 게이트는 상태를 서로 안 보고 각자 gate_results[이름] 에만 쓰므로, 사슬로
묶어도 결과는 같고 순서만 결정적이 된다.
"""

from __future__ import annotations

from . import nodes

ENTRY = "plan"
END = "__end__"

# 이름 → 함수. 노드 이름은 gates.py 의 함수 이름과 일부러 같다.
NODES = {
    "plan": nodes.plan,
    "draft": nodes.draft,
    "cefr_gate": nodes.cefr_gate,
    "answer_gate": nodes.answer_gate,
    "dup_gate": nodes.dup_gate,
    "fact_gate": nodes.fact_gate,
    "decide": nodes.decide,
    "revise": nodes.revise,
    "review": nodes.review,
}

# (from, to) 고정 엣지
EDGES = [
    ("plan", "draft"),
    ("draft", "cefr_gate"),
    ("cefr_gate", "answer_gate"),
    ("answer_gate", "dup_gate"),
    ("dup_gate", "fact_gate"),
    ("fact_gate", "decide"),
    ("revise", "cefr_gate"),        # 고친 뒤에는 게이트 전부를 다시 통과해야 한다
    ("review", END),
]

# from → (분기함수, {반환값: to})
CONDITIONAL = {
    "decide": (nodes.need_revision, {"revise": "revise", "review": "review"}),
}

# 폴백 워크리스트의 스텝 상한. 한 라운드가 7 스텝(cefr→…→decide→revise)이고
# 기본 상한이 3 라운드라 최악이 2 + 7*3 + 1 = 24 다. 64 는 그 두 배 남짓 —
# 무한루프는 막고 정상 실행은 절대 못 자르는 값.
MAX_STEPS = 64
