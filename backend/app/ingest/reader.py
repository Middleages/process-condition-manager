"""적재 데이터 판독 계약."""

from dataclasses import dataclass
from typing import Protocol


def process_key(line_id: str, process_id: str) -> str:
    """API path에서 사용할 안정적인 process key (구현체 공용)."""
    return f"{line_id}::{process_id}"


def layer_key(line_id: str, process_id: str, step_seq: str, layer_id: str) -> str:
    """layer 매칭 키의 안정적 표현 (구현체 공용). 자동 매칭 키와는 별개의 식별자."""
    return f"{line_id}::{process_id}::{step_seq}::{layer_id}"


@dataclass(frozen=True, slots=True)
class ProcessInfo:
    """적재 영역에서 발견한 process 메타데이터."""

    key: str
    line_id: str
    process_id: str
    display_name: str
    sort_order: int = 0


@dataclass(frozen=True, slots=True)
class LayerInfo:
    """공정별 동적 layer 메타데이터."""

    key: str
    step_seq: str
    layer_id: str
    eqp_type: str | None = None
    eqp_type_desc: str | None = None
    area_name: str | None = None
    sort_order: int = 0


class IngestReader(Protocol):
    """적재 데이터 판독기 계약.

    이 Protocol 바깥에서 적재 테이블/fixture 구조에 직접 의존하지 않는다.
    """

    async def list_processes(self) -> list[ProcessInfo]:
        """적재 데이터에 존재하는 process 목록을 반환한다."""
        ...

    async def get_layers(self, line_id: str, process_id: str) -> list[LayerInfo]:
        """process의 layer 목록을 반환한다."""
        ...
