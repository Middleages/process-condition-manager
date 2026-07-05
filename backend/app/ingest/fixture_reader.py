"""T4 fixture 기반 적재 판독기 구현.

실제 적재 스키마 미확정 상태에서 계약과 API를 검증하기 위한 in-memory 구현이다.
"""

from dataclasses import dataclass

from app.core.errors import NotFoundError
from app.ingest.reader import ConditionValue, IngestReader, LayerInfo, ProcessInfo


@dataclass(frozen=True, slots=True)
class _ProcessFixture:
    info: ProcessInfo
    layers: tuple[LayerInfo, ...]
    condition_values: tuple[ConditionValue, ...]


_FIXTURES: tuple[_ProcessFixture, ...] = (
    _ProcessFixture(
        info=ProcessInfo(key="lithography", display_name="노광", sort_order=10),
        layers=(
            LayerInfo(key="bottom", display_name="Bottom Layer", sort_order=10),
            LayerInfo(key="photoresist", display_name="Photoresist", sort_order=20),
            LayerInfo(key="topcoat", display_name="Topcoat", sort_order=30),
        ),
        condition_values=(
            ConditionValue("bottom", "thickness_nm", 90.0),
            ConditionValue("photoresist", "exposure_dose_mj", 42.5),
            ConditionValue("topcoat", "bake_temp_c", 110),
        ),
    ),
    _ProcessFixture(
        info=ProcessInfo(key="etch", display_name="식각", sort_order=20),
        layers=(
            LayerInfo(key="mask", display_name="Mask", sort_order=10),
            LayerInfo(key="target", display_name="Target Film", sort_order=20),
        ),
        condition_values=(
            ConditionValue("mask", "selectivity", 3.2),
            ConditionValue("target", "etch_rate_nm_min", 18.7),
        ),
    ),
)


class FixtureIngestReader(IngestReader):
    """fixture 스키마를 읽는 적재 판독기."""

    def __init__(self, fixtures: tuple[_ProcessFixture, ...] = _FIXTURES) -> None:
        self._fixtures = {fixture.info.key: fixture for fixture in fixtures}

    async def list_processes(self) -> list[ProcessInfo]:
        return sorted(
            (fixture.info for fixture in self._fixtures.values()),
            key=lambda process: (process.sort_order, process.key),
        )

    async def get_layers(self, process_key: str) -> list[LayerInfo]:
        fixture = self._get_fixture(process_key)
        return sorted(fixture.layers, key=lambda layer: (layer.sort_order, layer.key))

    async def get_condition_values(self, process_key: str) -> list[ConditionValue]:
        fixture = self._get_fixture(process_key)
        return list(fixture.condition_values)

    def _get_fixture(self, process_key: str) -> _ProcessFixture:
        try:
            return self._fixtures[process_key]
        except KeyError as exc:
            raise NotFoundError(f"공정을 찾을 수 없다: {process_key}") from exc


_fixture_reader = FixtureIngestReader()


def get_ingest_reader() -> IngestReader:
    """현재 활성 적재 판독기를 반환한다.

    Phase 0 T4에서는 fixture 구현을 사용한다. 실제 스키마 확정 후 이 함수의
    반환 구현만 pg_reader로 교체한다.
    """
    return _fixture_reader
