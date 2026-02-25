from pydantic import BaseModel


class UserResponse(BaseModel):
    id: int
    username: str
    display_name: str
    roles: list[str]
    is_active: bool

    model_config = {"from_attributes": True}
