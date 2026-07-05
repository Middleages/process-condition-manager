"""공정/layer 조회 라우터.

조회는 반드시 IngestReader 계약을 통해 수행한다.
"""

from typing import Annotated

from fastapi import APIRouter, Depends

from app.core.auth import get_current_user
from app.features.processes.schema import LayerOut, ProcessOut
from app.features.processes.service import ProcessService
from app.ingest.fixture_reader import get_ingest_reader
from app.ingest.reader import IngestReader

router = APIRouter(
    prefix="/processes",
    tags=["processes"],
    dependencies=[Depends(get_current_user)],
)


def get_service(
    reader: Annotated[IngestReader, Depends(get_ingest_reader)],
) -> ProcessService:
    return ProcessService(reader)


ServiceDep = Annotated[ProcessService, Depends(get_service)]


@router.get("", response_model=list[ProcessOut])
async def list_processes(service: ServiceDep) -> list[ProcessOut]:
    processes = await service.list_processes()
    return [
        ProcessOut(
            key=process.key,
            display_name=process.display_name,
            sort_order=process.sort_order,
        )
        for process in processes
    ]


@router.get("/{process_key}/layers", response_model=list[LayerOut])
async def get_layers(process_key: str, service: ServiceDep) -> list[LayerOut]:
    layers = await service.get_layers(process_key)
    return [
        LayerOut(
            key=layer.key,
            display_name=layer.display_name,
            sort_order=layer.sort_order,
        )
        for layer in layers
    ]
