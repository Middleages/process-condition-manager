"""EC1 스모크: PgIngestReader를 통해 서로 다른 두 process → 서로 다른 구조 시트.

적재 판독기를 fixture가 아니라 실 판독기(PgIngestReader, SQLite f_stpes)로 주입해
생성 파이프라인이 판독기 구현체와 무관하게(계약만으로) 동작함을 확인한다.
"""

from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import StaticPool

from app.core.db import get_app_session
from app.ingest.fixture_reader import get_ingest_reader
from app.ingest.pg_reader import PgIngestReader
from app.main import app

_ROWS = [
    ("L1", "PROC_ALPHA", "001", "CLN", "CLEAN", "Initial Clean", "CLEAN"),
    ("L1", "PROC_ALPHA", "010", "ACT", "PHOTO", "Active Photo", "PHOTO"),
    ("L1", "PROC_ALPHA", "020", "ACT", "ETCH", "Active Etch", "ETCH"),
    ("L1", "PROC_BETA", "001", "CLN", "CLEAN", "Initial Clean", "CLEAN"),
    ("L1", "PROC_BETA", "015", "WELL", "DEP", "Well Deposition", "DEP"),
]

_COLUMNS = (
    "line_id",
    "process_id",
    "step_seq",
    "layer_id",
    "eqp_type",
    "eqp_type_desc",
    "area_name",
)


@pytest.fixture
async def pg_ingest_client(
    db_session_factory: async_sessionmaker[AsyncSession],
) -> AsyncIterator[AsyncClient]:
    """앱 DB는 SQLite, 적재는 SQLite f_stpes를 읽는 PgIngestReader로 배선한 클라이언트."""
    ingest_engine = create_async_engine(
        "sqlite+aiosqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with ingest_engine.begin() as conn:
        await conn.execute(
            text(
                "CREATE TABLE f_stpes (line_id TEXT, process_id TEXT, step_seq TEXT, "
                "layer_id TEXT, eqp_type TEXT, eqp_type_desc TEXT, area_name TEXT)"
            )
        )
        for row in _ROWS:
            await conn.execute(
                text(
                    "INSERT INTO f_stpes VALUES (:line_id, :process_id, :step_seq, "
                    ":layer_id, :eqp_type, :eqp_type_desc, :area_name)"
                ),
                dict(zip(_COLUMNS, row, strict=True)),
            )
    ingest_factory = async_sessionmaker(
        ingest_engine, expire_on_commit=False, class_=AsyncSession
    )

    async def _override_get_app_session() -> AsyncIterator[AsyncSession]:
        async with db_session_factory() as session:
            yield session

    async def _override_get_ingest_reader() -> AsyncIterator[PgIngestReader]:
        async with ingest_factory() as session:
            yield PgIngestReader(session, table="f_stpes", schema=None)

    app.dependency_overrides[get_app_session] = _override_get_app_session
    app.dependency_overrides[get_ingest_reader] = _override_get_ingest_reader
    transport = ASGITransport(app=app)
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac
    finally:
        app.dependency_overrides.pop(get_app_session, None)
        app.dependency_overrides.pop(get_ingest_reader, None)
        await ingest_engine.dispose()


async def test_ec1_two_processes_yield_distinct_structures(
    pg_ingest_client: AsyncClient,
) -> None:
    alpha = await pg_ingest_client.post(
        "/projects",
        json={"line_id": "L1", "process_id": "PROC_ALPHA", "part_id": "A", "name": "Alpha"},
    )
    beta = await pg_ingest_client.post(
        "/projects",
        json={"line_id": "L1", "process_id": "PROC_BETA", "part_id": "B", "name": "Beta"},
    )

    assert alpha.status_code == 201, alpha.text
    assert beta.status_code == 201, beta.text
    alpha_layers = [(x["step_seq"], x["layer_id"]) for x in alpha.json()["layers"]]
    beta_layers = [(x["step_seq"], x["layer_id"]) for x in beta.json()["layers"]]

    assert alpha_layers == [("001", "CLN"), ("010", "ACT"), ("020", "ACT")]
    assert beta_layers == [("001", "CLN"), ("015", "WELL")]
    assert alpha_layers != beta_layers  # EC1: 서로 다른 구조


async def test_process_catalog_reads_from_pg_reader(
    pg_ingest_client: AsyncClient,
) -> None:
    listed = await pg_ingest_client.get("/processes")
    assert [p["key"] for p in listed.json()["items"]] == [
        "L1::PROC_ALPHA",
        "L1::PROC_BETA",
    ]

    detail = await pg_ingest_client.get("/processes/L1::PROC_BETA")
    assert detail.json()["step_count"] == 2
    assert detail.json()["area_names"] == ["CLEAN", "DEP"]
