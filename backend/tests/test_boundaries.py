"""T2에서 이미 구현된 경계(seam) 검증: 예외 매핑, 인증 경계, 설정, 모델 메타데이터."""

import ast
from collections.abc import Callable
from pathlib import Path
from typing import Annotated, Any, cast, get_args, get_type_hints

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
from app.core.maintenance import require_project_mutations_enabled
from app.features.cells import router as cells_router
from app.features.choice_sets import router as choice_sets_router
from app.features.conditions import router as conditions_router
from app.features.locks import router as locks_router
from app.features.parameters import router as parameters_router
from app.features.projects import router as projects_router
from app.features.validation import router as validation_router


def test_validation_domain_has_no_framework_or_persistence_imports() -> None:
    validation_dir = Path(__file__).parents[1] / "app" / "domain" / "validation"
    forbidden_roots = {"fastapi", "pydantic", "sqlalchemy"}
    forbidden_prefixes = ("app.models", "app.features")

    violations: list[str] = []
    for path in sorted(validation_dir.glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            imported_modules: list[str]
            if isinstance(node, ast.Import):
                imported_modules = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module is not None:
                imported_modules = [node.module]
            else:
                continue

            for module in imported_modules:
                if module.split(".", 1)[0] in forbidden_roots or module.startswith(
                    forbidden_prefixes
                ):
                    violations.append(f"{path.name}:{node.lineno}: {module}")

    assert violations == []


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
        (validation_router.ServiceDep, validation_router.get_service, False),
        (None, require_edit_lock, False),
    ],
    ids=[
        "projects",
        "locks",
        "cells",
        "conditions",
        "parameters",
        "choice_sets",
        "validation-rules",
        "edit_lock",
    ],
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
        edit_session = _depends(get_type_hints(require_edit_lock, include_extras=True)["session"])
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
            dependency for dependency in service.dependencies if dependency.call is get_app_session
        )

        assert edit_session.use_cache is service_session.use_cache is True
        assert edit_session.cache_key == service_session.cache_key
        assert edit_session.cache_key == (get_app_session, (), "function")


def test_phase4_writer_mutation_gate_covers_all_project_truth_write_routes() -> None:
    """Route enumeration must force explicit coverage for every truth-mutation surface."""

    blocked_routes = {
        ("POST", "/projects"),
        ("POST", "/projects/{project_id}/layers/{layer_key}/backbone-replace"),
        ("PATCH", "/projects/{project_id}/profile"),
        ("PATCH", "/projects/{project_id}/cells"),
        ("POST", "/projects/{project_id}/layers/{layer_key}/conditions"),
        ("DELETE", "/projects/{project_id}/conditions/{condition_id}"),
        ("PUT", "/projects/{project_id}/conditions/{condition_id}/por"),
        ("POST", "/projects/{project_id}/lock"),
        ("POST", "/projects/{project_id}/lock/heartbeat"),
    }
    allowed_routes = {
        ("POST", "/projects/backbone-preview"),
        ("DELETE", "/projects/{project_id}/lock"),
        ("POST", "/projects/{project_id}/lock/release"),
    }

    seen: set[tuple[str, str]] = set()
    for router in (
        projects_router.router,
        cells_router.router,
        conditions_router.router,
        locks_router.router,
    ):
        for route in router.routes:
            if not isinstance(route, APIRoute):
                continue
            methods = route.methods or set()
            method = next(iter(methods))
            if method == "GET":
                continue
            spec = (method, route.path)
            if spec in blocked_routes:
                assert any(
                    dependency.call is require_project_mutations_enabled
                    for dependency in route.dependant.dependencies
                ), spec
            elif spec in allowed_routes:
                assert all(
                    dependency.call is not require_project_mutations_enabled
                    for dependency in route.dependant.dependencies
                ), spec
            else:
                pytest.fail(f"Unhandled non-GET project-truth route: {spec}")
            seen.add(spec)

    assert seen == blocked_routes | allowed_routes


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


def test_validation_rule_model_is_registered_with_strict_storage_contract() -> None:
    from sqlalchemy import JSON, Enum, Table
    from sqlalchemy.dialects.postgresql import JSONB, dialect

    from app.models import Base

    table = cast(Table, Base.metadata.tables["validation_rule"])
    assert isinstance(table.c.scope.type, JSON)
    assert isinstance(table.c.scope.type.dialect_impl(dialect()), JSONB)
    assert isinstance(table.c.spec.type.dialect_impl(dialect()), JSONB)
    assert cast(Enum, table.c.severity.type).enums == ["error", "warning"]
    assert {constraint.name for constraint in table.constraints} >= {
        "ck_validation_rule_code_format",
        "ck_validation_rule_severity",
        "ck_validation_rule_version",
    }
    assert {index.name for index in table.indexes} == {
        "ix_validation_rule_active_code",
        "ix_validation_rule_code",
    }
    assert next(index for index in table.indexes if index.name == "ix_validation_rule_code").unique


def test_phase_2_6_metadata_has_no_legacy_option_or_project_description() -> None:
    """The reset-only cutover exposes only the final managed-choice model shape."""
    from sqlalchemy import Numeric

    from app.models import Base

    assert "project_profile" in Base.metadata.tables
    assert "parameter_option" not in Base.metadata.tables
    assert "description" not in Base.metadata.tables["project"].c
    assert isinstance(Base.metadata.tables["parameter"].c.min_value.type, Numeric)
    assert isinstance(Base.metadata.tables["parameter"].c.max_value.type, Numeric)


def test_phase_4_metadata_exposes_backbone_snapshot_and_history_columns() -> None:
    from sqlalchemy import JSON, Enum, Table
    from sqlalchemy.dialects.postgresql import JSONB, dialect

    from app.models import Base

    sheet_layer = cast(Table, Base.metadata.tables["sheet_layer"])
    change_event = cast(Table, Base.metadata.tables["change_event"])

    assert isinstance(sheet_layer.c.backbone_snapshot.type, JSON)
    assert isinstance(sheet_layer.c.backbone_snapshot.type.dialect_impl(dialect()), JSONB)
    assert sheet_layer.c.backbone_snapshot.nullable is True

    assert {"layer_key", "batch_id", "origin", "source_project_id", "source_layer_key"} <= set(
        change_event.c.keys()
    )
    assert cast(Enum, change_event.c.event_type.type).enums == [
        "project_create",
        "project_profile_update",
        "backbone_copy",
        "backbone_layer_replace",
        "cell_update",
        "condition_add",
        "condition_remove",
        "por_change",
    ]


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
