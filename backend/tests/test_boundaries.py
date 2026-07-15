"""T2에서 이미 구현된 경계(seam) 검증: 예외 매핑, 인증 경계, 설정, 모델 메타데이터."""

from collections.abc import Callable
from typing import Annotated, Any, get_args, get_type_hints

import pytest
from fastapi import Depends, FastAPI
from fastapi.params import Depends as DependsParam
from fastapi.routing import APIRoute
from httpx import ASGITransport, AsyncClient

from app.core.auth import (
    AuthNotConfiguredError,
    Role,
    UserContext,
    get_current_user,
)
from app.core.config import Settings
from app.core.db import get_app_session
from app.core.errors import (
    AppError,
    ConflictError,
    DomainValidationError,
    NotFoundError,
    register_exception_handlers,
)
from app.core.locks import require_edit_lock
from app.features.cells import router as cells_router
from app.features.choice_sets import router as choice_sets_router
from app.features.conditions import router as conditions_router
from app.features.locks import router as locks_router
from app.features.parameters import router as parameters_router
from app.features.projects import router as projects_router


def _depends(annotation: Any) -> DependsParam:
    return next(item for item in get_args(annotation) if isinstance(item, DependsParam))


@pytest.mark.parametrize(
    ("service_dependency", "provider", "shares_edit_session"),
    [
        (projects_router.ServiceDep, projects_router.get_service, True),
        (locks_router.ServiceDep, locks_router.get_service, False),
        (cells_router.ServiceDep, cells_router.get_service, True),
        (conditions_router.ServiceDep, conditions_router.get_service, True),
        (parameters_router.ServiceDep, parameters_router.get_service, False),
        (choice_sets_router.ServiceDep, choice_sets_router.get_service, False),
        (None, require_edit_lock, False),
    ],
    ids=["projects", "locks", "cells", "conditions", "parameters", "choice_sets", "edit_lock"],
)
def test_transactional_dependencies_finalize_before_response(
    service_dependency: Any | None,
    provider: Callable[..., Any],
    shares_edit_session: bool,
) -> None:
    """Every transaction owner and its cached session must finalize before response send."""
    scopes = []
    if service_dependency is not None:
        service = _depends(service_dependency)
        assert service.dependency is provider
        scopes.append(service.scope)

    session = _depends(get_type_hints(provider, include_extras=True)["session"])
    assert session.dependency is get_app_session
    assert session.use_cache is True
    scopes.append(session.scope)

    assert scopes == ["function"] * len(scopes)

    if shares_edit_session:
        edit_session = _depends(
            get_type_hints(require_edit_lock, include_extras=True)["session"]
        )
        assert (
            edit_session.dependency,
            edit_session.scope,
            edit_session.use_cache,
        ) == (session.dependency, session.scope, session.use_cache)


def test_locked_routes_reuse_the_transaction_session() -> None:
    """FastAPI's cache key must collapse lock validation and mutation to one session."""
    routes = [
        route
        for router in (projects_router.router, cells_router.router, conditions_router.router)
        for route in router.routes
        if isinstance(route, APIRoute)
        and any(dependency.call is require_edit_lock for dependency in route.dependant.dependencies)
    ]
    assert len(routes) == 6

    for route in routes:
        edit_lock = next(
            dependency
            for dependency in route.dependant.dependencies
            if dependency.call is require_edit_lock
        )
        service = next(
            dependency
            for dependency in route.dependant.dependencies
            if dependency.name == "service"
        )
        edit_session = next(
            dependency
            for dependency in edit_lock.dependencies
            if dependency.call is get_app_session
        )
        service_session = next(
            dependency
            for dependency in service.dependencies
            if dependency.call is get_app_session
        )

        assert edit_session.use_cache is service_session.use_cache is True
        assert edit_session.cache_key == service_session.cache_key
        assert edit_session.cache_key == (get_app_session, (), "function")


def test_app_database_url_sync_swaps_driver() -> None:
    """동기 URL 프로퍼티가 asyncpg 드라이버를 psycopg2로 치환한다."""
    s = Settings(app_database_url="postgresql+asyncpg://u:p@h:5432/db")
    assert s.app_database_url_sync == "postgresql+psycopg2://u:p@h:5432/db"


def test_models_expose_base_metadata() -> None:
    """models 패키지가 Base metadata를 노출한다 (Alembic autogenerate용)."""
    from app.models import Base

    assert Base.metadata is not None


def test_choice_models_and_parameter_relation_are_registered() -> None:
    """Task 2's additive aggregate is visible to create_all and later migrations."""
    from app.models import Base

    assert {"choice_set", "choice_option"} <= set(Base.metadata.tables)
    assert "choice_set_id" in Base.metadata.tables["parameter"].c


def test_phase_2_6_metadata_has_no_legacy_option_or_project_description() -> None:
    """The reset-only cutover exposes only the final managed-choice model shape."""
    from sqlalchemy import Numeric

    from app.models import Base

    assert "project_profile" in Base.metadata.tables
    assert "parameter_option" not in Base.metadata.tables
    assert "description" not in Base.metadata.tables["project"].c
    assert isinstance(Base.metadata.tables["parameter"].c.min_value.type, Numeric)
    assert isinstance(Base.metadata.tables["parameter"].c.max_value.type, Numeric)


def test_fixed_profile_choice_set_mapping_is_exact() -> None:
    from app.domain.choices.constants import PROFILE_CHOICE_SET_FIELDS

    assert PROFILE_CHOICE_SET_FIELDS == {
        "device_type": "device_type",
        "project_category": "project_category",
        "active_direction": "active_direction",
        "gate_direction": "gate_direction",
    }


async def test_dev_stub_returns_admin() -> None:
    """개발 스텁이 켜지면 고정 admin을 반환한다 (라우터 인증 배선용)."""
    from app.core.config import settings

    assert settings.auth_dev_stub is True

    app = FastAPI()

    @app.get("/me")
    async def _me(user: Annotated[UserContext, Depends(get_current_user)]) -> dict[str, object]:
        return {"id": user.id, "roles": list(user.roles)}

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.get("/me")

    assert resp.status_code == 200
    assert resp.json() == {"id": "dev-admin", "roles": [Role.ADMIN]}


def test_user_context_carries_roles() -> None:
    """UserContext가 역할 튜플을 보관한다."""
    ctx = UserContext(id="u1", roles=(Role.ADMIN,))
    assert ctx.id == "u1"
    assert Role.ADMIN in ctx.roles


@pytest.mark.parametrize(
    ("exc", "status", "code"),
    [
        (AppError("boom"), 500, "internal_error"),
        (NotFoundError("no"), 404, "not_found"),
        (ConflictError("locked"), 409, "conflict"),
        (DomainValidationError("bad"), 422, "validation_error"),
    ],
)
async def test_app_error_maps_to_http(exc: AppError, status: int, code: str) -> None:
    """AppError 계열이 표준 JSON 오류 응답으로 매핑된다."""
    app = FastAPI()
    register_exception_handlers(app)

    @app.get("/boom")
    async def _boom() -> None:
        raise exc

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.get("/boom")

    assert resp.status_code == status
    body = resp.json()
    assert body["code"] == code
    assert body["message"] == str(exc)


def test_auth_not_configured_error_is_explicit_501() -> None:
    """SSO 미연결 상태는 명시적인 501 AppError로 표현한다."""
    exc = AuthNotConfiguredError("not ready")

    assert exc.status_code == 501
    assert exc.code == "auth_not_configured"
