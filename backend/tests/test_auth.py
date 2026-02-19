"""Tests for JWT authentication endpoints (SPEC-AUTH-001 Milestone 1).

Covers:
- POST /api/auth/login  (success, wrong password, inactive user)
- POST /api/auth/refresh (valid cookie, missing cookie)
- POST /api/auth/logout  (clears cookie)
- GET  /api/auth/me      (returns current user)
- Protected endpoint without token -> 401
- Expired token          -> 401
"""

from datetime import timedelta

import pytest
import pytest_asyncio

from app.models.user import User
from app.services.auth_service import create_access_token, get_password_hash


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture
async def inactive_user(db_session):
    """Create an inactive user for testing disabled-account scenarios."""
    user = User(
        username="inactive_user",
        display_name="Inactive User",
        role="editor",
        is_active=False,
        password_hash=get_password_hash("changeme123!"),
        email="inactive@test.local",
    )
    db_session.add(user)
    await db_session.flush()
    await db_session.commit()
    return user


# ---------------------------------------------------------------------------
# Login tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_login_success(client, seed_test_data):
    """Correct credentials return 200, access_token and Set-Cookie header."""
    response = await client.post(
        "/api/auth/login",
        data={"username": "tester1", "password": "changeme123!"},
    )
    assert response.status_code == 200
    body = response.json()
    assert "access_token" in body
    assert body["token_type"] == "bearer"
    assert body["user"]["username"] == "tester1"
    assert body["user"]["role"] == "editor"
    assert "refresh_token" in response.cookies


@pytest.mark.asyncio
async def test_login_wrong_password(client, seed_test_data):
    """Wrong password returns 401."""
    response = await client.post(
        "/api/auth/login",
        data={"username": "tester1", "password": "wrongpassword"},
    )
    assert response.status_code == 401
    assert "access_token" not in response.json()


@pytest.mark.asyncio
async def test_login_unknown_user(client, seed_test_data):
    """Unknown username returns 401."""
    response = await client.post(
        "/api/auth/login",
        data={"username": "nonexistent", "password": "changeme123!"},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_login_inactive_user(client, db_session, inactive_user):
    """is_active=False returns 401."""
    response = await client.post(
        "/api/auth/login",
        data={"username": "inactive_user", "password": "changeme123!"},
    )
    assert response.status_code == 401


# ---------------------------------------------------------------------------
# Refresh token tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_refresh_token(client, seed_test_data):
    """Valid refresh cookie returns a new access_token."""
    # First login to get the cookie
    login_resp = await client.post(
        "/api/auth/login",
        data={"username": "tester1", "password": "changeme123!"},
    )
    assert login_resp.status_code == 200

    # Use the refresh cookie to get a new access token
    refresh_resp = await client.post("/api/auth/refresh")
    assert refresh_resp.status_code == 200
    body = refresh_resp.json()
    assert "access_token" in body
    assert body["token_type"] == "bearer"


@pytest.mark.asyncio
async def test_refresh_without_cookie(client, seed_test_data):
    """Missing refresh cookie returns 401."""
    response = await client.post("/api/auth/refresh")
    assert response.status_code == 401


# ---------------------------------------------------------------------------
# Logout tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_logout(client, seed_test_data):
    """Logout clears the refresh_token cookie."""
    # Login first
    login_resp = await client.post(
        "/api/auth/login",
        data={"username": "tester1", "password": "changeme123!"},
    )
    assert login_resp.status_code == 200
    assert "refresh_token" in login_resp.cookies

    # Logout
    logout_resp = await client.post("/api/auth/logout")
    assert logout_resp.status_code == 200

    # After logout, refresh should fail
    refresh_resp = await client.post("/api/auth/refresh")
    assert refresh_resp.status_code == 401


# ---------------------------------------------------------------------------
# /me endpoint tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_me_endpoint(client, seed_test_data, auth_headers):
    """GET /me returns the current user info."""
    user = seed_test_data["user"]
    headers = auth_headers(user)

    response = await client.get("/api/auth/me", headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == user.id
    assert body["username"] == user.username
    assert body["role"] == user.role


# ---------------------------------------------------------------------------
# Protected endpoint tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_protected_without_token(client, seed_test_data):
    """Accessing /me without a token returns 401."""
    response = await client.get("/api/auth/me")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_expired_token(client, seed_test_data):
    """An expired token returns 401."""
    user = seed_test_data["user"]
    # Create a token that has already expired
    expired_token = create_access_token(
        {"sub": str(user.id), "username": user.username, "role": user.role},
        expires_delta=timedelta(seconds=-1),
    )
    headers = {"Authorization": f"Bearer {expired_token}"}
    response = await client.get("/api/auth/me", headers=headers)
    assert response.status_code == 401
