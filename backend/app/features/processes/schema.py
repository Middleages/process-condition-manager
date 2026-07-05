"""공정 조회 API 스키마."""

from pydantic import BaseModel


class ProcessOut(BaseModel):
    """공정 목록 출력."""

    key: str
    display_name: str
    sort_order: int


class LayerOut(BaseModel):
    """공정 layer 출력."""

    key: str
    display_name: str
    sort_order: int
