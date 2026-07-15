from typing import get_args

import pytest
from fastapi.params import Depends
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.errors import RuleViolationError
from app.domain.parameters.types import ValueType
from app.features.choice_sets.repository import ChoiceSetRepository
from app.features.choice_sets.router import ServiceDep
from app.models.choice import ChoiceOption, ChoiceSet
from app.models.parameter import Parameter


async def create_set(client: AsyncClient, code: str = "device_type") -> dict:
    response = await client.post(
        "/api/choice-sets",
        json={"code": code, "display_name": code.replace("_", " ").title()},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_choice_service_commits_before_mutation_response_is_sent() -> None:
    dependency = next(
        metadata
        for metadata in get_args(ServiceDep)[1:]
        if isinstance(metadata, Depends)
    )
    assert dependency.scope == "function"


async def create_option(
    client: AsyncClient,
    set_code: str,
    version: int,
    code: str,
    *,
    label: str | None = None,
    sort_order: int = 0,
    is_active: bool = True,
) -> dict:
    response = await client.post(
        f"/api/choice-sets/{set_code}/options",
        json={
            "expected_version": version,
            "code": code,
            "label": label or code,
            "sort_order": sort_order,
            "is_active": is_active,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


async def test_option_mutation_bumps_once_and_stale_write_is_atomic(
    db_client: AsyncClient,
) -> None:
    created = await create_set(db_client)
    option = await db_client.post(
        "/api/choice-sets/device_type/options",
        json={"expected_version": created["version"], "code": "FOUNDRY", "label": "Foundry"},
    )
    assert option.status_code == 201
    assert option.json()["choice_set"]["version"] == 2

    stale = await db_client.patch(
        "/api/choice-sets/device_type/options/FOUNDRY",
        json={"expected_version": 1, "label": "Overwrite"},
    )
    assert stale.status_code == 409
    assert stale.json()["code"] == "choice_set_changed"
    assert stale.json()["details"]["actual_version"] == 2

    page = await db_client.get(
        "/api/choice-sets/device_type/options",
        params={"include_inactive": True},
    )
    assert page.json()["items"][0]["label"] == "Foundry"


async def test_page_cursor_rejects_version_mixing(db_client: AsyncClient) -> None:
    summary = await create_set(db_client, "large_set")
    version = summary["version"]
    for code in ["A", "B", "C"]:
        response = await db_client.post(
            "/api/choice-sets/large_set/options",
            json={"expected_version": version, "code": code, "label": code},
        )
        version = response.json()["choice_set"]["version"]

    first = await db_client.get(
        "/api/choice-sets/large_set/options",
        params={"version": version, "limit": 1, "include_inactive": True},
    )
    cursor = first.json()["next_cursor"]
    changed = await db_client.patch(
        "/api/choice-sets/large_set/options/A",
        json={"expected_version": version, "label": "Alpha"},
    )
    assert changed.status_code == 200
    second = await db_client.get(
        "/api/choice-sets/large_set/options",
        params={"cursor": cursor, "include_inactive": True},
    )
    assert second.status_code == 409
    assert second.json()["code"] == "choice_set_changed"


async def test_all_ten_endpoints_use_the_approved_status_table(db_client: AsyncClient) -> None:
    created = await db_client.post(
        "/api/choice-sets", json={"code": "status_set", "display_name": "Status"}
    )
    assert created.status_code == 201
    assert (await db_client.get("/api/choice-sets")).status_code == 200
    assert (await db_client.get("/api/choice-sets/status_set")).status_code == 200

    patched = await db_client.patch(
        "/api/choice-sets/status_set",
        json={"expected_version": 1, "display_name": "Statuses"},
    )
    assert patched.status_code == 200
    option = await db_client.post(
        "/api/choice-sets/status_set/options",
        json={"expected_version": 2, "code": "A", "label": "Alpha"},
    )
    assert option.status_code == 201
    option_patch = await db_client.patch(
        "/api/choice-sets/status_set/options/A",
        json={"expected_version": 3, "label": "A"},
    )
    assert option_patch.status_code == 200
    assert (await db_client.get("/api/choice-sets/status_set/options")).status_code == 200
    reordered = await db_client.put(
        "/api/choice-sets/status_set/option-order",
        json={"expected_version": 4, "ordered_codes": ["A"]},
    )
    assert reordered.status_code == 200
    csv_text = "code,label,sort_order,is_active\nA,Alpha,10,true\n"
    preview = await db_client.post(
        "/api/choice-sets/status_set/import/preview",
        json={"expected_version": 5, "csv_text": csv_text},
    )
    assert preview.status_code == 200
    applied = await db_client.post(
        "/api/choice-sets/status_set/import",
        json={"expected_version": 5, "csv_text": csv_text},
    )
    assert applied.status_code == 200


async def test_sequential_duplicate_set_is_a_clean_conflict(db_client: AsyncClient) -> None:
    await create_set(db_client, "duplicate")
    duplicate = await db_client.post(
        "/api/choice-sets", json={"code": "duplicate", "display_name": "Other"}
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["code"] == "choice_set_exists"
    assert duplicate.json()["details"] == {"set_code": "duplicate"}
    sets = await db_client.get("/api/choice-sets", params={"include_inactive": True})
    assert [item["code"] for item in sets.json()] == ["duplicate"]
    options = await db_client.get(
        "/api/choice-sets/duplicate/options", params={"include_inactive": True}
    )
    assert options.json()["items"] == []


async def test_set_list_defaults_to_active_only(db_client: AsyncClient) -> None:
    await create_set(db_client, "active")
    await create_set(db_client, "inactive")
    response = await db_client.patch(
        "/api/choice-sets/inactive", json={"expected_version": 1, "is_active": False}
    )
    assert response.status_code == 200
    active_only = await db_client.get("/api/choice-sets")
    assert [item["code"] for item in active_only.json()] == ["active"]
    all_sets = await db_client.get("/api/choice-sets", params={"include_inactive": True})
    assert [item["code"] for item in all_sets.json()] == ["active", "inactive"]


async def test_summary_counts_options_parameter_and_fixed_profile_usage(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    summaries: dict[str, dict] = {}
    for code in ["device_type", "project_category", "active_direction", "gate_direction"]:
        summaries[code] = await create_set(db_client, code)

    version = summaries["device_type"]["version"]
    first = await create_option(db_client, "device_type", version, "ACTIVE")
    version = first["choice_set"]["version"]
    second = await create_option(db_client, "device_type", version, "INACTIVE")
    version = second["choice_set"]["version"]
    inactive = await db_client.patch(
        "/api/choice-sets/device_type/options/INACTIVE",
        json={"expected_version": version, "is_active": False},
    )
    assert inactive.status_code == 200

    # Public summaries intentionally omit internal IDs. Resolve the row by code for direct seeding.
    from sqlalchemy import select

    choice_set = (
        await db_session.execute(select(ChoiceSet).where(ChoiceSet.code == "device_type"))
    ).scalar_one()
    db_session.add(
        Parameter(
            code="device_parameter",
            display_name="Device parameter",
            value_type=ValueType.CHOICE,
            choice_set_id=choice_set.id,
        )
    )
    await db_session.commit()

    listed = await db_client.get("/api/choice-sets", params={"include_inactive": True})
    by_code = {item["code"]: item for item in listed.json()}
    device = by_code["device_type"]
    assert device["option_count"] == 2
    assert device["active_option_count"] == 1
    assert device["parameter_usage_count"] == 1
    assert {
        code: by_code[code]["profile_usage_fields"]
        for code in ["device_type", "project_category", "active_direction", "gate_direction"]
    } == {
        "device_type": ["device_type"],
        "project_category": ["project_category"],
        "active_direction": ["active_direction"],
        "gate_direction": ["gate_direction"],
    }
    active_only = await db_client.get("/api/choice-sets/device_type/options")
    with_inactive = await db_client.get(
        "/api/choice-sets/device_type/options", params={"include_inactive": True}
    )
    assert [item["code"] for item in active_only.json()["items"]] == ["ACTIVE"]
    assert [item["code"] for item in with_inactive.json()["items"]] == [
        "ACTIVE",
        "INACTIVE",
    ]


async def test_repository_bulk_resolvers_and_summary_map_are_consumer_ready(
    db_session: AsyncSession,
) -> None:
    active = ChoiceSet(code="resolver_active", display_name="Active")
    active.options.extend(
        [
            ChoiceOption(code="A", label="Alpha", is_active=True),
            ChoiceOption(code="B", label="Beta", is_active=False),
        ]
    )
    inactive = ChoiceSet(code="resolver_inactive", display_name="Inactive", is_active=False)
    inactive.options.append(ChoiceOption(code="A", label="Inactive alpha", is_active=True))
    db_session.add_all([active, inactive])
    await db_session.flush()

    repository = ChoiceSetRepository(db_session)
    keys = {
        ("resolver_active", "A"),
        ("resolver_active", "B"),
        ("resolver_inactive", "A"),
        ("missing", "A"),
    }
    resolved = await repository.resolve_options(keys)
    assert set(resolved) == keys - {("missing", "A")}
    assert resolved[("resolver_active", "A")].effective_is_active is True
    assert resolved[("resolver_active", "B")].effective_is_active is False
    assert resolved[("resolver_inactive", "A")].effective_is_active is False
    only_active = await repository.resolve_options(keys, include_inactive=False)
    assert set(only_active) == {("resolver_active", "A")}

    with pytest.raises(RuleViolationError):
        await repository.resolve_active_options(keys)
    assert set(await repository.lock_active_sets_for_write(["resolver_active"])) == {
        "resolver_active"
    }
    with pytest.raises(RuleViolationError):
        await repository.lock_active_sets_for_write(["resolver_active", "resolver_inactive"])

    summaries = await repository.summaries_by_ids([active.id, inactive.id])
    assert set(summaries) == {active.id, inactive.id}
    assert summaries[active.id].option_count == 2


async def test_set_and_option_codes_are_immutable_request_fields(db_client: AsyncClient) -> None:
    summary = await create_set(db_client, "immutable")
    forbidden_set = await db_client.patch(
        "/api/choice-sets/immutable",
        json={"expected_version": summary["version"], "code": "changed"},
    )
    assert forbidden_set.status_code == 422
    option = await create_option(db_client, "immutable", summary["version"], "A")
    forbidden_option = await db_client.patch(
        "/api/choice-sets/immutable/options/A",
        json={"expected_version": option["choice_set"]["version"], "code": "B"},
    )
    assert forbidden_option.status_code == 422
    detail = await db_client.get("/api/choice-sets/immutable")
    assert detail.json()["version"] == 2


async def test_option_codes_are_exact_case_and_no_delete_route_exists(
    db_client: AsyncClient,
) -> None:
    summary = await create_set(db_client, "case_set")
    upper = await create_option(db_client, "case_set", summary["version"], "CASE")
    lower = await create_option(
        db_client, "case_set", upper["choice_set"]["version"], "case"
    )
    duplicate = await db_client.post(
        "/api/choice-sets/case_set/options",
        json={
            "expected_version": lower["choice_set"]["version"],
            "code": "CASE",
            "label": "Duplicate",
        },
    )
    assert duplicate.status_code == 422
    missing = await db_client.patch(
        "/api/choice-sets/case_set/options/Case",
        json={"expected_version": lower["choice_set"]["version"], "label": "missing"},
    )
    assert missing.status_code == 404
    page = await db_client.get(
        "/api/choice-sets/case_set/options", params={"include_inactive": True}
    )
    assert {item["code"] for item in page.json()["items"]} == {"CASE", "case"}
    deleted = await db_client.delete("/api/choice-sets/case_set/options/CASE")
    assert deleted.status_code == 405


async def test_punctuation_identity_round_trips(db_client: AsyncClient) -> None:
    summary = await create_set(db_client, "A.B-_1")
    mutation = await create_option(db_client, "A.B-_1", summary["version"], "A.B-_1")
    assert mutation["option"]["code"] == "A.B-_1"
    detail = await db_client.get("/api/choice-sets/A.B-_1")
    assert detail.json()["code"] == "A.B-_1"
    page = await db_client.get(
        "/api/choice-sets/A.B-_1/options", params={"include_inactive": True}
    )
    assert page.json()["items"][0]["code"] == "A.B-_1"


async def test_unsafe_identities_are_rejected_in_set_option_and_import_rows(
    db_client: AsyncClient,
) -> None:
    unsafe = ["A/B", "A%2FB", ".", "..", "한글", "A B"]
    for index, code in enumerate(unsafe):
        rejected_set = await db_client.post(
            "/api/choice-sets", json={"code": code, "display_name": "Unsafe"}
        )
        assert rejected_set.status_code == 422, (code, rejected_set.text)

        set_code = f"safe_{index}"
        await create_set(db_client, set_code)
        rejected_option = await db_client.post(
            f"/api/choice-sets/{set_code}/options",
            json={"expected_version": 1, "code": code, "label": "Unsafe"},
        )
        assert rejected_option.status_code == 422, (code, rejected_option.text)
        csv_text = f"code,label,sort_order,is_active\n{code},Unsafe,0,true\n"
        preview = await db_client.post(
            f"/api/choice-sets/{set_code}/import/preview",
            json={"expected_version": 1, "csv_text": csv_text},
        )
        assert preview.status_code == 200
        assert preview.json()["error_count"] == 1
        rejected_import = await db_client.post(
            f"/api/choice-sets/{set_code}/import",
            json={"expected_version": 1, "csv_text": csv_text},
        )
        assert rejected_import.status_code == 422, (code, rejected_import.text)


async def test_inactive_set_rejects_new_or_reactivated_option(db_client: AsyncClient) -> None:
    summary = await create_set(db_client, "inactive_parent")
    option = await create_option(db_client, "inactive_parent", summary["version"], "OLD")
    still_active = await create_option(
        db_client,
        "inactive_parent",
        option["choice_set"]["version"],
        "STILL_ACTIVE",
    )
    deactivated_option = await db_client.patch(
        "/api/choice-sets/inactive_parent/options/OLD",
        json={
            "expected_version": still_active["choice_set"]["version"],
            "is_active": False,
        },
    )
    version = deactivated_option.json()["choice_set"]["version"]
    deactivated_set = await db_client.patch(
        "/api/choice-sets/inactive_parent",
        json={"expected_version": version, "is_active": False},
    )
    version = deactivated_set.json()["version"]
    new_option = await db_client.post(
        "/api/choice-sets/inactive_parent/options",
        json={"expected_version": version, "code": "NEW", "label": "New"},
    )
    assert new_option.status_code == 422
    activated = await db_client.patch(
        "/api/choice-sets/inactive_parent/options/OLD",
        json={"expected_version": version, "is_active": True},
    )
    assert activated.status_code == 422
    assert (await db_client.get("/api/choice-sets/inactive_parent")).json()["version"] == version
    explicit_noop = await db_client.patch(
        "/api/choice-sets/inactive_parent/options/STILL_ACTIVE",
        json={"expected_version": version, "is_active": True},
    )
    assert explicit_noop.status_code == 200
    version = explicit_noop.json()["choice_set"]["version"]
    preview = await db_client.post(
        "/api/choice-sets/inactive_parent/import/preview",
        json={
            "expected_version": version,
            "csv_text": "code,label,sort_order,is_active\nNEW,New,0,false\nOLD,Old,1,true\n",
        },
    )
    assert preview.status_code == 200
    assert preview.json()["error_count"] == 2


async def test_q_matches_code_and_label_case_insensitively(db_client: AsyncClient) -> None:
    summary = await create_set(db_client, "search")
    first = await create_option(db_client, "search", summary["version"], "FOUNDRY", label="Fab")
    await create_option(
        db_client,
        "search",
        first["choice_set"]["version"],
        "SPECIAL",
        label="Special Customer",
    )
    by_code = await db_client.get("/api/choice-sets/search/options", params={"q": "found"})
    by_label = await db_client.get("/api/choice-sets/search/options", params={"q": "CUSTOMER"})
    assert [item["code"] for item in by_code.json()["items"]] == ["FOUNDRY"]
    assert [item["code"] for item in by_label.json()["items"]] == ["SPECIAL"]


async def test_option_pagination_defaults_to_100_and_caps_at_500(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    choice_set = ChoiceSet(code="paged", display_name="Paged", version=1)
    choice_set.options.extend(
        ChoiceOption(code=f"C{index:03d}", label=str(index), sort_order=index)
        for index in range(101)
    )
    db_session.add(choice_set)
    await db_session.commit()
    first = await db_client.get(
        "/api/choice-sets/paged/options", params={"include_inactive": True}
    )
    assert first.status_code == 200
    assert len(first.json()["items"]) == 100
    assert first.json()["next_cursor"] is not None
    maximum = await db_client.get(
        "/api/choice-sets/paged/options",
        params={"limit": 500, "include_inactive": True},
    )
    assert maximum.status_code == 200
    assert len(maximum.json()["items"]) == 101
    too_large = await db_client.get("/api/choice-sets/paged/options", params={"limit": 501})
    assert too_large.status_code == 422
    malformed = await db_client.get(
        "/api/choice-sets/paged/options", params={"cursor": "not-a-cursor"}
    )
    assert malformed.status_code == 422


async def test_reorder_requires_every_active_and_inactive_code_once(
    db_client: AsyncClient,
) -> None:
    summary = await create_set(db_client, "ordered")
    version = summary["version"]
    for code in ["A", "B", "C"]:
        mutation = await create_option(db_client, "ordered", version, code)
        version = mutation["choice_set"]["version"]
    inactive = await db_client.patch(
        "/api/choice-sets/ordered/options/B",
        json={"expected_version": version, "is_active": False},
    )
    version = inactive.json()["choice_set"]["version"]
    for invalid in (["A", "C"], ["A", "B", "B"]):
        rejected = await db_client.put(
            "/api/choice-sets/ordered/option-order",
            json={"expected_version": version, "ordered_codes": invalid},
        )
        assert rejected.status_code == 422
    reordered = await db_client.put(
        "/api/choice-sets/ordered/option-order",
        json={"expected_version": version, "ordered_codes": ["C", "B", "A"]},
    )
    assert reordered.status_code == 200
    assert reordered.json()["version"] == version + 1
    page = await db_client.get(
        "/api/choice-sets/ordered/options", params={"include_inactive": True}
    )
    assert [item["code"] for item in page.json()["items"]] == ["C", "B", "A"]


async def test_import_preview_errors_and_stale_apply_have_no_side_effect(
    db_client: AsyncClient,
) -> None:
    summary = await create_set(db_client, "imported")
    first = await create_option(db_client, "imported", summary["version"], "KEEP", label="Keep")
    second = await create_option(
        db_client,
        "imported",
        first["choice_set"]["version"],
        "FOUNDRY",
        label="Old",
    )
    version = second["choice_set"]["version"]
    valid_csv = (
        "code,label,sort_order,is_active\n"
        "FOUNDRY,Foundry,10,true\n"
        "SPECIAL,Special customer,20,false\n"
    )
    preview = await db_client.post(
        "/api/choice-sets/imported/import/preview",
        json={"expected_version": version, "csv_text": valid_csv},
    )
    assert preview.status_code == 200
    assert preview.json()["base_version"] == version
    assert (preview.json()["created_count"], preview.json()["updated_count"]) == (1, 1)
    before = await db_client.get(
        "/api/choice-sets/imported/options", params={"include_inactive": True}
    )
    assert [(item["code"], item["label"]) for item in before.json()["items"]] == [
        ("FOUNDRY", "Old"),
        ("KEEP", "Keep"),
    ]

    bad_csv = "code,label,sort_order,is_active\nBROKEN,Broken,0,yes\n"
    invalid = await db_client.post(
        "/api/choice-sets/imported/import",
        json={"expected_version": version, "csv_text": bad_csv},
    )
    assert invalid.status_code == 422
    stale = await db_client.post(
        "/api/choice-sets/imported/import",
        json={"expected_version": version - 1, "csv_text": valid_csv},
    )
    assert stale.status_code == 409
    unchanged = await db_client.get("/api/choice-sets/imported")
    assert unchanged.json()["version"] == version

    applied = await db_client.post(
        "/api/choice-sets/imported/import",
        json={"expected_version": version, "csv_text": valid_csv},
    )
    assert applied.status_code == 200
    assert applied.json()["choice_set"]["version"] == version + 1
    page = await db_client.get(
        "/api/choice-sets/imported/options", params={"include_inactive": True}
    )
    assert [(item["code"], item["label"], item["is_active"]) for item in page.json()["items"]] == [
        ("KEEP", "Keep", True),
        ("FOUNDRY", "Foundry", True),
        ("SPECIAL", "Special customer", False),
    ]
