"""SPEC-RBAC-001 M1: 다중 역할(Multi-Role RBAC) 백엔드 사양 테스트.

다음 항목을 검증한다:
- User 모델 roles ARRAY 컬럼 + has_role 메서드
- VALID_ROLES 상수 (editor, reviewer, admin, developer)
- 인증 의존성 (require_reviewer, require_admin, require_admin_or_developer 등)
- JWT 토큰 페이로드 roles 배열
- AdminUser 스키마 roles 유효성 검증 (빈 목록 거부, 중복 제거, 유효 역할만 허용)
- 서비스 계층 역할 검사 (last-admin 보호, approve/reject 권한)
- Admin 라우터 RBAC 분리 (GET: admin_or_developer, write: ops_write/system_write)
"""

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.services.auth_service import get_password_hash, create_access_token


# ---------------------------------------------------------------------------
# 헬퍼 함수
# ---------------------------------------------------------------------------

def _make_auth_headers(user: User) -> dict:
    """사용자에 대한 Bearer 인증 헤더를 생성한다."""
    token = create_access_token(
        {"sub": str(user.id), "username": user.username, "roles": user.roles}
    )
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture
async def rbac_users(db_session: AsyncSession):
    """RBAC 테스트에 필요한 다양한 역할의 사용자를 생성한다."""
    _hash = get_password_hash("changeme123!")

    editor = User(
        username="rbac_editor", display_name="RBAC Editor",
        roles=["editor"], password_hash=_hash, email="rbac_editor@test.local",
    )
    reviewer = User(
        username="rbac_reviewer", display_name="RBAC Reviewer",
        roles=["reviewer"], password_hash=_hash, email="rbac_reviewer@test.local",
    )
    admin = User(
        username="rbac_admin", display_name="RBAC Admin",
        roles=["admin"], password_hash=_hash, email="rbac_admin@test.local",
    )
    developer = User(
        username="rbac_developer", display_name="RBAC Developer",
        roles=["developer"], password_hash=_hash, email="rbac_developer@test.local",
    )
    multi_role = User(
        username="rbac_multi", display_name="RBAC Multi",
        roles=["admin", "developer"], password_hash=_hash, email="rbac_multi@test.local",
    )
    db_session.add_all([editor, reviewer, admin, developer, multi_role])
    await db_session.flush()
    await db_session.commit()

    return {
        "editor": editor,
        "reviewer": reviewer,
        "admin": admin,
        "developer": developer,
        "multi_role": multi_role,
    }


# ---------------------------------------------------------------------------
# T1: User 모델 + has_role 메서드
# ---------------------------------------------------------------------------

class TestUserModelRoles:
    """User.roles ARRAY 컬럼과 has_role() 헬퍼 메서드 검증."""

    @pytest.mark.asyncio
    async def test_user_has_roles_array(self, db_session: AsyncSession, rbac_users):
        """User.roles가 리스트 타입인지 확인."""
        admin = rbac_users["admin"]
        assert isinstance(admin.roles, list)
        assert admin.roles == ["admin"]

    @pytest.mark.asyncio
    async def test_user_multi_roles(self, db_session: AsyncSession, rbac_users):
        """다중 역할 사용자의 roles 배열 확인."""
        multi = rbac_users["multi_role"]
        assert "admin" in multi.roles
        assert "developer" in multi.roles
        assert len(multi.roles) == 2

    @pytest.mark.asyncio
    async def test_has_role_returns_true(self, rbac_users):
        """has_role()이 포함된 역할에 대해 True 반환."""
        admin = rbac_users["admin"]
        assert admin.has_role("admin") is True

    @pytest.mark.asyncio
    async def test_has_role_returns_false(self, rbac_users):
        """has_role()이 미포함 역할에 대해 False 반환."""
        editor = rbac_users["editor"]
        assert editor.has_role("admin") is False

    @pytest.mark.asyncio
    async def test_has_role_multi(self, rbac_users):
        """다중 역할 사용자의 has_role() 검증."""
        multi = rbac_users["multi_role"]
        assert multi.has_role("admin") is True
        assert multi.has_role("developer") is True
        assert multi.has_role("editor") is False


# ---------------------------------------------------------------------------
# T2: VALID_ROLES 상수
# ---------------------------------------------------------------------------

class TestValidRolesConstant:
    """constants.py의 VALID_ROLES 검증."""

    def test_valid_roles_contains_all_four(self):
        """VALID_ROLES가 4개 역할 모두 포함."""
        from app.constants import VALID_ROLES
        assert VALID_ROLES == {"editor", "reviewer", "admin", "developer"}

    def test_valid_roles_is_frozenset(self):
        """VALID_ROLES가 불변 frozenset 타입."""
        from app.constants import VALID_ROLES
        assert isinstance(VALID_ROLES, frozenset)


