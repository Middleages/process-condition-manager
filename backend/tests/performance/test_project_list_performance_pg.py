"""Opt-in PG scale contract. Run pytest -s with APP_TEST_DATABASE_URL for plans.

Uses a guarded disposable database. Timings are evidence, not an SLA. Cursor
traversal assumes a static dataset; concurrent revisions are not snapshot-isolated.
"""

import json
import os
import statistics
import time

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.models  # noqa: F401
from app.core.db import Base, get_app_session
from app.ingest.fixture_reader import get_ingest_reader
from app.ingest.pg_reader import PgIngestReader
from app.main import app
from tests.factories import seed_required_profile_choice_sets
from tests.postgres_database import temporary_postgres_database

pytestmark = pytest.mark.skipif(
    not os.environ.get("APP_TEST_DATABASE_URL"), reason="APP_TEST_DATABASE_URL unset"
)
LINES, IDENTITIES = 6, 2003


def _nodes(plan):
    yield plan
    for child in plan.get("Plans", []):
        yield from _nodes(child)


async def test_line_list_pg_scale_contract():
    with temporary_postgres_database() as database:
        engine = create_async_engine(database.async_url)
        factory = async_sessionmaker(engine, expire_on_commit=False)
        overrides = app.dependency_overrides.copy()
        captured = []

        def capture(_conn, _cursor, statement, parameters, _context, _many):
            if statement.lstrip().upper().startswith("SELECT"):
                captured.append((statement, parameters))

        try:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
                await conn.execute(
                    text("""
                    INSERT INTO project
                        (id,line_id,process_id,part_id,name,status,version,
                         revision_root_id,revision_of_id)
                    SELECT ((l-1)*:n+i-1)*3+r, 'L'||l, 'PROC-'||lpad(i::text,4,'0'),
                           'PART-'||lpad(i::text,4,'0'), 'scale fixture',
                           CASE WHEN r<3 THEN 'archived' WHEN i%2=0 THEN 'review'
                                ELSE 'draft' END, r,
                           CASE WHEN r>1 THEN ((l-1)*:n+i-1)*3+1 END,
                           CASE WHEN r>1 THEN ((l-1)*:n+i-1)*3+r-1 END
                    FROM generate_series(1,:lines) l,
                         generate_series(1,:n) i, generate_series(1,3) r
                """),
                    {"n": IDENTITIES, "lines": LINES},
                )
                for sql in (
                    "INSERT INTO project_profile "
                    "(project_id,process_name,device_type_code,project_category_code) "
                    "SELECT id,process_id,'DEFAULT','DEFAULT' "
                    "FROM project",
                    "INSERT INTO sheet_layer (id,project_id,layer_key,step_seq,layer_id) "
                    "SELECT (p.id-1)*2+s,p.id,'layer-'||s,s::text,'ACT' "
                    "FROM project p,generate_series(1,2) s",
                    "INSERT INTO layer_condition (id,layer_id,condition_index,is_por) "
                    "SELECT id,id,0,true "
                    "FROM sheet_layer",
                    "INSERT INTO cell_value (condition_id,parameter_code,value_text) "
                    "SELECT id,'PARAM-'||s,'nonempty' "
                    "FROM layer_condition,generate_series(1,4) s",
                    "CREATE TABLE scale_ingest AS "
                    "SELECT line_id,process_id,step_seq,layer_id "
                    "FROM project JOIN sheet_layer ON project.id=sheet_layer.project_id "
                    "WHERE version=3",
                    "ANALYZE",
                ):
                    await conn.execute(text(sql))
            async with factory() as session:
                await seed_required_profile_choice_sets(session)
                await session.commit()

            async def session_override():
                async with factory() as session:
                    yield session

            async def reader_override():
                async with factory() as session:
                    yield PgIngestReader(session, table="scale_ingest")

            app.dependency_overrides[get_app_session] = session_override
            app.dependency_overrides[get_ingest_reader] = reader_override
            event.listen(engine.sync_engine, "before_cursor_execute", capture)
            report = {
                "fixture": {
                    "lines": LINES,
                    "identities_per_line": IDENTITIES,
                    "revisions": 3,
                    "projects": LINES * IDENTITIES * 3,
                    "layers": LINES * IDENTITIES * 6,
                    "cells": LINES * IDENTITIES * 24,
                },
                "limitation": "static dataset; concurrent revisions are not snapshot-isolated",
            }
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                started = time.perf_counter()
                response = await client.get("/api/projects/lines")
                assert response.status_code == 200, response.text
                assert response.json() == [f"L{i}" for i in range(1, LINES + 1)]
                catalog_sql = captured[0]
                assert "scale_ingest" in catalog_sql[0]
                assert len(captured) == 2
                report["line_discovery"] = {
                    "elapsed_ms": (time.perf_counter() - started) * 1000,
                    "selects": len(captured),
                    "catalog_source_rows": LINES * IDENTITIES * 2,
                    "materialized_process_pairs": LINES * IDENTITIES,
                    "response_bytes": len(response.content),
                }
                captured.clear()
                response = await client.get("/api/projects", params={"line_id": "L1"})
                assert response.status_code == 200, response.text
                assert len(response.json()["items"]) == 25
                first_sql, first_selects = captured[0], len(captured)
                assert first_selects <= 3
                report["first_page"] = {
                    "selects": first_selects,
                    "response_bytes": len(response.content),
                }
                elapsed, pages = [], 0
                for line in range(1, LINES + 1):
                    ids, cursor = [], None
                    while True:
                        params = {"line_id": f"L{line}"}
                        if cursor is not None:
                            params["cursor"] = cursor
                        captured.clear()
                        started = time.perf_counter()
                        response = await client.get("/api/projects", params=params)
                        elapsed.append((time.perf_counter() - started) * 1000)
                        assert response.status_code == 200, response.text
                        page = response.json()
                        items = page["items"]
                        assert len(items) == min(25, IDENTITIES - len(ids))
                        assert len(captured) <= first_selects
                        assert all(
                            item["line_id"] == f"L{line}"
                            and item["version"] == 3
                            and item["status"] in {"draft", "review"}
                            and item["layer_count"] == 2
                            and item["cell_count"] == 8
                            for item in items
                        )
                        ids.extend(item["id"] for item in items)
                        pages += 1
                        cursor = page["next_cursor"]
                        if cursor is None:
                            break
                    assert ids == [
                        ((line - 1) * IDENTITIES + i) * 3 for i in range(IDENTITIES, 0, -1)
                    ]
                report["traversal"] = {
                    "pages": pages,
                    "identities": LINES * IDENTITIES,
                    "median_ms": statistics.median(elapsed),
                    "max_ms": max(elapsed),
                    "total_ms": sum(elapsed),
                }
                for query in ("proc-0042", "part-0042"):
                    response = await client.get(
                        "/api/projects", params={"line_id": "L2", "query": query}
                    )
                    assert response.status_code == 200, response.text
                    assert [item["id"] for item in response.json()["items"]] == [
                        (IDENTITIES + 42) * 3
                    ]
                    assert response.json()["next_cursor"] is None
            event.remove(engine.sync_engine, "before_cursor_execute", capture)
            async with engine.connect() as conn:
                plans = {}
                for label, (sql, params) in (("first_page", first_sql), ("catalog", catalog_sql)):
                    result = await conn.exec_driver_sql(
                        "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + sql, params
                    )
                    plans[label] = result.scalar_one()[0]
                report["plans"] = plans
                print("LINE_LIST_SCALE_REPORT=" + json.dumps(report))
                aggregates = [
                    node
                    for node in _nodes(plans["first_page"]["Plan"])
                    if node.get("Parent Relationship") == "SubPlan"
                ]
                assert len(aggregates) == 3
                assert all(node["Actual Loops"] <= 26 for node in aggregates), aggregates
                assert plans["catalog"]["Plan"]["Actual Rows"] == LINES * IDENTITIES
        finally:
            if event.contains(engine.sync_engine, "before_cursor_execute", capture):
                event.remove(engine.sync_engine, "before_cursor_execute", capture)
            app.dependency_overrides.clear()
            app.dependency_overrides.update(overrides)
            await engine.dispose()
