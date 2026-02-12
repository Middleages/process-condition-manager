from pydantic import BaseModel


class LineResponse(BaseModel):
    id: int
    line_code: str
    line_name: str

    model_config = {"from_attributes": True}
