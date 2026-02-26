"""Tests for SPEC-DEVICE-001 DeviceEnrichmentService.

Covers:
- _validate_identifier: valid/invalid SQL identifiers (SQL injection prevention)
- _resolve_device_field: allowed/disallowed device field resolution
- enrich_device: device not found, no active meta sources, successful enrichment
- enrich_all_devices: no active devices, multiple devices
- discover_columns: tested at schema level (information_schema is PostgreSQL-specific)

Note: Methods that query information_schema or build dynamic SQL are mocked since
the test database is SQLite. Pure logic tests run without mocking.
"""

import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.device_master import DeviceMaster, DeviceMetaSource
from app.services.device_enrichment_service import DeviceEnrichmentService


# ---------------------------------------------------------------------------
# Tests: _validate_identifier (pure logic, no DB)
# ---------------------------------------------------------------------------


class TestValidateIdentifier:

    def test_valid_simple_name(self):
        """Simple alphanumeric name should pass."""
        DeviceEnrichmentService._validate_identifier("product_name", "test")

    def test_valid_with_numbers(self):
        """Name with numbers should pass."""
        DeviceEnrichmentService._validate_identifier("column_123", "test")

    def test_valid_underscore_prefix(self):
        """Name starting with underscore should pass."""
        DeviceEnrichmentService._validate_identifier("_internal_col", "test")

    def test_valid_single_letter(self):
        """Single letter should pass."""
        DeviceEnrichmentService._validate_identifier("x", "test")

    def test_invalid_starts_with_number(self):
        """Name starting with number should fail."""
        with pytest.raises(ValueError, match="Invalid"):
            DeviceEnrichmentService._validate_identifier("123col", "test")

    def test_invalid_contains_hyphen(self):
        """Name with hyphen should fail (SQL injection vector)."""
        with pytest.raises(ValueError, match="Invalid"):
            DeviceEnrichmentService._validate_identifier("my-column", "test")

    def test_invalid_contains_space(self):
        """Name with space should fail."""
        with pytest.raises(ValueError, match="Invalid"):
            DeviceEnrichmentService._validate_identifier("my column", "test")

    def test_invalid_contains_semicolon(self):
        """Name with semicolon should fail (SQL injection vector)."""
        with pytest.raises(ValueError, match="Invalid"):
            DeviceEnrichmentService._validate_identifier("col; DROP TABLE", "test")

    def test_invalid_contains_quotes(self):
        """Name with quotes should fail (SQL injection vector)."""
        with pytest.raises(ValueError, match="Invalid"):
            DeviceEnrichmentService._validate_identifier("col'name", "test")

    def test_invalid_contains_parentheses(self):
        """Name with parentheses should fail (SQL injection vector)."""
        with pytest.raises(ValueError, match="Invalid"):
            DeviceEnrichmentService._validate_identifier("col()", "test")

    def test_invalid_empty_string(self):
        """Empty string should fail."""
        with pytest.raises(ValueError, match="Invalid"):
            DeviceEnrichmentService._validate_identifier("", "test")

    def test_invalid_dot_notation(self):
        """Dot notation should fail (schema.table injection)."""
        with pytest.raises(ValueError, match="Invalid"):
            DeviceEnrichmentService._validate_identifier("schema.table", "test")

    def test_error_message_includes_label(self):
        """Error message should include the label parameter."""
        with pytest.raises(ValueError, match="source_column"):
            DeviceEnrichmentService._validate_identifier("bad-col", "source_column")


# ---------------------------------------------------------------------------
# Tests: _resolve_device_field (pure logic, no DB)
# ---------------------------------------------------------------------------


