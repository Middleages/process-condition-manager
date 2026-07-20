"""Phase 5 인증 경계 테스트 (D-10: trusted proxy + dev_stub 호환성)."""

from __future__ import annotations

import base64
import hashlib
import json
from typing import Annotated

import pytest
from fastapi import APIRouter, Depends, FastAPI
from httpx import ASGITransport, AsyncClient

from app.core import auth as auth_module
from app.core.auth import (  # noqa: F401
    Permission,
    PermissionCheckError,
    SsoParseError,
    UserContext,
    get_permission_dependency,
    require_business_read,
    require_project_comment,
)
from app.core.config import Settings, clear_auth_parse_issues, settings
from app.core.errors import register_exception_handlers
from app.features.auth.router import router as auth_router
from app.main import create_app as create_main_app


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _build_auth_api_app() -> FastAPI:
    app = FastAPI()
    register_exception_handlers(app)
    api_router = APIRouter(prefix="/api")
    api_router.include_router(auth_router)
    # Route with a state-changing method to validate CSRF enforcement.
    @api_router.post("/auth/protected")
    async def protected(
        user: Annotated[UserContext, Depends(auth_module.get_current_user)],
    ) -> dict[str, str]:
        assert user is not None
        return {"ok": "true"}

    app.include_router(api_router)
    return app


