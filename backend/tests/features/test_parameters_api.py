"""파라미터 레지스트리 CRUD API 테스트 (SQLite 인메모리).

EC1(관리자가 파라미터 추가/수정/비활성화) 및 EC3(파라미터 추가에 앱 코드
수정 0줄 — 레지스트리 행 추가만으로 반영) 을 API 수준에서 검증한다.
"""

from httpx import AsyncClient


async def test_create_and_list_parameter(db_client: AsyncClient) -> None:
    """number 파라미터를 만들고 목록에 나타난다 (EC1/EC3)."""
    resp = await db_client.post(
        "/parameters",
        json={
            "code": "exposure_dose",
            "display_name": "노광량",
            "value_type": "number",
            "unit": "mJ",
            "min_value": 0,
            "max_value": 100,
        },
    )
    assert resp.status_code == 201, resp.text
    created = resp.json()
    assert created["code"] == "exposure_dose"
    assert created["is_active"] is True

    listed = (await db_client.get("/parameters")).json()
    assert [p["code"] for p in listed] == ["exposure_dose"]


async def test_code_normalized_and_duplicate_rejected(db_client: AsyncClient) -> None:
    """code는 정규화되고, 중복 code는 409로 거부된다."""
    r1 = await db_client.post(
        "/parameters",
        json={"code": "  width ", "display_name": "폭", "value_type": "text"},
    )
    assert r1.status_code == 201
    assert r1.json()["code"] == "width"

    r2 = await db_client.post(
        "/parameters",
        json={"code": "width", "display_name": "폭2", "value_type": "text"},
    )
    assert r2.status_code == 409
    assert r2.json()["code"] == "conflict"


async def test_invalid_code_rejected_as_422(db_client: AsyncClient) -> None:
    """도메인 규칙 위반(잘못된 code 형식)은 422로 매핑된다."""
    resp = await db_client.post(
        "/parameters",
        json={"code": "1bad", "display_name": "x", "value_type": "text"},
    )
    assert resp.status_code == 422
    assert resp.json()["code"] == "code_format"


async def test_choice_requires_option_422(db_client: AsyncClient) -> None:
    """choice 타입은 선택지 없이 생성하면 422."""
    resp = await db_client.post(
        "/parameters",
        json={"code": "mask_type", "display_name": "마스크", "value_type": "choice"},
    )
    assert resp.status_code == 422
    assert resp.json()["code"] == "choice_requires_option"


async def test_choice_with_options_and_replace(db_client: AsyncClient) -> None:
    """choice 파라미터 생성 + 선택지 교체."""
    created = (
        await db_client.post(
            "/parameters",
            json={
                "code": "tone",
                "display_name": "톤",
                "value_type": "choice",
                "options": [
                    {"value": "pos", "display_name": "Positive"},
                    {"value": "neg", "display_name": "Negative"},
                ],
            },
        )
    ).json()
    assert {o["value"] for o in created["options"]} == {"pos", "neg"}

    replaced = await db_client.put(
        f"/parameters/{created['id']}/options",
        json=[{"value": "pos", "display_name": "P"}],
    )
    assert replaced.status_code == 200
    assert [o["value"] for o in replaced.json()["options"]] == ["pos"]


