"""인증 어댑터 경계 (P4).

"요청 → 사용자 컨텍스트" 변환 지점만 정의한다.
개발용 스텁(고정 admin)과 실제 SSO 구현은 T5에서 이 경계 뒤로 채운다.
RBAC 역할 enum 자리만 잡아두며, 실제 인가 규칙은 Phase 5에서 정의한다.
"""

from dataclasses import dataclass
from enum import StrEnum

from app.core.config import settings


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


_DEV_ADMIN = UserContext(id="dev-admin", roles=(Role.ADMIN,))


async def get_current_user() -> UserContext:
    """현재 사용자 의존성 경계.

    개발 스텁(auth_dev_stub=true)일 때 고정 admin을 반환한다. 실제 SSO 인증과
    RBAC 인가 규칙은 T5/Phase 5에서 이 경계 뒤 구현만 교체한다. 라우터는
    처음부터 이 의존성을 통과하도록 배선한다.
    """
    if settings.auth_dev_stub:
        return _DEV_ADMIN
    raise NotImplementedError("실제 SSO 인증 어댑터는 T5에서 구현된다")
