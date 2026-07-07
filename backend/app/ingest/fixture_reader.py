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
        info=ProcessInfo(key="product_alpha_main", display_name="제품 Alpha Main Route", sort_order=10),
        layers=(
            LayerInfo(key="001_init_clean", display_name="Initial Clean", sort_order=10),
            LayerInfo(key="010_photo_active", display_name="Active Photo", sort_order=20),
            LayerInfo(key="020_etch_active", display_name="Active Etch", sort_order=30),
            LayerInfo(key="030_metrology_active", display_name="Active Metrology", sort_order=40),
            LayerInfo(key="040_deposition_gate", display_name="Gate Deposition", sort_order=50),
        ),
        condition_values=(
            ConditionValue("001_init_clean", "clean_time_sec", 45),
            ConditionValue("010_photo_active", "exposure_dose_mj", 42.5),
            ConditionValue("020_etch_active", "etch_rate_nm_min", 18.7),
            ConditionValue("030_metrology_active", "overlay_nm", 3.1),
            ConditionValue("040_deposition_gate", "thickness_nm", 90.0),
        ),
    ),
    _ProcessFixture(
        info=ProcessInfo(key="product_beta_memory", display_name="제품 Beta Memory Route", sort_order=20),
        layers=(
            LayerInfo(key="001_init_clean", display_name="Initial Clean", sort_order=10),
            LayerInfo(key="015_deposition_well", display_name="Well Deposition", sort_order=20),
            LayerInfo(key="025_photo_well", display_name="Well Photo", sort_order=30),
            LayerInfo(key="035_etch_well", display_name="Well Etch", sort_order=40),
            LayerInfo(key="045_strip_well", display_name="Well Strip", sort_order=50),
            LayerInfo(key="055_metrology_well", display_name="Well Metrology", sort_order=60),
        ),
        condition_values=(
            ConditionValue("001_init_clean", "clean_time_sec", 50),
            ConditionValue("015_deposition_well", "thickness_nm", 120.0),
            ConditionValue("025_photo_well", "exposure_dose_mj", 39.8),
            ConditionValue("035_etch_well", "etch_rate_nm_min", 16.4),
            ConditionValue("045_strip_well", "strip_time_sec", 75),
            ConditionValue("055_metrology_well", "overlay_nm", 2.8),
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
    """FastAPI DI에서 사용할 판독기 인스턴스를 반환한다.

    Phase 0 T4에서는 fixture 구현을 사용한다. 실제 스키마 확정 후 이 함수의
    반환 구현만 교체한다.
    """
    return _fixture_reader
