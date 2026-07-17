"""PostgreSQL snapshot races for the public Backbone diff traversal."""

from __future__ import annotations

import json
import os
import threading
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Literal

import pytest
from httpx import ASGITransport, AsyncClient, Response
from sqlalchemy import Connection, Engine, create_engine, event, text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

import app.models  # noqa: F401 -- register every model for metadata.create_all
from app.core.auth import UserContext, get_current_user
from app.core.db import Base, get_app_session
from app.domain.backbone.snapshot import (
    BackboneSnapshot,
    BackboneSnapshotCell,
    BackboneSnapshotColumn,
    BackboneSnapshotCondition,
    BackboneSnapshotSource,
    serialize_backbone_snapshot,
)
from app.domain.parameters.types import ValueType
from app.features.backbone_diff.provider import BackboneDiffProvider
from app.features.backbone_diff.read_snapshot import build_read_only_sessionmaker
from app.main import app
from app.models.parameter import Parameter, ParameterCategory
from app.models.project import CellValue, LayerCondition, Project, SheetLayer
from tests.factories import make_project_profile
from tests.postgres_database import temporary_postgres_database

_PG_URL = os.environ.get("APP_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(_PG_URL is None, reason="APP_TEST_DATABASE_URL 미설정")

_LAYER_KEY = "L1::PROC_RACE::010::ACT"
_ROOT_PARAMS = {"include_unchanged": "true", "preview_limit": "20"}
_MUTATIONS = (
    "cell_update",
    "condition_add",
    "condition_delete",
    "layer_replacement",
    "parameter_display",
    "parameter_category",
    "parameter_sort",
    "parameter_active",
)

MutationKind = Literal[
    "cell_update",
    "condition_add",
    "condition_delete",
    "layer_replacement",
    "parameter_display",
    "parameter_category",
    "parameter_sort",
    "parameter_active",
]


@dataclass(frozen=True, slots=True)
class _PgHarness:
    async_engine: AsyncEngine
    session_factory: async_sessionmaker[AsyncSession]
    sync_engine: Engine


@dataclass(frozen=True, slots=True)
class _Seed:
    project_id: int
    layer_id: int
    condition_id: int
    alpha_cell_id: int
    photo_category_id: int
    alternate_category_id: int
    original_snapshot: dict[str, Any]
    replacement_snapshot: dict[str, Any]


@dataclass(frozen=True, slots=True)
class _Traversal:
    root: dict[str, Any]
    condition: dict[str, Any]
    cell: dict[str, Any]
    branch_scope: str
    row_ref: str
    cell_scope: str


@pytest.fixture
async def pg_harness() -> AsyncIterator[_PgHarness]:
    assert _PG_URL is not None
    with temporary_postgres_database() as database:
        async_engine = create_async_engine(database.async_url)
        sync_engine = create_engine(database.sync_url)
        async with async_engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        try:
            yield _PgHarness(
                async_engine=async_engine,
                session_factory=async_sessionmaker(
                    async_engine,
                    expire_on_commit=False,
                    class_=AsyncSession,
                ),
                sync_engine=sync_engine,
            )
        finally:
            await async_engine.dispose()
            sync_engine.dispose()


@pytest.fixture
async def pg_client(pg_harness: _PgHarness) -> AsyncIterator[AsyncClient]:
    async def _session_override() -> AsyncIterator[AsyncSession]:
        async with pg_harness.session_factory() as session:
            yield session

    async def _user_override() -> UserContext:
        return UserContext(id="pg-backbone-diff-test")

    app.dependency_overrides[get_app_session] = _session_override
    app.dependency_overrides[get_current_user] = _user_override
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            yield client
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_app_session, None)


