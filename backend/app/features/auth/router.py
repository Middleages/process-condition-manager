"""인증 identity bootstrap API."""

from typing import Annotated

from fastapi import APIRouter, Depends

from app.core.auth import UserContext, get_current_user

router = APIRouter(prefix="/auth", tags=["auth"], dependencies=[Depends(get_current_user)])


@router.get("/me")
async def me(user: Annotated[UserContext, Depends(get_current_user)]) -> dict[str, object]:
    return {
        "id": user.id,
        "display_name": user.display_name,
        "email": user.email,
        "roles": [role.value for role in user.roles],
        "permissions": [permission.value for permission in user.permissions],
    }
