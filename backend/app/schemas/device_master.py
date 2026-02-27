"""Pydantic v2 schemas for Device Master, Layer Master, Sync/Enrichment configuration.

SPEC-DEVICE-001 M1: 디바이스/레이어 마스터 + 동기화/enrichment 설정 스키마.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, field_validator


# ---------------------------------------------------------------------------
# Device Master
# ---------------------------------------------------------------------------


class DeviceMasterResponse(BaseModel):
    """디바이스 마스터 단건 응답."""

    id: int
    line_id: int
    line_name: str  # lines 테이블 JOIN 해소
    product_name: str
    process: str
    part_id: str | None
    is_active: bool
    enrichment: dict
    synced_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DeviceMasterListResponse(BaseModel):
    """디바이스 마스터 페이지네이션 응답."""

    items: list[DeviceMasterResponse]
    total: int
    page: int
    size: int


# ---------------------------------------------------------------------------
# Layer Master
# ---------------------------------------------------------------------------


class LayerMasterResponse(BaseModel):
    """레이어 마스터 단건 응답."""

    id: int
    device_master_id: int
    layer_id: str
    step_seq: str | None
    descript: str | None
    synced_at: datetime | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Sync Source Config
# ---------------------------------------------------------------------------


class SyncSourceConfigCreate(BaseModel):
    """동기화 소스 설정 생성 요청."""

    source_type: Literal["device", "layer"]
    source_name: str
    table_name: str
    schema_name: str = "public"
    column_mappings: list[dict]
    description: str | None = None
    is_active: bool = True

    @field_validator("source_name")
    @classmethod
    def source_name_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("source_name must not be empty")
        return v

    @field_validator("table_name")
    @classmethod
    def table_name_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("table_name must not be empty")
        return v


class SyncSourceConfigUpdate(BaseModel):
    """동기화 소스 설정 부분 수정 요청."""

    source_name: str | None = None
    table_name: str | None = None
    schema_name: str | None = None
    column_mappings: list[dict] | None = None
    description: str | None = None
    is_active: bool | None = None


class SyncSourceConfigResponse(BaseModel):
    """동기화 소스 설정 응답."""

    id: int
    source_type: str
    source_name: str
    table_name: str
    schema_name: str
    column_mappings: list[dict]
    description: str | None
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Device Meta Source
# ---------------------------------------------------------------------------


class DeviceMetaSourceCreate(BaseModel):
    """디바이스 enrichment 메타 소스 생성 요청."""

    source_name: str
    table_name: str
    schema_name: str = "public"
    join_keys: list[dict]  # [{device_field, source_column}]
    column_mappings: list[dict]  # [{source_column, target_field}]
    description: str | None = None
    is_active: bool = True

    @field_validator("source_name")
    @classmethod
    def source_name_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("source_name must not be empty")
        return v

    @field_validator("table_name")
    @classmethod
    def table_name_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("table_name must not be empty")
        return v


class DeviceMetaSourceUpdate(BaseModel):
    """디바이스 enrichment 메타 소스 부분 수정 요청."""

    source_name: str | None = None
    table_name: str | None = None
    schema_name: str | None = None
    join_keys: list[dict] | None = None
    column_mappings: list[dict] | None = None
    description: str | None = None
    is_active: bool | None = None


class DeviceMetaSourceResponse(BaseModel):
    """디바이스 enrichment 메타 소스 응답."""

    id: int
    source_name: str
    table_name: str
    schema_name: str
    join_keys: list[dict]
    column_mappings: list[dict]
    description: str | None
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Sync Result
# ---------------------------------------------------------------------------


class DeviceSyncResult(BaseModel):
    """동기화 실행 결과."""

    total_processed: int
    inserted: int
    updated: int
    unchanged: int
    errors: list[str]
    enrichment_summary: EnrichmentSummary | None = None


# ---------------------------------------------------------------------------
# Enrichment
# ---------------------------------------------------------------------------


class EnrichmentResult(BaseModel):
    """단일 디바이스의 enrichment 결과."""

    device_id: int
    product_name: str
    sources_processed: int
    fields_enriched: list[str]
    errors: list[str]


class EnrichmentSummary(BaseModel):
    """전체 enrichment 요약."""

    devices_enriched: int
    total_errors: int
    details: list[EnrichmentResult]


# ---------------------------------------------------------------------------
# Column Discovery
# ---------------------------------------------------------------------------


class ColumnInfo(BaseModel):
    """information_schema에서 발견된 컬럼 정보."""

    column_name: str
    data_type: str


# ---------------------------------------------------------------------------
# Project Creation (SPEC-PROJECT-002)
# ---------------------------------------------------------------------------


class DeviceSearchResult(BaseModel):
    """Search result from device_master."""

    id: int
    line_id: int
    product_name: str
    process: str
    part_id: str | None
    is_active: bool
    enrichment: dict  # JSONB from device_master.enrichment

    model_config = ConfigDict(from_attributes=True)


class DeviceLayerItem(BaseModel):
    """Layer from layer_master for a device."""

    id: int  # layer_master PK
    layer_id: str  # VARCHAR(10): "1.0", "1.21", "17.31"
    step_seq: str | None
    descript: str | None

    model_config = ConfigDict(from_attributes=True)


class DuplicateCheckResponse(BaseModel):
    """Result of duplicate project check."""

    exists: bool
    existing_project_id: int | None = None
    existing_project_status: str | None = None
    existing_project_revision: int | None = None


# Pydantic v2 모델 재빌드 (forward reference 해소)
DeviceSyncResult.model_rebuild()
