"""공정 조회 서비스.

features 계층은 적재 fixture/DB 구조에 직접 접근하지 않고 IngestReader 계약만 사용한다.
"""

from app.ingest.reader import IngestReader, LayerInfo, ProcessInfo


class ProcessService:
    """공정 및 layer 조회 오케스트레이션."""

    def __init__(self, reader: IngestReader) -> None:
        self.reader = reader

    async def list_processes(self) -> list[ProcessInfo]:
        return await self.reader.list_processes()

    async def get_layers(self, process_key: str) -> list[LayerInfo]:
        return await self.reader.get_layers(process_key)