def _apply_settings(settings_obj: Settings, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(auth_module, "settings", settings_obj)
    monkeypatch.setattr("app.core.config.settings", settings_obj)
    monkeypatch.setattr("app.main.settings", settings_obj)


def _secret(seed: int) -> str:
    return _normalize_secret(hashlib.sha256(f"pcm-secret-seed-{seed}".encode()).digest())


def _normalize_secret(raw: bytes) -> str:
    return _b64url(raw)


def _expected_actor(issuer: str, subject: str) -> str:
    digest = hashlib.sha256(f"{issuer}\0{subject}".encode()).hexdigest()
    return f"oidc:{digest}"


def _set_trusted_proxy_settings(
    monkeypatch: pytest.MonkeyPatch,
    *,
    issuer: str = "tenant.example",
    secret_values: list[str] | None = None,
    admin_groups: list[str] | None = None,
    reviewer_groups: list[str] | None = None,
    editor_groups: list[str] | None = None,
    environment: str = "production",
    mode: str = "trusted_proxy",
) -> None:
    if secret_values is None:
        secret_values = [_normalize_secret(b"secret-key-minimum-32-bytes-0123")]
    admin_groups = admin_groups or ["team-admins"]
    reviewer_groups = reviewer_groups or ["team-reviewers"]
    editor_groups = editor_groups or ["team-editors"]

    _apply_settings(
        Settings(
            pcm_environment=environment,
            pcm_auth_mode=mode,
            pcm_auth_issuer=issuer,
            pcm_auth_proxy_secrets=secret_values,
            pcm_auth_admin_groups=admin_groups,
            pcm_auth_reviewer_groups=reviewer_groups,
            pcm_auth_editor_groups=editor_groups,
        ),
        monkeypatch,
    )


@pytest.mark.parametrize(
    ("environment", "mode", "expected_code"),
    [
        ("production", "dev_stub", 503),
        ("production", "trusted_proxy", 503),
    ],
)
async def test_auth_not_configured_in_invalid_mode(
    environment: str,
    mode: str,
    expected_code: int,
    monkeypatch,
) -> None:
    _apply_settings(
        Settings(
            pcm_environment=environment,
            pcm_auth_mode=mode,
            pcm_auth_issuer="",
            pcm_auth_proxy_secrets=[],
            pcm_auth_admin_groups=[],
            pcm_auth_reviewer_groups=[],
            pcm_auth_editor_groups=[],
        ),
        monkeypatch,
    )

    app = _build_auth_api_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.get("/api/auth/me")

    assert resp.status_code == expected_code
    assert resp.json()["code"] == "auth_not_configured"
    assert resp.json()["message"] == "authentication is not configured"


@pytest.mark.parametrize(
    ("raw", "message"),
    [
        ("", "must not be empty"),
        ("not-base64?", "is not strict base64url"),
        ("YWJjPQ==", "must be unpadded"),
        ("+YWJj", "invalid base64url alphabet"),
        ("/YWJj", "invalid base64url alphabet"),
    ],
)
def test_decode_unpadded_base64url_validation(raw: str, message: str) -> None:
    with pytest.raises(SsoParseError, match=message):
        auth_module._decode_unpadded_base64url(raw, min_len=1, max_len=10, field="value")


async def test_actor_hash_uses_issuer_and_decoded_subject(monkeypatch) -> None:
    _set_trusted_proxy_settings(
        monkeypatch=monkeypatch,
        secret_values=[_normalize_secret(b"secret-key-minimum-32-bytes-0001")],
        admin_groups=["admins"],
        reviewer_groups=["reviewers"],
        editor_groups=["editors"],
    )

    subject = _b64url(b"alice-subject")
    headers = {
        "X-PCM-Proxy-Secret": _normalize_secret(b"secret-key-minimum-32-bytes-0001"),
        "X-PCM-Subject": subject,
        "X-PCM-Groups": _b64url(json.dumps(["admins"]).encode()),
        "X-PCM-Issuer": "tenant.example",
        "X-PCM-CSRF-Verified": "1",
    }

    app = _build_auth_api_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.get("/api/auth/me", headers=headers)

    assert resp.status_code == 200, resp.text
    assert resp.json()["id"] == _expected_actor("tenant.example", "alice-subject")


async def test_auth_trusted_proxy_maps_roles_and_union_permissions(monkeypatch) -> None:
    _set_trusted_proxy_settings(
        monkeypatch=monkeypatch,
        secret_values=[_normalize_secret(b"secret-key-minimum-32-bytes-0123")],
        admin_groups=["admins"],
        reviewer_groups=["reviewers"],
        editor_groups=["editors"],
    )

    headers = {
        "X-PCM-Proxy-Secret": _normalize_secret(b"secret-key-minimum-32-bytes-0123"),
        "X-PCM-Subject": _b64url(b"alice-subject"),
        "X-PCM-Groups": _b64url(json.dumps(["editors", "admins"]).encode()),
        "X-PCM-Issuer": "tenant.example",
        "X-PCM-CSRF-Verified": "1",
    }

    app = _build_auth_api_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.get("/api/auth/me", headers=headers)

    assert resp.status_code == 200, resp.text
    assert resp.json()["roles"] == ["admin", "editor"]
    assert resp.json()["permissions"] == [
        "business.read",
        "registry.manage",
        "project.edit",
        "project.review.request",
        "project.review.decide",
        "project.revision.create",
        "project.comment",
    ]


@pytest.mark.parametrize(
    ("value",),
    [
        (_b64url(b"alice") + "=",),
        ("",),
        ("+YWJj",),
    ],
)
async def test_auth_rejects_invalid_subject_header(
    value: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _set_trusted_proxy_settings(
        monkeypatch=monkeypatch,
        secret_values=[_normalize_secret(b"secret-key-minimum-32-bytes-0123")],
        admin_groups=["admins"],
        reviewer_groups=["reviewers"],
        editor_groups=["editors"],
    )

    headers = {
        "X-PCM-Proxy-Secret": _normalize_secret(b"secret-key-minimum-32-bytes-0123"),
        "X-PCM-Subject": value,
        "X-PCM-Groups": _b64url(json.dumps(["editors"]).encode()),
        "X-PCM-Issuer": "tenant.example",
        "X-PCM-CSRF-Verified": "1",
    }

    app = _build_auth_api_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.get("/api/auth/me", headers=headers)

    assert resp.status_code == 401
    assert resp.json()["code"] == "authentication_required"


async def test_auth_rejects_duplicate_required_headers(monkeypatch) -> None:
    _set_trusted_proxy_settings(
        monkeypatch=monkeypatch,
        secret_values=[_normalize_secret(b"secret-key-minimum-32-bytes-0123")],
        admin_groups=["team-admins"],
        reviewer_groups=["team-reviewers"],
        editor_groups=["team-editors"],
    )

    app = _build_auth_api_app()
    transport = ASGITransport(app=app)
    headers = [
        ("X-PCM-Proxy-Secret", _normalize_secret(b"secret-key-minimum-32-bytes-0123")),
        ("X-PCM-Proxy-Secret", _normalize_secret(b"secret-key-minimum-32-bytes-0123")),
        ("X-PCM-Subject", _b64url(b"alice")),
        ("X-PCM-Groups", _b64url(json.dumps(["team-editors"]).encode())),
        ("X-PCM-Issuer", "tenant.example"),
        ("X-PCM-CSRF-Verified", "1"),
    ]

    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.get("/api/auth/me", headers=headers)

    assert resp.status_code == 401
    assert resp.json()["code"] == "authentication_required"


@pytest.mark.parametrize("csrf", [None, "0", "2", "", "yes", "01"])
async def test_auth_csrf_required_for_unsafe_methods(csrf: str | None, monkeypatch) -> None:
    _set_trusted_proxy_settings(
        monkeypatch=monkeypatch,
        secret_values=[_normalize_secret(b"secret-key-minimum-32-bytes-0123")],
        admin_groups=["team-admins"],
        reviewer_groups=["team-reviewers"],
        editor_groups=["team-editors"],
    )

    app = _build_auth_api_app()
    transport = ASGITransport(app=app)

    headers = {
        "X-PCM-Proxy-Secret": _normalize_secret(b"secret-key-minimum-32-bytes-0123"),
        "X-PCM-Subject": _b64url(b"alice"),
        "X-PCM-Groups": _b64url(json.dumps(["team-editors"]).encode()),
        "X-PCM-Issuer": "tenant.example",
    }
    if csrf is not None:
        headers["X-PCM-CSRF-Verified"] = csrf

    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.post("/api/auth/protected", headers=headers)

    assert resp.status_code == 401
    assert resp.json()["code"] == "authentication_required"


@pytest.mark.parametrize(
    ("secret_count", "expect_503"),
    [(0, True), (1, False), (2, False), (3, True)],
)
async def test_proxy_secret_count_validation(
    secret_count: int,
    expect_503: bool,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    secrets = [_secret(idx) for idx in range(secret_count)]
    _set_trusted_proxy_settings(
        monkeypatch=monkeypatch,
        secret_values=secrets,
        admin_groups=["a"],
        reviewer_groups=["b"],
        editor_groups=["c"],
    )

    app = _build_auth_api_app()
    transport = ASGITransport(app=app)
    headers = {
        "X-PCM-Proxy-Secret": secrets[0] if secrets else "a",
        "X-PCM-Subject": _b64url(b"alice"),
        "X-PCM-Groups": _b64url(json.dumps(["a"]).encode()),
        "X-PCM-Issuer": "tenant.example",
        "X-PCM-CSRF-Verified": "1",
    }

    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.get("/api/auth/me", headers=headers)

    assert resp.status_code == (503 if expect_503 else 200)


async def test_proxy_secret_duplicates_or_rotation(monkeypatch) -> None:
    secret = _normalize_secret(b"secret-key-minimum-32-bytes-1111")
    _set_trusted_proxy_settings(
        monkeypatch=monkeypatch,
        secret_values=[secret, secret],
        admin_groups=["a"],
        reviewer_groups=["b"],
        editor_groups=["c"],
    )

    app = _build_auth_api_app()
    transport = ASGITransport(app=app)
    headers = {
        "X-PCM-Proxy-Secret": secret,
        "X-PCM-Subject": _b64url(b"alice"),
        "X-PCM-Groups": _b64url(json.dumps(["a"]).encode()),
        "X-PCM-Issuer": "tenant.example",
        "X-PCM-CSRF-Verified": "1",
    }
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.get("/api/auth/me", headers=headers)
    assert resp.status_code == 503
    assert resp.json()["message"] == "authentication is not configured"

    # rotation check: two distinct secrets must both authenticate
    secret_a = _normalize_secret(b"secret-key-minimum-32-bytes-1111")
    secret_b = _normalize_secret(b"secret-key-minimum-32-bytes-2222")
    _set_trusted_proxy_settings(
        monkeypatch=monkeypatch,
        secret_values=[secret_a, secret_b],
        admin_groups=["a"],
        reviewer_groups=["b"],
        editor_groups=["c"],
    )

    headers["X-PCM-Groups"] = _b64url(json.dumps(["c"]).encode())
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        for secret_value in [secret_a, secret_b]:
            headers["X-PCM-Proxy-Secret"] = secret_value
            resp = await ac.get("/api/auth/me", headers=headers)
            assert resp.status_code == 200
            assert resp.json()["id"] == _expected_actor("tenant.example", "alice")


@pytest.mark.parametrize(
    ("payload", "error_msg"),
    [
        ("{}", "must be a list"),
        ("[\"a\", \"a\"]", "duplicate items"),
        ("[1,2]", "contains non-string item"),
    ],
)
def test_group_header_validation(payload: str, error_msg: str) -> None:
    with pytest.raises(SsoParseError, match=error_msg):
        auth_module._parse_group_header(_b64url(payload.encode()))


def test_group_header_rejects_empty_entry() -> None:
    with pytest.raises(SsoParseError, match="empty item"):
        auth_module._parse_group_header(_b64url(json.dumps([""]).encode()))


def test_group_header_counts_unicode_scalars_not_utf8_bytes() -> None:
    accepted = "가" * 256
    assert auth_module._parse_group_header(
        _b64url(json.dumps([accepted], ensure_ascii=False).encode())
    ) == [accepted]
    with pytest.raises(SsoParseError, match="scalar length"):
        auth_module._parse_group_header(
            _b64url(json.dumps(["가" * 257], ensure_ascii=False).encode())
        )


async def test_trusted_proxy_accepts_unicode_presentation_and_group(monkeypatch) -> None:
    secret = _normalize_secret(b"secret-key-minimum-32-bytes-0123")
    _set_trusted_proxy_settings(
        monkeypatch,
        secret_values=[secret],
        admin_groups=["관리자"],
        reviewer_groups=["검토자"],
        editor_groups=["편집자"],
    )
    headers = {
        "X-PCM-Proxy-Secret": secret,
        "X-PCM-Subject": _b64url("사용자-1".encode()),
        "X-PCM-Groups": _b64url(json.dumps(["검토자"], ensure_ascii=False).encode()),
        "X-PCM-Issuer": "tenant.example",
        "X-PCM-Display-Name": _b64url("홍길동".encode()),
        "X-PCM-Email": _b64url("사용자@example.com".encode()),
    }
    async with AsyncClient(
        transport=ASGITransport(app=_build_auth_api_app()), base_url="http://test"
    ) as ac:
        response = await ac.get("/api/auth/me", headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()["display_name"] == "홍길동"
    assert response.json()["email"] == "사용자@example.com"
    assert response.json()["roles"] == ["reviewer"]


async def test_trusted_proxy_parse_and_trust_failures_share_safe_shape(monkeypatch) -> None:
    secret = _normalize_secret(b"secret-key-minimum-32-bytes-0123")
    _set_trusted_proxy_settings(monkeypatch, secret_values=[secret])
    base = {
        "X-PCM-Proxy-Secret": secret,
        "X-PCM-Subject": _b64url(b"alice"),
        "X-PCM-Groups": _b64url(json.dumps(["team-editors"]).encode()),
        "X-PCM-Issuer": "tenant.example",
    }
    variants = [
        {**base, "X-PCM-Issuer": "wrong.example"},
        {**base, "X-PCM-Proxy-Secret": _normalize_secret(b"wrong-secret-minimum-32-bytes-00")},
        {**base, "X-PCM-Subject": "not-base64?"},
        {**base, "X-PCM-Subject": _b64url(b"\xff\xfe")},
        {
            **base,
            "X-PCM-Groups": _b64url(json.dumps(["\ud800"]).encode()),
        },
    ]
    async with AsyncClient(
        transport=ASGITransport(app=_build_auth_api_app()), base_url="http://test"
    ) as ac:
        bodies = [(await ac.get("/api/auth/me", headers=headers)).json() for headers in variants]
    assert {(body["code"], body["message"]) for body in bodies} == {
        ("authentication_required", "authentication required")
    }


def test_auth_configuration_rejects_unknown_environment_and_non_string_group(monkeypatch) -> None:
    clear_auth_parse_issues()
    malformed = Settings.model_validate(
        {
            "pcm_environment": "staging",
            "pcm_auth_mode": "trusted_proxy",
            "pcm_auth_issuer": "tenant.example",
            "pcm_auth_proxy_secrets": json.dumps([_secret(1)]),
            "pcm_auth_admin_groups": '["a", 1]',
            "pcm_auth_reviewer_groups": '["b"]',
            "pcm_auth_editor_groups": '["c"]',
        }
    )
    _apply_settings(malformed, monkeypatch)
    status = auth_module.get_auth_configuration_status()
    assert status.valid is False
    assert status.reason_code == "auth_not_configured"


@pytest.mark.parametrize(
    ("bad", "expected_message"),
    [
        ("parse_issue", "malformed auth settings"),
        ("group_overlap", "group mapping overlap"),
    ],
)
def test_auth_settings_parse_issues_cause_safe_config_status(
    bad: str,
    expected_message: str,
    monkeypatch,
) -> None:
    clear_auth_parse_issues()
    if bad == "parse_issue":
        malformed = Settings.model_validate(
            {
                "pcm_environment": "production",
                "pcm_auth_mode": "trusted_proxy",
                "pcm_auth_issuer": "tenant.example",
                "pcm_auth_proxy_secrets": "[1,2,",
                "pcm_auth_admin_groups": '["a"]',
                "pcm_auth_reviewer_groups": '["b"]',
                "pcm_auth_editor_groups": '["c"]',
            }
        )
    else:
        malformed = Settings(
            pcm_environment="production",
            pcm_auth_mode="trusted_proxy",
            pcm_auth_issuer="tenant.example",
            pcm_auth_proxy_secrets=[_normalize_secret(b"secret-key-minimum-32-bytes-0123")],
            pcm_auth_admin_groups=["overlap"],
            pcm_auth_reviewer_groups=["overlap"],
            pcm_auth_editor_groups=["c"],
        )

    _apply_settings(malformed, monkeypatch)
    status = auth_module.get_auth_configuration_status()
    assert status.valid is False
    assert status.reason_code == "auth_not_configured"
    assert expected_message in (status.reason or "")


@pytest.mark.asyncio
async def test_permission_dependency_factory_and_helpers() -> None:
    user = UserContext(
        id="u1",
        permissions=(Permission.BUSINESS_READ, Permission.PROJECT_COMMENT),
    )

    dep = get_permission_dependency(Permission.PROJECT_COMMENT)
    assert await dep(user) == user

    with pytest.raises(PermissionCheckError):
        await dep(UserContext(id="u2", permissions=(Permission.BUSINESS_READ,)))

    assert await require_business_read(user=user) == user
    with pytest.raises(PermissionCheckError):
        await require_project_comment(user=UserContext(id="u3"))


async def test_health_endpoints_remain_non_disclosing(monkeypatch) -> None:
    _set_trusted_proxy_settings(
        monkeypatch=monkeypatch,
        secret_values=[],
        admin_groups=["a"],
        reviewer_groups=["b"],
        editor_groups=["c"],
    )

    app = create_main_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        health = await ac.get("/health")
        ready = await ac.get("/health/ready")

    assert health.status_code == 200
    assert health.json() == {"status": "ok", "app": settings.app_name}
    assert ready.status_code == 503
    payload = ready.json()
    assert payload["status"] == "not_ready"
    assert payload["checks"]["auth"]["status"] == "fail"
    assert payload["checks"]["auth"]["reason_code"] == "auth_not_configured"
    assert "reason" not in payload["checks"]["auth"]
