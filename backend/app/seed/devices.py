"""디바이스 마스터 시드 데이터.

동기화 테스트용 외부 소스 테이블(ext_device_source, ext_layer_source)과
device_master / layer_master / sync_source_config / device_meta_source를 생성한다.
"""
import json
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session


# ---------------------------------------------------------------------------
# 외부 소스 테이블 mock 데이터 (동기화 원본 역할)
# ---------------------------------------------------------------------------

# ext_device_source: 동기화 서비스가 참조할 외부 디바이스 테이블
EXT_DEVICE_ROWS = [
    # (line_code, product_name, process, part_id)
    ("LINE-A", "PROD-2024X", "PHOTO", "PROD-2024X"),
    ("LINE-A", "PROD-2024X", "ETCH", "PROD-2024X"),
    ("LINE-A", "PROD-2024Z", "PHOTO", "PROD-2024Z"),
    ("LINE-A", "MCU-AUTO-V2", "PHOTO", "MCU-AUTO-V2"),
    ("LINE-B", "PROD-2024Y", "PHOTO", "PROD-2024Y"),
    ("LINE-B", "PROD-2024Y", "ETCH", "PROD-2024Y"),
    ("LINE-B", "HBM-3E-MEM", "PHOTO", "HBM-3E-MEM"),
    ("LINE-B", "HBM-3E-MEM", "CMP", "HBM-3E-MEM"),
]

# ext_layer_source: 동기화 서비스가 참조할 외부 레이어 테이블
EXT_LAYER_ROWS = [
    # (line_code, product_name, layer_id, step_seq, descript)
    ("LINE-A", "PROD-2024X", "L01", "1-1", "Active Area Definition"),
    ("LINE-A", "PROD-2024X", "L02", "1-2", "Gate Patterning"),
    ("LINE-A", "PROD-2024X", "L03", "1-3", "Contact Hole"),
    ("LINE-A", "PROD-2024X", "L04", "2-1", "Metal 1 Layer"),
    ("LINE-A", "PROD-2024Z", "L01", "1-1", "Active Area"),
    ("LINE-A", "PROD-2024Z", "L02", "1-2", "Gate Pattern"),
    ("LINE-B", "PROD-2024Y", "L01", "1-1", "Active Area (ArF)"),
    ("LINE-B", "PROD-2024Y", "L02", "1-2", "Gate (ArF Immersion)"),
    ("LINE-B", "PROD-2024Y", "L03", "2-1", "Via 1"),
    ("LINE-B", "HBM-3E-MEM", "L01", "1-1", "Capacitor Layer"),
    ("LINE-B", "HBM-3E-MEM", "L02", "1-2", "TSV Pattern"),
]

# ext_device_meta: enrichment용 외부 메타 테이블
EXT_DEVICE_META_ROWS = [
    # (product_name, part_id, technology_node, wafer_size, fab_location)
    ("PROD-2024X", "PROD-2024X", "28nm", "300mm", "FAB-A"),
    ("PROD-2024Y", "PROD-2024Y", "14nm", "300mm", "FAB-B"),
    ("PROD-2024Z", "PROD-2024Z", "28nm", "300mm", "FAB-A"),
    ("MCU-AUTO-V2", "MCU-AUTO-V2", "28nm", "300mm", "FAB-A"),
    ("HBM-3E-MEM", "HBM-3E-MEM", "7nm", "300mm", "FAB-B"),
]


