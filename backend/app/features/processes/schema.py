"""공정 조회 API 스키마."""

from pydantic import BaseModel


class ProcessOut(BaseModel):
    """공정 목록 출력."""

    key: str
    line_id: str
    process_id: str
    display_name: str
    sort_order: int
    has_project: bool = False


class ProcessListOut(BaseModel):
    """공정 검색 결과 (커서 페이징)."""

    items: list[ProcessOut]
    next_cursor: str | None = None


class ProcessDetailOut(BaseModel):
    """공정 구조 요약 + 조건표 유무."""

    key: str
    line_id: str
    process_id: str
    display_name: str
    step_count: int
    area_names: list[str]
    has_project: bool
    project_count: int


class LayerOut(BaseModel):
    """공정 layer 출력."""

    key: str
    step_seq: str
    layer_id: str
    eqp_type: str | None
    eqp_type_desc: str | None
    area_name: str | None
    sort_order: int
