"""공정 조회 서비스."""

from app.core.errors import NotFoundError
from app.ingest.fixture_reader import process_key
from app.ingest.reader import IngestReader, LayerInfo, ProcessInfo


class ProcessService:
    """공정 및 layer 조회 오케스트레이션."""

    def __init__(self, reader: IngestReader) -> None:
        self.reader = reader

    async def list_processes(self) -> list[ProcessInfo]:
        return await self.reader.list_processes()

    async def get_layers(self, process_key_value: str) -> list[LayerInfo]:
        line_id, process_id = self.parse_process_key(process_key_value)
        return await self.reader.get_layers(line_id, process_id)

    @staticmethod
    def parse_process_key(process_key_value: str) -> tuple[str, str]:
        parts = process_key_value.split("::", maxsplit=1)
        if len(parts) != 2 or not all(parts):
            raise NotFoundError(f"process를 찾을 수 없다: {process_key_value}")
        return parts[0], parts[1]

    @staticmethod
    def make_process_key(line_id: str, process_id: str) -> str:
        return process_key(line_id, process_id)
