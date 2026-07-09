"""공정 조회 API 스키마."""

from pydantic import BaseModel


class ProcessOut(BaseModel):
    """공정 목록 출력."""

    key: str
    line_id: str
    process_id: str
    display_name: str
    sort_order: int


class LayerOut(BaseModel):
    """공정 layer 출력."""

    key: str
    step_seq: str
    layer_id: str
    eqp_type: str | None
    eqp_type_desc: str | None
    area_name: str | None
    sort_order: int