class TestResolveDeviceField:

    def _make_device(self, **kwargs) -> DeviceMaster:
        """Create a DeviceMaster instance with given attributes."""
        device = DeviceMaster()
        device.product_name = kwargs.get("product_name", "PROD-A")
        device.process = kwargs.get("process", "PHOTO")
        device.part_id = kwargs.get("part_id", "PART-001")
        device.line_id = kwargs.get("line_id", 1)
        return device

    def test_resolve_product_name(self):
        """Should resolve product_name field."""
        device = self._make_device(product_name="TEST-PROD")
        result = DeviceEnrichmentService._resolve_device_field(device, "product_name")
        assert result == "TEST-PROD"

    def test_resolve_process(self):
        """Should resolve process field."""
        device = self._make_device(process="ETCH")
        result = DeviceEnrichmentService._resolve_device_field(device, "process")
        assert result == "ETCH"

    def test_resolve_part_id(self):
        """Should resolve part_id field."""
        device = self._make_device(part_id="PID-99")
        result = DeviceEnrichmentService._resolve_device_field(device, "part_id")
        assert result == "PID-99"

    def test_resolve_line_id(self):
        """Should resolve line_id field."""
        device = self._make_device(line_id=42)
        result = DeviceEnrichmentService._resolve_device_field(device, "line_id")
        assert result == 42

    def test_resolve_none_part_id(self):
        """Should return None for nullable field."""
        device = self._make_device(part_id=None)
        result = DeviceEnrichmentService._resolve_device_field(device, "part_id")
        assert result is None

    def test_disallowed_field_raises(self):
        """Should raise ValueError for disallowed field names."""
        device = self._make_device()
        with pytest.raises(ValueError, match="Unsupported device field"):
            DeviceEnrichmentService._resolve_device_field(device, "enrichment")

    def test_disallowed_field_id(self):
        """Should reject 'id' field (not in allowed set)."""
        device = self._make_device()
        with pytest.raises(ValueError, match="Unsupported device field"):
            DeviceEnrichmentService._resolve_device_field(device, "id")

    def test_disallowed_field_arbitrary(self):
        """Should reject arbitrary field names."""
        device = self._make_device()
        with pytest.raises(ValueError, match="Unsupported device field"):
            DeviceEnrichmentService._resolve_device_field(device, "nonexistent_field")

    def test_error_lists_allowed_fields(self):
        """Error message should list allowed fields."""
        device = self._make_device()
        with pytest.raises(ValueError, match="product_name"):
            DeviceEnrichmentService._resolve_device_field(device, "bad_field")