async def test_update_cannot_change_code(db_client: AsyncClient) -> None:
    """PATCH 스키마에 code가 없으므로 code는 변경 불가 (불변 보장)."""
    created = (
        await db_client.post(
            "/parameters",
            json={"code": "focus", "display_name": "포커스", "value_type": "text"},
        )
    ).json()
    resp = await db_client.patch(
        f"/parameters/{created['id']}",
        json={"code": "focus2", "display_name": "포커스 수정"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == "focus"  # code 무시됨
    assert body["display_name"] == "포커스 수정"


async def test_deactivate_is_soft_delete(db_client: AsyncClient) -> None:
    """비활성화는 소프트 삭제 — 기본 목록에서 사라지고 include_inactive로 보인다."""
    created = (
        await db_client.post(
            "/parameters",
            json={"code": "overlay", "display_name": "오버레이", "value_type": "text"},
        )
    ).json()
    resp = await db_client.post(f"/parameters/{created['id']}/deactivate")
    assert resp.status_code == 200
    assert resp.json()["is_active"] is False

    assert (await db_client.get("/parameters")).json() == []
    all_params = (
        await db_client.get("/parameters", params={"include_inactive": True})
    ).json()
    assert [p["code"] for p in all_params] == ["overlay"]


async def test_update_min_gt_max_rejected(db_client: AsyncClient) -> None:
    """수정으로 min>max가 되면 422."""
    created = (
        await db_client.post(
            "/parameters",
            json={"code": "temp", "display_name": "온도", "value_type": "number"},
        )
    ).json()
    resp = await db_client.patch(
        f"/parameters/{created['id']}",
        json={"min_value": 10, "max_value": 1},
    )
    assert resp.status_code == 422
    assert resp.json()["code"] == "number_bounds"


async def test_get_missing_parameter_404(db_client: AsyncClient) -> None:
    resp = await db_client.get("/parameters/999")
    assert resp.status_code == 404
    assert resp.json()["code"] == "not_found"


async def test_category_crud_and_link(db_client: AsyncClient) -> None:
    """카테고리 생성 후 파라미터에 연결한다."""
    cat = (
        await db_client.post(
            "/parameters/categories",
            json={"code": "photo", "display_name": "노광"},
        )
    ).json()
    param = (
        await db_client.post(
            "/parameters",
            json={
                "code": "na",
                "display_name": "개구수",
                "value_type": "number",
                "category_id": cat["id"],
            },
        )
    ).json()
    assert param["category_id"] == cat["id"]


async def test_duplicate_category_rejected_409(db_client: AsyncClient) -> None:
    """중복 카테고리 code는 409."""
    payload = {"code": "etch", "display_name": "식각"}
    assert (await db_client.post("/parameters/categories", json=payload)).status_code == 201
    dup = await db_client.post("/parameters/categories", json=payload)
    assert dup.status_code == 409


async def test_update_category_fields(db_client: AsyncClient) -> None:
    """카테고리 display_name/sort_order/비활성화 수정 + 목록 필터."""
    cat = (
        await db_client.post(
            "/parameters/categories", json={"code": "cmp", "display_name": "CMP"}
        )
    ).json()
    resp = await db_client.patch(
        f"/parameters/categories/{cat['id']}",
        json={"display_name": "CMP 공정", "sort_order": 5, "is_active": False},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["display_name"] == "CMP 공정"
    assert body["sort_order"] == 5
    assert body["is_active"] is False
    # 비활성이므로 기본 목록에서 제외
    assert (await db_client.get("/parameters/categories")).json() == []


async def test_update_category_missing_404(db_client: AsyncClient) -> None:
    resp = await db_client.patch(
        "/parameters/categories/999", json={"display_name": "x"}
    )
    assert resp.status_code == 404


async def test_update_parameter_all_editable_fields(db_client: AsyncClient) -> None:
    """description/unit/sort_order/category_id 수정이 모두 반영된다."""
    cat = (
        await db_client.post(
            "/parameters/categories", json={"code": "litho", "display_name": "리소"}
        )
    ).json()
    param = (
        await db_client.post(
            "/parameters",
            json={"code": "dose", "display_name": "도즈", "value_type": "number"},
        )
    ).json()
    resp = await db_client.patch(
        f"/parameters/{param['id']}",
        json={
            "description": "노광 에너지",
            "unit": "mJ/cm2",
            "sort_order": 3,
            "category_id": cat["id"],
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["description"] == "노광 에너지"
    assert body["unit"] == "mJ/cm2"
    assert body["sort_order"] == 3
    assert body["category_id"] == cat["id"]


async def test_update_parameter_unknown_category_404(db_client: AsyncClient) -> None:
    param = (
        await db_client.post(
            "/parameters",
            json={"code": "pitch", "display_name": "피치", "value_type": "number"},
        )
    ).json()
    resp = await db_client.patch(
        f"/parameters/{param['id']}", json={"category_id": 777}
    )
    assert resp.status_code == 404


async def test_parameter_with_unknown_category_404(db_client: AsyncClient) -> None:
    resp = await db_client.post(
        "/parameters",
        json={
            "code": "sigma",
            "display_name": "시그마",
            "value_type": "number",
            "category_id": 12345,
        },
    )
    assert resp.status_code == 404
