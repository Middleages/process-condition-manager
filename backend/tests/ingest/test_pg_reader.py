"""PgIngestReader 계약 테스트.

SQLite 인메모리에 확정 스키마(f_stpes)를 심어 판독 로직(DISTINCT/정렬/키 생성/미존재
처리/식별자 검증)을 검증한다. 스키마 한정(`public.f_stpes`) 경로는 PG 통합 테스트에서 확인.
"""

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import StaticPool

from app.core.errors import NotFoundError
from app.ingest.pg_reader import PgIngestReader, _qualified_ref

_ROWS = [
    # 삽입 순서를 일부러 섞어 ORDER BY 동작을 검증한다.
    ("L1", "PROC_ALPHA", "020", "ACT", "ETCH", "Active Etch", "ETCH"),
    ("L1", "PROC_ALPHA", "001", "CLN", "CLEAN", "Initial Clean", "CLEAN"),
    ("L1", "PROC_ALPHA", "010", "ACT", "PHOTO", "Active Photo", "PHOTO"),
    ("L1", "PROC_BETA", "015", "WELL", "DEP", "Well Deposition", "DEP"),
    ("L1", "PROC_BETA", "001", "CLN", "CLEAN", "Initial Clean", "CLEAN"),
]


@pytest.fixture
async def ingest_session() -> AsyncSession:
    engine = create_async_engine(
        "sqlite+aiosqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.execute(
            text(
                "CREATE TABLE f_stpes ("
                "line_id TEXT, process_id TEXT, step_seq TEXT, layer_id TEXT, "
                "eqp_type TEXT, eqp_type_desc TEXT, area_name TEXT)"
            )
        )
        for row in _ROWS:
            await conn.execute(
                text(
                    "INSERT INTO f_stpes VALUES "
                    "(:line_id, :process_id, :step_seq, :layer_id, :eqp_type, "
                    ":eqp_type_desc, :area_name)"
                ),
                dict(
                    zip(
                        (
                            "line_id",
                            "process_id",
                            "step_seq",
                            "layer_id",
                            "eqp_type",
                            "eqp_type_desc",
                            "area_name",
                        ),
                        row,
                        strict=True,
                    )
                ),
            )
    factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    async with factory() as session:
        yield session
    await engine.dispose()


def _reader(session: AsyncSession) -> PgIngestReader:
    return PgIngestReader(session, table="f_stpes", schema=None)


async def test_list_processes_distinct_and_sorted(ingest_session: AsyncSession) -> None:
    processes = await _reader(ingest_session).list_processes()

    assert [p.key for p in processes] == ["L1::PROC_ALPHA", "L1::PROC_BETA"]
    assert processes[0].display_name == "L1 / PROC_ALPHA"


async def test_get_layers_sorted_with_stable_keys(ingest_session: AsyncSession) -> None:
    layers = await _reader(ingest_session).get_layers("L1", "PROC_ALPHA")

    assert [(layer.step_seq, layer.layer_id) for layer in layers] == [
        ("001", "CLN"),
        ("010", "ACT"),
        ("020", "ACT"),
    ]
    assert layers[0].key == "L1::PROC_ALPHA::001::CLN"
    assert layers[0].area_name == "CLEAN"


async def test_get_layers_missing_process_raises(ingest_session: AsyncSession) -> None:
    with pytest.raises(NotFoundError):
        await _reader(ingest_session).get_layers("L9", "NOPE")


def test_qualified_ref_quotes_and_validates() -> None:
    assert _qualified_ref("f_stpes", "public") == '"public"."f_stpes"'
    assert _qualified_ref("f_stpes", None) == '"f_stpes"'
    with pytest.raises(ValueError):
        _qualified_ref("f_stpes; DROP TABLE x", None)