def _snapshot(*, replacement: bool) -> dict[str, Any]:
    alpha_value = "replacement-baseline" if replacement else "baseline-alpha"
    source_project_id = 9002 if replacement else 9001
    return serialize_backbone_snapshot(
        BackboneSnapshot(
            capture_batch_id=("fedcba9876543210" * 2 if replacement else "0123456789abcdef" * 2),
            source=BackboneSnapshotSource(
                project_id=source_project_id,
                sheet_layer_id=source_project_id,
                layer_key=_LAYER_KEY,
                step_seq="010",
                layer_id="ACT",
            ),
            columns=(
                BackboneSnapshotColumn(
                    parameter_code="alpha",
                    value_type=ValueType.TEXT,
                    display_name="Alpha",
                    category_code="photo",
                    sort_order=1,
                    active_at_capture=True,
                ),
                BackboneSnapshotColumn(
                    parameter_code="beta",
                    value_type=ValueType.TEXT,
                    display_name="Beta",
                    category_code="photo",
                    sort_order=2,
                    active_at_capture=True,
                ),
            ),
            conditions=(
                BackboneSnapshotCondition(
                    source_condition_id=101,
                    label="baseline",
                    condition_index=0,
                    is_por=True,
                    cells=(
                        BackboneSnapshotCell(parameter_code="alpha", value=alpha_value),
                        BackboneSnapshotCell(parameter_code="beta", value="baseline-beta"),
                    ),
                ),
            ),
        )
    )


async def _seed_project(factory: async_sessionmaker[AsyncSession]) -> _Seed:
    original_snapshot = _snapshot(replacement=False)
    replacement_snapshot = _snapshot(replacement=True)
    async with factory() as session:
        photo = ParameterCategory(code="photo", display_name="Photo", sort_order=1)
        alternate = ParameterCategory(code="alternate", display_name="Alternate", sort_order=2)
        session.add_all(
            [
                Parameter(
                    code="alpha",
                    display_name="Alpha",
                    value_type=ValueType.TEXT,
                    sort_order=1,
                    category=photo,
                    is_active=True,
                ),
                Parameter(
                    code="beta",
                    display_name="Beta",
                    value_type=ValueType.TEXT,
                    sort_order=2,
                    category=photo,
                    is_active=True,
                ),
                alternate,
            ]
        )
        project = Project(
            line_id="L1",
            process_id="PROC_RACE",
            part_id="PART_RACE",
            name="Backbone diff PG race",
            profile=make_project_profile(process_name="PROC_RACE"),
        )
        layer = SheetLayer(
            layer_key=_LAYER_KEY,
            step_seq="010",
            layer_id="ACT",
            eqp_type="ACT",
            eqp_type_desc="Active",
            area_name="PHOTO",
            sort_order=1,
            source_project_id=9001,
            source_layer_key=_LAYER_KEY,
            backbone_snapshot=original_snapshot,
        )
        condition = LayerCondition(
            label="current",
            condition_index=0,
            is_por=True,
            source_condition_id=101,
        )
        alpha_cell = CellValue(parameter_code="alpha", value_text="current-alpha")
        condition.cell_values.extend(
            [
                alpha_cell,
                CellValue(parameter_code="beta", value_text="current-beta"),
            ]
        )
        layer.conditions.append(condition)
        project.layers.append(layer)
        session.add(project)
        await session.commit()
        return _Seed(
            project_id=project.id,
            layer_id=layer.id,
            condition_id=condition.id,
            alpha_cell_id=alpha_cell.id,
            photo_category_id=photo.id,
            alternate_category_id=alternate.id,
            original_snapshot=original_snapshot,
            replacement_snapshot=replacement_snapshot,
        )


def _mutation_sql(kind: MutationKind, seed: _Seed, *, restore: bool) -> tuple[str, dict[str, Any]]:
    if kind == "cell_update":
        return (
            "UPDATE cell_value SET value_text = :value WHERE id = :cell_id",
            {
                "cell_id": seed.alpha_cell_id,
                "value": "current-alpha" if restore else "mutated-alpha",
            },
        )
    if kind == "condition_add":
        if restore:
            return (
                "DELETE FROM layer_condition WHERE layer_id = :layer_id AND label = :label",
                {"layer_id": seed.layer_id, "label": "race-added"},
            )
        return (
            "INSERT INTO layer_condition "
            "(layer_id, label, condition_index, is_por, source_condition_id) "
            "VALUES (:layer_id, :label, 10, false, NULL)",
            {"layer_id": seed.layer_id, "label": "race-added"},
        )
    if kind == "condition_delete":
        if not restore:
            return (
                "DELETE FROM layer_condition WHERE id = :condition_id",
                {"condition_id": seed.condition_id},
            )
        return (
            "WITH restored AS ("
            "  INSERT INTO layer_condition "
            "    (id, layer_id, label, condition_index, is_por, source_condition_id) "
            "  VALUES (:condition_id, :layer_id, 'current', 0, true, 101) "
            "  RETURNING id"
            ") "
            "INSERT INTO cell_value (condition_id, parameter_code, value_text) "
            "SELECT id, 'alpha', 'current-alpha' FROM restored "
            "UNION ALL "
            "SELECT id, 'beta', 'current-beta' FROM restored",
            {"condition_id": seed.condition_id, "layer_id": seed.layer_id},
        )
    if kind == "layer_replacement":
        snapshot = seed.original_snapshot if restore else seed.replacement_snapshot
        source_project_id = 9001 if restore else 9002
        return (
            "UPDATE sheet_layer "
            "SET backbone_snapshot = CAST(:snapshot AS JSONB), source_project_id = :source_id "
            "WHERE id = :layer_id",
            {
                "snapshot": json.dumps(snapshot, separators=(",", ":")),
                "source_id": source_project_id,
                "layer_id": seed.layer_id,
            },
        )
    if kind == "parameter_display":
        return (
            "UPDATE parameter SET display_name = :value WHERE code = 'alpha'",
            {"value": "Alpha" if restore else "Alpha mutated"},
        )
    if kind == "parameter_category":
        return (
            "UPDATE parameter SET category_id = :category_id WHERE code = 'alpha'",
            {"category_id": (seed.photo_category_id if restore else seed.alternate_category_id)},
        )
    if kind == "parameter_sort":
        return (
            "UPDATE parameter SET sort_order = :value WHERE code = 'alpha'",
            {"value": 1 if restore else 99},
        )
    return (
        "UPDATE parameter SET is_active = :value WHERE code = 'alpha'",
        {"value": True if restore else False},
    )


def _write_mutation(engine: Engine, kind: MutationKind, seed: _Seed, *, restore: bool) -> None:
    statement, parameters = _mutation_sql(kind, seed, restore=restore)
    with engine.begin() as connection:
        connection.execute(text(statement), parameters)
        if kind == "layer_replacement":
            connection.execute(
                text("UPDATE layer_condition SET label = :label WHERE id = :condition_id"),
                {
                    "condition_id": seed.condition_id,
                    "label": "current" if restore else "replacement-current",
                },
            )
            connection.execute(
                text("UPDATE cell_value SET value_text = :value WHERE id = :cell_id"),
                {
                    "cell_id": seed.alpha_cell_id,
                    "value": "current-alpha" if restore else "replacement-alpha",
                },
            )


def _is_first_graph_select(statement: str) -> bool:
    normalized = " ".join(statement.upper().split())
    return normalized.startswith("SELECT") and " FROM PROJECT " in f" {normalized} "


async def _race_after_first_graph_select(
    *,
    harness: _PgHarness,
    request: Callable[[], Awaitable[Response]],
    mutation: MutationKind,
    seed: _Seed,
) -> tuple[Response, list[str]]:
    """Commit the writer after the project SELECT establishes the RR snapshot."""

    graph_selected = threading.Event()
    writer_committed = threading.Event()
    writer_errors: list[BaseException] = []
    statements: list[str] = []
    barrier_hits = 0

    def writer() -> None:
        if not graph_selected.wait(timeout=10):
            writer_errors.append(TimeoutError("first graph SELECT barrier was not reached"))
            writer_committed.set()
            return
        try:
            _write_mutation(harness.sync_engine, mutation, seed, restore=False)
        except BaseException as exc:  # pragma: no cover - surfaced on the request thread
            writer_errors.append(exc)
        finally:
            writer_committed.set()

    writer_thread = threading.Thread(target=writer, name=f"backbone-diff-{mutation}")

    def after_cursor_execute(
        _connection: Connection,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        nonlocal barrier_hits
        statements.append(statement)
        if _is_first_graph_select(statement) and barrier_hits == 0:
            barrier_hits += 1
            graph_selected.set()
            if not writer_committed.wait(timeout=10):
                raise TimeoutError("writer did not commit at the first graph SELECT barrier")

    event.listen(harness.async_engine.sync_engine, "after_cursor_execute", after_cursor_execute)
    writer_thread.start()
    try:
        response = await request()
    finally:
        event.remove(harness.async_engine.sync_engine, "after_cursor_execute", after_cursor_execute)
        writer_thread.join(timeout=10)

    assert not writer_thread.is_alive()
    assert writer_errors == []
    assert barrier_hits == 1
    assert graph_selected.is_set()
    assert writer_committed.is_set()
    assert statements
    assert statements[0].lstrip().upper().startswith("SET TRANSACTION READ ONLY")
    select_count = sum(statement.lstrip().upper().startswith("SELECT") for statement in statements)
    assert len(statements) <= 9
    assert select_count <= 8
    return response, statements


async def _root(client: AsyncClient, project_id: int) -> Response:
    return await client.get(
        f"/api/projects/{project_id}/backbone-diff",
        params=_ROOT_PARAMS,
    )


def _matched_or_first_cell_row(items: list[dict[str, Any]]) -> dict[str, Any]:
    rows_with_cells = [item for item in items if item.get("cell_scope")]
    assert rows_with_cells
    return next(
        (item for item in rows_with_cells if item["row_status"] == "matched"),
        rows_with_cells[0],
    )


async def _traverse(client: AsyncClient, project_id: int) -> _Traversal:
    root_response = await _root(client, project_id)
    assert root_response.status_code == 200, root_response.text
    root = root_response.json()
    summary = next(item for item in root["layer_summaries"] if item["layer_key"] == _LAYER_KEY)
    branch_scope = summary["branch_scope"]
    assert isinstance(branch_scope, str)
    condition_response = await client.get(
        f"/api/projects/{project_id}/backbone-diff/layers/{_LAYER_KEY}/conditions",
        params={"scope": branch_scope, "limit": 100},
    )
    assert condition_response.status_code == 200, condition_response.text
    condition = condition_response.json()
    row = _matched_or_first_cell_row(condition["items"])
    row_ref = row["row_ref"]
    cell_scope = row["cell_scope"]
    cell_response = await client.get(
        f"/api/projects/{project_id}/backbone-diff/layers/{_LAYER_KEY}/conditions/{row_ref}/cells",
        params={"scope": cell_scope, "limit": 200},
    )
    assert cell_response.status_code == 200, cell_response.text
    return _Traversal(
        root=root,
        condition=condition,
        cell=cell_response.json(),
        branch_scope=branch_scope,
        row_ref=row_ref,
        cell_scope=cell_scope,
    )


def _assert_stale(response: Response) -> None:
    assert response.status_code == 409, response.text
    assert response.json() == {
        "code": "diff_basis_changed",
        "message": "backbone diff basis changed",
    }


@pytest.mark.parametrize("mutation", _MUTATIONS)
async def test_backbone_diff_endpoints_never_mix_graph_versions_during_pg_writes(
    mutation: MutationKind,
    pg_harness: _PgHarness,
    pg_client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seed = await _seed_project(pg_harness.session_factory)
    original = await _traverse(pg_client, seed.project_id)

    projection_calls = {"condition": 0, "cell": 0}
    real_branch_rows = BackboneDiffProvider._branch_rows
    real_cell_items = BackboneDiffProvider._cell_items

    def tracked_branch_rows(self: BackboneDiffProvider, *args: Any, **kwargs: Any) -> Any:
        projection_calls["condition"] += 1
        return real_branch_rows(self, *args, **kwargs)

    def tracked_cell_items(self: BackboneDiffProvider, *args: Any, **kwargs: Any) -> Any:
        projection_calls["cell"] += 1
        return real_cell_items(self, *args, **kwargs)

    monkeypatch.setattr(BackboneDiffProvider, "_branch_rows", tracked_branch_rows)
    monkeypatch.setattr(BackboneDiffProvider, "_cell_items", tracked_cell_items)

    async def restore_and_assert_original() -> _Traversal:
        _write_mutation(pg_harness.sync_engine, mutation, seed, restore=True)
        restored = await _traverse(pg_client, seed.project_id)
        assert restored.root == original.root
        assert restored.condition == original.condition
        assert restored.cell == original.cell
        return restored

    root_race, _ = await _race_after_first_graph_select(
        harness=pg_harness,
        request=lambda: _root(pg_client, seed.project_id),
        mutation=mutation,
        seed=seed,
    )
    assert root_race.status_code == 200, root_race.text
    assert root_race.json() == original.root
    post_root = await _root(pg_client, seed.project_id)
    assert post_root.status_code == 200, post_root.text
    assert post_root.json() != original.root
    assert (await _root(pg_client, seed.project_id)).json() == post_root.json()

    condition_pre = await restore_and_assert_original()
    condition_race, _ = await _race_after_first_graph_select(
        harness=pg_harness,
        request=lambda: pg_client.get(
            f"/api/projects/{seed.project_id}/backbone-diff/layers/{_LAYER_KEY}/conditions",
            params={"scope": condition_pre.branch_scope, "limit": 100},
        ),
        mutation=mutation,
        seed=seed,
    )
    assert condition_race.status_code == 200, condition_race.text
    assert condition_race.json() == condition_pre.condition
    condition_projection_count = projection_calls["condition"]
    stale_condition = await pg_client.get(
        f"/api/projects/{seed.project_id}/backbone-diff/layers/{_LAYER_KEY}/conditions",
        params={"scope": condition_pre.branch_scope, "limit": 100},
    )
    _assert_stale(stale_condition)
    assert projection_calls["condition"] == condition_projection_count
    post_condition = await _traverse(pg_client, seed.project_id)
    assert post_condition.root != original.root
    assert post_condition.condition != original.condition

    cell_pre = await restore_and_assert_original()
    cell_race, _ = await _race_after_first_graph_select(
        harness=pg_harness,
        request=lambda: pg_client.get(
            f"/api/projects/{seed.project_id}/backbone-diff/layers/{_LAYER_KEY}"
            f"/conditions/{cell_pre.row_ref}/cells",
            params={"scope": cell_pre.cell_scope, "limit": 200},
        ),
        mutation=mutation,
        seed=seed,
    )
    assert cell_race.status_code == 200, cell_race.text
    assert cell_race.json() == cell_pre.cell
    cell_projection_count = projection_calls["cell"]
    stale_cell = await pg_client.get(
        f"/api/projects/{seed.project_id}/backbone-diff/layers/{_LAYER_KEY}"
        f"/conditions/{cell_pre.row_ref}/cells",
        params={"scope": cell_pre.cell_scope, "limit": 200},
    )
    _assert_stale(stale_cell)
    assert projection_calls["cell"] == cell_projection_count
    post_cell = await _traverse(pg_client, seed.project_id)
    assert post_cell.root != original.root
    assert post_cell.cell != original.cell


async def test_backbone_diff_read_factory_uses_repeatable_read_and_read_only_pg(
    pg_harness: _PgHarness,
) -> None:
    read_factory = build_read_only_sessionmaker(pg_harness.async_engine)
    async with read_factory() as session:
        await session.execute(text("SET TRANSACTION READ ONLY"))
        isolation = (await session.execute(text("SHOW transaction_isolation"))).scalar_one()
        read_only = (await session.execute(text("SHOW transaction_read_only"))).scalar_one()

    assert str(isolation).upper() == "REPEATABLE READ"
    assert str(read_only).upper() == "ON"
