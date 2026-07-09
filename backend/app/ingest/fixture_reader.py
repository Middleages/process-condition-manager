"""fixture 기반 적재 판독기 구현."""

from dataclasses import dataclass

from app.core.errors import NotFoundError
from app.ingest.reader import IngestReader, LayerInfo, ProcessInfo


def process_key(line_id: str, process_id: str) -> str:
    """API path에서 사용할 안정적인 process key."""
    return f"{line_id}::{process_id}"


@dataclass(frozen=True, slots=True)
class _ProcessFixture:
    info: ProcessInfo
    layers: tuple[LayerInfo, ...]


_FIXTURES: tuple[_ProcessFixture, ...] = (
    _ProcessFixture(
        info=ProcessInfo(
            key=process_key("L1", "PROC_ALPHA"),
            line_id="L1",
            process_id="PROC_ALPHA",
            display_name="L1 / PROC_ALPHA",
            sort_order=10,
        ),
        layers=(
            LayerInfo(
                key="L1::PROC_ALPHA::001::CLN",
                step_seq="001",
                layer_id="CLN",
                eqp_type="CLEAN",
                eqp_type_desc="Initial Clean",
                area_name="CLEAN",
                sort_order=10,
            ),
            LayerInfo(
                key="L1::PROC_ALPHA::010::ACT",
                step_seq="010",
                layer_id="ACT",
                eqp_type="PHOTO",
                eqp_type_desc="Active Photo",
                area_name="PHOTO",
                sort_order=20,
            ),
            LayerInfo(
                key="L1::PROC_ALPHA::020::ACT",
                step_seq="020",
                layer_id="ACT",
                eqp_type="ETCH",
                eqp_type_desc="Active Etch",
                area_name="ETCH",
                sort_order=30,
            ),
        ),
    ),
    _ProcessFixture(
        info=ProcessInfo(
            key=process_key("L1", "PROC_BETA"),
            line_id="L1",
            process_id="PROC_BETA",
            display_name="L1 / PROC_BETA",
            sort_order=20,
        ),
        layers=(
            LayerInfo(
                key="L1::PROC_BETA::001::CLN",
                step_seq="001",
                layer_id="CLN",
                eqp_type="CLEAN",
                eqp_type_desc="Initial Clean",
                area_name="CLEAN",
                sort_order=10,
            ),
            LayerInfo(
                key="L1::PROC_BETA::015::WELL",
                step_seq="015",
                layer_id="WELL",
                eqp_type="DEP",
                eqp_type_desc="Well Deposition",
                area_name="DEP",
                sort_order=20,
            ),
        ),
    ),
)


class FixtureIngestReader(IngestReader):
    """fixture 스키마를 읽는 적재 판독기."""

    def __init__(self, fixtures: tuple[_ProcessFixture, ...] = _FIXTURES) -> None:
        self._fixtures = {(f.info.line_id, f.info.process_id): f for f in fixtures}

    async def list_processes(self) -> list[ProcessInfo]:
        return sorted(
            (fixture.info for fixture in self._fixtures.values()),
            key=lambda process: (process.sort_order, process.key),
        )

    async def get_layers(self, line_id: str, process_id: str) -> list[LayerInfo]:
        fixture = self._get_fixture(line_id, process_id)
        return sorted(fixture.layers, key=lambda layer: (layer.step_seq, layer.layer_id))

    def _get_fixture(self, line_id: str, process_id: str) -> _ProcessFixture:
        try:
            return self._fixtures[(line_id, process_id)]
        except KeyError as exc:
            raise NotFoundError(f"process를 찾을 수 없다: {line_id}/{process_id}") from exc


_fixture_reader = FixtureIngestReader()


def get_ingest_reader() -> IngestReader:
    """FastAPI DI에서 사용할 판독기 인스턴스를 반환한다."""
    return _fixture_reader