# ---------------------------------------------------------------------------
# Tests: enrich_device (DB-level, mocked enrichment source queries)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestEnrichDevice:

    async def test_device_not_found_raises_404(self, db_session: AsyncSession):
        """Should raise HTTPException 404 when device does not exist."""
        with pytest.raises(HTTPException) as exc_info:
            await DeviceEnrichmentService.enrich_device(db_session, 99999)
        assert exc_info.value.status_code == 404
        assert "not found" in exc_info.value.detail

    async def test_no_meta_sources_returns_zero_processed(
        self, db_session: AsyncSession,
    ):
        """With no active meta sources, should return 0 sources_processed."""
        from app.models.line import Line

        # Create a line and device for testing
        line = Line(line_code="ENR-LINE", line_name="Enrichment Test Line")
        db_session.add(line)
        await db_session.flush()

        device = DeviceMaster(
            line_id=line.id,
            product_name="ENR-PROD",
            process="PHOTO",
            is_active=True,
            enrichment={},
        )
        db_session.add(device)
        await db_session.commit()

        result = await DeviceEnrichmentService.enrich_device(db_session, device.id)
        assert result.device_id == device.id
        assert result.sources_processed == 0
        assert result.fields_enriched == []
        assert result.errors == []

    async def test_meta_source_with_empty_join_keys_skipped(
        self, db_session: AsyncSession,
    ):
        """Meta source with empty join_keys should be skipped (returns None).

        _enrich_from_source returns None when join_keys is empty, but the source
        is still counted as 'processed' (no error raised). The key indicator is
        that fields_enriched remains empty and no errors are recorded.
        """
        from app.models.line import Line

        line = Line(line_code="ENR-LINE2", line_name="Enrichment Test Line 2")
        db_session.add(line)
        await db_session.flush()

        device = DeviceMaster(
            line_id=line.id,
            product_name="ENR-PROD2",
            process="PHOTO",
            is_active=True,
            enrichment={},
        )
        db_session.add(device)
        await db_session.flush()

        meta_src = DeviceMetaSource(
            source_name="empty_keys_source",
            table_name="some_table",
            schema_name="public",
            join_keys=[],  # empty
            column_mappings=[{"source_column": "grade", "target_field": "grade"}],
            is_active=True,
        )
        db_session.add(meta_src)
        await db_session.commit()

        result = await DeviceEnrichmentService.enrich_device(db_session, device.id)
        # _enrich_from_source returns None (no join_keys), but the source is still
        # counted as processed (no exception raised). Verify no data was enriched.
        assert result.fields_enriched == []
        assert result.errors == []

    async def test_meta_source_with_empty_column_mappings_skipped(
        self, db_session: AsyncSession,
    ):
        """Meta source with empty column_mappings should be skipped.

        _enrich_from_source returns None when column_mappings is empty, but the
        source is still counted as 'processed' (no error raised). The key
        indicator is that fields_enriched remains empty and no errors are recorded.
        """
        from app.models.line import Line

        line = Line(line_code="ENR-LINE3", line_name="Enrichment Test Line 3")
        db_session.add(line)
        await db_session.flush()

        device = DeviceMaster(
            line_id=line.id,
            product_name="ENR-PROD3",
            process="PHOTO",
            is_active=True,
            enrichment={},
        )
        db_session.add(device)
        await db_session.flush()

        meta_src = DeviceMetaSource(
            source_name="empty_mappings_source",
            table_name="some_table",
            schema_name="public",
            join_keys=[{"device_field": "product_name", "source_column": "prod_name"}],
            column_mappings=[],  # empty
            is_active=True,
        )
        db_session.add(meta_src)
        await db_session.commit()

        result = await DeviceEnrichmentService.enrich_device(db_session, device.id)
        # _enrich_from_source returns None (no column_mappings), but the source is
        # still counted as processed (no exception raised). Verify no data was enriched.
        assert result.fields_enriched == []
        assert result.errors == []

    async def test_inactive_meta_source_excluded(
        self, db_session: AsyncSession,
    ):
        """Inactive meta sources should not be processed."""
        from app.models.line import Line

        line = Line(line_code="ENR-LINE4", line_name="Enrichment Test Line 4")
        db_session.add(line)
        await db_session.flush()

        device = DeviceMaster(
            line_id=line.id,
            product_name="ENR-PROD4",
            process="PHOTO",
            is_active=True,
            enrichment={},
        )
        db_session.add(device)
        await db_session.flush()

        meta_src = DeviceMetaSource(
            source_name="inactive_source",
            table_name="some_table",
            schema_name="public",
            join_keys=[{"device_field": "product_name", "source_column": "prod_name"}],
            column_mappings=[{"source_column": "grade", "target_field": "grade"}],
            is_active=False,  # inactive
        )
        db_session.add(meta_src)
        await db_session.commit()

        result = await DeviceEnrichmentService.enrich_device(db_session, device.id)
        assert result.sources_processed == 0

    async def test_enrichment_error_isolated(
        self, db_session: AsyncSession,
    ):
        """Error in one meta source should be isolated and recorded, not propagated."""
        from app.models.line import Line

        line = Line(line_code="ENR-LINE5", line_name="Enrichment Test Line 5")
        db_session.add(line)
        await db_session.flush()

        device = DeviceMaster(
            line_id=line.id,
            product_name="ENR-PROD5",
            process="PHOTO",
            is_active=True,
            enrichment={},
        )
        db_session.add(device)
        await db_session.flush()

        # Active meta source that will fail due to invalid identifier
        meta_src = DeviceMetaSource(
            source_name="bad_source",
            table_name="some-table",  # invalid identifier (contains hyphen)
            schema_name="public",
            join_keys=[{"device_field": "product_name", "source_column": "prod_name"}],
            column_mappings=[{"source_column": "grade", "target_field": "grade"}],
            is_active=True,
        )
        db_session.add(meta_src)
        await db_session.commit()

        result = await DeviceEnrichmentService.enrich_device(db_session, device.id)
        # Error should be recorded, not raised
        assert len(result.errors) >= 1
        assert "bad_source" in result.errors[0]

    async def test_existing_enrichment_preserved(
        self, db_session: AsyncSession,
    ):
        """Existing enrichment data should be preserved for sources not updated."""
        from app.models.line import Line

        line = Line(line_code="ENR-LINE6", line_name="Enrichment Test Line 6")
        db_session.add(line)
        await db_session.flush()

        device = DeviceMaster(
            line_id=line.id,
            product_name="ENR-PROD6",
            process="PHOTO",
            is_active=True,
            enrichment={"existing_source": {"key": "value"}},
        )
        db_session.add(device)
        await db_session.commit()

        # No active meta sources, so existing enrichment should stay
        result = await DeviceEnrichmentService.enrich_device(db_session, device.id)
        await db_session.refresh(device)
        assert device.enrichment.get("existing_source") == {"key": "value"}


# ---------------------------------------------------------------------------
# Tests: enrich_all_devices (DB-level)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestEnrichAllDevices:

    async def test_no_active_devices_returns_empty(self, db_session: AsyncSession):
        """With no active devices, should return empty summary."""
        result = await DeviceEnrichmentService.enrich_all_devices(db_session)
        assert result.devices_enriched == 0
        assert result.total_errors == 0
        assert result.details == []

    async def test_processes_active_devices_only(self, db_session: AsyncSession):
        """Should only process active devices."""
        from app.models.line import Line

        line = Line(line_code="ENR-ALL-LINE", line_name="Enrich All Test Line")
        db_session.add(line)
        await db_session.flush()

        active_device = DeviceMaster(
            line_id=line.id,
            product_name="ACTIVE-PROD",
            process="PHOTO",
            is_active=True,
            enrichment={},
        )
        inactive_device = DeviceMaster(
            line_id=line.id,
            product_name="INACTIVE-PROD",
            process="PHOTO",
            is_active=False,
            enrichment={},
        )
        db_session.add_all([active_device, inactive_device])
        await db_session.commit()

        result = await DeviceEnrichmentService.enrich_all_devices(db_session)
        # Only the active device should appear in details
        device_ids = [d.device_id for d in result.details]
        assert active_device.id in device_ids
        assert inactive_device.id not in device_ids


