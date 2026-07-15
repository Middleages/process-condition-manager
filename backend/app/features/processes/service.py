"""공정 조회 서비스."""

from app.core.errors import NotFoundError
from app.features.processes.schema import ProcessDetailOut, ProcessOut
from app.features.projects.repository import ProjectRepository
from app.ingest.fixture_reader import process_key
from app.ingest.reader import IngestReader, LayerInfo


class ProcessService:
    """공정 및 layer 조회 오케스트레이션.

    구조는 적재 판독기(read-only)에서, 조건표 유무는 앱 DB(project)에서 읽어
    카탈로그가 필요로 하는 "조건표 있는 process" 정보를 합성한다.
    """

    def __init__(
        self, reader: IngestReader, project_repo: ProjectRepository | None = None
    ) -> None:
        self.reader = reader
        self.project_repo = project_repo

    async def list_processes(self) -> list[ProcessOut]:
        items, _ = await self.search_processes(limit=1000)
        return items

    async def search_processes(
        self,
        *,
        query: str | None = None,
        cursor: str | None = None,
        limit: int = 50,
        without_project: bool = False,
    ) -> tuple[list[ProcessOut], str | None]:
        processes = await self.reader.list_processes()
        with_projects = await self._processes_with_projects()

        if query:
            needle = query.strip().lower()
            processes = [
                p
                for p in processes
                if needle in p.key.lower() or needle in p.display_name.lower()
            ]
        if without_project:
            processes = [
                p for p in processes if (p.line_id, p.process_id) not in with_projects
            ]

        # key 오름차순으로 안정 정렬 후 key 기반 커서 페이징.
        processes = sorted(processes, key=lambda p: p.key)
        if cursor is not None:
            processes = [p for p in processes if p.key > cursor]

        page = processes[:limit]
        has_more = len(processes) > limit
        next_cursor = page[-1].key if has_more and page else None
        items = [
            ProcessOut(
                key=p.key,
                line_id=p.line_id,
                process_id=p.process_id,
                display_name=p.display_name,
                sort_order=p.sort_order,
                has_project=(p.line_id, p.process_id) in with_projects,
            )
            for p in page
        ]
        return items, next_cursor

    async def get_process_detail(self, process_key_value: str) -> ProcessDetailOut:
        line_id, process_id = self.parse_process_key(process_key_value)
        process = await self.reader.get_process(line_id, process_id)
        layers = await self.reader.get_layers(line_id, process_id)
        area_names = sorted({layer.area_name for layer in layers if layer.area_name})
        project_count = await self._project_count(line_id, process_id)
        return ProcessDetailOut(
            key=process_key_value,
            line_id=line_id,
            process_id=process_id,
            display_name=process.display_name,
            step_count=len(layers),
            area_names=area_names,
            has_project=project_count > 0,
            project_count=project_count,
        )

    async def get_layers(self, process_key_value: str) -> list[LayerInfo]:
        line_id, process_id = self.parse_process_key(process_key_value)
        return await self.reader.get_layers(line_id, process_id)

    async def _processes_with_projects(self) -> set[tuple[str, str]]:
        if self.project_repo is None:
            return set()
        return await self.project_repo.processes_with_projects()

    async def _project_count(self, line_id: str, process_id: str) -> int:
        if self.project_repo is None:
            return 0
        return await self.project_repo.count_by_process(line_id, process_id)

    @staticmethod
    def parse_process_key(process_key_value: str) -> tuple[str, str]:
        parts = process_key_value.split("::", maxsplit=1)
        if len(parts) != 2 or not all(parts):
            raise NotFoundError(f"process를 찾을 수 없다: {process_key_value}")
        return parts[0], parts[1]

    @staticmethod
    def make_process_key(line_id: str, process_id: str) -> str:
        return process_key(line_id, process_id)
