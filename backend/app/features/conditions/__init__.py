"""조건 행 관리 + POR 선택 수직 슬라이스 (P2-T7 / D-16).

같은 layer/step에 여러 조건 행(layer_condition)이 있을 수 있고, POR(Process of
Record)은 layer당 최대 1개다(partial unique index가 DB 레벨에서 강제).
이 슬라이스는 조건 행 추가/복제(POST), 하드 삭제(DELETE), POR 이양(PUT)의
세 편집 API만 얹는다. 잠금 검사(require_edit_lock)와 시간 헬퍼는 app.core.locks
공용 경계에 있고, 조건 행 소속 확인 쿼리는 features/ 간 결합을 피하려고 cells
슬라이스를 import하지 않고 이 슬라이스 안에 따로 둔다.
"""
