"""설정 변경 합의(Config Change Consensus) 기능 통합 테스트.

요청 생성, 투표, 합의 판정, 구현 시작/완료, 취소, 목록/상세 조회를 포괄적으로 검증한다.
테스트 대상 엔드포인트:
  - POST   /api/config-changes          (요청 생성)
  - GET    /api/config-changes          (목록 조회)
  - GET    /api/config-changes/{id}     (상세 조회)
  - POST   /api/config-changes/{id}/vote    (투표)
  - PATCH  /api/config-changes/{id}/start   (구현 시작)
  - PATCH  /api/config-changes/{id}/complete (구현 완료)
  - PATCH  /api/config-changes/{id}/cancel  (취소)
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.line import Line
from app.models.user import User
from app.services.auth_service import get_password_hash


# ---------------------------------------------------------------------------
# 테스트 전용 시드 데이터 fixture
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture
async def consensus_seed(db_session: AsyncSession):
    """설정 변경 합의 테스트용 시드 데이터를 생성한다.

    라인 3개, 사용자 5명(각 라인별 reviewer + admin + editor + developer + line 없는 reviewer)
    """
    _hash = get_password_hash("changeme123!")

    # 라인 3개
    line_a = Line(line_code="LINE-A", line_name="A 라인")
    line_b = Line(line_code="LINE-B", line_name="B 라인")
    line_c = Line(line_code="LINE-C", line_name="C 라인")
    db_session.add_all([line_a, line_b, line_c])
    await db_session.flush()

    # reviewer: 라인 A 소속
    reviewer_a = User(
        username="reviewer_a", display_name="A라인 검토자",
        roles=["reviewer"], password_hash=_hash, email="ra@test.local",
        line_id=line_a.id,
    )
    # reviewer: 라인 B 소속
    reviewer_b = User(
        username="reviewer_b", display_name="B라인 검토자",
        roles=["reviewer"], password_hash=_hash, email="rb@test.local",
        line_id=line_b.id,
    )
    # reviewer: 라인 C 소속
    reviewer_c = User(
        username="reviewer_c", display_name="C라인 검토자",
        roles=["reviewer"], password_hash=_hash, email="rc@test.local",
        line_id=line_c.id,
    )
    # editor: 라인 A 소속 (투표 불가)
    editor = User(
        username="editor1", display_name="편집자",
        roles=["editor"], password_hash=_hash, email="editor1@test.local",
        line_id=line_a.id,
    )
    # admin: 라인 없음
    admin_user = User(
        username="admin_consensus", display_name="관리자",
        roles=["admin"], password_hash=_hash, email="admin_c@test.local",
    )
    # developer: 라인 없음
    developer = User(
        username="dev1", display_name="개발자",
        roles=["developer"], password_hash=_hash, email="dev1@test.local",
    )
    # reviewer: 라인 미지정 (투표 불가)
    reviewer_no_line = User(
        username="reviewer_no_line", display_name="라인 없는 검토자",
        roles=["reviewer"], password_hash=_hash, email="rnl@test.local",
    )
    db_session.add_all([
        reviewer_a, reviewer_b, reviewer_c, editor, admin_user, developer, reviewer_no_line,
    ])
    await db_session.commit()

    return {
        "line_a": line_a,
        "line_b": line_b,
        "line_c": line_c,
        "reviewer_a": reviewer_a,
        "reviewer_b": reviewer_b,
        "reviewer_c": reviewer_c,
        "editor": editor,
        "admin": admin_user,
        "developer": developer,
        "reviewer_no_line": reviewer_no_line,
    }


# ---------------------------------------------------------------------------
# 헬퍼 함수
# ---------------------------------------------------------------------------

async def _create_request(
    client: AsyncClient,
    headers: dict,
    *,
    title: str = "컬럼 추가 요청",
    description: str = "PR_SPEED 컬럼을 추가해야 합니다",
    change_type: str = "column_add",
) -> dict:
    """설정 변경 요청을 생성하고 응답 JSON을 반환한다."""
    resp = await client.post(
        "/api/config-changes",
        json={"title": title, "description": description, "change_type": change_type},
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


# ===========================================================================
# 1. 요청 생성 테스트
# ===========================================================================


class TestCreateRequest:
    """설정 변경 요청 생성 테스트."""

    @pytest.mark.asyncio
    async def test_create_request_success_reviewer(
        self, client: AsyncClient, consensus_seed, auth_headers,
    ):
        """TC-01: reviewer 역할로 요청 생성 성공 (201)."""
        headers = auth_headers(consensus_seed["reviewer_a"])
        data = await _create_request(client, headers)

        assert data["title"] == "컬럼 추가 요청"
        assert data["description"] == "PR_SPEED 컬럼을 추가해야 합니다"
        assert data["change_type"] == "column_add"
        assert data["status"] == "pending"
        assert data["requested_by"] == consensus_seed["reviewer_a"].id
        assert data["requester_name"] == "A라인 검토자"

    @pytest.mark.asyncio
    async def test_create_request_forbidden_editor(
        self, client: AsyncClient, consensus_seed, auth_headers,
    ):
        """TC-02: editor 역할로 요청 생성 시 403."""
        headers = auth_headers(consensus_seed["editor"])
        resp = await client.post(
            "/api/config-changes",
            json={
                "title": "테스트",
                "description": "설명",
                "change_type": "column_add",
            },
            headers=headers,
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_create_request_auto_creates_votes_for_all_lines(
        self, client: AsyncClient, consensus_seed, auth_headers,
    ):
        """TC-03: 요청 생성 시 모든 라인에 대한 투표 레코드가 자동 생성된다."""
        headers = auth_headers(consensus_seed["reviewer_a"])
        data = await _create_request(client, headers)

        assert "votes" in data
        assert len(data["votes"]) == 3  # 3개 라인

        vote_line_ids = {v["line_id"] for v in data["votes"]}
        expected_line_ids = {
            consensus_seed["line_a"].id,
            consensus_seed["line_b"].id,
            consensus_seed["line_c"].id,
        }
        assert vote_line_ids == expected_line_ids

        # 모든 투표는 미투표(null) 상태
        for v in data["votes"]:
            assert v["vote"] is None
            assert v["voted_by"] is None

        # 투표 요약 확인
        assert data["vote_summary"]["total"] == 3
        assert data["vote_summary"]["pending"] == 3
        assert data["vote_summary"]["approved"] == 0
        assert data["vote_summary"]["rejected"] == 0


# ===========================================================================
# 2. 투표 테스트
# ===========================================================================


class TestVoting:
    """설정 변경 투표 테스트."""

    @pytest.mark.asyncio
    async def test_vote_approve_success(
        self, client: AsyncClient, consensus_seed, auth_headers,
    ):
        """TC-04: 승인 투표 성공."""
        # 요청 생성
        req_headers = auth_headers(consensus_seed["reviewer_a"])
        data = await _create_request(client, req_headers)

        # 라인 A reviewer가 승인 투표
        resp = await client.post(
            f"/api/config-changes/{data['id']}/vote",
            json={"vote": "approve"},
            headers=req_headers,
        )
        assert resp.status_code == 200
        result = resp.json()

        assert result["vote_summary"]["approved"] == 1
        assert result["vote_summary"]["pending"] == 2
        assert result["status"] == "pending"  # 아직 전원 승인 아님

    @pytest.mark.asyncio
    async def test_vote_reject_requires_reason(
        self, client: AsyncClient, consensus_seed, auth_headers,
    ):
        """TC-05: 반려 투표에 사유(reason) 필수."""
        req_headers = auth_headers(consensus_seed["reviewer_a"])
        data = await _create_request(client, req_headers)

        # 사유 포함 반려 - 성공
        resp = await client.post(
            f"/api/config-changes/{data['id']}/vote",
            json={"vote": "reject", "reason": "현재 컬럼으로 충분합니다"},
            headers=req_headers,
        )
        assert resp.status_code == 200

    @pytest.mark.asyncio
    async def test_vote_reject_without_reason_fails(
        self, client: AsyncClient, consensus_seed, auth_headers,
    ):
        """TC-06: 반려 투표에 사유 없으면 400."""
        req_headers = auth_headers(consensus_seed["reviewer_a"])
        data = await _create_request(client, req_headers)

        resp = await client.post(
            f"/api/config-changes/{data['id']}/vote",
            json={"vote": "reject"},
            headers=req_headers,
        )
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_vote_wrong_line_forbidden(
        self, client: AsyncClient, consensus_seed, auth_headers,
    ):
        """TC-07: 소속 라인이 아닌 라인에 투표 시도 - 해당 라인의 투표만 가능.

        reviewer_a는 라인 A 소속이므로, 라인 A 투표 레코드에만 투표할 수 있다.
        투표 시 자동으로 사용자의 line_id로 투표 레코드를 찾는다.
        """
        # 이 테스트는 사용자가 자신의 line_id에 해당하는 투표만 할 수 있는지 확인
        # reviewer_a가 투표하면 line_a에 대한 투표만 기록됨
        req_headers = auth_headers(consensus_seed["reviewer_a"])
        data = await _create_request(client, req_headers)

        # reviewer_a가 투표 (line_a에 대해 자동 매핑)
        resp = await client.post(
            f"/api/config-changes/{data['id']}/vote",
            json={"vote": "approve"},
            headers=req_headers,
        )
        assert resp.status_code == 200

        # 투표 결과에서 line_a만 approve됨
        result = resp.json()
        line_a_id = consensus_seed["line_a"].id
        line_a_vote = next(v for v in result["votes"] if v["line_id"] == line_a_id)
        assert line_a_vote["vote"] == "approve"

    @pytest.mark.asyncio
    async def test_vote_no_line_id_forbidden(
        self, client: AsyncClient, consensus_seed, auth_headers,
    ):
        """TC-08: 소속 라인이 없는 사용자(reviewer_no_line)는 투표 불가 (403)."""
        # reviewer_a로 요청 생성
        req_headers = auth_headers(consensus_seed["reviewer_a"])
        data = await _create_request(client, req_headers)

        # line_id가 없는 reviewer가 투표 시도
        no_line_headers = auth_headers(consensus_seed["reviewer_no_line"])
        resp = await client.post(
            f"/api/config-changes/{data['id']}/vote",
            json={"vote": "approve"},
            headers=no_line_headers,
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_vote_request_not_pending_fails(
        self, client: AsyncClient, consensus_seed, auth_headers,
    ):
        """TC-09: pending 상태가 아닌 요청에 투표 시 400."""
        req_headers = auth_headers(consensus_seed["reviewer_a"])
        data = await _create_request(client, req_headers)

        # 한 라인이 반려하여 rejected 상태로 전환
        resp = await client.post(
            f"/api/config-changes/{data['id']}/vote",
            json={"vote": "reject", "reason": "반대합니다"},
            headers=req_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "rejected"

        # rejected 상태에서 다른 라인이 투표 시도
        b_headers = auth_headers(consensus_seed["reviewer_b"])
        resp2 = await client.post(
            f"/api/config-changes/{data['id']}/vote",
            json={"vote": "approve"},
            headers=b_headers,
        )
        assert resp2.status_code == 400


# ===========================================================================
# 3. 합의 판정 테스트
# ===========================================================================


class TestConsensus:
    """합의 판정 로직 테스트."""

    @pytest.mark.asyncio
    async def test_all_approve_auto_approved(
        self, client: AsyncClient, consensus_seed, auth_headers,
    ):
        """TC-10: 전원 승인 시 자동으로 approved 상태로 전환."""
        req_headers = auth_headers(consensus_seed["reviewer_a"])
        data = await _create_request(client, req_headers)

        # 라인 A 승인
        await client.post(
            f"/api/config-changes/{data['id']}/vote",
            json={"vote": "approve"},
            headers=auth_headers(consensus_seed["reviewer_a"]),
        )
        # 라인 B 승인
        await client.post(
            f"/api/config-changes/{data['id']}/vote",
            json={"vote": "approve"},
            headers=auth_headers(consensus_seed["reviewer_b"]),
        )
        # 라인 C 승인 (마지막)
        resp = await client.post(
            f"/api/config-changes/{data['id']}/vote",
            json={"vote": "approve"},
            headers=auth_headers(consensus_seed["reviewer_c"]),
        )
        assert resp.status_code == 200
        result = resp.json()

        assert result["status"] == "approved"
        assert result["approved_at"] is not None
        assert result["vote_summary"]["approved"] == 3
        assert result["vote_summary"]["pending"] == 0

    @pytest.mark.asyncio
    async def test_one_reject_auto_rejected(
        self, client: AsyncClient, consensus_seed, auth_headers,
    ):
        """TC-11: 하나라도 반려하면 즉시 rejected 상태로 전환."""
        req_headers = auth_headers(consensus_seed["reviewer_a"])
        data = await _create_request(client, req_headers)

        # 라인 A 승인
        await client.post(
            f"/api/config-changes/{data['id']}/vote",
            json={"vote": "approve"},
            headers=auth_headers(consensus_seed["reviewer_a"]),
        )

        # 라인 B 반려 → 즉시 rejected
        resp = await client.post(
            f"/api/config-changes/{data['id']}/vote",
            json={"vote": "reject", "reason": "시기상조입니다"},
            headers=auth_headers(consensus_seed["reviewer_b"]),
        )
        assert resp.status_code == 200
        result = resp.json()
        assert result["status"] == "rejected"
        assert result["vote_summary"]["rejected"] == 1

    @pytest.mark.asyncio
    async def test_partial_votes_stays_pending(
        self, client: AsyncClient, consensus_seed, auth_headers,
    ):
        """TC-12: 일부만 투표한 상태에서는 pending 유지."""
        req_headers = auth_headers(consensus_seed["reviewer_a"])
        data = await _create_request(client, req_headers)

        # 라인 A만 승인
        resp = await client.post(
            f"/api/config-changes/{data['id']}/vote",
            json={"vote": "approve"},
            headers=auth_headers(consensus_seed["reviewer_a"]),
        )
        assert resp.status_code == 200
        result = resp.json()
        assert result["status"] == "pending"
        assert result["vote_summary"]["approved"] == 1
        assert result["vote_summary"]["pending"] == 2


# ===========================================================================
# 4. 구현 시작/완료 테스트
# ===========================================================================


class TestImplementation:
    """구현 시작/완료 테스트."""

    async def _approve_all(self, client, data, consensus_seed, auth_headers):
        """헬퍼: 모든 라인 승인."""
        for key in ["reviewer_a", "reviewer_b", "reviewer_c"]:
            await client.post(
                f"/api/config-changes/{data['id']}/vote",
                json={"vote": "approve"},
                headers=auth_headers(consensus_seed[key]),
            )

    @pytest.mark.asyncio
    async def test_start_implementation_success_developer(
        self, client: AsyncClient, consensus_seed, auth_headers,
    ):
        """TC-13: developer 역할로 구현 시작 성공 (approved -> in_progress)."""
        req_headers = auth_headers(consensus_seed["reviewer_a"])
        data = await _create_request(client, req_headers)
        await self._approve_all(client, data, consensus_seed, auth_headers)

        # developer가 구현 시작
        dev_headers = auth_headers(consensus_seed["developer"])
        resp = await client.patch(
            f"/api/config-changes/{data['id']}/start",
            headers=dev_headers,
        )
        assert resp.status_code == 200
        result = resp.json()
        assert result["status"] == "in_progress"
        assert result["implemented_by"] == consensus_seed["developer"].id
        assert result["implementer_name"] == "개발자"

    @pytest.mark.asyncio
    async def test_start_implementation_forbidden_editor(
        self, client: AsyncClient, consensus_seed, auth_headers,
    ):
        """TC-14: editor 역할로 구현 시작 시 403."""
        req_headers = auth_headers(consensus_seed["reviewer_a"])
        data = await _create_request(client, req_headers)
        await self._approve_all(client, data, consensus_seed, auth_headers)

        editor_headers = auth_headers(consensus_seed["editor"])
        resp = await client.patch(
            f"/api/config-changes/{data['id']}/start",
            headers=editor_headers,
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_complete_implementation_success(
        self, client: AsyncClient, consensus_seed, auth_headers,
    ):
        """TC-15: 구현 완료 성공 (in_progress -> completed)."""
        req_headers = auth_headers(consensus_seed["reviewer_a"])
        data = await _create_request(client, req_headers)
        await self._approve_all(client, data, consensus_seed, auth_headers)

        dev_headers = auth_headers(consensus_seed["developer"])
        # 구현 시작
        await client.patch(
            f"/api/config-changes/{data['id']}/start",
            headers=dev_headers,
        )
        # 구현 완료
        resp = await client.patch(
            f"/api/config-changes/{data['id']}/complete",
            headers=dev_headers,
        )
        assert resp.status_code == 200
        result = resp.json()
        assert result["status"] == "completed"
        assert result["completed_at"] is not None


# ===========================================================================
# 5. 취소 테스트
# ===========================================================================


class TestCancelRequest:
    """요청 취소 테스트."""

    @pytest.mark.asyncio
    async def test_cancel_by_requester(
        self, client: AsyncClient, consensus_seed, auth_headers,
    ):
        """TC-16: 요청자 본인이 취소 성공."""
        req_headers = auth_headers(consensus_seed["reviewer_a"])
        data = await _create_request(client, req_headers)

        resp = await client.patch(
            f"/api/config-changes/{data['id']}/cancel",
            headers=req_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "cancelled"

    @pytest.mark.asyncio
    async def test_cancel_by_admin(
        self, client: AsyncClient, consensus_seed, auth_headers,
    ):
        """TC-17: admin이 취소 성공."""
        req_headers = auth_headers(consensus_seed["reviewer_a"])
        data = await _create_request(client, req_headers)

        admin_headers = auth_headers(consensus_seed["admin"])
        resp = await client.patch(
            f"/api/config-changes/{data['id']}/cancel",
            headers=admin_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "cancelled"

    @pytest.mark.asyncio
    async def test_cancel_non_pending_fails(
        self, client: AsyncClient, consensus_seed, auth_headers,
    ):
        """TC-18: pending이 아닌 상태에서 취소 시 400."""
        req_headers = auth_headers(consensus_seed["reviewer_a"])
        data = await _create_request(client, req_headers)

        # 반려로 상태 변경
        await client.post(
            f"/api/config-changes/{data['id']}/vote",
            json={"vote": "reject", "reason": "반대"},
            headers=req_headers,
        )

        # rejected 상태에서 취소 시도
        resp = await client.patch(
            f"/api/config-changes/{data['id']}/cancel",
            headers=req_headers,
        )
        assert resp.status_code == 400


# ===========================================================================
# 6. 목록/상세 조회 테스트
# ===========================================================================


class TestListAndDetail:
    """목록 및 상세 조회 테스트."""

    @pytest.mark.asyncio
    async def test_list_requests_with_status_filter(
        self, client: AsyncClient, consensus_seed, auth_headers,
    ):
        """TC-19: 상태(status) 필터로 목록 조회."""
        req_headers = auth_headers(consensus_seed["reviewer_a"])
        await _create_request(client, req_headers, title="요청 A")
        data2 = await _create_request(client, req_headers, title="요청 B")

        # 요청 B를 취소
        await client.patch(
            f"/api/config-changes/{data2['id']}/cancel",
            headers=req_headers,
        )

        # pending 필터
        resp = await client.get(
            "/api/config-changes",
            params={"status": "pending"},
            headers=req_headers,
        )
        assert resp.status_code == 200
        body = resp.json()
        statuses = [item["status"] for item in body["items"]]
        assert all(s == "pending" for s in statuses)
        assert body["total"] >= 1

        # cancelled 필터
        resp2 = await client.get(
            "/api/config-changes",
            params={"status": "cancelled"},
            headers=req_headers,
        )
        assert resp2.status_code == 200
        body2 = resp2.json()
        assert all(item["status"] == "cancelled" for item in body2["items"])

    @pytest.mark.asyncio
    async def test_get_detail_includes_vote_info(
        self, client: AsyncClient, consensus_seed, auth_headers,
    ):
        """TC-20: 상세 조회 시 투표 정보 포함."""
        req_headers = auth_headers(consensus_seed["reviewer_a"])
        data = await _create_request(client, req_headers)

        # 라인 A 승인 투표
        await client.post(
            f"/api/config-changes/{data['id']}/vote",
            json={"vote": "approve"},
            headers=req_headers,
        )

        # 상세 조회
        resp = await client.get(
            f"/api/config-changes/{data['id']}",
            headers=req_headers,
        )
        assert resp.status_code == 200
        detail = resp.json()

        assert "votes" in detail
        assert len(detail["votes"]) == 3

        # 투표한 라인 확인
        line_a_id = consensus_seed["line_a"].id
        line_a_vote = next(v for v in detail["votes"] if v["line_id"] == line_a_id)
        assert line_a_vote["vote"] == "approve"
        assert line_a_vote["voter_name"] == "A라인 검토자"
        assert line_a_vote["line_name"] == "A 라인"
        assert line_a_vote["line_code"] == "LINE-A"

        # 미투표 라인 확인
        line_b_id = consensus_seed["line_b"].id
        line_b_vote = next(v for v in detail["votes"] if v["line_id"] == line_b_id)
        assert line_b_vote["vote"] is None
        assert line_b_vote["voted_by"] is None

        # 투표 요약 확인
        assert detail["vote_summary"]["approved"] == 1
        assert detail["vote_summary"]["pending"] == 2