def seed_device_masters(session: Session, line_ids: dict[str, int]) -> None:
    """디바이스 마스터 관련 시드 데이터를 삽입한다.

    Args:
        session: SQLAlchemy 세션.
        line_ids: line_code -> line.id 매핑 (runner.py에서 전달).
    """
    # 이미 시드된 경우 스킵
    result = session.execute(text("SELECT count(*) FROM sync_source_config"))
    if result.scalar() > 0:
        print("  Device master data already seeded. Skipping.")
        return

    # ------------------------------------------------------------------
    # 1. 외부 소스 테이블 생성 (동기화가 참조할 mock 테이블)
    # ------------------------------------------------------------------

    # ext_device_source
    session.execute(text("""
        CREATE TABLE IF NOT EXISTS ext_device_source (
            id           SERIAL PRIMARY KEY,
            line_code    VARCHAR(20) NOT NULL,
            product_name VARCHAR(100) NOT NULL,
            process      VARCHAR(50) NOT NULL,
            part_id      VARCHAR(100)
        )
    """))
    session.execute(text("DELETE FROM ext_device_source"))
    for row in EXT_DEVICE_ROWS:
        session.execute(
            text(
                "INSERT INTO ext_device_source (line_code, product_name, process, part_id) "
                "VALUES (:lc, :pn, :proc, :pid)"
            ),
            {"lc": row[0], "pn": row[1], "proc": row[2], "pid": row[3]},
        )

    # ext_layer_source
    session.execute(text("""
        CREATE TABLE IF NOT EXISTS ext_layer_source (
            id           SERIAL PRIMARY KEY,
            line_code    VARCHAR(20) NOT NULL,
            product_name VARCHAR(100) NOT NULL,
            layer_id     VARCHAR(10) NOT NULL,
            step_seq     VARCHAR(20),
            descript     VARCHAR(200)
        )
    """))
    session.execute(text("DELETE FROM ext_layer_source"))
    for row in EXT_LAYER_ROWS:
        session.execute(
            text(
                "INSERT INTO ext_layer_source (line_code, product_name, layer_id, step_seq, descript) "
                "VALUES (:lc, :pn, :lid, :sseq, :desc)"
            ),
            {"lc": row[0], "pn": row[1], "lid": row[2], "sseq": row[3], "desc": row[4]},
        )

    # ext_device_meta (enrichment용)
    session.execute(text("""
        CREATE TABLE IF NOT EXISTS ext_device_meta (
            id              SERIAL PRIMARY KEY,
            product_name    VARCHAR(100) NOT NULL,
            part_id         VARCHAR(100),
            technology_node VARCHAR(20),
            wafer_size      VARCHAR(20),
            fab_location    VARCHAR(50)
        )
    """))
    session.execute(text("DELETE FROM ext_device_meta"))
    for row in EXT_DEVICE_META_ROWS:
        session.execute(
            text(
                "INSERT INTO ext_device_meta (product_name, part_id, technology_node, wafer_size, fab_location) "
                "VALUES (:pn, :pid, :tn, :ws, :fl)"
            ),
            {"pn": row[0], "pid": row[1], "tn": row[2], "ws": row[3], "fl": row[4]},
        )

    print(f"  External source tables: ext_device_source({len(EXT_DEVICE_ROWS)}), "
          f"ext_layer_source({len(EXT_LAYER_ROWS)}), ext_device_meta({len(EXT_DEVICE_META_ROWS)})")

    # ------------------------------------------------------------------
    # 2. sync_source_config (동기화 설정)
    # ------------------------------------------------------------------

    device_sync_config = {
        "source_type": "device",
        "source_name": "MES-Device-Master",
        "table_name": "ext_device_source",
        "schema_name": "public",
        "column_mappings": json.dumps([
            {"source_column": "line_code", "target_field": "line_code"},
            {"source_column": "product_name", "target_field": "product_name"},
            {"source_column": "process", "target_field": "process"},
            {"source_column": "part_id", "target_field": "part_id"},
        ]),
        "description": "MES 디바이스 마스터 동기화 소스",
        "is_active": True,
    }

    layer_sync_config = {
        "source_type": "layer",
        "source_name": "MES-Layer-Master",
        "table_name": "ext_layer_source",
        "schema_name": "public",
        "column_mappings": json.dumps([
            {"source_column": "line_code", "target_field": "line_code"},
            {"source_column": "product_name", "target_field": "product_name"},
            {"source_column": "layer_id", "target_field": "layer_id"},
            {"source_column": "step_seq", "target_field": "step_seq"},
            {"source_column": "descript", "target_field": "descript"},
        ]),
        "description": "MES 레이어 마스터 동기화 소스",
        "is_active": True,
    }

    for config in [device_sync_config, layer_sync_config]:
        session.execute(
            text(
                "INSERT INTO sync_source_config "
                "(source_type, source_name, table_name, schema_name, column_mappings, description, is_active) "
                "VALUES (:source_type, :source_name, :table_name, :schema_name, "
                "CAST(:column_mappings AS jsonb), :description, :is_active)"
            ),
            config,
        )
    print("  Sync Source Configs: 2 (device + layer)")

    # ------------------------------------------------------------------
    # 3. device_master (직접 삽입 - 동기화 결과와 동일한 상태)
    # ------------------------------------------------------------------

    now = datetime.now(timezone.utc)
    device_ids: dict[tuple[str, str, str], int] = {}  # (line_code, product_name, process) -> id

    for row in EXT_DEVICE_ROWS:
        line_code, product_name, process, part_id = row
        line_id = line_ids.get(line_code)
        if line_id is None:
            continue
        session.execute(
            text(
                "INSERT INTO device_master (line_id, product_name, process, part_id, is_active, synced_at) "
                "VALUES (:lid, :pn, :proc, :pid, TRUE, :synced) "
                "ON CONFLICT ON CONSTRAINT uq_device_master_line_product_process_part DO NOTHING"
            ),
            {"lid": line_id, "pn": product_name, "proc": process, "pid": part_id, "synced": now},
        )
        result = session.execute(
            text(
                "SELECT id FROM device_master WHERE line_id = :lid AND product_name = :pn AND process = :proc"
            ),
            {"lid": line_id, "pn": product_name, "proc": process},
        )
        dm_id = result.scalar()
        if dm_id:
            device_ids[(line_code, product_name, process)] = dm_id

    print(f"  Device Masters: {len(device_ids)}")

    # ------------------------------------------------------------------
    # 4. layer_master (직접 삽입)
    # ------------------------------------------------------------------

    layer_count = 0
    for row in EXT_LAYER_ROWS:
        line_code, product_name, layer_id, step_seq, descript = row
        # device_master에서 PHOTO 공정 기준으로 매칭
        dm_key = (line_code, product_name, "PHOTO")
        dm_id = device_ids.get(dm_key)
        if dm_id is None:
            continue
        session.execute(
            text(
                "INSERT INTO layer_master (device_master_id, layer_id, step_seq, descript, synced_at) "
                "VALUES (:dmid, :lid, :sseq, :desc, :synced) "
                "ON CONFLICT ON CONSTRAINT uq_layer_master_device_layer DO NOTHING"
            ),
            {"dmid": dm_id, "lid": layer_id, "sseq": step_seq, "desc": descript, "synced": now},
        )
        layer_count += 1
    print(f"  Layer Masters: {layer_count}")

    # ------------------------------------------------------------------
    # 5. device_meta_source (enrichment 설정)
    # ------------------------------------------------------------------

    meta_source = {
        "source_name": "Device-Tech-Info",
        "table_name": "ext_device_meta",
        "schema_name": "public",
        "join_keys": json.dumps([
            {"device_field": "product_name", "source_column": "product_name"},
        ]),
        "column_mappings": json.dumps([
            {"source_column": "technology_node", "target_field": "technology_node"},
            {"source_column": "wafer_size", "target_field": "wafer_size"},
            {"source_column": "fab_location", "target_field": "fab_location"},
        ]),
        "description": "디바이스 기술 노드/웨이퍼 사이즈/팹 위치 메타 정보",
        "is_active": True,
    }

    session.execute(
        text(
            "INSERT INTO device_meta_source "
            "(source_name, table_name, schema_name, join_keys, column_mappings, description, is_active) "
            "VALUES (:source_name, :table_name, :schema_name, "
            "CAST(:join_keys AS jsonb), CAST(:column_mappings AS jsonb), :description, :is_active)"
        ),
        meta_source,
    )
    print("  Device Meta Sources: 1 (Device-Tech-Info)")
