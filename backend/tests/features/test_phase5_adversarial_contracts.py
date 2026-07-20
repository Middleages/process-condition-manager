"""Phase 5 adversarial backend contract tests.

These tests are intentionally conservative and skip once a contract endpoint is
not yet implemented. They provide a stable, reviewable scaffold for worker-1
backend implementation alignment.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from typing import Any

import pytest
from fastapi.dependencies.models import Dependant
from fastapi.routing import APIRoute

from app.core.auth import get_current_user
from app.main import app

_REQUIRED_PHASE5_ENDPOINTS: set[tuple[str, str]] = {
    ("GET", "/api/auth/me"),
    ("POST", "/api/projects/{project_id}/transitions"),
    ("POST", "/api/projects/{project_id}/revisions"),
    ("GET", "/api/projects/{project_id}/comments"),
    ("POST", "/api/projects/{project_id}/comments"),
}


def _join_paths(*parts: str) -> str:
    pieces = [part.strip("/") for part in parts if part]
    if not pieces:
        return "/"
    return "/" + "/".join(pieces)


def _walk_routes(
    routes: Iterable[Any], prefix: str = ""
) -> Iterable[tuple[str, APIRoute]]:
    for route in routes:
        if isinstance(route, APIRoute):
            yield _join_paths(prefix, route.path), route
            continue

        if route.__class__.__name__ == "_IncludedRouter":
            yield from _walk_routes(
                route.original_router.routes, _join_paths(prefix, route.include_context.prefix)
            )
            continue

        if hasattr(route, "routes"):
            yield from _walk_routes(route.routes, prefix)


def _find_api_routes() -> list[tuple[str, APIRoute]]:
    return list(_walk_routes(app.router.routes))


def _routes_by_method() -> dict[tuple[str, str], APIRoute]:
    route_map: dict[tuple[str, str], APIRoute] = {}
    for path, route in _find_api_routes():
        methods = route.methods or set()
        for method in methods:
            route_map[(method, path)] = route
    return route_map


def _dependency_call_chain(dependency: Dependant) -> set[Callable[..., object]]:
    calls: set[Callable[..., object]] = set()
    if dependency.call is not None:
        calls.add(dependency.call)
    for child in dependency.dependencies:
        calls.update(_dependency_call_chain(child))
    return calls


def _route_has_auth_dependency(route: APIRoute) -> bool:
    calls = _dependency_call_chain(route.dependant)
    return get_current_user in calls


def test_current_auth_contract_is_scaffolded() -> None:
    """모든 API 라우트는 지금이라도 인증 의존성을 보장한다."""

    api_routes = [
        (route_path, route)
        for route_path, route in _find_api_routes()
        if route_path.startswith("/api")
    ]
    if not api_routes:
        pytest.fail("No /api routes discovered in app router")

    missing: list[str] = []
    for route_path, route in api_routes:
        if not _route_has_auth_dependency(route):
            methods = "/".join(sorted(route.methods or {"GET"}))
            missing.append(f"{route_path} ({methods})")

    assert missing == []


@pytest.mark.parametrize("route_spec", sorted(_REQUIRED_PHASE5_ENDPOINTS))
def test_phase5_contract_routes_are_declared(route_spec: tuple[str, str]) -> None:
    route_map = _routes_by_method()
    if route_spec not in route_map:
        pytest.xfail(f"Phase 5 route not yet implemented: {route_spec[1]} {route_spec[0]}")


def test_phase5_transition_route_prefers_auth_error_shape() -> None:
    # When transition route exists, assert a deterministic failure mode on auth-less call.
    route_map = _routes_by_method()
    transition_route = route_map.get(("POST", "/api/projects/{project_id}/transitions"))
    if transition_route is None:
        pytest.xfail(
            "Phase 5 route not yet implemented: "
            "POST /api/projects/{project_id}/transitions"
        )

    # route exists: authentication contract should never be bypassed by body binding.
    assert transition_route.endpoint is not None
    assert _route_has_auth_dependency(transition_route)
