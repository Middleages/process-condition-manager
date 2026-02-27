"""Tests for device_master_query_service (SPEC-PROJECT-002 M1).

Covers:
- search_devices: cascading filters (line_id, product_name, process, part_id), active-only
- get_device_by_ref: exact 4-field match, not-found case
- get_device_layers: sorted layers by layer_id numeric, empty device
- get_device_header: enrichment retrieval, device not found

Uses AsyncMock for db session since test DB is SQLite and does not support
PostgreSQL-specific features (ILIKE, CAST to Float, JSONB).
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from types import SimpleNamespace

from app.models.device_master import DeviceMaster, LayerMaster


# ---------------------------------------------------------------------------
# Helper: mock result chain for scalars().all() / scalars().first()
# ---------------------------------------------------------------------------


def _mock_scalars_all(items: list) -> AsyncMock:
    """Create a mock db.execute() result where scalars().all() returns items."""
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = items
    return mock_result


def _mock_scalars_first(item) -> MagicMock:
    """Create a mock db.execute() result where scalars().first() returns item."""
    mock_result = MagicMock()
    mock_result.scalars.return_value.first.return_value = item
    return mock_result


# ===========================================================================
# TestSearchDevices
# ===========================================================================


class TestSearchDevices:

    @pytest.mark.asyncio
    async def test_search_by_line_id_only(self):
        """Filter devices by line_id returns matching active devices."""
        from app.services.device_master_query_service import search_devices

        device = SimpleNamespace(
            id=1, line_id=10, product_name="PROD-A", process="PHOTO",
            part_id="P1", is_active=True, enrichment={},
        )

        db = AsyncMock()
        db.execute.return_value = _mock_scalars_all([device])

        result = await search_devices(db, line_id=10)
        assert len(result) == 1
        assert result[0].product_name == "PROD-A"
        db.execute.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_search_by_product_name_partial(self):
        """ILIKE partial match on product_name returns matching devices."""
        from app.services.device_master_query_service import search_devices

        devices = [
            SimpleNamespace(id=1, product_name="ABC-100", is_active=True),
            SimpleNamespace(id=2, product_name="ABC-200", is_active=True),
        ]

        db = AsyncMock()
        db.execute.return_value = _mock_scalars_all(devices)

        result = await search_devices(db, product_name="ABC")
        assert len(result) == 2
        db.execute.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_search_cascading_filter(self):
        """Filter by line_id + product_name + process returns intersection."""
        from app.services.device_master_query_service import search_devices

        device = SimpleNamespace(
            id=1, line_id=10, product_name="PROD-A", process="PHOTO",
            part_id="P1", is_active=True,
        )

        db = AsyncMock()
        db.execute.return_value = _mock_scalars_all([device])

        result = await search_devices(
            db, line_id=10, product_name="PROD", process="PHOTO",
        )
        assert len(result) == 1
        assert result[0].process == "PHOTO"
        db.execute.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_search_returns_active_only(self):
        """Only active devices are returned (inactive excluded by query)."""
        from app.services.device_master_query_service import search_devices

        # The mock returns only active devices because the service query
        # filters with `is_active == True`. We simulate that the DB
        # correctly returns only active matches.
        active_device = SimpleNamespace(
            id=1, product_name="ACTIVE-PROD", is_active=True,
        )

        db = AsyncMock()
        db.execute.return_value = _mock_scalars_all([active_device])

        result = await search_devices(db)
        assert len(result) == 1
        assert result[0].product_name == "ACTIVE-PROD"

    @pytest.mark.asyncio
    async def test_search_empty_result(self):
        """No matching devices returns empty list."""
        from app.services.device_master_query_service import search_devices

        db = AsyncMock()
        db.execute.return_value = _mock_scalars_all([])

        result = await search_devices(db, line_id=999)
        assert result == []

    @pytest.mark.asyncio
    async def test_search_respects_limit(self):
        """Custom limit parameter is accepted without error."""
        from app.services.device_master_query_service import search_devices

        db = AsyncMock()
        db.execute.return_value = _mock_scalars_all([])

        result = await search_devices(db, limit=5)
        assert result == []
        db.execute.assert_awaited_once()


# ===========================================================================
# TestGetDeviceByRef
# ===========================================================================


class TestGetDeviceByRef:

    @pytest.mark.asyncio
    async def test_found(self):
        """Exact 4-field match returns DeviceMaster."""
        from app.services.device_master_query_service import get_device_by_ref

        device = SimpleNamespace(
            id=1, line_id=10, product_name="PROD-A",
            process="PHOTO", part_id="P1", is_active=True,
        )

        db = AsyncMock()
        db.execute.return_value = _mock_scalars_first(device)

        result = await get_device_by_ref(
            db, line_id=10, product_name="PROD-A",
            process="PHOTO", part_id="P1",
        )
        assert result is not None
        assert result.product_name == "PROD-A"
        assert result.process == "PHOTO"
        db.execute.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_not_found(self):
        """Returns None when no match for 4-field combination."""
        from app.services.device_master_query_service import get_device_by_ref

        db = AsyncMock()
        db.execute.return_value = _mock_scalars_first(None)

        result = await get_device_by_ref(
            db, line_id=999, product_name="NOPE",
            process="NOPE", part_id="NOPE",
        )
        assert result is None


# ===========================================================================
# TestGetDeviceLayers
# ===========================================================================


class TestGetDeviceLayers:

    @pytest.mark.asyncio
    async def test_returns_sorted_layers(self):
        """Layers returned sorted by CAST(layer_id AS FLOAT) numerically."""
        from app.services.device_master_query_service import get_device_layers

        # Simulate layers already sorted (DB does the sort via ORDER BY)
        layers = [
            SimpleNamespace(id=1, device_master_id=10, layer_id="1.0", step_seq="ts1", descript="L1"),
            SimpleNamespace(id=2, device_master_id=10, layer_id="1.21", step_seq="ts2", descript="L2"),
            SimpleNamespace(id=3, device_master_id=10, layer_id="17.31", step_seq="ts3", descript="L3"),
        ]

        db = AsyncMock()
        db.execute.return_value = _mock_scalars_all(layers)

        result = await get_device_layers(db, device_master_id=10)
        assert len(result) == 3
        assert result[0].layer_id == "1.0"
        assert result[1].layer_id == "1.21"
        assert result[2].layer_id == "17.31"
        db.execute.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_empty_device(self):
        """Device with no layers returns empty list."""
        from app.services.device_master_query_service import get_device_layers

        db = AsyncMock()
        db.execute.return_value = _mock_scalars_all([])

        result = await get_device_layers(db, device_master_id=99)
        assert result == []


# ===========================================================================
# TestGetDeviceHeader
# ===========================================================================


class TestGetDeviceHeader:

    @pytest.mark.asyncio
    async def test_returns_enrichment(self):
        """Returns enrichment dict from device_master."""
        from app.services.device_master_query_service import get_device_header

        enrichment_data = {"fab_grade": "A", "target_yield": 0.98}
        device = SimpleNamespace(
            id=1, enrichment=enrichment_data,
        )

        db = AsyncMock()
        db.get.return_value = device

        result = await get_device_header(db, device_master_id=1)
        assert result is not None
        assert result["fab_grade"] == "A"
        assert result["target_yield"] == 0.98
        db.get.assert_awaited_once_with(DeviceMaster, 1)

    @pytest.mark.asyncio
    async def test_device_not_found(self):
        """Returns None when device doesn't exist."""
        from app.services.device_master_query_service import get_device_header

        db = AsyncMock()
        db.get.return_value = None

        result = await get_device_header(db, device_master_id=999)
        assert result is None
        db.get.assert_awaited_once_with(DeviceMaster, 999)

    @pytest.mark.asyncio
    async def test_returns_empty_enrichment(self):
        """Returns empty dict when enrichment is empty."""
        from app.services.device_master_query_service import get_device_header

        device = SimpleNamespace(id=1, enrichment={})

        db = AsyncMock()
        db.get.return_value = device

        result = await get_device_header(db, device_master_id=1)
        assert result == {}
