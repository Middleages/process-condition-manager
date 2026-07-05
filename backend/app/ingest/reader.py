"""적재 데이터 판독 계약.

실제 적재 DB 스키마가 확정되기 전까지도 features 계층이 의존할 수 있는
불변 인터페이스를 정의한다. 구현체는 fixture_reader(T4)에서 시작하고,
실 스키마 확정 후 pg_reader로 교체해도 이 계약은 유지한다.
"""

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True, slots=True)
class ProcessInfo:
    """적재 영역에서 발견한 공정 메타데이터."""

    key: str
    display_name: str
    sort_order: int = 0


@dataclass(frozen=True, slots=True)
class LayerInfo:
    """공정별 동적 layer 메타데이터."""

    key: str
    display_name: str
    sort_order: int = 0


@dataclass(frozen=True, slots=True)
class ConditionValue:
    """백본 소스로 사용할 layer별 원천 조건 값."""

    layer_key: str
    source_param_id: str
    value: str | int | float | bool | None


class IngestReader(Protocol):
    """적재 데이터 판독기 계약.

    이 Protocol 바깥에서 적재 테이블/fixture 구조에 직접 의존하지 않는다.
    """

    async def list_processes(self) -> list[ProcessInfo]:
        """적재 데이터에 존재하는 공정 목록을 반환한다."""
        ...

    async def get_layers(self, process_key: str) -> list[LayerInfo]:
        """공정의 layer 목록을 반환한다."""
        ...

    async def get_condition_values(self, process_key: str) -> list[ConditionValue]:
        """공정의 layer별 원천 조건 값을 반환한다."""
        ...
