"""Device Master / Layer Master ORM models + Sync/Enrichment configuration tables.

SPEC-DEVICE-001 M1:
- DeviceMaster: MES/ERP 등 외부 소스에서 동기화되는 디바이스(제품) 마스터
- LayerMaster: DeviceMaster에 종속되는 레이어 마스터
- SyncSourceConfig: 동기화 소스 테이블/컬럼 매핑 설정
- DeviceMetaSource: 디바이스 enrichment용 외부 메타 소스 설정
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class DeviceMaster(Base):
    """외부 소스에서 동기화되는 디바이스(제품) 마스터 레코드."""

    __tablename__ = "device_master"
    __table_args__ = (
        UniqueConstraint("line_id", "product_name", "process", "part_id", name="uq_device_master_line_product_process_part"),
        Index("idx_device_master_line_id", "line_id"),
        Index("idx_device_master_product_name", "product_name"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    line_id: Mapped[int] = mapped_column(
        ForeignKey("lines.id", ondelete="RESTRICT"), nullable=False,
    )
    product_name: Mapped[str] = mapped_column(String(100), nullable=False)
    process: Mapped[str] = mapped_column(String(50), nullable=False)
    part_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    enrichment: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )

    # Relationships
    line: Mapped["Line"] = relationship()  # noqa: F821
    layers: Mapped[list["LayerMaster"]] = relationship(back_populates="device")


class LayerMaster(Base):
    """DeviceMaster에 종속되는 레이어 마스터 레코드."""

    __tablename__ = "layer_master"
    __table_args__ = (
        UniqueConstraint(
            "device_master_id", "layer_id", name="uq_layer_master_device_layer",
        ),
        Index("idx_layer_master_device_id", "device_master_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    device_master_id: Mapped[int] = mapped_column(
        ForeignKey("device_master.id", ondelete="RESTRICT"), nullable=False,
    )
    layer_id: Mapped[str] = mapped_column(String(10), nullable=False)
    step_seq: Mapped[str | None] = mapped_column(String(20), nullable=True)
    descript: Mapped[str | None] = mapped_column(String(200), nullable=True)
    synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )

    # Relationships
    device: Mapped["DeviceMaster"] = relationship(back_populates="layers")


class SyncSourceConfig(Base):
    """동기화 소스 테이블/컬럼 매핑 설정.

    source_type: 'device' 또는 'layer' (어떤 마스터를 대상으로 하는지)
    column_mappings: [{source_column, target_field}, ...] 형태의 매핑 목록
    """

    __tablename__ = "sync_source_config"
    __table_args__ = (
        UniqueConstraint("source_type", "source_name", name="uq_sync_source_type_name"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    source_type: Mapped[str] = mapped_column(String(20), nullable=False)
    source_name: Mapped[str] = mapped_column(String(100), nullable=False)
    table_name: Mapped[str] = mapped_column(String(200), nullable=False)
    schema_name: Mapped[str] = mapped_column(String(50), nullable=False, server_default="public")
    column_mappings: Mapped[list] = mapped_column(JSONB, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )


class DeviceMetaSource(Base):
    """디바이스 enrichment용 외부 메타 소스 설정.

    join_keys: [{device_field, source_column}, ...] 형태로 JOIN 조건 정의
    column_mappings: [{source_column, target_field}, ...] 형태로 결과 매핑 정의
    enrichment 결과는 DeviceMaster.enrichment[source_name] JSONB에 저장
    """

    __tablename__ = "device_meta_source"

    id: Mapped[int] = mapped_column(primary_key=True)
    source_name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    table_name: Mapped[str] = mapped_column(String(200), nullable=False)
    schema_name: Mapped[str] = mapped_column(String(50), nullable=False, server_default="public")
    join_keys: Mapped[list] = mapped_column(JSONB, nullable=False)
    column_mappings: Mapped[list] = mapped_column(JSONB, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )
