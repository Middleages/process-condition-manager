"""Typed relation-rule administration and defensive persistence behavior."""

from copy import deepcopy

import pytest
from httpx import AsyncClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession


async def _parameter(
    client: AsyncClient,
    code: str,
    value_type: str = "text",
    *,
    choice_set_code: str | None = None,
) -> dict:
    response = await client.post(
        "/api/parameters",
        json={
            "code": code,
            "display_name": code,
            "value_type": value_type,
            "choice_set_code": choice_set_code,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _required_if_context(client: AsyncClient) -> tuple[dict, dict]:
    when = await _parameter(client, "trigger", "number")
    target = await _parameter(client, "target")
    return when, target


def _required_if_payload() -> dict:
    return {
        "code": "equipment_required",
        "name": "  Equipment required  ",
        "description": "  Require an equipment identity  ",
        "severity": "error",
        "scope": {
            "line_ids": [" L2 ", "L1"],
            "layers": {"step_seqs": [" 020 ", "010"]},
        },
        "spec": {
            "schema_version": 1,
            "type": "required_if",
            "when_parameter_code": " trigger ",
            "equals": " 001.5000 ",
            "required_parameter_code": " target ",
        },
    }


async def test_create_returns_canonical_nested_rule_and_global_scope_default(
    db_client: AsyncClient,
) -> None:
    await _required_if_context(db_client)
    response = await db_client.post("/api/validation-rules", json=_required_if_payload())

    assert response.status_code == 201, response.text
    created = response.json()
    assert created == {
        **created,
        "code": "equipment_required",
        "name": "Equipment required",
        "description": "Require an equipment identity",
        "severity": "error",
        "scope": {
            "line_ids": ["L1", "L2"],
            "layers": {"step_seqs": ["010", "020"]},
        },
        "spec": {
            "schema_version": 1,
            "type": "required_if",
            "when_parameter_code": "trigger",
            "equals": "1.5",
            "required_parameter_code": "target",
        },
        "version": 1,
        "is_active": True,
    }

    global_payload = _required_if_payload()
    global_payload["code"] = "global_rule"
    global_payload.pop("scope")
    global_response = await db_client.post("/api/validation-rules", json=global_payload)
    assert global_response.status_code == 201, global_response.text
    assert global_response.json()["scope"] == {}

    listed = await db_client.get("/api/validation-rules")
    detail = await db_client.get("/api/validation-rules/equipment_required")
    assert [item["code"] for item in listed.json()] == [
        "equipment_required",
        "global_rule",
    ]
    assert detail.json() == created


@pytest.mark.parametrize(
    "mutate",
    [
        lambda p: p.update({"unknown": True}),
        lambda p: p["scope"].update({"unknown": []}),
        lambda p: p["scope"]["layers"].update({"unknown": []}),
        lambda p: p["scope"].update({"line_ids": []}),
        lambda p: p["scope"].update({"line_ids": [" "]}),
        lambda p: p["scope"].update({"line_ids": ["L1", " L1 "]}),
        lambda p: p["scope"]["layers"].update({"eqp_types": []}),
        lambda p: p["scope"]["layers"].update({"eqp_types": ["PHOTO", " PHOTO "]}),
        lambda p: p["spec"].update({"unknown": True}),
        lambda p: p["spec"].update({"schema_version": 2}),
        lambda p: p["spec"].update({"schema_version": True}),
        lambda p: p["spec"].update({"schema_version": 1.0}),
        lambda p: p["spec"].update({"type": "expression"}),
        lambda p: p.update({"code": "Upper_Case"}),
        lambda p: p.update({"name": "  "}),
    ],
    ids=[
        "top-extra",
        "scope-extra",
        "layers-extra",
        "empty-scope-array",
        "blank-scope-entry",
        "duplicate-scope-entry",
        "empty-layer-array",
        "duplicate-layer-entry",
        "spec-extra",
        "schema-version",
        "boolean-schema-version",
        "float-schema-version",
        "unknown-discriminator",
        "code-format",
        "blank-name",
    ],
)
async def test_request_shape_is_strict_recursively(
    db_client: AsyncClient,
    mutate,
) -> None:
    await _required_if_context(db_client)
    payload = _required_if_payload()
    mutate(payload)

    response = await db_client.post("/api/validation-rules", json=payload)

    assert response.status_code == 422


async def test_prior_por_requires_active_same_type_and_choice_set_parameters(
    db_client: AsyncClient,
) -> None:
    await _parameter(db_client, "source")
    inactive = await _parameter(db_client, "inactive")
    await db_client.patch(f"/api/parameters/{inactive['id']}", json={"is_active": False})
    await _parameter(db_client, "number_candidate", "number")

    base = {
        "code": "prior_value",
        "name": "Prior value",
        "severity": "warning",
        "spec": {
            "schema_version": 1,
            "type": "value_exists_in_prior_por",
            "source_parameter_code": "source",
            "candidate_parameter_code": "missing",
        },
    }
    missing = await db_client.post("/api/validation-rules", json=base)
    inactive_payload = deepcopy(base)
    inactive_payload["spec"]["candidate_parameter_code"] = "inactive"
    inactive_response = await db_client.post("/api/validation-rules", json=inactive_payload)
    mismatch_payload = deepcopy(base)
    mismatch_payload["spec"]["candidate_parameter_code"] = "number_candidate"
    mismatch = await db_client.post("/api/validation-rules", json=mismatch_payload)

    assert missing.status_code == 422
    assert inactive_response.status_code == 422
    assert mismatch.status_code == 422


async def test_choice_literal_uses_known_identity_even_when_option_is_inactive(
    db_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    from tests.factories import seed_choice_set

    await seed_choice_set(
        db_session,
        code="yes_no",
        options=(("Y", "Yes", False), ("N", "No", True)),
    )
    await db_session.commit()
    await _parameter(db_client, "choice_trigger", "choice", choice_set_code="yes_no")
    await _parameter(db_client, "choice_target")
    payload = {
        "code": "known_choice",
        "name": "Known choice",
        "severity": "error",
        "spec": {
            "schema_version": 1,
            "type": "required_if",
            "when_parameter_code": "choice_trigger",
            "equals": "Y",
            "required_parameter_code": "choice_target",
        },
    }

    known = await db_client.post("/api/validation-rules", json=payload)
    payload["code"] = "unknown_choice"
    payload["spec"]["equals"] = "UNKNOWN"
    unknown = await db_client.post("/api/validation-rules", json=payload)

    assert known.status_code == 201, known.text
    assert known.json()["spec"]["equals"] == "Y"
    assert known.json()["description"] is None
    assert unknown.status_code == 422


async def test_prior_por_choice_parameters_must_share_the_same_choice_set(
    db_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    from tests.factories import seed_choice_set

    await seed_choice_set(db_session, code="first", options=(("A", "A", True),))
    await seed_choice_set(db_session, code="second", options=(("A", "A", True),))
    await db_session.commit()
    await _parameter(db_client, "source_choice", "choice", choice_set_code="first")
    await _parameter(db_client, "candidate_choice", "choice", choice_set_code="second")

    response = await db_client.post(
        "/api/validation-rules",
        json={
            "code": "choice_prior",
            "name": "Choice prior",
            "severity": "error",
            "spec": {
                "schema_version": 1,
                "type": "value_exists_in_prior_por",
                "source_parameter_code": "source_choice",
                "candidate_parameter_code": "candidate_choice",
            },
        },
    )

    assert response.status_code == 422


async def test_patch_is_locked_versioned_canonical_and_soft_only(
    db_client: AsyncClient,
) -> None:
    await _required_if_context(db_client)
    payload = _required_if_payload()
    created = await db_client.post("/api/validation-rules", json=payload)
    assert created.status_code == 201, created.text

    canonical_noop = await db_client.patch(
        "/api/validation-rules/equipment_required",
        json={
            "expected_version": 1,
            "name": " Equipment required ",
            "scope": {
                "line_ids": ["L2", "L1"],
                "layers": {"step_seqs": ["020", "010"]},
            },
        },
    )
    assert canonical_noop.status_code == 200, canonical_noop.text
    assert canonical_noop.json()["version"] == 1

    changed = await db_client.patch(
        "/api/validation-rules/equipment_required",
        json={"expected_version": 1, "severity": "warning"},
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["version"] == 2

    stale_noop = await db_client.patch(
        "/api/validation-rules/equipment_required",
        json={"expected_version": 1, "severity": "warning"},
    )
    assert stale_noop.status_code == 409
    assert stale_noop.json()["code"] == "validation_rule_changed"
    assert stale_noop.json()["details"]["actual_version"] == 2

    forbidden_code = await db_client.patch(
        "/api/validation-rules/equipment_required",
        json={"expected_version": 2, "code": "renamed"},
    )
    assert forbidden_code.status_code == 422
    deleted = await db_client.delete("/api/validation-rules/equipment_required")
    assert deleted.status_code in {404, 405}

    deactivated = await db_client.patch(
        "/api/validation-rules/equipment_required",
        json={"expected_version": 2, "is_active": False},
    )
    assert deactivated.status_code == 200, deactivated.text
    assert deactivated.json()["version"] == 3
    assert deactivated.json()["is_active"] is False
    assert (await db_client.get("/api/validation-rules")).json() == []
    included = await db_client.get("/api/validation-rules", params={"include_inactive": True})
    assert [item["code"] for item in included.json()] == ["equipment_required"]


async def test_inactive_rule_can_repair_old_inactive_references_before_reactivation(
    db_client: AsyncClient,
) -> None:
    old_when, _ = await _required_if_context(db_client)
    created = await db_client.post("/api/validation-rules", json=_required_if_payload())
    assert created.status_code == 201, created.text
    deactivated = await db_client.patch(
        "/api/validation-rules/equipment_required",
        json={"expected_version": 1, "is_active": False},
    )
    assert deactivated.status_code == 200, deactivated.text
    assert deactivated.json()["version"] == 2

    old_parameter_deactivated = await db_client.patch(
        f"/api/parameters/{old_when['id']}", json={"is_active": False}
    )
    assert old_parameter_deactivated.status_code == 200, old_parameter_deactivated.text

    inactive_noop = await db_client.patch(
        "/api/validation-rules/equipment_required",
        json={"expected_version": 2, "name": "Equipment required"},
    )
    assert inactive_noop.status_code == 200, inactive_noop.text
    assert inactive_noop.json()["version"] == 2

    rejected_reactivation = await db_client.patch(
        "/api/validation-rules/equipment_required",
        json={"expected_version": 2, "is_active": True},
    )
    assert rejected_reactivation.status_code == 422
    assert rejected_reactivation.json()["code"] == "validation_rule_parameter_inactive"
    unchanged = await db_client.get("/api/validation-rules/equipment_required")
    assert unchanged.json()["version"] == 2
    assert unchanged.json()["is_active"] is False

    await _parameter(db_client, "new_trigger", "number")
    await _parameter(db_client, "new_target")
    repaired = await db_client.patch(
        "/api/validation-rules/equipment_required",
        json={
            "expected_version": 2,
            "spec": {
                "schema_version": 1,
                "type": "required_if",
                "when_parameter_code": "new_trigger",
                "equals": "002.000",
                "required_parameter_code": "new_target",
            },
        },
    )
    assert repaired.status_code == 200, repaired.text
    assert repaired.json()["version"] == 3
    assert repaired.json()["is_active"] is False
    assert repaired.json()["spec"] == {
        "schema_version": 1,
        "type": "required_if",
        "when_parameter_code": "new_trigger",
        "equals": "2",
        "required_parameter_code": "new_target",
    }

    reactivated = await db_client.patch(
        "/api/validation-rules/equipment_required",
        json={"expected_version": 3, "is_active": True},
    )
    assert reactivated.status_code == 200, reactivated.text
    assert reactivated.json()["version"] == 4
    assert reactivated.json()["is_active"] is True


@pytest.mark.parametrize(
    "corrupt",
    [
        {"spec": {"schema_version": 1, "type": "broken"}},
        {"scope": {"layer_ids": ["ACT"]}},
    ],
    ids=["spec", "flat-internal-scope"],
)
async def test_malformed_persisted_json_raises_stable_configuration_error(
    db_client: AsyncClient,
    db_session: AsyncSession,
    corrupt: dict,
) -> None:
    from app.models.validation import ValidationRule

    await _required_if_context(db_client)
    created = await db_client.post("/api/validation-rules", json=_required_if_payload())
    assert created.status_code == 201, created.text
    await db_session.execute(
        update(ValidationRule).where(ValidationRule.code == "equipment_required").values(**corrupt)
    )
    await db_session.commit()

    response = await db_client.get("/api/validation-rules/equipment_required")
    listed = await db_client.get("/api/validation-rules")

    assert response.status_code == 422
    assert response.json()["code"] == "validation_configuration_invalid"
    assert listed.status_code == 422
    assert listed.json()["code"] == "validation_configuration_invalid"
