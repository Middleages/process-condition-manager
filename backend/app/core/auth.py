"""인증 어댑터 경계 (T5).

Phase 5에서 요구되는 SSO 경계를 이 모듈에서 처리한다.
Dev stub는 기존 Phase 0/테스트 동작을 유지하면서, 실제 실행은
trusted_proxy 모드에서 게이트웨이 주입 헤더를 검증한다.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from enum import StrEnum
from typing import Annotated, Protocol

from fastapi import Depends, Request

from app.core.config import clear_auth_parse_issues, get_auth_parse_issues, settings
from app.core.errors import AppError

B64URL_UNPADDED_RE = re.compile(r"^[A-Za-z0-9_-]+$")


class Role(StrEnum):
    """RBAC 역할."""

    ADMIN = "admin"
    REVIEWER = "reviewer"
    EDITOR = "editor"


class Permission(StrEnum):
    """엔드포인트 권한 집합."""

    BUSINESS_READ = "business.read"
    REGISTRY_MANAGE = "registry.manage"
    PROJECT_EDIT = "project.edit"
    PROJECT_REVIEW_REQUEST = "project.review.request"
    PROJECT_REVIEW_DECIDE = "project.review.decide"
    PROJECT_REVISION_CREATE = "project.revision.create"
    PROJECT_COMMENT = "project.comment"


@dataclass(frozen=True)
class UserContext:
    """요청 사용자 컨텍스트."""

    id: str
    roles: tuple[Role, ...] = ()
    permissions: tuple[Permission, ...] = ()
    display_name: str | None = None
    email: str | None = None


@dataclass(frozen=True)
class AuthConfigurationStatus:
    """설정 유효성 결과(시작 실패/서비스 실패를 유도하지 않음)."""

    valid: bool
    reason_code: str | None = None
    reason: str | None = None
    details: dict[str, object] | None = None


class AuthAdapter(Protocol):
    """요청을 사용자 컨텍스트로 변환하는 인증 어댑터 계약."""

    async def authenticate(self, request: Request) -> UserContext:
        """요청에서 현재 사용자를 판독한다."""
        ...


class AuthenticationError(AppError):
    """인증/파싱 실패."""

    status_code = 401
    code = "authentication_required"


class PermissionDeniedError(AppError):
    """권한 부족."""

    status_code = 403
    code = "permission_denied"


class AuthNotConfiguredError(AppError):
    """보호 경로에서 인증 어댑터가 유효 구성으로 준비되지 않음."""

    status_code = 503
    code = "auth_not_configured"


class SsoParseError(AuthenticationError):
    """SSO 헤더 파싱/검증 실패."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)


class PermissionCheckError(PermissionDeniedError):
    """권한 미보유 오류."""

    def __init__(self, required_permission: Permission) -> None:
        super().__init__(
            "required permission is missing",
            code="permission_denied",
            details={"required_permission": required_permission.value},
        )


class DevStubAuthAdapter:
    """Phase 0 개발용 인증 스텁."""

    async def authenticate(self, request: Request) -> UserContext:
        return UserContext(
            id="dev-admin",
            roles=(Role.ADMIN,),
            permissions=_permissions_for_roles((Role.ADMIN,)),
            display_name="dev-admin",
        )


class TrustedProxyAuthAdapter:
    """신뢰된 내부 게이트웨이 헤더 기반 SSO 어댑터."""

    async def authenticate(self, request: Request) -> UserContext:
        if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
            csrf = _require_single_header(request, "x-pcm-csrf-verified")
            if csrf != "1":
                raise SsoParseError("missing or invalid csrf proof")

        secret = _require_single_header(request, "x-pcm-proxy-secret")
        _validate_proxy_secret(secret)

        subject = _require_single_header(request, "x-pcm-subject")
        groups_raw = _require_single_header(request, "x-pcm-groups")
        issuer = _require_single_header(request, "x-pcm-issuer")
        if issuer != settings.pcm_auth_issuer:
            raise SsoParseError("issuer mismatch")

        subject_bytes = _decode_unpadded_base64url(subject, min_len=1, max_len=255)
        if _contains_control_or_nul(subject_bytes):
            raise SsoParseError("subject contains control character")
        try:
            decoded_subject = subject_bytes.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise SsoParseError("subject is invalid utf-8") from exc

        display_name = _optional_text_header(
            request,
            "x-pcm-display-name",
            "display_name",
            max_bytes=512,
            allow_absent=True,
            max_scalars=255,
        )
        email = _optional_text_header(
            request,
            "x-pcm-email",
            "email",
            max_bytes=320,
            allow_absent=True,
            max_scalars=320,
        )
        groups = _parse_group_header(groups_raw)

        actor = _derive_actor_id(issuer=issuer, subject=decoded_subject)
        roles = _roles_from_groups(groups)
        permissions = _permissions_for_roles(roles)

        return UserContext(
            id=actor,
            roles=roles,
            permissions=permissions,
            display_name=display_name,
            email=email,
        )


