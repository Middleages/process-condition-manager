"""공지사항(Announcement) 기능 통합 테스트.

관리자 CRUD, 사용자 조회, 읽음 처리, 정렬/필터, 엣지 케이스를 포괄적으로 검증한다.
테스트 대상 엔드포인트:
  - User API:  GET/POST /api/announcements/**
  - Admin API: GET/POST/PUT/DELETE /api/admin/announcements/**
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.announcement import Announcement


# ---------------------------------------------------------------------------
# 헬퍼: 관리자 API 를 통해 공지사항 생성
# ---------------------------------------------------------------------------

async def _create_announcement(
    client: AsyncClient,
    headers: dict,
    *,
    title: str = "테스트 공지",
    content: str = "공지 본문입니다.",
    category: str = "general",
    priority: str = "normal",
    is_pinned: bool = False,
) -> dict:
    """관리자 API 를 통해 공지사항을 생성하고 응답 JSON 을 반환한다."""
    resp = await client.post(
        "/api/admin/announcements",
        json={
            "title": title,
            "content": content,
            "category": category,
            "priority": priority,
            "is_pinned": is_pinned,
        },
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


# ===========================================================================
# 1. 관리자 CRUD 테스트
# ===========================================================================


class TestAdminCRUD:
    """관리자 공지사항 CRUD 엔드포인트 테스트."""

    @pytest.mark.asyncio
    async def test_create_announcement_success(
        self, client: AsyncClient, seed_test_data, auth_headers,
    ):
        """POST /api/admin/announcements - 정상 생성 (201)."""
        headers = auth_headers(seed_test_data["admin_user"])
        data = await _create_announcement(
            client, headers,
            title="신규 기능 안내",
            content="v2.0 업데이트 내용입니다.",
            category="new_feature",
            priority="important",
            is_pinned=True,
        )
        assert data["title"] == "신규 기능 안내"
        assert data["content"] == "v2.0 업데이트 내용입니다."
        assert data["category"] == "new_feature"
        assert data["priority"] == "important"
        assert data["is_pinned"] is True
        assert data["is_active"] is True
        assert data["created_by"] == seed_test_data["admin_user"].id

    @pytest.mark.asyncio
    async def test_create_announcement_invalid_category(
        self, client: AsyncClient, seed_test_data, auth_headers,
    ):
        """POST /api/admin/announcements - 잘못된 카테고리 시 422."""
        headers = auth_headers(seed_test_data["admin_user"])
        resp = await client.post(
            "/api/admin/announcements",
            json={
                "title": "공지",
                "content": "본문",
                "category": "invalid_category",
            },
            headers=headers,
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_create_announcement_invalid_priority(
        self, client: AsyncClient, seed_test_data, auth_headers,
    ):
        """POST /api/admin/announcements - 잘못된 우선순위 시 422."""
        headers = auth_headers(seed_test_data["admin_user"])
        resp = await client.post(
            "/api/admin/announcements",
            json={
                "title": "공지",
                "content": "본문",
                "priority": "ultra_high",
            },
            headers=headers,
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_list_admin_announcements(
        self, client: AsyncClient, seed_test_data, auth_headers,
    ):
        """GET /api/admin/announcements - 관리자 목록 조회 성공."""
        headers = auth_headers(seed_test_data["admin_user"])
        await _create_announcement(client, headers, title="공지 A")
        await _create_announcement(client, headers, title="공지 B")

        resp = await client.get("/api/admin/announcements", headers=headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] >= 2
        titles = [item["title"] for item in body["items"]]
        assert "공지 A" in titles
        assert "공지 B" in titles

    @pytest.mark.asyncio
    async def test_update_announcement_success(
        self, client: AsyncClient, seed_test_data, auth_headers,
    ):
        """PUT /api/admin/announcements/{id} - 정상 수정."""
        headers = auth_headers(seed_test_data["admin_user"])
        created = await _create_announcement(client, headers, title="원본 제목")

        resp = await client.put(
            f"/api/admin/announcements/{created['id']}",
            json={"title": "수정된 제목", "priority": "critical"},
            headers=headers,
        )
        assert resp.status_code == 200
        updated = resp.json()
        assert updated["title"] == "수정된 제목"
        assert updated["priority"] == "critical"
        # 수정하지 않은 필드는 유지
        assert updated["content"] == "공지 본문입니다."

    @pytest.mark.asyncio
    async def test_update_nonexistent_announcement(
        self, client: AsyncClient, seed_test_data, auth_headers,
    ):
        """PUT /api/admin/announcements/99999 - 존재하지 않는 공지 수정 시 404."""
        headers = auth_headers(seed_test_data["admin_user"])
        resp = await client.put(
            "/api/admin/announcements/99999",
            json={"title": "없는 공지"},
            headers=headers,
        )
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_delete_announcement_soft_delete(
        self, client: AsyncClient, db_session: AsyncSession,
        seed_test_data, auth_headers,
    ):
        """DELETE /api/admin/announcements/{id} - 소프트 삭제 (204) + is_active=False 검증."""
        headers = auth_headers(seed_test_data["admin_user"])
        created = await _create_announcement(client, headers, title="삭제 대상")

        resp = await client.delete(
            f"/api/admin/announcements/{created['id']}", headers=headers,
        )
        assert resp.status_code == 204

        # DB 에서 is_active=False 확인
        db_session.expire_all()
        ann = await db_session.get(Announcement, created["id"])
        assert ann is not None, "물리 삭제가 아니라 소프트 삭제여야 한다"
        assert ann.is_active is False

    @pytest.mark.asyncio
    async def test_delete_nonexistent_announcement(
        self, client: AsyncClient, seed_test_data, auth_headers,
    ):
        """DELETE /api/admin/announcements/99999 - 존재하지 않는 공지 삭제 시 404."""
        headers = auth_headers(seed_test_data["admin_user"])
        resp = await client.delete(
            "/api/admin/announcements/99999", headers=headers,
        )
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_non_admin_cannot_access_admin_endpoints(
        self, client: AsyncClient, seed_test_data, auth_headers,
    ):
        """관리자가 아닌 사용자(editor)는 admin 공지 엔드포인트 접근 불가 (403)."""
        headers = auth_headers(seed_test_data["user"])  # editor 역할

        resp_list = await client.get("/api/admin/announcements", headers=headers)
        assert resp_list.status_code == 403

        resp_create = await client.post(
            "/api/admin/announcements",
            json={"title": "몰래 생성", "content": "본문"},
            headers=headers,
        )
        assert resp_create.status_code == 403


# ===========================================================================
# 2. 사용자 조회 API 테스트
# ===========================================================================


class TestUserReadAPI:
    """사용자 공지사항 조회 엔드포인트 테스트."""

    @pytest.mark.asyncio
    async def test_list_announcements_with_is_read_false(
        self, client: AsyncClient, seed_test_data, auth_headers,
    ):
        """GET /api/announcements - 초기 조회 시 is_read=False."""
        admin_headers = auth_headers(seed_test_data["admin_user"])
        await _create_announcement(client, admin_headers, title="새 공지")

        user_headers = auth_headers(seed_test_data["user"])
        resp = await client.get("/api/announcements", headers=user_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] >= 1
        for item in body["items"]:
            assert item["is_read"] is False

    @pytest.mark.asyncio
    async def test_list_announcements_pagination(
        self, client: AsyncClient, seed_test_data, auth_headers,
    ):
        """GET /api/announcements?offset=&limit= - 페이지네이션 동작 검증."""
        admin_headers = auth_headers(seed_test_data["admin_user"])
        for i in range(5):
            await _create_announcement(client, admin_headers, title=f"페이지 공지 {i}")

        user_headers = auth_headers(seed_test_data["user"])

        # 첫 페이지: limit=2
        resp1 = await client.get(
            "/api/announcements", params={"offset": 0, "limit": 2},
            headers=user_headers,
        )
        assert resp1.status_code == 200
        body1 = resp1.json()
        assert len(body1["items"]) == 2
        assert body1["total"] == 5

        # 두 번째 페이지
        resp2 = await client.get(
            "/api/announcements", params={"offset": 2, "limit": 2},
            headers=user_headers,
        )
        assert resp2.status_code == 200
        body2 = resp2.json()
        assert len(body2["items"]) == 2

        # 첫 페이지와 두 번째 페이지 항목이 중복되지 않음
        ids1 = {item["id"] for item in body1["items"]}
        ids2 = {item["id"] for item in body2["items"]}
        assert ids1.isdisjoint(ids2)

    @pytest.mark.asyncio
    async def test_get_single_announcement(
        self, client: AsyncClient, seed_test_data, auth_headers,
    ):
        """GET /api/announcements/{id} - 단일 공지 조회 성공."""
        admin_headers = auth_headers(seed_test_data["admin_user"])
        created = await _create_announcement(
            client, admin_headers, title="단일 조회 테스트",
        )

        user_headers = auth_headers(seed_test_data["user"])
        resp = await client.get(
            f"/api/announcements/{created['id']}", headers=user_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == created["id"]
        assert data["title"] == "단일 조회 테스트"
        assert "creator_name" in data

    @pytest.mark.asyncio
    async def test_get_nonexistent_announcement(
        self, client: AsyncClient, seed_test_data, auth_headers,
    ):
        """GET /api/announcements/99999 - 존재하지 않는 공지 조회 시 404."""
        headers = auth_headers(seed_test_data["user"])
        resp = await client.get("/api/announcements/99999", headers=headers)
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_get_deleted_announcement_returns_404(
        self, client: AsyncClient, seed_test_data, auth_headers,
    ):
        """GET /api/announcements/{id} - 삭제(비활성)된 공지 조회 시 404."""
        admin_headers = auth_headers(seed_test_data["admin_user"])
        created = await _create_announcement(client, admin_headers, title="곧 삭제될 공지")

        # 소프트 삭제
        del_resp = await client.delete(
            f"/api/admin/announcements/{created['id']}", headers=admin_headers,
        )
        assert del_resp.status_code == 204

        # 사용자 조회 시 404
        user_headers = auth_headers(seed_test_data["user"])
        resp = await client.get(
            f"/api/announcements/{created['id']}", headers=user_headers,
        )
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_unread_count(
        self, client: AsyncClient, seed_test_data, auth_headers,
    ):
        """GET /api/announcements/unread-count - 미읽음 수 정확히 반환."""
        admin_headers = auth_headers(seed_test_data["admin_user"])
        await _create_announcement(client, admin_headers, title="미읽음 1")
        await _create_announcement(client, admin_headers, title="미읽음 2")
        await _create_announcement(client, admin_headers, title="미읽음 3")

        user_headers = auth_headers(seed_test_data["user"])
        resp = await client.get(
            "/api/announcements/unread-count", headers=user_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["count"] == 3

    @pytest.mark.asyncio
    async def test_list_returns_creator_name(
        self, client: AsyncClient, seed_test_data, auth_headers,
    ):
        """GET /api/announcements - 응답에 creator_name (작성자 표시명) 포함."""
        admin_headers = auth_headers(seed_test_data["admin_user"])
        await _create_announcement(client, admin_headers, title="작성자 확인")

        user_headers = auth_headers(seed_test_data["user"])
        resp = await client.get("/api/announcements", headers=user_headers)
        assert resp.status_code == 200
        item = resp.json()["items"][0]
        assert item["creator_name"] == seed_test_data["admin_user"].display_name


# ===========================================================================
# 3. 읽음 처리 테스트
# ===========================================================================


class TestReadTracking:
    """공지사항 읽음 처리 테스트."""

    @pytest.mark.asyncio
    async def test_mark_as_read_success(
        self, client: AsyncClient, seed_test_data, auth_headers,
    ):
        """POST /api/announcements/{id}/read - 읽음 처리 성공 (204) + is_read 변경 확인."""
        admin_headers = auth_headers(seed_test_data["admin_user"])
        created = await _create_announcement(client, admin_headers, title="읽음 테스트")

        user_headers = auth_headers(seed_test_data["user"])

        # 읽음 처리 전: is_read=False
        resp_before = await client.get(
            f"/api/announcements/{created['id']}", headers=user_headers,
        )
        assert resp_before.json()["is_read"] is False

        # 읽음 처리
        resp = await client.post(
            f"/api/announcements/{created['id']}/read", headers=user_headers,
        )
        assert resp.status_code == 204

        # 읽음 처리 후: is_read=True
        resp_after = await client.get(
            f"/api/announcements/{created['id']}", headers=user_headers,
        )
        assert resp_after.json()["is_read"] is True

    @pytest.mark.asyncio
    async def test_mark_as_read_nonexistent_returns_404(
        self, client: AsyncClient, seed_test_data, auth_headers,
    ):
        """POST /api/announcements/99999/read - 존재하지 않는 공지 읽음 처리 시 404."""
        headers = auth_headers(seed_test_data["user"])
        resp = await client.post(
            "/api/announcements/99999/read", headers=headers,
        )
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_mark_as_read_deleted_returns_404(
        self, client: AsyncClient, seed_test_data, auth_headers,
    ):
        """POST /api/announcements/{id}/read - 삭제된(비활성) 공지 읽음 처리 시 404."""
        admin_headers = auth_headers(seed_test_data["admin_user"])
        created = await _create_announcement(client, admin_headers, title="삭제 후 읽음")

        # 소프트 삭제
        await client.delete(
            f"/api/admin/announcements/{created['id']}", headers=admin_headers,
        )

        user_headers = auth_headers(seed_test_data["user"])
        resp = await client.post(
            f"/api/announcements/{created['id']}/read", headers=user_headers,
        )
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_mark_as_read_idempotent(
        self, client: AsyncClient, seed_test_data, auth_headers,
    ):
        """POST /api/announcements/{id}/read - 두 번 읽어도 에러 없이 멱등 처리."""
        admin_headers = auth_headers(seed_test_data["admin_user"])
        created = await _create_announcement(client, admin_headers, title="멱등 테스트")

        user_headers = auth_headers(seed_test_data["user"])

        resp1 = await client.post(
            f"/api/announcements/{created['id']}/read", headers=user_headers,
        )
        assert resp1.status_code == 204

        resp2 = await client.post(
            f"/api/announcements/{created['id']}/read", headers=user_headers,
        )
        assert resp2.status_code == 204

    @pytest.mark.asyncio
    async def test_mark_all_as_read_success(
        self, client: AsyncClient, seed_test_data, auth_headers,
    ):
        """POST /api/announcements/read-all - 전체 읽음 처리 후 미읽음 수 0."""
        admin_headers = auth_headers(seed_test_data["admin_user"])
        await _create_announcement(client, admin_headers, title="전체 읽음 A")
        await _create_announcement(client, admin_headers, title="전체 읽음 B")

        user_headers = auth_headers(seed_test_data["user"])

        # 전체 읽음 처리
        resp = await client.post(
            "/api/announcements/read-all", headers=user_headers,
        )
        assert resp.status_code == 204

        # 미읽음 수 0 확인
        count_resp = await client.get(
            "/api/announcements/unread-count", headers=user_headers,
        )
        assert count_resp.json()["count"] == 0

    @pytest.mark.asyncio
    async def test_mark_all_as_read_when_already_all_read(
        self, client: AsyncClient, seed_test_data, auth_headers,
    ):
        """POST /api/announcements/read-all - 이미 전부 읽은 상태에서도 에러 없이 처리."""
        admin_headers = auth_headers(seed_test_data["admin_user"])
        await _create_announcement(client, admin_headers, title="이미 읽음")

        user_headers = auth_headers(seed_test_data["user"])

        # 먼저 전체 읽음
        await client.post("/api/announcements/read-all", headers=user_headers)

        # 다시 전체 읽음 - 에러 없음
        resp = await client.post(
            "/api/announcements/read-all", headers=user_headers,
        )
        assert resp.status_code == 204

    @pytest.mark.asyncio
    async def test_read_status_is_per_user(
        self, client: AsyncClient, seed_test_data, auth_headers,
    ):
        """읽음 상태는 사용자별 독립 - A 가 읽어도 B 는 미읽음 유지."""
        admin_headers = auth_headers(seed_test_data["admin_user"])
        created = await _create_announcement(client, admin_headers, title="사용자별 읽음")

        user_a_headers = auth_headers(seed_test_data["user"])        # editor
        user_b_headers = auth_headers(seed_test_data["reviewer_user"])  # reviewer

        # 사용자 A 만 읽음 처리
        resp = await client.post(
            f"/api/announcements/{created['id']}/read", headers=user_a_headers,
        )
        assert resp.status_code == 204

        # 사용자 A: is_read=True
        resp_a = await client.get(
            f"/api/announcements/{created['id']}", headers=user_a_headers,
        )
        assert resp_a.json()["is_read"] is True

        # 사용자 B: is_read=False (독립)
        resp_b = await client.get(
            f"/api/announcements/{created['id']}", headers=user_b_headers,
        )
        assert resp_b.json()["is_read"] is False

    @pytest.mark.asyncio
    async def test_unread_count_decreases_after_read(
        self, client: AsyncClient, seed_test_data, auth_headers,
    ):
        """개별 읽음 처리 후 미읽음 수가 정확히 감소하는지 검증."""
        admin_headers = auth_headers(seed_test_data["admin_user"])
        created1 = await _create_announcement(client, admin_headers, title="카운트 1")
        await _create_announcement(client, admin_headers, title="카운트 2")

        user_headers = auth_headers(seed_test_data["user"])

        # 초기 미읽음 2
        resp = await client.get(
            "/api/announcements/unread-count", headers=user_headers,
        )
        assert resp.json()["count"] == 2

        # 1건 읽음 처리
        await client.post(
            f"/api/announcements/{created1['id']}/read", headers=user_headers,
        )

        # 미읽음 1
        resp2 = await client.get(
            "/api/announcements/unread-count", headers=user_headers,
        )
        assert resp2.json()["count"] == 1


# ===========================================================================
# 4. 정렬 및 필터 테스트
# ===========================================================================


class TestOrderingAndFiltering:
    """공지사항 정렬 및 필터링 테스트."""

    @pytest.mark.asyncio
    async def test_pinned_announcements_appear_first(
        self, client: AsyncClient, seed_test_data, auth_headers,
    ):
        """고정(pinned) 공지가 일반 공지보다 먼저 표시된다."""
        admin_headers = auth_headers(seed_test_data["admin_user"])

        # 일반 공지 먼저 생성
        await _create_announcement(
            client, admin_headers, title="일반 공지", is_pinned=False,
        )
        # 고정 공지 나중에 생성
        await _create_announcement(
            client, admin_headers, title="고정 공지", is_pinned=True,
        )

        user_headers = auth_headers(seed_test_data["user"])
        resp = await client.get("/api/announcements", headers=user_headers)
        assert resp.status_code == 200
        items = resp.json()["items"]
        assert len(items) >= 2
        # 첫 번째 항목이 고정 공지
        assert items[0]["title"] == "고정 공지"
        assert items[0]["is_pinned"] is True

    @pytest.mark.asyncio
    async def test_admin_list_includes_inactive(
        self, client: AsyncClient, seed_test_data, auth_headers,
    ):
        """GET /api/admin/announcements - 비활성(삭제된) 공지도 포함."""
        admin_headers = auth_headers(seed_test_data["admin_user"])
        created = await _create_announcement(client, admin_headers, title="비활성 포함 테스트")

        # 소프트 삭제
        await client.delete(
            f"/api/admin/announcements/{created['id']}", headers=admin_headers,
        )

        resp = await client.get("/api/admin/announcements", headers=admin_headers)
        assert resp.status_code == 200
        ids = [item["id"] for item in resp.json()["items"]]
        assert created["id"] in ids  # 비활성이어도 관리자 목록에 포함

    @pytest.mark.asyncio
    async def test_user_list_excludes_inactive(
        self, client: AsyncClient, seed_test_data, auth_headers,
    ):
        """GET /api/announcements - 사용자 목록에서 비활성 공지 제외."""
        admin_headers = auth_headers(seed_test_data["admin_user"])
        created = await _create_announcement(client, admin_headers, title="사용자 제외 테스트")

        # 소프트 삭제
        await client.delete(
            f"/api/admin/announcements/{created['id']}", headers=admin_headers,
        )

        user_headers = auth_headers(seed_test_data["user"])
        resp = await client.get("/api/announcements", headers=user_headers)
        assert resp.status_code == 200
        ids = [item["id"] for item in resp.json()["items"]]
        assert created["id"] not in ids  # 비활성 공지 제외

    @pytest.mark.asyncio
    async def test_announcements_sorted_by_created_at_desc(
        self, client: AsyncClient, db_session: AsyncSession,
        seed_test_data, auth_headers,
    ):
        """동일 pin 상태 내에서 최신 공지가 먼저 표시된다 (created_at DESC).

        SQLite 인메모리 환경에서는 server_default=func.now()가 동일 초(second)에
        동일 타임스탬프를 생성할 수 있으므로, DB 직접 삽입으로 타임스탬프를 분리한다.
        """
        from datetime import datetime, timezone, timedelta

        admin_id = seed_test_data["admin_user"].id
        t_old = datetime(2024, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
        t_new = t_old + timedelta(hours=1)

        older = Announcement(
            title="먼저 생성", content="본문", created_by=admin_id,
            created_at=t_old, updated_at=t_old,
        )
        newer = Announcement(
            title="나중 생성", content="본문", created_by=admin_id,
            created_at=t_new, updated_at=t_new,
        )
        db_session.add_all([older, newer])
        await db_session.commit()

        user_headers = auth_headers(seed_test_data["user"])
        resp = await client.get("/api/announcements", headers=user_headers)
        assert resp.status_code == 200
        items = resp.json()["items"]

        # 나중에 생성된 공지(newer)가 먼저 표시
        item_ids = [item["id"] for item in items]
        idx_older = item_ids.index(older.id)
        idx_newer = item_ids.index(newer.id)
        assert idx_newer < idx_older, "나중 생성 공지가 먼저 표시되어야 한다"


# ===========================================================================
# 5. 엣지 케이스 테스트
# ===========================================================================


class TestEdgeCases:
    """엣지 케이스 및 보안 테스트."""

    @pytest.mark.asyncio
    async def test_unauthenticated_access_user_api(
        self, client: AsyncClient,
    ):
        """인증 없이 사용자 API 접근 시 401."""
        resp = await client.get("/api/announcements")
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_unauthenticated_access_admin_api(
        self, client: AsyncClient,
    ):
        """인증 없이 관리자 API 접근 시 401."""
        resp = await client.get("/api/admin/announcements")
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_create_missing_required_fields(
        self, client: AsyncClient, seed_test_data, auth_headers,
    ):
        """POST /api/admin/announcements - 필수 필드 누락 시 422."""
        headers = auth_headers(seed_test_data["admin_user"])

        # title 누락
        resp = await client.post(
            "/api/admin/announcements",
            json={"content": "본문만"},
            headers=headers,
        )
        assert resp.status_code == 422

        # content 누락
        resp2 = await client.post(
            "/api/admin/announcements",
            json={"title": "제목만"},
            headers=headers,
        )
        assert resp2.status_code == 422

    @pytest.mark.asyncio
    async def test_create_title_exceeds_max_length(
        self, client: AsyncClient, seed_test_data, auth_headers,
    ):
        """POST /api/admin/announcements - title 200자 초과 시 422."""
        headers = auth_headers(seed_test_data["admin_user"])
        long_title = "A" * 201
        resp = await client.post(
            "/api/admin/announcements",
            json={"title": long_title, "content": "본문"},
            headers=headers,
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_create_with_default_values(
        self, client: AsyncClient, seed_test_data, auth_headers,
    ):
        """POST /api/admin/announcements - category/priority/is_pinned 기본값 확인."""
        headers = auth_headers(seed_test_data["admin_user"])
        resp = await client.post(
            "/api/admin/announcements",
            json={"title": "기본값 테스트", "content": "본문"},
            headers=headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["category"] == "general"
        assert data["priority"] == "normal"
        assert data["is_pinned"] is False

    @pytest.mark.asyncio
    async def test_mark_all_read_then_new_announcement_is_unread(
        self, client: AsyncClient, seed_test_data, auth_headers,
    ):
        """전체 읽음 처리 후 새로 생성된 공지는 미읽음 상태."""
        admin_headers = auth_headers(seed_test_data["admin_user"])
        await _create_announcement(client, admin_headers, title="기존 공지")

        user_headers = auth_headers(seed_test_data["user"])

        # 전체 읽음
        await client.post("/api/announcements/read-all", headers=user_headers)

        # 새 공지 생성
        new = await _create_announcement(client, admin_headers, title="새 공지")

        # 미읽음 수 1
        count_resp = await client.get(
            "/api/announcements/unread-count", headers=user_headers,
        )
        assert count_resp.json()["count"] == 1

        # 새 공지 is_read=False
        detail_resp = await client.get(
            f"/api/announcements/{new['id']}", headers=user_headers,
        )
        assert detail_resp.json()["is_read"] is False

    @pytest.mark.asyncio
    async def test_update_with_invalid_category(
        self, client: AsyncClient, seed_test_data, auth_headers,
    ):
        """PUT /api/admin/announcements/{id} - 수정 시 잘못된 카테고리 422."""
        admin_headers = auth_headers(seed_test_data["admin_user"])
        created = await _create_announcement(client, admin_headers)

        resp = await client.put(
            f"/api/admin/announcements/{created['id']}",
            json={"category": "nonexistent"},
            headers=admin_headers,
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_list_announcements_with_is_read_true_after_read(
        self, client: AsyncClient, seed_test_data, auth_headers,
    ):
        """GET /api/announcements - 읽음 처리 후 목록에서도 is_read=True."""
        admin_headers = auth_headers(seed_test_data["admin_user"])
        created = await _create_announcement(client, admin_headers, title="목록 읽음 확인")

        user_headers = auth_headers(seed_test_data["user"])

        # 읽음 처리
        await client.post(
            f"/api/announcements/{created['id']}/read", headers=user_headers,
        )

        # 목록 조회에서 is_read=True
        resp = await client.get("/api/announcements", headers=user_headers)
        items = resp.json()["items"]
        target = next(i for i in items if i["id"] == created["id"])
        assert target["is_read"] is True
