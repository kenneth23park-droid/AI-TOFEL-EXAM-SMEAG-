"""
authoring — 교재 챕터 집필 파이프라인(계획 → 초안 → 게이트 4종 → 판단 → 수정/검토).

한 챕터에서 다섯 가지가 나온다(학생용 PDF, 교사판 PDF, 응시 세트, 음원, 색인).
원고가 둘이면 첫 수정에서 갈라지므로 집필은 챕터 JSON 한 벌이고, 이 패키지는 그
한 벌을 만들어 **사람 앞에 park 하는 것까지만** 한다. 자동 승인은 없다.

읽는 순서
  graph_spec.py  그래프 구조(단일 진실 소스)
  nodes.py       노드 + LLM 프로바이더 껍데기
  gates.py       판정 네 개 — 전부 결정적, 전부 오프라인
  graph.py       langgraph / stdlib 폴백 두 백엔드
  cli.py         python3 -m authoring.cli

의존성: 표준 라이브러리만. langgraph 는 있으면 쓰고 없으면 폴백이 같은 그래프를 돈다
(캠퍼스 장비는 망이 끊겨 있다 — requirements.txt 머리말).
"""

from __future__ import annotations

__version__ = "1.0.0"

from . import gates, graph, graph_spec, nodes   # noqa: F401  (편의 재수출)

__all__ = ["gates", "graph", "graph_spec", "nodes", "__version__"]