def _decode_unpadded_base64url(
    value: str,
    *,
    min_len: int | None = None,
    max_len: int | None = None,
    max_raw_len: int | None = None,
    field: str = "value",
) -> bytes:
    if max_raw_len is not None and len(value) > max_raw_len:
        raise SsoParseError(f"{field} exceeds raw length")
    if not value.isascii():
        raise SsoParseError(f"{field} must contain ASCII characters only")
    if value == "":
        raise SsoParseError(f"{field} must not be empty")
    if "+" in value or "/" in value:
        raise SsoParseError(f"{field} has invalid base64url alphabet")
    if "=" in value:
        raise SsoParseError(f"{field} must be unpadded")
    if not B64URL_UNPADDED_RE.match(value):
        raise SsoParseError(f"{field} is not strict base64url")

    padded = value + "=" * ((4 - len(value) % 4) % 4)
    try:
        decoded = base64.urlsafe_b64decode(padded)
    except (ValueError, TypeError) as exc:
        raise SsoParseError(f"{field} is not base64url") from exc

    if min_len is not None and len(decoded) < min_len:
        raise SsoParseError(f"{field} is shorter than minimum")
    if max_len is not None and len(decoded) > max_len:
        raise SsoParseError(f"{field} is longer than maximum")
    return decoded


def _contains_control_or_nul(value: bytes | str) -> bool:
    if isinstance(value, str):
        text = value
    else:
        try:
            text = value.decode("utf-8")
        except UnicodeDecodeError:
            return True
    return any(ord(ch) < 0x20 or ord(ch) == 0x7F or ord(ch) == 0 for ch in text)


def _decode_strict_text(
    raw: str,
    *,
    field: str,
    max_len: int,
    max_scalars: int | None = None,
) -> str:
    if _contains_control_or_nul(raw):
        raise SsoParseError(f"{field} contains control character")
    # ``json.loads`` can materialize escaped lone surrogates even though they
    # are not Unicode scalar values and cannot be encoded as UTF-8.  Normalize
    # that trust-boundary failure instead of allowing UnicodeEncodeError to
    # escape as a 500.
    if any(0xD800 <= ord(ch) <= 0xDFFF for ch in raw):
        raise SsoParseError(f"{field} contains non-scalar character")
    try:
        encoded = raw.encode("utf-8")
    except UnicodeEncodeError as exc:
        raise SsoParseError(f"{field} is not valid Unicode text") from exc
    if len(encoded) > max_len:
        raise SsoParseError(f"{field} exceeds byte length")

    if max_scalars is not None and len(raw) > max_scalars:
        raise SsoParseError(f"{field} exceeds scalar length")
    return raw


def _optional_text_header(
    request: Request,
    name: str,
    field: str,
    *,
    max_bytes: int,
    allow_absent: bool,
    max_scalars: int | None = None,
) -> str | None:
    values = _header_values(request, name)
    if not values:
        return None if allow_absent else raise_missing_header(name)
    if len(values) != 1:
        raise SsoParseError(f"{name} is duplicated")
    raw = values[0]
    decoded = _decode_unpadded_base64url(raw, max_raw_len=8192, field=name)
    try:
        text = decoded.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise SsoParseError(f"{field} is invalid utf-8") from exc
    return _decode_strict_text(
        text,
        field=field,
        max_len=max_bytes,
        max_scalars=max_scalars,
    )


