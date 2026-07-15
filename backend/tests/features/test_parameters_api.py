"""Final Parameter API contract backed by managed ChoiceSets."""

from typing import cast

import pytest
from httpx import AsyncClient
from sqlalchemy import Enum, String, Table, event
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.models.parameter import Parameter
from tests.factories import seed_choice_set


async def test_create_number_returns_canonical_decimal_strings(
    db_client: AsyncClient,
) -> None:
    response = await db_client.post(
        "/api/parameters",
        json={
            "code": "exposure_dose",
            "display_name": "노광량",
            "value_type": "number",
            "unit": "mJ",
            "min_value": "001.5000",
            "max_value": "100.000",
        },
    )
    assert response.status_code == 201, response.text
    created = response.json()
    assert created["min_value"] == "1.5"
    assert created["max_value"] == "100"
    assert created["choice_set"] is None
    assert "options" not in created


def test_parameter_metadata_persists_lowercase_enum_and_binding_constraint() -> None:
    table = cast(Table, Parameter.__table__)
    enum_type = cast(Enum, table.c.value_type.type)
    assert enum_type.enums == ["number", "text", "choice"]
    assert {
        "ck_parameter_choice_set_binding",
        "ck_parameter_number_metadata",
        "ck_parameter_pattern_pair",
    } <= {constraint.name for constraint in table.constraints}
    assert table.c.required.nullable is False
    assert table.c.required.server_default is not None
    assert cast(String, table.c.pattern.type).length == 256
    assert cast(String, table.c.pattern_hint.type).length == 256


async def test_create_text_validation_metadata_is_normalized_and_returned(
    db_client: AsyncClient,
) -> None:
    response = await db_client.post(
        "/api/parameters",
        json={
            "code": "mask_id",
            "display_name": "Mask ID",
            "value_type": "text",
            "required": True,
            "pattern": "[A-Z]{2}-[0-9]{4}",
            "pattern_hint": "  영문 대문자 2자리-숫자 4자리  ",
        },
    )

    assert response.status_code == 201, response.text
    assert response.json()["required"] is True
    assert response.json()["pattern"] == "[A-Z]{2}-[0-9]{4}"
    assert response.json()["pattern_hint"] == "영문 대문자 2자리-숫자 4자리"


@pytest.mark.parametrize(
    ("metadata", "code"),
    [
        ({"pattern": "[A-Z]{2}"}, "pattern_hint_required"),
        ({"pattern_hint": "영문 대문자 2자리"}, "pattern_required"),
        (
            {"pattern": "(a+)+", "pattern_hint": "안전한 형식"},
            "portable_pattern_invalid",
        ),
    ],
)
async def test_create_rejects_incomplete_or_nonportable_text_pattern(
    db_client: AsyncClient,
    metadata: dict[str, str],
    code: str,
) -> None:
    response = await db_client.post(
        "/api/parameters",
        json={
            "code": "mask_id",
            "display_name": "Mask ID",
            "value_type": "text",
            **metadata,
        },
    )

    assert response.status_code == 422
    assert response.json()["code"] == code


@pytest.mark.parametrize(
    ("value_type", "metadata"),
    [
        ("text", {"unit": "nm"}),
        ("text", {"min_value": "0"}),
        ("choice", {"max_value": "10", "choice_set_code": "equipment_mode"}),
        (
            "number",
            {"pattern": "[0-9]{1,3}", "pattern_hint": "숫자 1~3자리"},
        ),
    ],
)
async def test_create_rejects_metadata_owned_by_another_value_type(
    db_client: AsyncClient,
    db_session: AsyncSession,
    value_type: str,
    metadata: dict[str, str],
) -> None:
    if value_type == "choice":
        await seed_choice_set(db_session, code="equipment_mode")
        await db_session.commit()
    response = await db_client.post(
        "/api/parameters",
        json={
            "code": "metadata_owner",
            "display_name": "Metadata owner",
            "value_type": value_type,
            **metadata,
        },
    )

    assert response.status_code == 422
    assert response.json()["code"] in {
        "number_metadata_not_allowed",
        "pattern_not_allowed",
    }


