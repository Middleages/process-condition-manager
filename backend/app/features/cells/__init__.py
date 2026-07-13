"""셀 편집 저장 수직 슬라이스 (P2-T3).

조건표 그리드의 더티 셀 배치를 단일 트랜잭션으로 UPSERT하고, 실제 변경분만
셀 단위 change_event(cell_update)로 남긴다. 잠금 검사(require_edit_lock)와
시간/판정 헬퍼는 app.core.locks 공용 경계에 있고, 이 슬라이스는 그 위에
편집 저장 API 하나만 얹는다.
"""
