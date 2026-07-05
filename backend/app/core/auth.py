"""인증 어댑터 경계 (P4/T5).

"요청 → 사용자 컨텍스트" 변환 지점만 정의한다. Phase 0에서는 개발용 스텁
어댑터가 고정 admin 사용자를 반환하고, 실제 SSO 구현은 같은 AuthAdapter
계약 뒤에 나중에 연결한다. RBAC 역할 enum 자리만 잡아두며, 실제 인가 규칙은
Phase 5에서 정의한다.
"""

from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

from fastapi import Request

from app.core.config import settings
from app.core.errors import AppError


class Role(StrEnum):
    """RBAC 역할 (실제 인가 규칙은 Phase 5에서 정의)."""

    ADMIN = "admin"
    REVIEWER = "reviewer"
    EDITOR = "editor"


@dataclass(frozen=True)
class UserContext:
    """인증된 사용자 컨텍스트. 라우터는 이 타입만 알면 된다."""

    id: str
    roles: tuple[Role, ...] = ()


class AuthAdapter(Protocol):
    """요청을 사용자 컨텍스트로 변환하는 인증 어댑터 계약."""

    async def authenticate(self, request: Request) -> UserContext:
        """요청에서 현재 사용자를 판독한다."""
        ...


class AuthNotConfiguredError(AppError):
    """개발 스텁이 꺼졌지만 실제 SSO 어댑터가 아직 연결되지 않음."""

    status_code = 501
    code = "auth_not_configured"


_DEV_ADMIN = UserContext(id="dev-admin", roles=(Role.ADMIN,))


class DevStubAuthAdapter:
    """Phase 0 개발용 인증 스텁."""

    async def authenticate(self, request: Request) -> UserContext:
        return _DEV_ADMIN


class SsoAuthAdapterPlaceholder:
    """실제 SSO 확정 전까지 경계 뒤에 둔 명시적 placeholder."""

    async def authenticate(self, request: Request) -> UserContext:
        raise AuthNotConfiguredError("실제 SSO 인증 어댑터가 아직 설정되지 않았다")


def get_auth_adapter() -> AuthAdapter:
    """설정에 따라 현재 인증 어댑터를 선택한다."""
    if settings.auth_dev_stub:
        return DevStubAuthAdapter()
    return SsoAuthAdapterPlaceholder()


async def get_current_user(request: Request) -> UserContext:
    """현재 사용자 의존성 경계.

    개발 스텁(auth_dev_stub=true)일 때 고정 admin을 반환한다. 실제 SSO 인증은
    나중에 AuthAdapter 구현만 교체하며, 라우터는 계속 이 의존성을 통과한다.
    """
    adapter = get_auth_adapter()
    return await adapter.authenticate(request)
