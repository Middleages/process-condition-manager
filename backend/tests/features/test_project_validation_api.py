"""Committed whole-project validation and shared Sheet definition basis."""

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime
from decimal import Decimal

from httpx import AsyncClient
from sqlalchemy import event, text, update
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.domain.parameters.types import ValueType
from app.features.approval.repository import ApprovalRepository
from app.features.approval.service import ApprovalService
from app.models.choice import ChoiceOption, ChoiceSet
from app.models.parameter import Parameter, ParameterCategory
from app.models.project import (
    CellValue,
    EditLock,
    LayerCondition,
    Project,
    ProjectStatus,
    SheetLayer,
)
from app.models.validation import ValidationRule
from tests.factories import make_project_profile, seed_required_profile_choice_sets

_SAFE_CONFIGURATION_MESSAGE = (
    "검증 규칙을 불러오지 못했습니다. 관리자에게 확인을 요청해 주세요."
)


@contextmanager
def _captured_statements(engine: AsyncEngine) -> Iterator[list[str]]:
    statements: list[str] = []

    def _capture(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _many: object,
    ) -> None:
        statements.append(statement)

    event.listen(engine.sync_engine, "before_cursor_execute", _capture)
    try:
        yield statements
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", _capture)


async def _seed_validation_project(session: AsyncSession) -> tuple[int, int]:
    category = ParameterCategory(code="validation", display_name="Validation")
    choices = ChoiceSet(code="yes_no", display_name="Yes/No", version=7)
    choices.options.extend(
        [
            ChoiceOption(code="Y", label="Yes", sort_order=1, is_active=True),
            ChoiceOption(code="OLD", label="Old", sort_order=2, is_active=False),
        ]
    )
    parameters = [
        Parameter(
            code="trigger",
            display_name="Trigger",
            value_type=ValueType.CHOICE,
            choice_set=choices,
            category=category,
            sort_order=1,
        ),
        Parameter(
            code="target",
            display_name="Target",
            value_type=ValueType.TEXT,
            pattern="[A-Z]{2}",
            pattern_hint="대문자 2자리",
            sort_order=2,
        ),
        Parameter(
            code="amount",
            display_name="Amount",
            value_type=ValueType.NUMBER,
            min_value=Decimal("10"),
            max_value=Decimal("20"),
            required=True,
            sort_order=3,
        ),
        Parameter(
            code="source",
            display_name="Source",
            value_type=ValueType.TEXT,
            sort_order=4,
        ),
        Parameter(
            code="candidate",
            display_name="Candidate",
            value_type=ValueType.TEXT,
            sort_order=5,
        ),
        Parameter(
            code="trigger_copy",
            display_name="Trigger copy",
            value_type=ValueType.CHOICE,
            choice_set=choices,
            sort_order=6,
        ),
    ]

    project = Project(
        line_id="L1",
        process_id="PROC",
        part_id="PART",
        name="validation",
        profile=make_project_profile(process_name="PROC"),
    )
    prior = SheetLayer(
        layer_key="L1::PROC::010::PRE",
        step_seq="010",
        layer_id="PRE",
        eqp_type="ETCH",
        area_name="A",
        sort_order=1,
    )
    prior_por = LayerCondition(label="base", condition_index=1, is_por=True)
    prior_por.cell_values.extend(
        [
            CellValue(parameter_code="candidate", value_text="seen"),
            CellValue(parameter_code="amount", value_text="10"),
        ]
    )
    prior.conditions.append(prior_por)

    current = SheetLayer(
        layer_key="L1::PROC::020::ACT",
        step_seq="020",
        layer_id="ACT",
        eqp_type="PHOTO",
        area_name="B",
        sort_order=2,
    )
    current_por = LayerCondition(label="base", condition_index=1, is_por=True)
    current_por.cell_values.extend(
        [
            CellValue(parameter_code="trigger", value_text="Y"),
            CellValue(parameter_code="source", value_text="seen"),
            CellValue(parameter_code="amount", value_text="25"),
        ]
    )
    current_other = LayerCondition(label="C2", condition_index=2, is_por=False)
    current_other.cell_values.extend(
        [
            CellValue(parameter_code="source", value_text="missing"),
            CellValue(parameter_code="target", value_text="bad"),
        ]
    )
    current.conditions.extend([current_por, current_other])
    project.layers.extend([current, prior])

    rules = [
        ValidationRule(
            code="equipment_required",
            name="Equipment required",
            severity="error",
            version=3,
            scope={
                "line_ids": ["L1"],
                "process_ids": ["PROC"],
                "layers": {"layer_ids": ["ACT"], "eqp_types": ["PHOTO"]},
            },
            spec={
                "schema_version": 1,
                "type": "required_if",
                "when_parameter_code": "trigger",
                "equals": "Y",
                "required_parameter_code": "target",
            },
        ),
        ValidationRule(
            code="prior_value",
            name="Prior value",
            severity="warning",
            version=2,
            scope={"line_ids": ["L1"]},
            spec={
                "schema_version": 1,
                "type": "value_exists_in_prior_por",
                "source_parameter_code": "source",
                "candidate_parameter_code": "candidate",
            },
        ),
        ValidationRule(
            code="other_line",
            name="Other line",
            severity="error",
            scope={"line_ids": ["L2"]},
            spec={
                "schema_version": 1,
                "type": "required_if",
                "when_parameter_code": "trigger",
                "equals": "Y",
                "required_parameter_code": "target",
            },
        ),
        ValidationRule(
            code="inactive_rule",
            name="Inactive",
            severity="error",
            is_active=False,
            scope={},
            spec={
                "schema_version": 1,
                "type": "required_if",
                "when_parameter_code": "trigger",
                "equals": "Y",
                "required_parameter_code": "target",
            },
        ),
    ]
    session.add_all([*parameters, project, *rules])
    await session.flush()
    project_id = project.id
    current_other_id = current_other.id
    await session.commit()
    return project_id, current_other_id


