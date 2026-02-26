"""Tests for SPEC-DEVICE-001 Pydantic schemas.

Covers:
- SyncSourceConfigCreate: required fields, validators, defaults
- SyncSourceConfigUpdate: optional fields
- DeviceMetaSourceCreate: required fields, validators, defaults
- DeviceMetaSourceUpdate: optional fields
- DeviceSyncResult: construction and optional enrichment_summary
- EnrichmentResult / EnrichmentSummary: construction
- ColumnInfo: construction
"""

import pytest
from pydantic import ValidationError

from app.schemas.device_master import (
    ColumnInfo,
    DeviceMasterResponse,
    DeviceMetaSourceCreate,
    DeviceMetaSourceResponse,
    DeviceMetaSourceUpdate,
    DeviceSyncResult,
    EnrichmentResult,
    EnrichmentSummary,
    LayerMasterResponse,
    SyncSourceConfigCreate,
    SyncSourceConfigResponse,
    SyncSourceConfigUpdate,
)


# ---------------------------------------------------------------------------
# SyncSourceConfigCreate
# ---------------------------------------------------------------------------


class TestSyncSourceConfigCreate:

    def test_valid_device_config(self):
        """Valid device sync source config should be accepted."""
        data = SyncSourceConfigCreate(
            source_type="device",
            source_name="MES-Device",
            table_name="mes_device_table",
            column_mappings=[
                {"source_column": "dev_name", "target_field": "product_name"},
            ],
        )
        assert data.source_type == "device"
        assert data.source_name == "MES-Device"
        assert data.schema_name == "public"  # default
        assert data.is_active is True  # default
        assert data.description is None  # default

    def test_valid_layer_config(self):
        """Valid layer sync source config should be accepted."""
        data = SyncSourceConfigCreate(
            source_type="layer",
            source_name="MES-Layer",
            table_name="mes_layer_table",
            schema_name="external",
            column_mappings=[
                {"source_column": "lyr_id", "target_field": "layer_id"},
            ],
            description="Layer sync from MES",
            is_active=False,
        )
        assert data.source_type == "layer"
        assert data.schema_name == "external"
        assert data.is_active is False
        assert data.description == "Layer sync from MES"

    def test_invalid_source_type_rejected(self):
        """source_type must be 'device' or 'layer'."""
        with pytest.raises(ValidationError) as exc_info:
            SyncSourceConfigCreate(
                source_type="invalid",
                source_name="test",
                table_name="test_table",
                column_mappings=[],
            )
        errors = exc_info.value.errors()
        assert any("source_type" in str(e) for e in errors)

    def test_empty_source_name_rejected(self):
        """source_name must not be empty or whitespace-only."""
        with pytest.raises(ValidationError) as exc_info:
            SyncSourceConfigCreate(
                source_type="device",
                source_name="   ",
                table_name="test_table",
                column_mappings=[],
            )
        errors = exc_info.value.errors()
        assert any("source_name" in str(e) for e in errors)

    def test_empty_table_name_rejected(self):
        """table_name must not be empty or whitespace-only."""
        with pytest.raises(ValidationError) as exc_info:
            SyncSourceConfigCreate(
                source_type="device",
                source_name="test",
                table_name="   ",
                column_mappings=[],
            )
        errors = exc_info.value.errors()
        assert any("table_name" in str(e) for e in errors)

    def test_missing_required_fields_rejected(self):
        """Missing required fields should raise ValidationError."""
        with pytest.raises(ValidationError):
            SyncSourceConfigCreate()  # type: ignore

    def test_source_name_stripped(self):
        """source_name should be stripped of whitespace."""
        data = SyncSourceConfigCreate(
            source_type="device",
            source_name="  MES-Source  ",
            table_name="test_table",
            column_mappings=[],
        )
        assert data.source_name == "MES-Source"

    def test_table_name_stripped(self):
        """table_name should be stripped of whitespace."""
        data = SyncSourceConfigCreate(
            source_type="device",
            source_name="MES-Source",
            table_name="  test_table  ",
            column_mappings=[],
        )
        assert data.table_name == "test_table"

    def test_empty_column_mappings_allowed(self):
        """An empty column_mappings list should be allowed."""
        data = SyncSourceConfigCreate(
            source_type="device",
            source_name="MES-Source",
            table_name="test_table",
            column_mappings=[],
        )
        assert data.column_mappings == []


# ---------------------------------------------------------------------------
# SyncSourceConfigUpdate
# ---------------------------------------------------------------------------


