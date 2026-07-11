"""시트 조회 API 성능 측정 (게이트 판정용).

100 layer x 200 parameter(약 2만 셀, 조건 1행 기준) 규모의 프로젝트를 시드하고,
SheetService.get_sheet 의 직렬화 시간과 응답(JSON) 크기를 측정해 출력한다.

게이트(계획 문서): 응답 < 1초 또는 < 5MB 이면 현재 중첩 dict 포맷을 유지한다.
임계값을 넘을 때만 행 배열 + 컬럼 인덱스 포맷으로 전환한다.

측정은 외부 DB 없이 인메모리 SQLite로 수행한다 — 관심 대상은 Python 직렬화
비용이지 DB 왕복이 아니다(단일 selectinload 트리 로드).

실행: `cd backend && uv run python -m scripts.measure_sheet_perf`
"""

import asyncio
import time

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 — 모든 모델을 metadata에 등록
from app.core.db import Base
from app.features.sheets.repository import SheetRepository
from app.features.sheets.service import SheetService
from scripts.seed_dev import seed_parameters, seed_project

_NUM_LAYERS = 100
_NUM_PARAMETERS = 200


async def measure() -> None:
    engine = create_async_engine(
        "sqlite+aiosqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        codes = await seed_parameters(session, count=_NUM_PARAMETERS, category_count=5)
        project_id = await seed_project(
            session,
            parameter_codes=codes,
            num_layers=_NUM_LAYERS,
            multi_condition_every=10_000,  # 순수 밀도 측정: 조건 1행 기준
            fill_ratio=1.0,
        )
        await session.commit()

    async with session_factory() as session:
        service = SheetService(SheetRepository(session))
        # 워밍업(캐시/컴파일 제외한 직렬화 순수 측정을 위해 1회 선행).
        await service.get_sheet(project_id, user_id="perf")

        start = time.perf_counter()
        sheet = await service.get_sheet(project_id, user_id="perf")
        payload = sheet.model_dump_json()
        elapsed = time.perf_counter() - start

    await engine.dispose()

    size_bytes = len(payload.encode("utf-8"))
    cell_total = sum(len(row.cells) for row in sheet.rows)
    print("=== sheet API perf ===")
    print(f"layers            : {_NUM_LAYERS}")
    print(f"columns           : {len(sheet.columns)}")
    print(f"rows              : {len(sheet.rows)}")
    print(f"cells (non-empty) : {cell_total}")
    print(f"serialize time    : {elapsed * 1000:.1f} ms")
    print(f"response size     : {size_bytes / 1_000_000:.3f} MB")
    print(f"gate <1s / <5MB   : {'PASS' if elapsed < 1.0 and size_bytes < 5_000_000 else 'REVIEW'}")


if __name__ == "__main__":
    asyncio.run(measure())