# ---------------------------------------------------------------------------
# Tests: _enrich_from_source helper (logic paths)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestEnrichFromSource:

    async def test_invalid_table_identifier_raises(self):
        """Invalid table name should raise ValueError during identifier check."""
        device = DeviceMaster()
        device.product_name = "PROD"
        device.process = "PHOTO"
        device.line_id = 1

        meta_src = DeviceMetaSource()
        meta_src.table_name = "bad-table-name"
        meta_src.schema_name = "public"
        meta_src.join_keys = [{"device_field": "product_name", "source_column": "pn"}]
        meta_src.column_mappings = [{"source_column": "col1", "target_field": "field1"}]

        db = AsyncMock(spec=AsyncSession)
        with pytest.raises(ValueError, match="Invalid"):
            await DeviceEnrichmentService._enrich_from_source(db, device, meta_src)

    async def test_invalid_schema_identifier_raises(self):
        """Invalid schema name should raise ValueError."""
        device = DeviceMaster()
        device.product_name = "PROD"
        device.process = "PHOTO"
        device.line_id = 1

        meta_src = DeviceMetaSource()
        meta_src.table_name = "valid_table"
        meta_src.schema_name = "bad-schema"
        meta_src.join_keys = [{"device_field": "product_name", "source_column": "pn"}]
        meta_src.column_mappings = [{"source_column": "col1", "target_field": "field1"}]

        db = AsyncMock(spec=AsyncSession)
        with pytest.raises(ValueError, match="Invalid"):
            await DeviceEnrichmentService._enrich_from_source(db, device, meta_src)

    async def test_invalid_source_column_in_join_key_raises(self):
        """Invalid source_column in join_keys should raise ValueError."""
        device = DeviceMaster()
        device.product_name = "PROD"
        device.process = "PHOTO"
        device.line_id = 1

        meta_src = DeviceMetaSource()
        meta_src.table_name = "valid_table"
        meta_src.schema_name = "public"
        meta_src.join_keys = [
            {"device_field": "product_name", "source_column": "bad-column"},
        ]
        meta_src.column_mappings = [{"source_column": "col1", "target_field": "field1"}]

        db = AsyncMock(spec=AsyncSession)
        with pytest.raises(ValueError, match="Invalid"):
            await DeviceEnrichmentService._enrich_from_source(db, device, meta_src)

    async def test_invalid_source_column_in_mapping_raises(self):
        """Invalid source_column in column_mappings should raise ValueError."""
        device = DeviceMaster()
        device.product_name = "PROD"
        device.process = "PHOTO"
        device.line_id = 1

        meta_src = DeviceMetaSource()
        meta_src.table_name = "valid_table"
        meta_src.schema_name = "public"
        meta_src.join_keys = [
            {"device_field": "product_name", "source_column": "valid_col"},
        ]
        meta_src.column_mappings = [
            {"source_column": "bad;column", "target_field": "field1"},
        ]

        db = AsyncMock(spec=AsyncSession)
        with pytest.raises(ValueError, match="Invalid"):
            await DeviceEnrichmentService._enrich_from_source(db, device, meta_src)

    async def test_unsupported_device_field_in_join_key_raises(self):
        """Unsupported device_field in join_keys should raise ValueError."""
        device = DeviceMaster()
        device.product_name = "PROD"
        device.process = "PHOTO"
        device.line_id = 1

        meta_src = DeviceMetaSource()
        meta_src.table_name = "valid_table"
        meta_src.schema_name = "public"
        meta_src.join_keys = [
            {"device_field": "enrichment", "source_column": "valid_col"},
        ]
        meta_src.column_mappings = [{"source_column": "col1", "target_field": "field1"}]

        # Mock _validate_table_columns to pass (since SQLite has no information_schema)
        db = AsyncMock(spec=AsyncSession)
        with patch.object(
            DeviceEnrichmentService, "_validate_table_columns", new_callable=AsyncMock,
        ):
            with pytest.raises(ValueError, match="Unsupported device field"):
                await DeviceEnrichmentService._enrich_from_source(db, device, meta_src)