class TestSyncSourceConfigUpdate:

    def test_all_fields_optional(self):
        """All fields should be optional for partial update."""
        data = SyncSourceConfigUpdate()
        assert data.source_name is None
        assert data.table_name is None
        assert data.schema_name is None
        assert data.column_mappings is None
        assert data.description is None
        assert data.is_active is None

    def test_partial_update(self):
        """Only provided fields should be set."""
        data = SyncSourceConfigUpdate(
            source_name="Updated-Name",
            is_active=False,
        )
        assert data.source_name == "Updated-Name"
        assert data.is_active is False
        assert data.table_name is None


# ---------------------------------------------------------------------------
# DeviceMetaSourceCreate
# ---------------------------------------------------------------------------


class TestDeviceMetaSourceCreate:

    def test_valid_meta_source(self):
        """Valid device meta source config should be accepted."""
        data = DeviceMetaSourceCreate(
            source_name="ERP-Meta",
            table_name="erp_device_info",
            join_keys=[{"device_field": "product_name", "source_column": "prod_name"}],
            column_mappings=[{"source_column": "grade", "target_field": "grade"}],
        )
        assert data.source_name == "ERP-Meta"
        assert data.schema_name == "public"
        assert data.is_active is True
        assert data.description is None

    def test_empty_source_name_rejected(self):
        """source_name must not be empty."""
        with pytest.raises(ValidationError):
            DeviceMetaSourceCreate(
                source_name="   ",
                table_name="test_table",
                join_keys=[],
                column_mappings=[],
            )

    def test_empty_table_name_rejected(self):
        """table_name must not be empty."""
        with pytest.raises(ValidationError):
            DeviceMetaSourceCreate(
                source_name="test",
                table_name="   ",
                join_keys=[],
                column_mappings=[],
            )

    def test_missing_required_fields_rejected(self):
        """Missing join_keys or column_mappings should raise ValidationError."""
        with pytest.raises(ValidationError):
            DeviceMetaSourceCreate(
                source_name="test",
                table_name="test_table",
            )  # type: ignore

    def test_custom_schema_and_description(self):
        """Custom schema_name and description should be accepted."""
        data = DeviceMetaSourceCreate(
            source_name="Custom-Meta",
            table_name="custom_table",
            schema_name="erp_schema",
            join_keys=[],
            column_mappings=[],
            description="ERP meta source",
            is_active=False,
        )
        assert data.schema_name == "erp_schema"
        assert data.description == "ERP meta source"
        assert data.is_active is False


# ---------------------------------------------------------------------------
# DeviceMetaSourceUpdate
# ---------------------------------------------------------------------------


class TestDeviceMetaSourceUpdate:

    def test_all_fields_optional(self):
        """All fields should be optional for partial update."""
        data = DeviceMetaSourceUpdate()
        assert data.source_name is None
        assert data.table_name is None
        assert data.join_keys is None
        assert data.column_mappings is None

    def test_partial_update(self):
        """Only provided fields should be set."""
        data = DeviceMetaSourceUpdate(
            source_name="Updated-Meta",
            is_active=False,
        )
        assert data.source_name == "Updated-Meta"
        assert data.is_active is False
        assert data.table_name is None


# ---------------------------------------------------------------------------
# DeviceSyncResult
# ---------------------------------------------------------------------------


class TestDeviceSyncResult:

    def test_basic_result(self):
        """DeviceSyncResult should accept all required fields."""
        result = DeviceSyncResult(
            total_processed=100,
            inserted=80,
            updated=15,
            unchanged=5,
            errors=[],
        )
        assert result.total_processed == 100
        assert result.inserted == 80
        assert result.enrichment_summary is None

    def test_result_with_errors(self):
        """DeviceSyncResult should accept error list."""
        result = DeviceSyncResult(
            total_processed=50,
            inserted=40,
            updated=0,
            unchanged=0,
            errors=["Row skipped: line_code not found", "Row skipped: empty process"],
        )
        assert len(result.errors) == 2

    def test_result_with_enrichment_summary(self):
        """DeviceSyncResult should accept optional enrichment_summary."""
        summary = EnrichmentSummary(
            devices_enriched=10,
            total_errors=0,
            details=[],
        )
        result = DeviceSyncResult(
            total_processed=10,
            inserted=10,
            updated=0,
            unchanged=0,
            errors=[],
            enrichment_summary=summary,
        )
        assert result.enrichment_summary is not None
        assert result.enrichment_summary.devices_enriched == 10


