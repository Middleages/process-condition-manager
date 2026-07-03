"""pytest 공통 픽스처.

골격 단계에서는 DB에 접속하지 않는 라이브니스/조립 검증만 수행한다.
"""

from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    """앱을 ASGI 트랜스포트로 감싼 비동기 테스트 클라이언트."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