async def test_patch_omission_preserves_and_explicit_null_clears_nullable_metadata(
    db_client: AsyncClient,
) -> None:
    category = (
        await db_client.post(
            "/api/parameters/categories",
            json={"code": "photo", "display_name": "Photo"},
        )
    ).json()
    created = (
        await db_client.post(
            "/api/parameters",
            json={
                "code": "dose",
                "display_name": "Dose",
                "description": "Wafer dose",
                "value_type": "number",
                "category_id": category["id"],
                "unit": "mJ",
                "min_value": "1",
                "max_value": "100",
            },
        )
    ).json()

    preserved = await db_client.patch(
        f"/api/parameters/{created['id']}",
        json={"required": True},
    )
    assert preserved.status_code == 200, preserved.text
    assert preserved.json()["description"] == "Wafer dose"
    assert preserved.json()["category_id"] == category["id"]
    assert preserved.json()["unit"] == "mJ"
    assert preserved.json()["min_value"] == "1"
    assert preserved.json()["max_value"] == "100"
    assert preserved.json()["required"] is True

    cleared = await db_client.patch(
        f"/api/parameters/{created['id']}",
        json={
            "description": None,
            "category_id": None,
            "unit": None,
            "min_value": None,
            "max_value": None,
        },
    )
    assert cleared.status_code == 200, cleared.text
    assert {
        key: cleared.json()[key]
        for key in ("description", "category_id", "unit", "min_value", "max_value")
    } == {
        "description": None,
        "category_id": None,
        "unit": None,
        "min_value": None,
        "max_value": None,
    }
    assert cleared.json()["required"] is True