# ---------------------------------------------------------------------------
# EnrichmentResult / EnrichmentSummary
# ---------------------------------------------------------------------------


class TestEnrichmentResult:

    def test_basic_result(self):
        """EnrichmentResult should accept all required fields."""
        result = EnrichmentResult(
            device_id=1,
            product_name="PRODUCT-A",
            sources_processed=2,
            fields_enriched=["grade", "technology"],
            errors=[],
        )
        assert result.device_id == 1
        assert result.product_name == "PRODUCT-A"
        assert len(result.fields_enriched) == 2

    def test_result_with_errors(self):
        """EnrichmentResult should accept error messages."""
        result = EnrichmentResult(
            device_id=1,
            product_name="PRODUCT-A",
            sources_processed=1,
            fields_enriched=[],
            errors=["Enrichment failed for source 'ERP': table not found"],
        )
        assert len(result.errors) == 1


class TestEnrichmentSummary:

    def test_basic_summary(self):
        """EnrichmentSummary should accept required fields."""
        summary = EnrichmentSummary(
            devices_enriched=5,
            total_errors=1,
            details=[
                EnrichmentResult(
                    device_id=1,
                    product_name="A",
                    sources_processed=1,
                    fields_enriched=["grade"],
                    errors=[],
                ),
            ],
        )
        assert summary.devices_enriched == 5
        assert len(summary.details) == 1

    def test_empty_summary(self):
        """Empty summary with no devices should work."""
        summary = EnrichmentSummary(
            devices_enriched=0,
            total_errors=0,
            details=[],
        )
        assert summary.devices_enriched == 0
        assert summary.details == []


# ---------------------------------------------------------------------------
# ColumnInfo
# ---------------------------------------------------------------------------


class TestColumnInfo:

    def test_basic_column_info(self):
        """ColumnInfo should store column_name and data_type."""
        info = ColumnInfo(column_name="product_name", data_type="character varying")
        assert info.column_name == "product_name"
        assert info.data_type == "character varying"


# ---------------------------------------------------------------------------
# Response schemas (from_attributes)
# ---------------------------------------------------------------------------


class TestSyncSourceConfigResponse:

    def test_construction(self):
        """SyncSourceConfigResponse should accept all fields."""
        from datetime import datetime, timezone

        now = datetime.now(timezone.utc)
        resp = SyncSourceConfigResponse(
            id=1,
            source_type="device",
            source_name="MES",
            table_name="mes_table",
            schema_name="public",
            column_mappings=[{"source_column": "name", "target_field": "product_name"}],
            description=None,
            is_active=True,
            created_at=now,
            updated_at=now,
        )
        assert resp.id == 1
        assert resp.source_type == "device"


class TestDeviceMetaSourceResponse:

    def test_construction(self):
        """DeviceMetaSourceResponse should accept all fields."""
        from datetime import datetime, timezone

        now = datetime.now(timezone.utc)
        resp = DeviceMetaSourceResponse(
            id=1,
            source_name="ERP-Meta",
            table_name="erp_table",
            schema_name="public",
            join_keys=[{"device_field": "product_name", "source_column": "prod_name"}],
            column_mappings=[{"source_column": "grade", "target_field": "grade"}],
            description="ERP metadata",
            is_active=True,
            created_at=now,
            updated_at=now,
        )
        assert resp.id == 1
        assert resp.source_name == "ERP-Meta"


class TestDeviceMasterResponse:

    def test_construction(self):
        """DeviceMasterResponse should accept all fields including enrichment dict."""
        from datetime import datetime, timezone

        now = datetime.now(timezone.utc)
        resp = DeviceMasterResponse(
            id=1,
            line_id=1,
            line_name="LINE-A",
            product_name="PROD-A",
            process="PHOTO",
            part_id="PART-001",
            is_active=True,
            enrichment={"erp": {"grade": "A"}},
            synced_at=now,
            created_at=now,
            updated_at=now,
        )
        assert resp.enrichment == {"erp": {"grade": "A"}}
        assert resp.line_name == "LINE-A"


class TestLayerMasterResponse:

    def test_construction(self):
        """LayerMasterResponse should accept all fields."""
        from datetime import datetime, timezone

        now = datetime.now(timezone.utc)
        resp = LayerMasterResponse(
            id=1,
            device_master_id=1,
            layer_id="L01",
            step_seq="ts100000",
            descript="First layer",
            synced_at=now,
            created_at=now,
        )
        assert resp.layer_id == "L01"
        assert resp.device_master_id == 1
