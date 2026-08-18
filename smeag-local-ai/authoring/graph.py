"""
집필 그래프의 실행기. 백엔드가 둘이고 **둘 다 graph_spec.py 를 읽는다**.

  langgraph 가 import 되면      → StateGraph 로 컴파일해서 돈다.
  안 되면(캠퍼스 장비가 그렇다) → _SequentialGraph 워크리스트로 돈다.

langgraph 는 선택 의존성이다. smeag-local-ai/requirements.txt 머리말이 못 박은
대로 캠퍼스 박스는 망이 끊겨 있어 패키지 하나가 손으로 패치할 거리 하나다. 그래서
import 는 반드시 guarded 이고, 폴백은 '축소판' 이 아니라 **같은 그래프** 를 돈다.

공개 시그니처
    backend()               -> 'langgraph' | 'sequential'
    uses_langgraph()        -> bool
    run(state, backend='')  -> 최종 상태 dict

예외 정책: architecture.md §8.4 의 확정 사항을 그대로 지킨다 — 실행기는 노드 예외를
삼키지 않는다. 밖으로 나가는 노드가 각자 안에서 흡수한다(nodes.draft/revise).
"""

from __future__ import annotations

from typing import Any, Dict

from . import graph_spec

try:                                     # 선택 의존성. 없는 것이 기본이다.
    from langgraph.graph import StateGraph, END as _LG_END   # type: ignore
    _HAVE_LANGGRAPH = True
except Exception:                        # noqa: BLE001 — import 실패 이유는 상관없다
    StateGraph = None                    # type: ignore
    _LG_END = None                       # type: ignore
    _HAVE_LANGGRAPH = False


def uses_langgraph() -> bool:
    return _HAVE_LANGGRAPH


def backend(want: str = "") -> str:
    """실제로 무엇으로 돌 것인가. want 로 강제할 수 있다(자체검사가 양쪽을 다 돈다)."""
    want = (want or "").strip().lower()
    if want == "langgraph":
        if not _HAVE_LANGGRAPH:
            raise RuntimeError("langgraph is not installed")
        return "langgraph"
    if want == "sequential":
        return "sequential"
    return "langgraph" if _HAVE_LANGGRAPH else "sequential"


# ── 폴백 ───────────────────────────────────────────────────────────────────

class _SequentialGraph:
    """
    ENTRY 에서 시작해 CONDITIONAL/EDGES 를 따라가는 일반 워크리스트.

    하드코딩된 순서를 두지 않는 것이 전부다. 노드가 늘면 graph_spec 만 고치면 되고,
    이 클래스는 그대로다.
    """

    def __init__(self, spec=graph_spec):
        self.spec = spec

    def invoke(self, state: Dict[str, Any]) -> Dict[str, Any]:
        spec = self.spec
        cur = spec.ENTRY
        steps = 0
        while cur and cur != spec.END:
            if steps >= spec.MAX_STEPS:
                raise RuntimeError(
                    "authoring graph exceeded %d steps at node %r — the revise loop is not "
                    "terminating (check max_rounds and nodes.need_revision)"
                    % (spec.MAX_STEPS, cur))
            steps += 1
            fn = spec.NODES.get(cur)
            if fn is None:
                raise KeyError("graph_spec.NODES has no node %r" % cur)
            update = fn(state) or {}
            state.update(update)          # 노드는 덮어쓸 키만 돌려준다
            if cur in spec.CONDITIONAL:
                branch, table = spec.CONDITIONAL[cur]
                pick = branch(state)
                if pick not in table:
                    raise KeyError("conditional edge from %r returned %r, which is not one "
                                   "of %s" % (cur, pick, sorted(table)))
                cur = table[pick]
                continue
            nxt = None
            for a, b in spec.EDGES:
                if a == cur:
                    nxt = b
                    break
            cur = nxt
        return state


# ── langgraph ─────────────────────────────────────────────────────────────

def _build_langgraph():
    """graph_spec 을 순회해 StateGraph 를 만든다. 구조는 여기 안 적는다."""
    from . import nodes
    g = StateGraph(nodes.AuthorState)
    for name, fn in graph_spec.NODES.items():
        g.add_node(name, fn)
    g.set_entry_point(graph_spec.ENTRY)
    for a, b in graph_spec.EDGES:
        g.add_edge(a, _LG_END if b == graph_spec.END else b)
    for src, (branch, table) in graph_spec.CONDITIONAL.items():
        g.add_conditional_edges(src, branch, dict(table))
    return g.compile()


_COMPILED = None


def compiled():
    """컴파일은 한 번만. 실패하면 부른 쪽이 폴백으로 내려갈 수 있게 그대로 던진다."""
    global _COMPILED
    if _COMPILED is None:
        _COMPILED = _build_langgraph()
    return _COMPILED


# ── 공개 진입점 ────────────────────────────────────────────────────────────

def run(state: Dict[str, Any], want_backend: str = "") -> Dict[str, Any]:
    """
    그래프 한 번 실행. state 는 nodes.AuthorState 모양의 dict.

    langgraph 백엔드도 dict 를 돌려주므로 호출자는 어느 쪽으로 돌았는지 몰라도 된다.
    실제로 무엇으로 돌았는지는 결과의 'backend' 키에 남는다 — 로그에서 이걸 못 보면
    "폴백으로만 돌고 있었다" 를 아무도 눈치채지 못한다.
    """
    chosen = backend(want_backend)
    state = dict(state)
    state.setdefault("max_rounds", 3)
    if chosen == "langgraph":
        out = dict(compiled().invoke(state))
    else:
        out = _SequentialGraph().invoke(state)
    out["backend"] = chosen
    return out