async def test_validate_committed_project_without_body_or_edit_lock(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, _ = await _seed_validation_project(db_session)

    response = await db_client.post(f"/api/projects/{project_id}/validate")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["basis_hash"].startswith("sha256:")
    assert body["rule_versions"] == {"equipment_required": 3, "prior_value": 2}
    assert body["summary"] == {"error_count": 4, "warning_count": 1}
    assert [issue["code"] for issue in body["issues"]] == [
        "required_if",
        "range_max",
        "pattern_mismatch",
        "required",
        "value_not_found_in_prior_por",
    ]
    assert all("pattern" not in issue["details"] for issue in body["issues"])
    evaluated_at = datetime.fromisoformat(body["evaluated_at"].replace("Z", "+00:00"))
    assert evaluated_at.utcoffset() is not None
    assert await db_session.get(EditLock, project_id) is None


async def test_validate_uses_only_bounded_read_queries(
    db_client: AsyncClient,
    db_session: AsyncSession,
    db_engine: AsyncEngine,
) -> None:
    project_id, _ = await _seed_validation_project(db_session)

    with _captured_statements(db_engine) as statements:
        response = await db_client.post(f"/api/projects/{project_id}/validate")

    assert response.status_code == 200, response.text
    assert len(statements) <= 10
    assert all(statement.lstrip().upper().startswith("SELECT") for statement in statements)
    assert all("edit_lock" not in statement.lower() for statement in statements)


async def test_sheet_and_validate_share_projected_applicable_basis(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, _ = await _seed_validation_project(db_session)

    sheet = (await db_client.get(f"/api/projects/{project_id}/sheet")).json()
    validated = (await db_client.post(f"/api/projects/{project_id}/validate")).json()

    assert sheet["validation_basis_hash"] == validated["basis_hash"]
    assert [rule["code"] for rule in sheet["validation_rules"]] == [
        "equipment_required",
        "prior_value",
    ]
    required = sheet["validation_rules"][0]
    assert required == {
        "code": "equipment_required",
        "name": "Equipment required",
        "severity": "error",
        "version": 3,
        "scope": {"layers": {"layer_ids": ["ACT"], "eqp_types": ["PHOTO"]}},
        "spec": {
            "schema_version": 1,
            "type": "required_if",
            "when_parameter_code": "trigger",
            "equals": "Y",
            "required_parameter_code": "target",
        },
    }
    assert "line_ids" not in required["scope"]
    assert "process_ids" not in required["scope"]
    assert "options" not in str(sheet)


async def test_sheet_eager_loads_shared_choice_options_once_including_inactive(
    db_client: AsyncClient,
    db_session: AsyncSession,
    db_engine: AsyncEngine,
) -> None:
    project_id, _ = await _seed_validation_project(db_session)

    with _captured_statements(db_engine) as statements:
        response = await db_client.get(f"/api/projects/{project_id}/sheet")

    assert response.status_code == 200, response.text
    option_queries = [
        statement
        for statement in statements
        if "choice_option" in statement.lower() and "select" in statement.lower()
    ]
    assert len(option_queries) == 1
    assert "options" not in response.text


async def test_sheet_projects_valid_persisted_rules_to_canonical_literals(
    db_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    project_id, _ = await _seed_validation_project(db_session)
    await db_session.execute(
        update(ValidationRule)
        .where(ValidationRule.code == "equipment_required")
        .values(
            spec={
                "schema_version": 1,
                "type": "required_if",
                "when_parameter_code": "amount",
                "equals": "010.000",
                "required_parameter_code": "target",
            }
        )
    )
    await db_session.commit()

    sheet = await db_client.get(f"/api/projects/{project_id}/sheet")
    validated = await db_client.post(f"/api/projects/{project_id}/validate")

    assert sheet.status_code == validated.status_code == 200
    rule = next(
        item
        for item in sheet.json()["validation_rules"]
        if item["code"] == "equipment_required"
    )
    assert rule["spec"]["equals"] == "10"
    assert sheet.json()["validation_basis_hash"] == validated.json()["basis_hash"]


async def test_basis_hash_tracks_definitions_but_not_cell_values(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, condition_id = await _seed_validation_project(db_session)
    first = (await db_client.post(f"/api/projects/{project_id}/validate")).json()["basis_hash"]

    await db_session.execute(
        update(CellValue)
        .where(
            CellValue.condition_id == condition_id,
            CellValue.parameter_code == "source",
        )
        .values(value_text="seen")
    )
    await db_session.commit()
    same = (await db_client.post(f"/api/projects/{project_id}/validate")).json()["basis_hash"]
    assert same == first

    await db_session.execute(
        update(Parameter).where(Parameter.code == "amount").values(required=False)
    )
    await db_session.commit()
    parameter_changed = (
        await db_client.post(f"/api/projects/{project_id}/validate")
    ).json()["basis_hash"]
    assert parameter_changed != same

    await db_session.execute(update(ChoiceSet).where(ChoiceSet.code == "yes_no").values(version=8))
    await db_session.commit()
    choice_changed = (await db_client.post(f"/api/projects/{project_id}/validate")).json()[
        "basis_hash"
    ]
    assert choice_changed != parameter_changed

    await db_session.execute(
        update(ValidationRule)
        .where(ValidationRule.code == "prior_value")
        .values(version=3)
    )
    await db_session.commit()
    rule_changed = (await db_client.post(f"/api/projects/{project_id}/validate")).json()[
        "basis_hash"
    ]
    assert rule_changed != choice_changed


async def test_approved_validation_uses_snapshot_after_live_definition_changes(
    db_client: AsyncClient,
    db_session: AsyncSession,
    db_engine: AsyncEngine,
) -> None:
    project_id, _ = await _seed_validation_project(db_session)
    await seed_required_profile_choice_sets(db_session)
    await db_session.commit()
    before = (await db_client.post(f"/api/projects/{project_id}/validate")).json()
    approval = ApprovalService(ApprovalRepository(db_session))
    basis = await approval.basis_loader.load(project_id)
    frozen = await approval._snapshot_basis(basis)
    project = await db_session.get(Project, project_id)
    assert project is not None
    project.status = ProjectStatus.APPROVED
    project.parameter_snapshot = frozen
    await db_session.commit()

    await db_session.execute(
        update(Parameter).where(Parameter.code == "amount").values(required=False)
    )
    await db_session.execute(
        update(ChoiceSet).where(ChoiceSet.code == "yes_no").values(version=99)
    )
    await db_session.execute(
        update(ValidationRule).where(ValidationRule.code == "prior_value").values(version=99)
    )
    await db_session.commit()

    with _captured_statements(db_engine) as statements:
        response = await db_client.post(f"/api/projects/{project_id}/validate")

    assert response.status_code == 200, response.text
    after = response.json()
    assert after["basis_hash"] == frozen["validation_basis_hash"]
    assert after["rule_versions"] == before["rule_versions"]
    assert after["summary"] == before["summary"]
    assert [issue["code"] for issue in after["issues"]] == [
        issue["code"] for issue in before["issues"]
    ]
    sql = "\n".join(statements).lower()
    assert " from parameter " not in sql
    assert " from parameter_category " not in sql
    assert " from validation_rule " not in sql
    assert " from choice_set " not in sql


async def test_validate_missing_project_is_404_and_empty_project_is_green(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    missing = await db_client.post("/api/projects/999999/validate")
    assert missing.status_code == 404

    project = Project(
        line_id="EMPTY",
        process_id="EMPTY",
        part_id="EMPTY",
        name="empty",
        profile=make_project_profile(process_name="EMPTY"),
    )
    db_session.add(project)
    await db_session.commit()
    response = await db_client.post(f"/api/projects/{project.id}/validate")
    assert response.status_code == 200, response.text
    assert response.json()["summary"] == {"error_count": 0, "warning_count": 0}
    assert response.json()["issues"] == []


async def test_malformed_active_rule_fails_with_safe_configuration_error(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, _ = await _seed_validation_project(db_session)
    await db_session.execute(
        update(ValidationRule)
        .where(ValidationRule.code == "equipment_required")
        .values(spec={"schema_version": 1, "type": "broken", "secret": "do not leak"})
    )
    await db_session.commit()

    response = await db_client.post(f"/api/projects/{project_id}/validate")
    sheet = await db_client.get(f"/api/projects/{project_id}/sheet")

    for result in (response, sheet):
        assert result.status_code == 422
        assert result.json() == {
            "code": "validation_configuration_invalid",
            "message": _SAFE_CONFIGURATION_MESSAGE,
        }
        assert "secret" not in result.text


async def test_malformed_active_rule_cannot_hide_behind_nonmatching_project_scope(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, _ = await _seed_validation_project(db_session)
    await db_session.execute(
        update(ValidationRule)
        .where(ValidationRule.code == "other_line")
        .values(spec={"schema_version": 1, "type": "broken", "secret": "do not leak"})
    )
    await db_session.commit()

    response = await db_client.post(f"/api/projects/{project_id}/validate")
    sheet = await db_client.get(f"/api/projects/{project_id}/sheet")

    for result in (response, sheet):
        assert result.status_code == 422
        assert result.json() == {
            "code": "validation_configuration_invalid",
            "message": _SAFE_CONFIGURATION_MESSAGE,
        }
        assert "secret" not in result.text


async def test_corrupt_active_severity_cannot_hide_behind_nonmatching_project_scope(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, _ = await _seed_validation_project(db_session)
    await db_session.execute(text("PRAGMA ignore_check_constraints = ON"))
    await db_session.execute(
        text(
            "UPDATE validation_rule SET severity = 'broken' "
            "WHERE code = 'other_line'"
        )
    )
    await db_session.commit()

    response = await db_client.post(f"/api/projects/{project_id}/validate")
    sheet = await db_client.get(f"/api/projects/{project_id}/sheet")

    for result in (response, sheet):
        assert result.status_code == 422
        assert result.json() == {
            "code": "validation_configuration_invalid",
            "message": _SAFE_CONFIGURATION_MESSAGE,
        }


async def test_validate_route_has_no_request_body_in_openapi(db_client: AsyncClient) -> None:
    operation = (await db_client.get("/openapi.json")).json()["paths"][
        "/api/projects/{project_id}/validate"
    ]["post"]

    assert "requestBody" not in operation
    assert operation["security"] if "security" in operation else True


async def test_inactive_choice_identity_is_available_to_committed_validation(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, condition_id = await _seed_validation_project(db_session)
    db_session.add(
        CellValue(condition_id=condition_id, parameter_code="trigger", value_text="OLD")
    )
    await db_session.commit()

    response = await db_client.post(f"/api/projects/{project_id}/validate")

    assert response.status_code == 200, response.text
    issue = next(
        issue
        for issue in response.json()["issues"]
        if issue["condition_id"] == condition_id and issue["parameter_code"] == "trigger"
    )
    assert issue["code"] == "choice_inactive"
    assert issue["severity"] == "warning"


async def test_legacy_non_number_bounds_are_ignored_by_validation_projection(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, _ = await _seed_validation_project(db_session)
    await db_session.execute(text("PRAGMA ignore_check_constraints = ON"))
    await db_session.execute(
        text(
            "UPDATE parameter SET unit = 'legacy', min_value = 1, max_value = 2 "
            "WHERE code = 'target'"
        )
    )
    await db_session.commit()

    validated = await db_client.post(f"/api/projects/{project_id}/validate")
    sheet = await db_client.get(f"/api/projects/{project_id}/sheet")

    assert validated.status_code == 200, validated.text
    assert sheet.status_code == 200, sheet.text
    target = next(
        column for column in sheet.json()["columns"] if column["parameter_code"] == "target"
    )
    assert target["unit"] is None
    assert target["min_value"] is None
    assert target["max_value"] is None