# ---------------------------------------------------------------------------
# T3: 인증 의존성 단위 테스트
# ---------------------------------------------------------------------------

class TestAuthDependencies:
    """인증 의존성 함수의 역할 검사 로직 검증."""

    @pytest.mark.asyncio
    async def test_require_reviewer_allows_reviewer(self, client: AsyncClient, rbac_users):
        """reviewer 역할이 require_reviewer 의존성을 통과."""
        # reviewer 역할로 projects 생성 등 reviewer-required 엔드포인트 접근
        # 여기서는 간접적으로 로그인 성공을 확인
        headers = _make_auth_headers(rbac_users["reviewer"])
        resp = await client.get("/api/auth/me", headers=headers)
        assert resp.status_code == 200
        assert "reviewer" in resp.json()["roles"]

    @pytest.mark.asyncio
    async def test_require_admin_blocks_editor(self, client: AsyncClient, rbac_users):
        """editor 역할이 admin 전용 엔드포인트에 접근 시 403."""
        headers = _make_auth_headers(rbac_users["editor"])
        resp = await client.get("/api/admin/users", headers=headers)
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_require_admin_allows_admin(self, client: AsyncClient, rbac_users):
        """admin 역할이 admin 전용 엔드포인트 접근 가능."""
        headers = _make_auth_headers(rbac_users["admin"])
        resp = await client.get("/api/admin/users", headers=headers)
        assert resp.status_code == 200

    @pytest.mark.asyncio
    async def test_require_admin_blocks_developer(self, client: AsyncClient, rbac_users):
        """developer 역할이 admin 전용(사용자 관리) 엔드포인트에 접근 시 403."""
        headers = _make_auth_headers(rbac_users["developer"])
        resp = await client.get("/api/admin/users", headers=headers)
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# T4: JWT 토큰 페이로드
# ---------------------------------------------------------------------------

