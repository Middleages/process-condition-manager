"""Final Parameter API contract backed by managed ChoiceSets."""

from typing import cast

from httpx import AsyncClient
from sqlalchemy import Enum, Table, event
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
    assert "ck_parameter_choice_set_binding" in {
        constraint.name for constraint in table.constraints
    }


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
    all_parameters = await db_client.get(
        "/api/parameters", params={"include_inactive": True}
    )
    assert [row["code"] for row in all_parameters.json()] == ["overlay"]


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
    update = await db_client.patch(
        f"/api/parameters/{parameter['id']}", json={"category_id": 777}
    )
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

    preview = await db_client.post(
        "/api/parameters/import/preview", json={"csv_text": csv_text}
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["created_count"] == 2
    assert preview.json()["updated_count"] == 1
    assert {row["code"] for row in (await db_client.get("/api/parameters")).json()} == {
        "memo"
    }

    applied = await db_client.post(
        "/api/parameters/import/apply", json={"csv_text": csv_text}
    )
    assert applied.status_code == 200, applied.text
    parameters = {
        row["code"]: row for row in (await db_client.get("/api/parameters")).json()
    }
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
    preview = await db_client.post(
        "/api/parameters/import/preview", json={"csv_text": csv_text}
    )
    assert preview.status_code == 200
    assert preview.json()["error_count"] == 2
    applied = await db_client.post(
        "/api/parameters/import/apply", json={"csv_text": csv_text}
    )
    assert applied.status_code == 200
    assert (await db_client.get("/api/parameters")).json() == []
