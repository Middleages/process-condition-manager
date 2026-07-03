"""인증 어댑터 경계 (P4).

"요청 → 사용자 컨텍스트" 변환 지점만 정의한다.
개발용 스텁(고정 admin)과 실제 SSO 구현은 T5에서 이 경계 뒤로 채운다.
RBAC 역할 enum 자리만 잡아두며, 실제 인가 규칙은 Phase 5에서 정의한다.
"""

from dataclasses import dataclass
from enum import StrEnum


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


async def get_current_user() -> UserContext:
    """현재 사용자 의존성 경계.

    T5에서 개발 스텁(env 플래그 기반 고정 admin) 및 실제 SSO 구현으로 교체된다.
    라우터는 처음부터 이 의존성을 통과하도록 배선한다.
    """
    raise NotImplementedError("인증 어댑터 구현은 T5에서 채운다")
