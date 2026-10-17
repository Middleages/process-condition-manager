"""LINE list contracts: current revision selection precedes filtering and paging."""

from unittest.mock import AsyncMock

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.projects.repository import ProjectRepository
from app.ingest.fixture_reader import get_ingest_reader
from app.ingest.reader import ProcessInfo
from app.main import app
from app.models.project import Project, ProjectProfile, ProjectStatus
from tests.factories import seed_required_profile_choice_sets


def _project(line: str, part: str, **kwargs) -> Project:
    return Project(
        line_id=line,
        process_id="PROC_ALPHA",
        part_id=part,
        name="name-only",
        profile=ProjectProfile(
            process_name="PROC_ALPHA",
            device_type_code="DEFAULT",
            project_category_code="DEFAULT",
            comment="comment-only",
        ),
        **kwargs,
    )


@pytest.mark.parametrize("latest_status", [ProjectStatus.DRAFT, ProjectStatus.REVIEW])
async def test_latest_before_cursor_status_and_profile(db_session: AsyncSession, latest_status):
    old = _project("L1", "P", status=ProjectStatus.ARCHIVED)
    db_session.add(old)
    await db_session.flush()
    latest = _project(
        "L1", "P", status=latest_status, version=2, revision_root_id=old.id, revision_of_id=old.id
    )
    latest.profile.device_type_code = "NEW"
    latest.profile.project_category_code = "NEW"
    db_session.add(latest)
    await db_session.flush()
    repo = ProjectRepository(db_session)
    rows, _ = await repo.list_summaries(line_id="L1")
    assert [r.project.id for r in rows] == [latest.id]
    for rows, _ in (
        await repo.list_summaries(line_id="L1", cursor=latest.id),
        await repo.list_summaries(line_id="L1", status="archived"),
        await repo.list_summaries(line_id="L1", device_type_code="DEFAULT"),
        await repo.list_summaries(line_id="L1", project_category_code="DEFAULT"),
    ):
        assert rows == []


async def test_default_pages_are_25_latest_rows_scoped_to_line(
    db_client: AsyncClient,
    db_session: AsyncSession,
):
    await seed_required_profile_choice_sets(db_session)
    expected = []
    for line in ("L1", "L2"):
        for i in range(53):
            old = _project(line, f"PART-{i:03}", status=ProjectStatus.ARCHIVED)
            db_session.add(old)
            await db_session.flush()
            current = _project(
                line, old.part_id, version=2, revision_root_id=old.id, revision_of_id=old.id
            )
            db_session.add(current)
            await db_session.flush()
            if line == "L1":
                expected.append(current.id)
    await db_session.commit()
    ids = []
    params = {"line_id": "L1"}
    for size in (25, 25, 3):
        response = await db_client.get("/api/projects", params=params)
        assert response.status_code == 200, response.text
        page = response.json()
        assert len(page["items"]) == size
        assert all(item["line_id"] == "L1" and item["version"] == 2 for item in page["items"])
        ids.extend(item["id"] for item in page["items"])
        params["cursor"] = page["next_cursor"]
    assert page["next_cursor"] is None
    assert ids == sorted(expected, reverse=True)


@pytest.mark.parametrize(
    "query,matched",
    [
        ("proc_alpha", True),
        ("part-x", True),
        ("name-only", False),
        ("comment-only", False),
        ("L1", False),
        ("DEFAULT", False),
    ],
)
async def test_search_only_process_and_part(db_session: AsyncSession, query, matched):
    row = _project("L1", "PART-X")
    db_session.add(row)
    await db_session.flush()
    rows, _ = await ProjectRepository(db_session).list_summaries(line_id="L1", query=query)
    assert bool(rows) is matched


async def test_line_discovery_union_sorted_without_counts(db_client: AsyncClient, db_session):
    db_session.add_all([_project("L9", "P"), _project("L1", "P"), _project("L9", "Q")])
    await db_session.commit()
    reader = AsyncMock()
    reader.list_processes.return_value = [
        ProcessInfo(key="k", line_id=line, process_id="P", display_name="P")
        for line in ("L2", "L1", "L2")
    ]
    app.dependency_overrides[get_ingest_reader] = lambda: reader
    try:
        response = await db_client.get("/api/projects/lines")
        assert response.status_code == 200, response.text
        assert response.json() == ["L1", "L2", "L9"]
    finally:
        app.dependency_overrides.pop(get_ingest_reader, None)


async def test_line_discovery_failure_is_retryable(db_client: AsyncClient):
    reader = AsyncMock()
    reader.list_processes.side_effect = ConnectionError("catalog unavailable")
    app.dependency_overrides[get_ingest_reader] = lambda: reader
    try:
        response = await db_client.get("/api/projects/lines")
        assert response.status_code == 503
        assert response.json()["details"]["retryable"] is True
    finally:
        app.dependency_overrides.pop(get_ingest_reader, None)


async def test_latest_uses_version_then_id_not_insertion_order(db_session: AsyncSession):
    old = _project("L1", "P", id=100, status=ProjectStatus.ARCHIVED)
    db_session.add(old)
    await db_session.flush()
    newest = _project("L1", "P", id=50, version=2, revision_root_id=100, revision_of_id=100)
    # Separate archived roots can coexist; the ID breaks equal-version ties.
    tie_old = _project("L1", "Q", id=101, status=ProjectStatus.ARCHIVED)
    tie_new = _project("L1", "Q", id=102, status=ProjectStatus.ARCHIVED)
    db_session.add_all([newest, tie_old, tie_new])
    await db_session.flush()
    rows, _ = await ProjectRepository(db_session).list_summaries(line_id="L1")
    assert [row.project.id for row in rows] == [102, 50]
