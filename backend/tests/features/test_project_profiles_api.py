"""Project creation/Profile read, list, and locked atomic patch contracts."""

from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from httpx import AsyncClient, Response
from sqlalchemy import String, event, func, select, update
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.ingest.fixture_reader import get_ingest_reader
from app.ingest.reader import LayerInfo, ProcessInfo, process_key
from app.main import app
from app.models.choice import ChoiceOption, ChoiceSet
from app.models.project import (
    ChangeEvent,
    ChangeEventType,
    EditLock,
    Project,
    ProjectProfile,
)
from app.project_metadata import ProjectProfileSeed, get_project_metadata_provider
from tests.factories import seed_choice_set


class SeedProvider:
    identifier = "test-seed"

    async def load_seed(self, *, line_id: str, process_id: str, part_id: str) -> ProjectProfileSeed:
        assert (line_id, process_id, part_id) == ("L1", "PROC_ALPHA", "PART-1")
        return ProjectProfileSeed(comment="provider comment", pitch_x="001.5000", gross_die=" 20 ")


class EmptyProvider:
    identifier = "empty-test"

    async def load_seed(self, *, line_id: str, process_id: str, part_id: str) -> ProjectProfileSeed:
        return ProjectProfileSeed()


class FailingProvider:
    identifier = "failing-test"

    async def load_seed(self, *, line_id: str, process_id: str, part_id: str) -> ProjectProfileSeed:
        raise RuntimeError("provider unavailable")


class RecordingProvider:
    identifier = "recording-test"

    def __init__(self, seed: ProjectProfileSeed | None = None) -> None:
        self.seed = seed or ProjectProfileSeed()
        self.calls: list[tuple[str, str, str]] = []

    async def load_seed(self, *, line_id: str, process_id: str, part_id: str) -> ProjectProfileSeed:
        self.calls.append((line_id, process_id, part_id))
        return self.seed


class RecordingReader:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, str]] = []

    async def list_processes(self) -> list[ProcessInfo]:
        return []

    async def get_process(self, line_id: str, process_id: str) -> ProcessInfo:
        self.calls.append(("process", line_id, process_id))
        return ProcessInfo(
            key=process_key(line_id, process_id),
            line_id=line_id,
            process_id=process_id,
            display_name=f"{line_id} / {process_id}",
        )

    async def get_layers(self, line_id: str, process_id: str) -> list[LayerInfo]:
        self.calls.append(("layers", line_id, process_id))
        return []


async def _seed_profile_choices(
    session: AsyncSession,
    *,
    device_set_active: bool = True,
    foundry_active: bool = True,
    include_category: bool = True,
) -> None:
    await seed_choice_set(
        session,
        code="device_type",
        is_active=device_set_active,
        options=(
            ("FOUNDRY", "Foundry", foundry_active),
            ("SPECIAL", "Special customer", True),
            ("LEGACY", "Legacy device", False),
        ),
    )
    if include_category:
        await seed_choice_set(
            session,
            code="project_category",
            options=(("LOGIC", "Logic", True), ("MEMORY", "Memory", True)),
        )
    await seed_choice_set(
        session,
        code="active_direction",
        options=(("UP", "Up", True), ("OLD", "Old direction", False)),
    )
    await seed_choice_set(
        session,
        code="gate_direction",
        options=(("LEFT", "Left", True),),
    )
    await session.commit()


def _create_payload(**overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "line_id": "L1",
        "process_id": "PROC_ALPHA",
        "part_id": "PART-1",
        "name": "Alpha",
        "device_type_code": "FOUNDRY",
        "project_category_code": "LOGIC",
    }
    payload.update(overrides)
    return payload


async def _create(
    client: AsyncClient,
    *,
    provider: object | None = None,
    **overrides: Any,
) -> Response:
    if provider is not None:
        app.dependency_overrides[get_project_metadata_provider] = lambda: provider
    return await client.post("/api/projects", json=_create_payload(**overrides))


async def _profile_events(session: AsyncSession, project_id: int) -> list[ChangeEvent]:
    session.expire_all()
    rows = await session.execute(
        select(ChangeEvent)
        .where(
            ChangeEvent.project_id == project_id,
            ChangeEvent.event_type == ChangeEventType.PROJECT_PROFILE_UPDATE,
        )
        .order_by(ChangeEvent.id)
    )
    return list(rows.scalars())


@pytest.fixture
async def profile_client(
    db_client: AsyncClient, db_session: AsyncSession
) -> AsyncIterator[AsyncClient]:
    await _seed_profile_choices(db_session)
    try:
        yield db_client
    finally:
        app.dependency_overrides.pop(get_project_metadata_provider, None)
        app.dependency_overrides.pop(get_ingest_reader, None)


@dataclass
class ProjectWithLock:
    client: AsyncClient
    session: AsyncSession
    project_id: int
    token: str

    async def patch_profile(self, payload: dict[str, Any]) -> Response:
        return await self.client.patch(
            f"/api/projects/{self.project_id}/profile",
            json=payload,
            headers={"X-Lock-Token": self.token},
        )

    async def latest_profile_event(self) -> ChangeEvent:
        events = await _profile_events(self.session, self.project_id)
        assert events
        return events[-1]


@pytest.fixture
async def project_with_lock(
    profile_client: AsyncClient, db_session: AsyncSession
) -> ProjectWithLock:
    created = await _create(
        profile_client,
        provider=SeedProvider(),
        comment="explicit comment",
    )
    assert created.status_code == 201, created.text
    project_id = created.json()["id"]
    acquired = await profile_client.post(f"/api/projects/{project_id}/lock")
    assert acquired.status_code == 200, acquired.text
    return ProjectWithLock(
        client=profile_client,
        session=db_session,
        project_id=project_id,
        token=acquired.json()["lock_token"],
    )


def test_project_profile_model_has_fixed_code_columns() -> None:
    table = ProjectProfile.__table__
    expected_nullable = {
        "device_type_code": False,
        "project_category_code": False,
        "active_direction_code": True,
        "gate_direction_code": True,
    }
    for name, nullable in expected_nullable.items():
        column_type = table.c[name].type
        assert isinstance(column_type, String)
        assert column_type.length == 128
        assert table.c[name].nullable is nullable
    assert Project.profile.property.uselist is False


async def test_create_project_builds_fixed_profile_and_complete_provenance(
    profile_client: AsyncClient, db_session: AsyncSession
) -> None:
    response = await _create(
        profile_client,
        provider=SeedProvider(),
        comment="explicit comment",
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["profile"]["process_name"] == "L1 / PROC_ALPHA"
    assert body["profile"]["device_type"] == {
        "code": "FOUNDRY",
        "label": "Foundry",
        "is_active": True,
    }
    assert body["profile"]["comment"] == "explicit comment"
    assert body["profile"]["pitch_x"] == "1.5"
    assert body["profile"]["gross_die"] == "20"
    assert "description" not in body

    events = list(
        (
            await db_session.execute(
                select(ChangeEvent)
                .where(ChangeEvent.project_id == body["id"])
                .order_by(ChangeEvent.id)
            )
        ).scalars()
    )
    assert [item.event_type for item in events] == [ChangeEventType.PROJECT_CREATE]
    payload = events[0].payload
    assert payload["metadata_provider"] == "test-seed"
    assert payload["profile_seed"]["comment"] == "provider comment"
    assert payload["profile_seed"]["pitch_x"] == "001.5000"
    assert payload["profile_seed"]["gross_die"] == " 20 "
    assert payload["profile_final"]["comment"] == "explicit comment"
    assert payload["profile_final"]["pitch_x"] == "1.5"
    assert payload["profile_final"]["gross_die"] == "20"
    assert payload["profile_final"]["process_name"] == "L1 / PROC_ALPHA"
    assert payload["profile_final"]["device_type_code"] == "FOUNDRY"
    assert payload["profile_final"]["project_category_code"] == "LOGIC"
    assert payload["profile_final"]["map_offset_x"] is None
    assert payload["batch_id"]
    assert not any(
        forbidden in str(payload).lower()
        for forbidden in ("password", "credential", "connection", "query")
    )


async def test_create_normalizes_identity_once_for_every_downstream_consumer(
    profile_client: AsyncClient, db_session: AsyncSession
) -> None:
    reader = RecordingReader()
    provider = RecordingProvider()
    app.dependency_overrides[get_ingest_reader] = lambda: reader

    response = await _create(
        profile_client,
        provider=provider,
        line_id="  L1  ",
        process_id=" PROC_ALPHA ",
        part_id=" PART-1 ",
        name=" Alpha ",
        device_type_code=" FOUNDRY ",
        project_category_code=" LOGIC ",
    )

    assert response.status_code == 201, response.text
    assert reader.calls == [
        ("process", "L1", "PROC_ALPHA"),
        ("layers", "L1", "PROC_ALPHA"),
    ]
    assert provider.calls == [("L1", "PROC_ALPHA", "PART-1")]
    stored = await db_session.get(Project, response.json()["id"])
    assert stored is not None
    assert (stored.line_id, stored.process_id, stored.part_id, stored.name) == (
        "L1",
        "PROC_ALPHA",
        "PART-1",
        "Alpha",
    )
    event_row = (
        await db_session.execute(
            select(ChangeEvent).where(
                ChangeEvent.project_id == stored.id,
                ChangeEvent.event_type == ChangeEventType.PROJECT_CREATE,
            )
        )
    ).scalar_one()
    assert event_row.payload["identity"] == {
        "line_id": "L1",
        "process_id": "PROC_ALPHA",
        "part_id": "PART-1",
        "name": "Alpha",
    }


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("line_id", "   "),
        ("line_id", "L" * 65),
        ("process_id", "   "),
        ("process_id", "P" * 129),
        ("part_id", "   "),
        ("part_id", "P" * 129),
        ("name", "   "),
        ("name", "N" * 257),
    ],
)
async def test_create_rejects_invalid_identity_before_downstream_calls(
    profile_client: AsyncClient,
    field: str,
    value: str,
) -> None:
    reader = RecordingReader()
    provider = RecordingProvider()
    app.dependency_overrides[get_ingest_reader] = lambda: reader

    response = await _create(profile_client, provider=provider, **{field: value})

    assert response.status_code == 422
    assert reader.calls == []
    assert provider.calls == []


async def test_duplicate_lookup_uses_canonical_padded_identity(
    profile_client: AsyncClient,
) -> None:
    first = await _create(profile_client, provider=EmptyProvider())
    duplicate = await _create(
        profile_client,
        provider=EmptyProvider(),
        line_id=" L1 ",
        process_id=" PROC_ALPHA ",
        part_id=" PART-1 ",
    )

    assert first.status_code == 201, first.text
    assert duplicate.status_code == 409
    assert duplicate.json()["details"]["existing_project_id"] == first.json()["id"]


@pytest.mark.parametrize(
    "choice_setup",
    ["missing_category", "inactive_set", "inactive_option"],
)
async def test_create_rejects_unavailable_required_choices_without_partial_rows(
    db_client: AsyncClient,
    db_session: AsyncSession,
    choice_setup: str,
) -> None:
    await _seed_profile_choices(
        db_session,
        include_category=choice_setup != "missing_category",
        device_set_active=choice_setup != "inactive_set",
        foundry_active=choice_setup != "inactive_option",
    )

    response = await _create(db_client, provider=EmptyProvider())

    assert response.status_code == 422
    assert (await db_session.scalar(select(func.count(Project.id)))) == 0
    assert (await db_session.scalar(select(func.count(ChangeEvent.id)))) == 0
    assert (await db_session.scalar(select(func.count(ProjectProfile.project_id)))) == 0
    app.dependency_overrides.pop(get_project_metadata_provider, None)


async def test_provider_failure_rolls_back_all_creation_rows(
    profile_client: AsyncClient, db_session: AsyncSession
) -> None:
    with pytest.raises(RuntimeError, match="provider unavailable"):
        await _create(profile_client, provider=FailingProvider())

    assert (await db_session.scalar(select(func.count(Project.id)))) == 0
    assert (await db_session.scalar(select(func.count(ChangeEvent.id)))) == 0


async def test_explicit_required_choices_override_provider_defaults(
    profile_client: AsyncClient,
) -> None:
    provider = RecordingProvider(
        ProjectProfileSeed(
            device_type_code="LEGACY",
            project_category_code="MEMORY",
        )
    )

    response = await _create(profile_client, provider=provider)

    assert response.status_code == 201, response.text
    assert response.json()["profile"]["device_type"]["code"] == "FOUNDRY"
    assert response.json()["profile"]["project_category"]["code"] == "LOGIC"


@pytest.mark.parametrize(
    ("comment_marker", "expected"),
    [("omitted", "provider comment"), ("null", None)],
)
async def test_create_comment_omission_keeps_seed_but_null_clears_it(
    profile_client: AsyncClient,
    comment_marker: str,
    expected: str | None,
) -> None:
    provider = RecordingProvider(ProjectProfileSeed(comment="provider comment"))
    overrides = {} if comment_marker == "omitted" else {"comment": None}

    response = await _create(profile_client, provider=provider, **overrides)

    assert response.status_code == 201, response.text
    assert response.json()["profile"]["comment"] == expected


async def test_backbone_create_records_project_create_and_copy_events(
    profile_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    source = await _create(profile_client, provider=EmptyProvider(), part_id="SOURCE")
    target = await _create(
        profile_client,
        provider=EmptyProvider(),
        process_id="PROC_BETA",
        part_id="TARGET",
        backbone_project_id=source.json()["id"],
    )
    assert target.status_code == 201, target.text

    event_types = list(
        (
            await db_session.execute(
                select(ChangeEvent.event_type)
                .where(ChangeEvent.project_id == target.json()["id"])
                .order_by(ChangeEvent.id)
            )
        ).scalars()
    )
    assert event_types == [ChangeEventType.PROJECT_CREATE, ChangeEventType.BACKBONE_COPY]


async def test_project_list_filters_exact_profile_choices(
    profile_client: AsyncClient,
) -> None:
    await _create(profile_client, provider=EmptyProvider(), part_id="A")
    await _create(
        profile_client,
        provider=EmptyProvider(),
        part_id="B",
        device_type_code="SPECIAL",
        project_category_code="MEMORY",
    )

    filtered = await profile_client.get(
        "/api/projects",
        params={"device_type_code": " SPECIAL ", "project_category_code": " MEMORY "},
    )

    assert filtered.status_code == 200, filtered.text
    assert [item["part_id"] for item in filtered.json()["items"]] == ["B"]
    summary = filtered.json()["items"][0]
    assert summary["device_type"]["label"] == "Special customer"
    assert summary["project_category"]["label"] == "Memory"
    assert "comment" not in summary
    assert "description" not in summary
    assert "layer_total" in summary
    assert summary["updated_at"]


@pytest.mark.parametrize("query", ["secret note", "SPECIAL", "customer", "logic"])
async def test_project_list_searches_profile_comment_and_resolved_choice(
    profile_client: AsyncClient,
    query: str,
) -> None:
    created = await _create(
        profile_client,
        provider=EmptyProvider(),
        part_id="SEARCHABLE",
        device_type_code="SPECIAL",
        comment="Secret Note",
    )
    assert created.status_code == 201, created.text

    response = await profile_client.get("/api/projects", params={"query": query})

    assert [item["id"] for item in response.json()["items"]] == [created.json()["id"]]


async def test_project_list_resolves_page_in_one_select_without_option_n_plus_one(
    profile_client: AsyncClient,
    db_engine: AsyncEngine,
) -> None:
    for part_id in ("A", "B", "C"):
        response = await _create(profile_client, provider=EmptyProvider(), part_id=part_id)
        assert response.status_code == 201, response.text

    statements: list[str] = []

    def _capture(
        _conn: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: object,
    ) -> None:
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)

    event.listen(db_engine.sync_engine, "before_cursor_execute", _capture)
    try:
        response = await profile_client.get("/api/projects")
    finally:
        event.remove(db_engine.sync_engine, "before_cursor_execute", _capture)

    assert response.status_code == 200, response.text
    assert len(response.json()["items"]) == 3
    assert len(statements) == 1, statements


async def test_profile_read_resolves_inactive_stored_choice(
    profile_client: AsyncClient, db_session: AsyncSession
) -> None:
    created = await _create(profile_client, provider=EmptyProvider())
    device_set_id = await db_session.scalar(
        select(ChoiceSet.id).where(ChoiceSet.code == "device_type")
    )
    await db_session.execute(
        update(ChoiceOption)
        .where(
            ChoiceOption.choice_set_id == device_set_id,
            ChoiceOption.code == "FOUNDRY",
        )
        .values(is_active=False)
    )
    await db_session.commit()

    response = await profile_client.get(f"/api/projects/{created.json()['id']}/profile")

    assert response.status_code == 200, response.text
    assert response.json()["device_type"] == {
        "code": "FOUNDRY",
        "label": "Foundry",
        "is_active": False,
    }


async def test_profile_patch_distinguishes_omitted_set_and_clear(
    project_with_lock: ProjectWithLock,
) -> None:
    response = await project_with_lock.patch_profile(
        {"comment": None, "pitch_x": " 0010.5000 ", "device_type_code": "SPECIAL"}
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["comment"] is None
    assert body["pitch_x"] == "10.5"
    assert body["device_type"]["code"] == "SPECIAL"
    assert body["gross_die"] == "20"

    profile_event = await project_with_lock.latest_profile_event()
    assert profile_event.payload["changes"]["device_type_code"] == {
        "old": {"code": "FOUNDRY", "label": "Foundry"},
        "new": {"code": "SPECIAL", "label": "Special customer"},
    }
    assert profile_event.payload["changes"]["pitch_x"] == {
        "old": "1.5",
        "new": "10.5",
    }


async def test_profile_patch_requires_current_lock_token(
    project_with_lock: ProjectWithLock,
) -> None:
    url = f"/api/projects/{project_with_lock.project_id}/profile"
    missing = await project_with_lock.client.patch(url, json={"comment": "x"})
    wrong = await project_with_lock.client.patch(
        url, json={"comment": "x"}, headers={"X-Lock-Token": "wrong"}
    )
    await project_with_lock.session.execute(
        update(EditLock)
        .where(EditLock.project_id == project_with_lock.project_id)
        .values(expires_at=datetime.now(UTC) - timedelta(minutes=1))
    )
    await project_with_lock.session.commit()
    expired = await project_with_lock.client.patch(
        url,
        json={"comment": "x"},
        headers={"X-Lock-Token": project_with_lock.token},
    )

    assert [missing.status_code, wrong.status_code, expired.status_code] == [409, 409, 409]


@pytest.mark.parametrize(
    "payload",
    [
        {"process_name": None},
        {"process_name": "   "},
        {"device_type_code": None},
        {"device_type_code": "   "},
        {"project_category_code": None},
        {"project_category_code": "   "},
    ],
)
async def test_profile_patch_rejects_clearing_required_fields(
    project_with_lock: ProjectWithLock, payload: dict[str, Any]
) -> None:
    response = await project_with_lock.patch_profile(payload)

    assert response.status_code == 422
    assert await _profile_events(project_with_lock.session, project_with_lock.project_id) == []


@pytest.mark.parametrize("field", ["line_id", "process_id", "part_id", "name", "device_ref"])
async def test_profile_patch_forbids_identity_or_unknown_fields(
    project_with_lock: ProjectWithLock, field: str
) -> None:
    response = await project_with_lock.patch_profile({field: "forbidden"})

    assert response.status_code == 422


async def test_profile_patch_invalid_decimal_is_atomic(
    project_with_lock: ProjectWithLock,
) -> None:
    before = await project_with_lock.client.get(
        f"/api/projects/{project_with_lock.project_id}/profile"
    )

    response = await project_with_lock.patch_profile(
        {"comment": "must-not-stick", "pitch_x": "1e3"}
    )

    assert response.status_code == 422
    after = await project_with_lock.client.get(
        f"/api/projects/{project_with_lock.project_id}/profile"
    )
    assert after.json() == before.json()
    assert await _profile_events(project_with_lock.session, project_with_lock.project_id) == []


async def test_profile_patch_allows_known_inactive_same_code_noop_only(
    project_with_lock: ProjectWithLock,
) -> None:
    device_set_id = await project_with_lock.session.scalar(
        select(ChoiceSet.id).where(ChoiceSet.code == "device_type")
    )
    await project_with_lock.session.execute(
        update(ChoiceOption)
        .where(ChoiceOption.choice_set_id == device_set_id)
        .values(
            is_active=False,
        )
    )
    await project_with_lock.session.commit()

    same = await project_with_lock.patch_profile({"device_type_code": "FOUNDRY"})
    different = await project_with_lock.patch_profile({"device_type_code": "LEGACY"})
    unknown = await project_with_lock.patch_profile({"device_type_code": "UNKNOWN"})

    assert same.status_code == 200, same.text
    assert different.status_code == 422
    assert unknown.status_code == 422
    assert await _profile_events(project_with_lock.session, project_with_lock.project_id) == []


async def test_profile_patch_records_one_event_and_touches_project_once(
    project_with_lock: ProjectWithLock,
) -> None:
    project_with_lock.session.expire_all()
    before_project = await project_with_lock.session.get(Project, project_with_lock.project_id)
    assert before_project is not None
    before_updated_at = before_project.updated_at

    response = await project_with_lock.patch_profile(
        {
            "process_name": " Renamed process ",
            "comment": " changed ",
            "pitch_y": ".5000",
            "active_direction_code": "UP",
        }
    )

    assert response.status_code == 200, response.text
    assert response.json()["process_name"] == "Renamed process"
    assert response.json()["comment"] == "changed"
    assert response.json()["pitch_y"] == "0.5"
    assert response.json()["active_direction"]["code"] == "UP"
    events = await _profile_events(project_with_lock.session, project_with_lock.project_id)
    assert len(events) == 1
    assert set(events[0].payload["changes"]) == {
        "process_name",
        "comment",
        "pitch_y",
        "active_direction_code",
    }
    project_with_lock.session.expire_all()
    after_project = await project_with_lock.session.get(Project, project_with_lock.project_id)
    assert after_project is not None
    assert after_project.updated_at > before_updated_at


async def test_profile_patch_empty_and_explicit_noop_do_not_touch_timestamp_or_event(
    project_with_lock: ProjectWithLock,
) -> None:
    before = await project_with_lock.client.get(
        f"/api/projects/{project_with_lock.project_id}/profile"
    )
    empty = await project_with_lock.patch_profile({})
    noop = await project_with_lock.patch_profile(
        {"comment": "explicit comment", "pitch_x": "1.5000"}
    )

    assert empty.status_code == 200, empty.text
    assert noop.status_code == 200, noop.text
    assert empty.json()["updated_at"] == before.json()["updated_at"]
    assert noop.json()["updated_at"] == before.json()["updated_at"]
    assert await _profile_events(project_with_lock.session, project_with_lock.project_id) == []
