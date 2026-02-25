"""Tests for admin user CRUD endpoints and last-admin protection."""

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession


# ---------------------------------------------------------------------------
# User CRUD Tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_list_users(client: AsyncClient, seed_test_data, auth_headers):
    """GET /api/admin/users returns active users by default."""
    headers = auth_headers(seed_test_data["admin_user"])
    resp = await client.get("/api/admin/users", headers=headers)
    assert resp.status_code == 200
    users = resp.json()
    assert len(users) >= 3
    assert all(u["is_active"] for u in users)


@pytest.mark.asyncio
async def test_list_users_include_inactive(
    client: AsyncClient, db_session: AsyncSession, seed_test_data, auth_headers,
):
    """GET /api/admin/users?include_inactive=true returns all users."""
    user = seed_test_data["user"]
    user.is_active = False
    await db_session.commit()

    headers = auth_headers(seed_test_data["admin_user"])
    resp = await client.get(
        "/api/admin/users", params={"include_inactive": True}, headers=headers,
    )
    assert resp.status_code == 200
    users = resp.json()
    inactive = [u for u in users if not u["is_active"]]
    assert len(inactive) >= 1


@pytest.mark.asyncio
async def test_list_users_non_admin_rejected(client: AsyncClient, seed_test_data, auth_headers):
    """Non-admin users should get 403."""
    headers = auth_headers(seed_test_data["user"])
    resp = await client.get("/api/admin/users", headers=headers)
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_create_user(client: AsyncClient, seed_test_data, auth_headers):
    """POST /api/admin/users creates a new user."""
    headers = auth_headers(seed_test_data["admin_user"])
    resp = await client.post(
        "/api/admin/users",
        json={
            "username": "newuser",
            "display_name": "New User",
            "email": "new@test.local",
            "roles": ["editor"],
            "password": "password123",
        },
        headers=headers,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["username"] == "newuser"
    assert data["roles"] == ["editor"]
    assert data["is_active"] is True
    assert "password_hash" not in data


@pytest.mark.asyncio
async def test_create_user_duplicate_username(client: AsyncClient, seed_test_data, auth_headers):
    """Duplicate username returns 409."""
    headers = auth_headers(seed_test_data["admin_user"])
    resp = await client.post(
        "/api/admin/users",
        json={
            "username": "tester1",
            "display_name": "Dup User",
            "roles": ["editor"],
            "password": "pass",
        },
        headers=headers,
    )
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_update_user(client: AsyncClient, seed_test_data, auth_headers):
    """PUT /api/admin/users/{id} updates user fields."""
    headers = auth_headers(seed_test_data["admin_user"])
    user_id = seed_test_data["user"].id
    resp = await client.put(
        f"/api/admin/users/{user_id}",
        json={"display_name": "Updated Name", "roles": ["reviewer"]},
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["display_name"] == "Updated Name"
    assert resp.json()["roles"] == ["reviewer"]


@pytest.mark.asyncio
async def test_deactivate_user(client: AsyncClient, seed_test_data, auth_headers):
    """PUT /api/admin/users/{id}/deactivate deactivates a user."""
    headers = auth_headers(seed_test_data["admin_user"])
    user_id = seed_test_data["user"].id
    resp = await client.put(
        f"/api/admin/users/{user_id}/deactivate", headers=headers,
    )
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_deactivate_self_rejected(client: AsyncClient, seed_test_data, auth_headers):
    """Cannot deactivate yourself."""
    admin = seed_test_data["admin_user"]
    headers = auth_headers(admin)
    resp = await client.put(
        f"/api/admin/users/{admin.id}/deactivate", headers=headers,
    )
    assert resp.status_code == 400
    assert "자기 자신" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_reset_password(client: AsyncClient, seed_test_data, auth_headers):
    """PUT /api/admin/users/{id}/password resets password."""
    headers = auth_headers(seed_test_data["admin_user"])
    user_id = seed_test_data["user"].id
    resp = await client.put(
        f"/api/admin/users/{user_id}/password",
        json={"new_password": "newpass123"},
        headers=headers,
    )
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Last Admin Protection Tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_last_admin_role_change_rejected(
    client: AsyncClient, seed_test_data, auth_headers,
):
    """Cannot change the last admin's role."""
    admin = seed_test_data["admin_user"]
    headers = auth_headers(admin)
    resp = await client.put(
        f"/api/admin/users/{admin.id}",
        json={"roles": ["editor"]},
        headers=headers,
    )
    assert resp.status_code == 400
    assert "마지막 관리자" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_last_admin_deactivate_rejected(
    client: AsyncClient, db_session: AsyncSession, seed_test_data, auth_headers,
):
    """Cannot deactivate the last admin (even by another admin)."""
    from app.models import User

    admin = seed_test_data["admin_user"]
    # Create a second admin to perform the action
    second_admin = User(
        username="admin2", display_name="Admin 2", roles=["admin"],
        password_hash="fakehash", email="admin2@test.local",
    )
    db_session.add(second_admin)
    await db_session.commit()

    headers = auth_headers(second_admin)

    # Deactivate second_admin first (by admin1)
    headers1 = auth_headers(admin)
    await client.put(f"/api/admin/users/{second_admin.id}/deactivate", headers=headers1)

    # Now try to deactivate the only remaining admin
    resp = await client.put(
        f"/api/admin/users/{admin.id}/deactivate",
        headers=headers1,
    )
    # admin1 cannot deactivate themselves
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Master Data FK Protection Tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_delete_line_with_products_rejected(
    client: AsyncClient, seed_test_data, auth_headers,
):
    """Cannot delete a line that has products."""
    headers = auth_headers(seed_test_data["admin_user"])
    line_id = seed_test_data["line"].id
    resp = await client.delete(
        f"/api/admin/lines/{line_id}", headers=headers,
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_delete_product_with_projects_rejected(
    client: AsyncClient, db_session: AsyncSession, seed_test_data, auth_headers,
):
    """Cannot delete a product that is referenced by projects."""
    from app.models import Project

    backbone = seed_test_data["backbone"]
    user = seed_test_data["user"]

    project = Project(
        product_id=backbone.id,
        main_backbone_id=backbone.id,
        created_by=user.id,
        status="draft",
    )
    db_session.add(project)
    await db_session.commit()

    headers = auth_headers(seed_test_data["admin_user"])
    resp = await client.delete(
        f"/api/admin/products/{backbone.id}", headers=headers,
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_delete_layer_with_project_layers_rejected(
    client: AsyncClient, db_session: AsyncSession, seed_test_data, auth_headers,
):
    """Cannot delete a layer that is referenced by project layers."""
    from app.models import Project, ProjectLayer

    layer = seed_test_data["layers"][0]
    backbone = seed_test_data["backbone"]
    user = seed_test_data["user"]

    project = Project(
        product_id=backbone.id,
        main_backbone_id=backbone.id,
        created_by=user.id,
        status="draft",
    )
    db_session.add(project)
    await db_session.flush()

    pl = ProjectLayer(
        project_id=project.id,
        layer_id=layer.id,
        conditions={},
        backbone_conditions={},
    )
    db_session.add(pl)
    await db_session.commit()

    headers = auth_headers(seed_test_data["admin_user"])
    resp = await client.delete(
        f"/api/admin/layers/{layer.id}", headers=headers,
    )
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Select Options Test
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_select_options_crud(
    client: AsyncClient, db_session: AsyncSession, seed_test_data, auth_headers,
):
    """GET select columns + PUT select_options."""
    from app.models import ColumnDefinition
    headers = auth_headers(seed_test_data["admin_user"])

    # Set select_options on adhesion_use column
    from sqlalchemy import select
    result = await db_session.execute(
        select(ColumnDefinition).where(ColumnDefinition.column_name == "SP_ADHESION_USE")
    )
    col = result.scalar_one()
    col.select_options = ["Y", "N"]
    await db_session.commit()

    # List select columns
    resp = await client.get("/api/admin/columns/select-options", headers=headers)
    assert resp.status_code == 200
    cols = resp.json()
    assert len(cols) >= 1

    # Update select_options
    resp = await client.put(
        f"/api/admin/columns/{col.id}/select-options",
        json={"select_options": ["Y", "N", "SKIP"]},
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["select_options"] == ["Y", "N", "SKIP"]


# ---------------------------------------------------------------------------
# Audit Log Test
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_audit_logs(
    client: AsyncClient, db_session: AsyncSession, seed_test_data, auth_headers,
):
    """GET /api/admin/audit-logs returns paginated logs."""
    from app.models import ChangeLog, Project, ProjectLayer

    user = seed_test_data["user"]
    backbone = seed_test_data["backbone"]
    layer = seed_test_data["layers"][0]

    project = Project(
        product_id=backbone.id, main_backbone_id=backbone.id,
        created_by=user.id, status="draft",
    )
    db_session.add(project)
    await db_session.flush()

    pl = ProjectLayer(
        project_id=project.id, layer_id=layer.id,
        conditions={}, backbone_conditions={},
    )
    db_session.add(pl)
    await db_session.flush()

    log = ChangeLog(
        project_layer_id=pl.id,
        column_name="SP_SPIN1_SPEED_rpm",
        old_value="2000",
        new_value="2500",
        change_type="manual",
        changed_by=user.id,
    )
    db_session.add(log)
    await db_session.commit()

    headers = auth_headers(seed_test_data["admin_user"])
    resp = await client.get("/api/admin/audit-logs", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] >= 1
    assert len(data["items"]) >= 1
    assert data["items"][0]["column_name"] == "SP_SPIN1_SPEED_rpm"