async def test_patch_pattern_pair_is_atomic_and_hint_only_is_rejected(
    db_client: AsyncClient,
) -> None:
    created = (
        await db_client.post(
            "/api/parameters",
            json={
                "code": "mask_id",
                "display_name": "Mask ID",
                "value_type": "text",
                "pattern": "[A-Z]{2}-[0-9]{4}",
                "pattern_hint": "영문 대문자 2자리-숫자 4자리",
            },
        )
    ).json()

    preserved = await db_client.patch(
        f"/api/parameters/{created['id']}",
        json={"display_name": "Mask identifier"},
    )
    assert preserved.status_code == 200, preserved.text
    assert preserved.json()["pattern"] == "[A-Z]{2}-[0-9]{4}"
    assert preserved.json()["pattern_hint"] == "영문 대문자 2자리-숫자 4자리"

    hint_only = await db_client.patch(
        f"/api/parameters/{created['id']}",
        json={"pattern_hint": "다른 안내"},
    )
    pattern_only = await db_client.patch(
        f"/api/parameters/{created['id']}",
        json={"pattern": "[A-Z]{3}"},
    )
    contradictory_clear = await db_client.patch(
        f"/api/parameters/{created['id']}",
        json={"pattern": None, "pattern_hint": "남겨 둘 수 없는 안내"},
    )
    assert hint_only.status_code == 422
    assert pattern_only.status_code == 422
    assert contradictory_clear.status_code == 422

    cleared = await db_client.patch(
        f"/api/parameters/{created['id']}",
        json={"pattern": None},
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["pattern"] is None
    assert cleared.json()["pattern_hint"] is None


async def test_patch_rejects_required_null_and_non_number_metadata(
    db_client: AsyncClient,
) -> None:
    created = (
        await db_client.post(
            "/api/parameters",
            json={"code": "note", "display_name": "Note", "value_type": "text"},
        )
    ).json()

    required_null = await db_client.patch(
        f"/api/parameters/{created['id']}",
        json={"required": None},
    )
    number_metadata = await db_client.patch(
        f"/api/parameters/{created['id']}",
        json={"unit": "nm"},
    )
    assert required_null.status_code == 422
    assert number_metadata.status_code == 422
    assert number_metadata.json()["code"] == "number_metadata_not_allowed"


async def test_code_normalized_and_duplicate_rejected(db_client: AsyncClient) -> None:
    first = await db_client.post(
        "/api/parameters",
        json={"code": "  width ", "display_name": "폭", "value_type": "text"},
    )
    assert first.status_code == 201
    assert first.json()["code"] == "width"

    duplicate = await db_client.post(
        "/api/parameters",
        json={"code": "width", "display_name": "폭2", "value_type": "text"},
    )
    assert duplicate.status_code == 409


async def test_invalid_code_rejected_as_422(db_client: AsyncClient) -> None:
    response = await db_client.post(
        "/api/parameters",
        json={"code": "1bad", "display_name": "x", "value_type": "text"},
    )
    assert response.status_code == 422
    assert response.json()["code"] == "code_format"


async def test_choice_parameter_requires_active_choice_set(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    await seed_choice_set(
        db_session,
        code="equipment_mode",
        options=(("AUTO", "Automatic", True),),
    )
    await db_session.commit()

    response = await db_client.post(
        "/api/parameters",
        json={
            "code": "mode",
            "display_name": "Mode",
            "value_type": "choice",
            "choice_set_code": "equipment_mode",
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["choice_set"]["code"] == "equipment_mode"
    assert "options" not in response.json()

    inactive = await db_client.patch(
        "/api/choice-sets/equipment_mode",
        json={"expected_version": 1, "is_active": False},
    )
    assert inactive.status_code == 200
    rejected = await db_client.post(
        "/api/parameters",
        json={
            "code": "mode_2",
            "display_name": "Mode 2",
            "value_type": "choice",
            "choice_set_code": "equipment_mode",
        },
    )
    assert rejected.status_code == 422
    assert rejected.json()["code"] == "invalid_active_choice_set"


async def test_choice_parameter_rejects_missing_set(db_client: AsyncClient) -> None:
    absent_code = await db_client.post(
        "/api/parameters",
        json={
            "code": "mode",
            "display_name": "Mode",
            "value_type": "choice",
            "choice_set_code": "does_not_exist",
        },
    )
    omitted = await db_client.post(
        "/api/parameters",
        json={"code": "mode_2", "display_name": "Mode 2", "value_type": "choice"},
    )
    assert absent_code.status_code == 422
    assert omitted.status_code == 422
    assert omitted.json()["code"] == "choice_set_required"


async def test_non_choice_parameter_rejects_choice_set(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    await seed_choice_set(db_session, code="equipment_mode")
    await db_session.commit()
    response = await db_client.post(
        "/api/parameters",
        json={
            "code": "pitch",
            "display_name": "Pitch",
            "value_type": "number",
            "choice_set_code": "equipment_mode",
        },
    )
    assert response.status_code == 422
    assert response.json()["code"] == "choice_set_not_allowed"


async def test_choice_set_binding_is_immutable_after_create(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    await seed_choice_set(db_session, code="equipment_mode")
    await seed_choice_set(db_session, code="other_mode")
    await db_session.commit()
    created = (
        await db_client.post(
            "/api/parameters",
            json={
                "code": "mode",
                "display_name": "Mode",
                "value_type": "choice",
                "choice_set_code": "equipment_mode",
            },
        )
    ).json()

    response = await db_client.patch(
        f"/api/parameters/{created['id']}",
        json={"display_name": "Updated", "choice_set_code": "other_mode"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["display_name"] == "Updated"
    assert response.json()["choice_set"]["code"] == "equipment_mode"


async def test_legacy_parameter_options_route_is_removed(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    await seed_choice_set(db_session, code="equipment_mode")
    await db_session.commit()
    created = (
        await db_client.post(
            "/api/parameters",
            json={
                "code": "mode",
                "display_name": "Mode",
                "value_type": "choice",
                "choice_set_code": "equipment_mode",
            },
        )
    ).json()
    response = await db_client.put(
        f"/api/parameters/{created['id']}/options",
        json=[{"value": "A", "display_name": "Alpha"}],
    )
    assert response.status_code in {404, 405}


async def test_min_greater_than_max_rejected_on_create_and_update(
    db_client: AsyncClient,
) -> None:
    create = await db_client.post(
        "/api/parameters",
        json={
            "code": "bad_bounds",
            "display_name": "Bad",
            "value_type": "number",
            "min_value": "10",
            "max_value": "1",
        },
    )
    assert create.status_code == 422
    assert create.json()["code"] == "number_bounds"

    parameter = (
        await db_client.post(
            "/api/parameters",
            json={
                "code": "temp",
                "display_name": "온도",
                "value_type": "number",
                "min_value": "0",
                "max_value": "20",
            },
        )
    ).json()
    update = await db_client.patch(
        f"/api/parameters/{parameter['id']}",
        json={"min_value": "10", "max_value": "1"},
    )
    assert update.status_code == 422
    assert update.json()["code"] == "number_bounds"


async def test_parameter_list_builds_choice_summaries_without_n_plus_one(
    db_client: AsyncClient,
    db_session: AsyncSession,
    db_engine: AsyncEngine,
) -> None:
    choice_set = await seed_choice_set(
        db_session,
        code="equipment_mode",
        options=(("AUTO", "Automatic", True),),
    )
    await db_session.commit()
    for index in range(8):
        response = await db_client.post(
            "/api/parameters",
            json={
                "code": f"mode_{index}",
                "display_name": f"Mode {index}",
                "value_type": "choice",
                "choice_set_code": choice_set.code,
            },
        )
        assert response.status_code == 201, response.text

    statements: list[str] = []

    def record_statement(*args) -> None:
        statements.append(str(args[2]))

    event.listen(db_engine.sync_engine, "before_cursor_execute", record_statement)
    try:
        response = await db_client.get("/api/parameters")
    finally:
        event.remove(db_engine.sync_engine, "before_cursor_execute", record_statement)

    assert response.status_code == 200, response.text
    assert len(response.json()) == 8
    assert all(row["choice_set"]["code"] == "equipment_mode" for row in response.json())
    assert len(statements) <= 3, statements


async def test_update_cannot_change_code(db_client: AsyncClient) -> None:
    created = (
        await db_client.post(
            "/api/parameters",
            json={"code": "focus", "display_name": "포커스", "value_type": "text"},
        )
    ).json()
    response = await db_client.patch(
        f"/api/parameters/{created['id']}",
        json={"code": "focus2", "display_name": "포커스 수정"},
    )
    assert response.status_code == 200
    assert response.json()["code"] == "focus"


async def test_deactivate_is_soft_delete(db_client: AsyncClient) -> None:
    created = (
        await db_client.post(
            "/api/parameters",
            json={"code": "overlay", "display_name": "오버레이", "value_type": "text"},
        )
    ).json()
    response = await db_client.post(f"/api/parameters/{created['id']}/deactivate")
    assert response.status_code == 200
    assert response.json()["is_active"] is False
    assert (await db_client.get("/api/parameters")).json() == []
    all_parameters = await db_client.get("/api/parameters", params={"include_inactive": True})
    assert [row["code"] for row in all_parameters.json()] == ["overlay"]


async def test_active_rules_fence_both_parameter_deactivation_paths(
    db_client: AsyncClient,
) -> None:
    source = (
        await db_client.post(
            "/api/parameters",
            json={"code": "source_ref", "display_name": "Source", "value_type": "text"},
        )
    ).json()
    await db_client.post(
        "/api/parameters",
        json={"code": "target_ref", "display_name": "Target", "value_type": "text"},
    )
    created_rule = await db_client.post(
        "/api/validation-rules",
        json={
            "code": "dependent_rule",
            "name": "Dependent rule",
            "severity": "error",
            "spec": {
                "schema_version": 1,
                "type": "required_if",
                "when_parameter_code": "source_ref",
                "equals": "yes",
                "required_parameter_code": "target_ref",
            },
        },
    )
    assert created_rule.status_code == 201, created_rule.text

    ordinary_update = await db_client.patch(
        f"/api/parameters/{source['id']}", json={"display_name": "Renamed source"}
    )
    patch_deactivate = await db_client.patch(
        f"/api/parameters/{source['id']}", json={"is_active": False}
    )
    route_deactivate = await db_client.post(
        f"/api/parameters/{source['id']}/deactivate"
    )
    assert ordinary_update.status_code == 200, ordinary_update.text
    for blocked in (patch_deactivate, route_deactivate):
        assert blocked.status_code == 409, blocked.text
        assert blocked.json()["code"] == "parameter_referenced_by_validation_rule"

    deactivated_rule = await db_client.patch(
        "/api/validation-rules/dependent_rule",
        json={"expected_version": 1, "is_active": False},
    )
    assert deactivated_rule.status_code == 200, deactivated_rule.text
    allowed = await db_client.patch(
        f"/api/parameters/{source['id']}", json={"is_active": False}
    )
    repeated = await db_client.post(f"/api/parameters/{source['id']}/deactivate")
    assert allowed.status_code == 200, allowed.text
    assert repeated.status_code == 200, repeated.text
    assert repeated.json()["is_active"] is False


async def test_get_missing_parameter_404(db_client: AsyncClient) -> None:
    response = await db_client.get("/api/parameters/999")
    assert response.status_code == 404


async def test_category_crud_and_parameter_link(db_client: AsyncClient) -> None:
    category = (
        await db_client.post(
            "/api/parameters/categories",
            json={"code": "photo", "display_name": "노광"},
        )
    ).json()
    parameter = await db_client.post(
        "/api/parameters",
        json={
            "code": "na",
            "display_name": "개구수",
            "value_type": "number",
            "category_id": category["id"],
        },
    )
    assert parameter.status_code == 201, parameter.text
    assert parameter.json()["category_id"] == category["id"]

    updated = await db_client.patch(
        f"/api/parameters/categories/{category['id']}",
        json={"display_name": "PHOTO", "sort_order": 5, "is_active": False},
    )
    assert updated.status_code == 200
    assert updated.json()["display_name"] == "PHOTO"
    assert (await db_client.get("/api/parameters/categories")).json() == []


async def test_category_errors(db_client: AsyncClient) -> None:
    payload = {"code": "etch", "display_name": "식각"}
    assert (await db_client.post("/api/parameters/categories", json=payload)).status_code == 201
    assert (await db_client.post("/api/parameters/categories", json=payload)).status_code == 409
    assert (
        await db_client.patch("/api/parameters/categories/999", json={"display_name": "x"})
    ).status_code == 404


async def test_unknown_category_rejected(db_client: AsyncClient) -> None:
    create = await db_client.post(
        "/api/parameters",
        json={
            "code": "sigma",
            "display_name": "시그마",
            "value_type": "number",
            "category_id": 12345,
        },
    )
    assert create.status_code == 404

    parameter = (
        await db_client.post(
            "/api/parameters",
            json={"code": "pitch", "display_name": "피치", "value_type": "number"},
        )
    ).json()
    update = await db_client.patch(f"/api/parameters/{parameter['id']}", json={"category_id": 777})
    assert update.status_code == 404


async def test_csv_preview_then_apply_uses_choice_set_code(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    await seed_choice_set(
        db_session,
        code="equipment_mode",
        options=(("AUTO", "Automatic", True),),
    )
    await db_session.commit()
    await db_client.post(
        "/api/parameters",
        json={"code": "memo", "display_name": "old", "value_type": "text"},
    )
    csv_text = (
        "code,display_name,value_type,category,unit,min_value,max_value,"
        "choice_set_code,description,sort_order\n"
        "pitch,Pitch,number,geometry,um,001.5000,10.000,,,1\n"
        "memo,Memo,text,,,,,,,2\n"
        "mode,Mode,choice,,,,,equipment_mode,,3\n"
    )

    preview = await db_client.post("/api/parameters/import/preview", json={"csv_text": csv_text})
    assert preview.status_code == 200, preview.text
    assert preview.json()["created_count"] == 2
    assert preview.json()["updated_count"] == 1
    assert {row["code"] for row in (await db_client.get("/api/parameters")).json()} == {"memo"}

    applied = await db_client.post("/api/parameters/import/apply", json={"csv_text": csv_text})
    assert applied.status_code == 200, applied.text
    parameters = {row["code"]: row for row in (await db_client.get("/api/parameters")).json()}
    assert parameters["pitch"]["min_value"] == "1.5"
    assert parameters["pitch"]["max_value"] == "10"
    assert parameters["mode"]["choice_set"]["code"] == "equipment_mode"
    assert "options" not in parameters["mode"]


async def test_csv_import_reports_errors_without_applying(
    db_client: AsyncClient,
) -> None:
    csv_text = (
        "code,display_name,value_type,category,unit,min_value,max_value,"
        "choice_set_code,description,sort_order\n"
        "9bad,Bad,text,,,,,,,0\n"
        "mode,Mode,choice,,,,,,,0\n"
    )
    preview = await db_client.post("/api/parameters/import/preview", json={"csv_text": csv_text})
    assert preview.status_code == 200
    assert preview.json()["error_count"] == 2
    applied = await db_client.post("/api/parameters/import/apply", json={"csv_text": csv_text})
    assert applied.status_code == 200
    assert (await db_client.get("/api/parameters")).json() == []


async def test_csv_preview_rejects_non_number_numeric_metadata_before_apply(
    db_client: AsyncClient,
) -> None:
    csv_text = (
        "code,display_name,value_type,category,unit,min_value,max_value,"
        "choice_set_code,description,sort_order\n"
        "note,Note,text,,nm,,,,,0\n"
    )

    preview = await db_client.post(
        "/api/parameters/import/preview",
        json={"csv_text": csv_text},
    )
    applied = await db_client.post(
        "/api/parameters/import/apply",
        json={"csv_text": csv_text},
    )

    assert preview.status_code == 200
    assert preview.json()["error_count"] == 1
    assert applied.status_code == 200
    assert applied.json()["error_count"] == 1
    assert (await db_client.get("/api/parameters")).json() == []
