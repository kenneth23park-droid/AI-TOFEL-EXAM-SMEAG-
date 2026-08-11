"""관리자 백오피스 접근 통제.

이 화면들은 학생 답안·녹음·학생별 비용을 그대로 보여준다. 그래서 검증할 것은
"맞는 비밀번호가 통과하는가"보다 **자격증명이 없을 때 무엇을 하는가**다.
열어 두는 쪽으로 기울면 배포 한 번이 곧 유출이 된다.
"""

from __future__ import annotations

import asyncio
import base64

import pytest
from fastapi import HTTPException

from app.config import get_settings
from app.routers.admin import require_admin


class _Req:
    """require_admin 이 실제로 보는 것만 흉내낸다 — client.host 와 헤더."""

    def __init__(self, host: str = "127.0.0.1", auth: str | None = None):
        self.client = type("C", (), {"host": host})()
        self.headers = {"authorization": auth} if auth else {}


def _basic(user: str, password: str) -> str:
    return "Basic " + base64.b64encode(f"{user}:{password}".encode()).decode()


@pytest.fixture
def gate(monkeypatch):
    """(mode, user, password) 로 설정을 갈아끼우고 상태코드를 돌려주는 호출자."""

    def run(mode: str, user: str = "", password: str = "", req: _Req | None = None) -> int:
        monkeypatch.setenv("APP_MODE", mode)
        monkeypatch.setenv("ADMIN_USER", user)
        monkeypatch.setenv("ADMIN_PASSWORD", password)
        get_settings.cache_clear()
        try:
            asyncio.run(require_admin(req or _Req()))
            return 200
        except HTTPException as exc:
            return exc.status_code

    yield run
    get_settings.cache_clear()


# ── 자격증명이 없을 때 ────────────────────────────────────────────────────────


def test_cloud_without_credentials_refuses_to_serve(gate):
    """공개 URL 에 무인증 백오피스를 띄우지 않는다. 열린 채 뜨느니 안 뜨는 게 낫다."""
    assert gate("cloud", req=_Req("203.0.113.9")) == 503


def test_local_without_credentials_allows_loopback(gate):
    """교실 노트북에서 ./run_local.sh 로 바로 쓰던 흐름은 그대로 살린다."""
    assert gate("local", req=_Req("127.0.0.1")) == 200


def test_local_without_credentials_blocks_the_lan(gate):
    """같은 LAN 의 학생 PC 30대도 서버 주소로 /admin 에 닿는다. 그건 막는다."""
    assert gate("local", req=_Req("192.168.0.44")) == 403


# ── 자격증명이 있을 때 ────────────────────────────────────────────────────────


def test_correct_credentials_pass(gate):
    assert gate("cloud", "smeag", "s3cret", _Req("203.0.113.9", _basic("smeag", "s3cret"))) == 200


def test_missing_header_challenges(gate):
    assert gate("cloud", "smeag", "s3cret", _Req("203.0.113.9")) == 401


@pytest.mark.parametrize(
    "auth",
    [
        _basic("smeag", "wrong"),      # 비번만 틀림
        _basic("nope", "s3cret"),      # 아이디만 틀림
        "Basic !!!!not-base64!!!!",    # 깨진 인코딩
        "Bearer smeag:s3cret",         # 다른 스킴
    ],
    ids=["bad-password", "bad-user", "broken-base64", "wrong-scheme"],
)
def test_bad_credentials_are_rejected(gate, auth):
    assert gate("cloud", "smeag", "s3cret", _Req("203.0.113.9", auth)) == 401


def test_loopback_is_not_a_bypass_once_credentials_exist(gate):
    """비밀번호를 세워 두고도 루프백이 프리패스면, 그 서버에 붙은 누구든 통과한다."""
    assert gate("local", "smeag", "s3cret", _Req("127.0.0.1")) == 401


def test_challenge_carries_www_authenticate(gate, monkeypatch):
    """헤더가 없으면 브라우저가 로그인 창을 띄우지 못한다."""
    monkeypatch.setenv("APP_MODE", "cloud")
    monkeypatch.setenv("ADMIN_USER", "smeag")
    monkeypatch.setenv("ADMIN_PASSWORD", "s3cret")
    get_settings.cache_clear()
    with pytest.raises(HTTPException) as caught:
        asyncio.run(require_admin(_Req("203.0.113.9")))
    assert "Basic" in (caught.value.headers or {}).get("WWW-Authenticate", "")