def _parse_group_header(raw: str) -> list[str]:
    decoded = _decode_unpadded_base64url(
        raw,
        max_raw_len=12 * 1024,
        max_len=8 * 1024,
        field="x-pcm-groups",
    )
    try:
        parsed = json.loads(decoded.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise SsoParseError("x-pcm-groups is malformed") from exc
    if not isinstance(parsed, list):
        raise SsoParseError("x-pcm-groups must be a list")
    if len(parsed) > 100:
        raise SsoParseError("x-pcm-groups has too many entries")

    groups: list[str] = []
    seen: set[str] = set()
    for item in parsed:
        if not isinstance(item, str):
            raise SsoParseError("x-pcm-groups contains non-string item")
        # D-10 expresses this limit in Unicode scalar values. The decoded JSON
        # envelope already has its own 8 KiB byte ceiling.
        entry = _decode_strict_text(item, field="group", max_len=1024, max_scalars=256)
        if not entry:
            raise SsoParseError("x-pcm-groups contains empty item")
        if entry in seen:
            raise SsoParseError("x-pcm-groups has duplicate items")
        seen.add(entry)
        groups.append(entry)
    return groups


def _roles_from_groups(groups: list[str]) -> tuple[Role, ...]:
    return tuple(
        role
        for role in (Role.ADMIN, Role.REVIEWER, Role.EDITOR)
        if any(g for g in groups if g in _role_group_map()[role])
    )


def _permissions_for_roles(roles: tuple[Role, ...]) -> tuple[Permission, ...]:
    permissions: list[Permission] = []
    seen: set[Permission] = set()

    role_permissions = {
        Role.ADMIN: (
            Permission.BUSINESS_READ,
            Permission.REGISTRY_MANAGE,
            Permission.PROJECT_EDIT,
            Permission.PROJECT_REVIEW_REQUEST,
            Permission.PROJECT_REVIEW_DECIDE,
            Permission.PROJECT_REVISION_CREATE,
            Permission.PROJECT_COMMENT,
        ),
        Role.REVIEWER: (
            Permission.BUSINESS_READ,
            Permission.PROJECT_REVIEW_DECIDE,
            Permission.PROJECT_COMMENT,
        ),
        Role.EDITOR: (
            Permission.BUSINESS_READ,
            Permission.PROJECT_EDIT,
            Permission.PROJECT_REVIEW_REQUEST,
            Permission.PROJECT_COMMENT,
        ),
    }

    ordered: list[Permission] = []
    for role in (Role.ADMIN, Role.REVIEWER, Role.EDITOR):
        if role in roles:
            ordered.extend(role_permissions[role])

    for perm in ordered:
        if perm not in seen:
            seen.add(perm)
            permissions.append(perm)

    return tuple(permissions)


def _role_group_map() -> dict[Role, tuple[str, ...]]:
    return {
        Role.ADMIN: tuple(settings.pcm_auth_admin_groups),
        Role.REVIEWER: tuple(settings.pcm_auth_reviewer_groups),
        Role.EDITOR: tuple(settings.pcm_auth_editor_groups),
    }


def _validate_group_overlaps(role_groups: dict[Role, tuple[str, ...]]) -> list[str]:
    seen: dict[str, Role] = {}
    overlaps: list[str] = []
    for role in (Role.ADMIN, Role.REVIEWER, Role.EDITOR):
        for group in role_groups[role]:
            if group in seen:
                overlaps.append(f"{group}:{seen[group].value}:{role.value}")
                continue
            seen[group] = role
    return overlaps


def _require_single_header(request: Request, name: str) -> str:
    values = _header_values(request, name)
    if len(values) != 1:
        if len(values) == 0:
            raise SsoParseError(f"missing {name}")
        raise SsoParseError(f"duplicate {name}")
    return values[0]


def _header_values(request: Request, name: str) -> list[str]:
    needle = name.lower().encode("ascii")
    values: list[str] = []
    for key, value in request.scope.get("headers", []):
        if key.lower() == needle:
            values.append(value.decode("latin-1"))
    return values


def _derive_actor_id(*, issuer: str, subject: str) -> str:
    digest = hashlib.sha256(f"{issuer}\0{subject}".encode()).hexdigest()
    return f"oidc:{digest}"


def _validate_proxy_secret(value: str) -> None:
    _decode_unpadded_base64url(
        value,
        min_len=1,
        max_len=256,
        field="x-pcm-proxy-secret",
    )


def get_auth_configuration_status() -> AuthConfigurationStatus:
    parse_issues = get_auth_parse_issues()
    if parse_issues:
        clear_auth_parse_issues()
        return AuthConfigurationStatus(
            valid=False,
            reason_code="auth_not_configured",
            reason="malformed auth settings",
            details={"parse_issues": list(parse_issues.keys())},
        )

    env = (settings.pcm_environment or "").strip().lower()
    mode = (settings.pcm_auth_mode or "").strip().lower()

    if env not in {"development", "test", "production"}:
        return AuthConfigurationStatus(
            valid=False,
            reason_code="auth_not_configured",
            reason="invalid environment",
            details={"pcm_environment": env},
        )

    if mode not in {"dev_stub", "trusted_proxy"}:
        return AuthConfigurationStatus(
            valid=False,
            reason_code="auth_not_configured",
            reason="invalid auth mode",
            details={"mode": settings.pcm_auth_mode},
        )

    if mode == "dev_stub" and env not in {"development", "test"}:
        return AuthConfigurationStatus(
            valid=False,
            reason_code="auth_not_configured",
            reason="dev_stub is disabled in production",
            details={"pcm_environment": env},
        )

    if mode == "trusted_proxy":
        if not settings.pcm_auth_issuer:
            return AuthConfigurationStatus(
                valid=False,
                reason_code="auth_not_configured",
                reason="missing auth issuer",
                details={"field": "pcm_auth_issuer"},
            )

        if len(settings.pcm_auth_proxy_secrets) not in {1, 2}:
            return AuthConfigurationStatus(
                valid=False,
                reason_code="auth_not_configured",
                reason="invalid proxy secret count",
                details={"count": len(settings.pcm_auth_proxy_secrets)},
            )

        if (
            not settings.pcm_auth_admin_groups
            or not settings.pcm_auth_reviewer_groups
            or not settings.pcm_auth_editor_groups
        ):
            return AuthConfigurationStatus(
                valid=False,
                reason_code="auth_not_configured",
                reason="group mapping must be configured",
                details={
                    "admin": len(settings.pcm_auth_admin_groups),
                    "reviewer": len(settings.pcm_auth_reviewer_groups),
                    "editor": len(settings.pcm_auth_editor_groups),
                },
            )

        configured_groups = (
            settings.pcm_auth_admin_groups
            + settings.pcm_auth_reviewer_groups
            + settings.pcm_auth_editor_groups
        )
        if any(
            not group or len(group) > 256 or _contains_control_or_nul(group)
            for group in configured_groups
        ) or any(
            len(groups) != len(set(groups))
            for groups in (
                settings.pcm_auth_admin_groups,
                settings.pcm_auth_reviewer_groups,
                settings.pcm_auth_editor_groups,
            )
        ):
            return AuthConfigurationStatus(
                valid=False,
                reason_code="auth_not_configured",
                reason="invalid group mapping entry",
            )

        role_groups = _role_group_map()
        overlaps = _validate_group_overlaps(role_groups)
        if overlaps:
            return AuthConfigurationStatus(
                valid=False,
                reason_code="auth_not_configured",
                reason="group mapping overlap",
                details={"overlaps": overlaps},
            )

        try:
            _ensure_secret_set(settings.pcm_auth_proxy_secrets)
        except SsoParseError as exc:
            return AuthConfigurationStatus(
                valid=False,
                reason_code="auth_not_configured",
                reason=str(exc),
            )

    return AuthConfigurationStatus(valid=True)


def _ensure_secret_set(values: list[str]) -> None:
    decoded: set[str] = set()
    for value in values:
        decoded_secret = _decode_unpadded_base64url(
            value,
            min_len=32,
            max_len=256,
            field="x-pcm-proxy-secret",
        )
        secret = decoded_secret.decode("latin-1", errors="ignore")
        if secret in decoded:
            raise SsoParseError("proxy secret duplicates are not allowed")
        decoded.add(secret)

    if len(values) == 0:
        raise SsoParseError("proxy secret is required")


def _compare_proxy_secret(secret: str, configured: list[str]) -> bool:
    decoded = _decode_unpadded_base64url(secret, field="x-pcm-proxy-secret")
    for candidate in configured:
        candidate_bytes = _decode_unpadded_base64url(candidate, field="proxy_secret")
        if hmac.compare_digest(decoded, candidate_bytes):
            return True
    return False


def get_auth_adapter() -> AuthAdapter:
    """설정에 따라 현재 인증 어댑터를 선택한다."""
    mode = (settings.pcm_auth_mode or "").strip().lower()
    if mode == "dev_stub":
        return DevStubAuthAdapter()
    if mode == "trusted_proxy":
        return TrustedProxyAuthAdapter()
    return TrustedProxyAuthAdapter()


async def get_current_user(request: Request) -> UserContext:
    """현재 사용자 의존성 경계."""
    config = get_auth_configuration_status()
    if not config.valid:
        raise AuthNotConfiguredError(
            "authentication is not configured",
            details={"reason_code": config.reason_code or "auth_not_configured"},
        )

    adapter = get_auth_adapter()
    try:
        user = await adapter.authenticate(request)
    except SsoParseError as exc:
        # Expose one public trust-boundary failure shape. Parser details remain
        # available to diagnostics only through the exception chain.
        raise AuthenticationError("authentication required") from exc

    if isinstance(adapter, TrustedProxyAuthAdapter):
        secrets = settings.pcm_auth_proxy_secrets
        if not secrets:
            raise AuthNotConfiguredError("trusted proxy secret is missing")
        try:
            secret = _require_single_header(request, "x-pcm-proxy-secret")
            matches = _compare_proxy_secret(secret, secrets)
        except SsoParseError as exc:
            raise AuthenticationError("authentication required") from exc
        if not matches:
            raise AuthenticationError("authentication required")

    return user


async def require_permission(permission: Permission, user: UserContext) -> UserContext:
    """권한 dependency helper."""
    if permission not in user.permissions:
        raise PermissionCheckError(permission)
    return user


async def require_business_read(
    user: Annotated[UserContext, Depends(get_current_user)],
) -> UserContext:
    return await require_permission(Permission.BUSINESS_READ, user=user)


async def require_registry_manage(
    user: Annotated[UserContext, Depends(get_current_user)],
) -> UserContext:
    return await require_permission(Permission.REGISTRY_MANAGE, user=user)


async def require_project_edit(
    user: Annotated[UserContext, Depends(get_current_user)],
) -> UserContext:
    return await require_permission(Permission.PROJECT_EDIT, user=user)


async def require_project_review_request(
    user: Annotated[UserContext, Depends(get_current_user)],
) -> UserContext:
    return await require_permission(Permission.PROJECT_REVIEW_REQUEST, user=user)


async def require_project_review_decide(
    user: Annotated[UserContext, Depends(get_current_user)],
) -> UserContext:
    return await require_permission(Permission.PROJECT_REVIEW_DECIDE, user=user)


async def require_project_revision_create(
    user: Annotated[UserContext, Depends(get_current_user)],
) -> UserContext:
    return await require_permission(Permission.PROJECT_REVISION_CREATE, user=user)


async def require_project_comment(
    user: Annotated[UserContext, Depends(get_current_user)],
) -> UserContext:
    return await require_permission(Permission.PROJECT_COMMENT, user=user)


def get_permission_dependency(
    permission: Permission,
) -> Callable[[UserContext], Awaitable[UserContext]]:
    """권한 디펜던시 팩토리."""

    async def _dependency(
        user: Annotated[UserContext, Depends(get_current_user)],
    ) -> UserContext:
        return await require_permission(permission, user=user)

    return _dependency


def raise_missing_header(name: str) -> None:
    raise SsoParseError(f"missing {name}")