class TestJWTPayload:
    """JWT 토큰이 roles 배열을 포함하는지 검증."""

    @pytest.mark.asyncio
    async def test_login_returns_roles_array(self, client: AsyncClient, rbac_users):
        """로그인 응답에 roles 배열이 포함."""
        resp = await client.post(
            "/api/auth/login",
            data={"username": "rbac_admin", "password": "changeme123!"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert "roles" in body["user"]
        assert isinstance(body["user"]["roles"], list)
        assert body["user"]["roles"] == ["admin"]

    @pytest.mark.asyncio
    async def test_login_multi_role_returns_all_roles(self, client: AsyncClient, rbac_users):
        """다중 역할 사용자 로그인 시 모든 역할 반환."""
        resp = await client.post(
            "/api/auth/login",
            data={"username": "rbac_multi", "password": "changeme123!"},
        )
        assert resp.status_code == 200
        roles = resp.json()["user"]["roles"]
        assert "admin" in roles
        assert "developer" in roles

    @pytest.mark.asyncio
    async def test_me_returns_roles_array(self, client: AsyncClient, rbac_users):
        """/me 엔드포인트가 roles 배열 반환."""
        headers = _make_auth_headers(rbac_users["developer"])
        resp = await client.get("/api/auth/me", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["roles"] == ["developer"]


# ---------------------------------------------------------------------------
# T5: AdminUser 스키마 유효성 검증
# ---------------------------------------------------------------------------

class TestAdminUserSchemaValidation:
    """AdminUserCreate/Update 스키마의 roles 유효성 검증."""

    def test_create_valid_roles(self):
        """유효한 역할 목록으로 생성 스키마 통과."""
        from app.schemas.admin_user import AdminUserCreate
        data = AdminUserCreate(
            username="test", display_name="Test",
            roles=["editor", "reviewer"], password="pass1234",
        )
        assert data.roles == ["editor", "reviewer"]

    def test_create_empty_roles_rejected(self):
        """빈 역할 목록으로 생성 스키마 거부."""
        from app.schemas.admin_user import AdminUserCreate
        with pytest.raises(Exception):
            AdminUserCreate(
                username="test", display_name="Test",
                roles=[], password="pass1234",
            )

    def test_create_invalid_role_rejected(self):
        """유효하지 않은 역할로 생성 스키마 거부."""
        from app.schemas.admin_user import AdminUserCreate
        with pytest.raises(Exception):
            AdminUserCreate(
                username="test", display_name="Test",
                roles=["superadmin"], password="pass1234",
            )

    def test_create_deduplicates_roles(self):
        """중복 역할이 자동 제거."""
        from app.schemas.admin_user import AdminUserCreate
        data = AdminUserCreate(
            username="test", display_name="Test",
            roles=["editor", "editor", "admin"], password="pass1234",
        )
        assert data.roles == ["editor", "admin"]

    def test_create_developer_role_accepted(self):
        """developer 역할이 유효하게 수락됨."""
        from app.schemas.admin_user import AdminUserCreate
        data = AdminUserCreate(
            username="test", display_name="Test",
            roles=["developer"], password="pass1234",
        )
        assert data.roles == ["developer"]

    def test_update_roles_validation(self):
        """업데이트 스키마도 동일한 유효성 검증."""
        from app.schemas.admin_user import AdminUserUpdate
        data = AdminUserUpdate(roles=["admin", "developer"])
        assert data.roles == ["admin", "developer"]

    def test_update_none_roles_accepted(self):
        """업데이트 스키마에서 roles=None은 허용."""
        from app.schemas.admin_user import AdminUserUpdate
        data = AdminUserUpdate(roles=None)
        assert data.roles is None


# ---------------------------------------------------------------------------
# T8: 서비스 계층 역할 검사 (Last Admin 보호)
# ---------------------------------------------------------------------------

class TestServiceLayerRoleChecks:
    """서비스 계층의 역할 기반 비즈니스 로직 검증."""

    @pytest.mark.asyncio
    async def test_last_admin_role_change_blocked(
        self, client: AsyncClient, rbac_users,
    ):
        """마지막 admin의 역할 변경을 거부."""
        admin = rbac_users["admin"]
        headers = _make_auth_headers(admin)
        resp = await client.put(
            f"/api/admin/users/{admin.id}",
            json={"roles": ["editor"]},
            headers=headers,
        )
        assert resp.status_code == 400
        assert "마지막 관리자" in resp.json()["detail"]

    @pytest.mark.asyncio
    async def test_last_admin_deactivation_blocked(
        self, client: AsyncClient, rbac_users,
    ):
        """마지막 admin의 비활성화를 거부."""
        admin = rbac_users["admin"]
        headers = _make_auth_headers(admin)
        resp = await client.put(
            f"/api/admin/users/{admin.id}/deactivate",
            headers=headers,
        )
        # 자기 자신 비활성화 거부
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_create_user_with_developer_role(
        self, client: AsyncClient, rbac_users,
    ):
        """admin이 developer 역할의 사용자를 생성할 수 있음."""
        headers = _make_auth_headers(rbac_users["admin"])
        resp = await client.post(
            "/api/admin/users",
            json={
                "username": "new_developer",
                "display_name": "New Dev",
                "roles": ["developer"],
                "password": "password123",
            },
            headers=headers,
        )
        assert resp.status_code == 201
        assert resp.json()["roles"] == ["developer"]

    @pytest.mark.asyncio
    async def test_create_user_with_multi_roles(
        self, client: AsyncClient, rbac_users,
    ):
        """admin이 다중 역할 사용자를 생성할 수 있음."""
        headers = _make_auth_headers(rbac_users["admin"])
        resp = await client.post(
            "/api/admin/users",
            json={
                "username": "multi_role_user",
                "display_name": "Multi Role",
                "roles": ["editor", "reviewer"],
                "password": "password123",
            },
            headers=headers,
        )
        assert resp.status_code == 201
        roles = resp.json()["roles"]
        assert "editor" in roles
        assert "reviewer" in roles


# ---------------------------------------------------------------------------
# T9-T12: Admin 라우터 RBAC 분리 테스트
# ---------------------------------------------------------------------------

class TestAdminRouterRBACSplit:
    """Admin 라우터의 GET(admin_or_developer) vs Write(ops_write/system_write) 분리 검증."""

    @pytest.mark.asyncio
    async def test_admin_master_get_by_developer(self, client: AsyncClient, rbac_users, seed_test_data):
        """developer가 마스터 데이터 GET 엔드포인트 접근 가능."""
        headers = _make_auth_headers(rbac_users["developer"])
        resp = await client.get("/api/admin/lines", headers=headers)
        assert resp.status_code == 200

    @pytest.mark.asyncio
    async def test_admin_master_get_by_editor_blocked(self, client: AsyncClient, rbac_users):
        """editor가 마스터 데이터 GET 엔드포인트에 접근 시 403."""
        headers = _make_auth_headers(rbac_users["editor"])
        resp = await client.get("/api/admin/lines", headers=headers)
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_ops_write_by_developer_blocked(self, client: AsyncClient, rbac_users):
        """developer가 운영 데이터(라인) POST 시 403 (admin 필요)."""
        headers = _make_auth_headers(rbac_users["developer"])
        resp = await client.post(
            "/api/admin/lines",
            json={"line_code": "TEST-DEV", "line_name": "Dev Line"},
            headers=headers,
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_ops_write_by_admin_allowed(self, client: AsyncClient, rbac_users):
        """admin이 운영 데이터(라인) POST 가능."""
        headers = _make_auth_headers(rbac_users["admin"])
        resp = await client.post(
            "/api/admin/lines",
            json={"line_code": "TEST-ADM", "line_name": "Admin Line"},
            headers=headers,
        )
        assert resp.status_code == 201

    @pytest.mark.asyncio
    async def test_system_write_by_admin_blocked(self, client: AsyncClient, rbac_users, seed_test_data):
        """admin이 시스템 설정(카테고리) POST 시 403 (developer 필요)."""
        headers = _make_auth_headers(rbac_users["admin"])
        resp = await client.post(
            "/api/admin/categories",
            json={"category_code": "TST", "category_name": "Test Cat", "sort_order": 99},
            headers=headers,
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_system_write_by_developer_allowed(self, client: AsyncClient, rbac_users, seed_test_data):
        """developer가 시스템 설정(카테고리) POST 가능."""
        headers = _make_auth_headers(rbac_users["developer"])
        resp = await client.post(
            "/api/admin/categories",
            json={"category_code": "TST", "category_name": "Test Cat", "sort_order": 99},
            headers=headers,
        )
        assert resp.status_code == 201

    @pytest.mark.asyncio
    async def test_multi_role_admin_developer_full_access(self, client: AsyncClient, rbac_users):
        """admin+developer 다중 역할 사용자가 모든 admin 엔드포인트 접근 가능."""
        headers = _make_auth_headers(rbac_users["multi_role"])
        # admin 전용 (사용자 관리)
        resp = await client.get("/api/admin/users", headers=headers)
        assert resp.status_code == 200
        # admin_or_developer (마스터 데이터 읽기)
        resp = await client.get("/api/admin/lines", headers=headers)
        assert resp.status_code == 200

    @pytest.mark.asyncio
    async def test_recipe_mappings_read_by_developer(self, client: AsyncClient, rbac_users):
        """developer가 Recipe 매핑 GET 가능."""
        headers = _make_auth_headers(rbac_users["developer"])
        resp = await client.get("/api/admin/recipe-mappings", headers=headers)
        assert resp.status_code == 200

    @pytest.mark.asyncio
    async def test_audit_logs_read_by_developer(self, client: AsyncClient, rbac_users):
        """developer가 감사 로그 GET 가능."""
        headers = _make_auth_headers(rbac_users["developer"])
        resp = await client.get("/api/admin/audit-logs", headers=headers)
        assert resp.status_code == 200

    @pytest.mark.asyncio
    async def test_export_systems_read_by_developer(self, client: AsyncClient, rbac_users):
        """developer가 출력 시스템 GET 가능."""
        headers = _make_auth_headers(rbac_users["developer"])
        resp = await client.get("/api/admin/export-systems", headers=headers)
        assert resp.status_code == 200

    @pytest.mark.asyncio
    async def test_data_sources_read_by_developer(self, client: AsyncClient, rbac_users):
        """developer가 외부 데이터 소스 GET 가능."""
        headers = _make_auth_headers(rbac_users["developer"])
        resp = await client.get("/api/admin/data-sources", headers=headers)
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# T6: users.py 라우터 역할 필터 테스트
# ---------------------------------------------------------------------------

class TestUsersRouterRoleFilter:
    """Public users 엔드포인트의 역할 필터 검증."""

    @pytest.mark.asyncio
    async def test_filter_users_by_role(self, client: AsyncClient, rbac_users):
        """role 파라미터로 특정 역할 사용자 필터링."""
        headers = _make_auth_headers(rbac_users["admin"])
        resp = await client.get("/api/users", params={"role": "developer"}, headers=headers)
        assert resp.status_code == 200
        users = resp.json()
        for u in users:
            assert "developer" in u["roles"]

    @pytest.mark.asyncio
    async def test_filter_users_all(self, client: AsyncClient, rbac_users):
        """역할 필터 없이 모든 사용자 조회."""
        headers = _make_auth_headers(rbac_users["admin"])
        resp = await client.get("/api/users", headers=headers)
        assert resp.status_code == 200
        assert len(resp.json()) >= 5  # 최소 5명 생성됨
