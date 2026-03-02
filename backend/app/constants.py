"""
Domain constants for the PCM application.

Single source of truth for all business-domain enumerations and rules.

PCM 애플리케이션의 도메인 상수 모음.
비즈니스 규칙에서 사용하는 모든 열거형과 규칙의 단일 진실 공급원(Single Source of Truth).
새로운 상수를 추가하거나 기존 값을 변경할 때 이 파일만 수정하면 된다.
"""

# --- 사용자 역할 ---
# editor: 공정조건표 편집 (본인 프로젝트), reviewer: 검토/승인/반려,
# admin: 전체 시스템 관리, developer: 시스템 설정(컬럼/매핑/출력) 관리
VALID_ROLES = frozenset({"editor", "reviewer", "admin", "developer"})

# --- 검증 규칙 타입 ---
# range: 숫자 범위 검증 (min/max), required: 필수 입력,
# conditional_required: 조건부 필수 (다른 컬럼 값에 따라 필수 여부 결정),
# cross_layer: 레이어 간 교차 검증 (참조 레이어 존재 여부, 값 비교 등)
ALLOWED_RULE_TYPES = ("range", "required", "conditional_required", "cross_layer")

# 값 변환 함수 타입: DB에서 읽은 문자열을 적절한 타입으로 변환할 때 사용
ALLOWED_VALUE_TRANSFORMS = ("to_int", "to_float", "yn_to_bool")

# --- 프로젝트 상태 워크플로우 ---
# 프로젝트가 가질 수 있는 모든 상태 목록
# draft(초안) → review(검토중) → approved(승인) → archived(보관)
# rejected(반려)는 다시 draft로 되돌릴 수 있음
PROJECT_STATUSES = ("draft", "review", "approved", "rejected", "archived")

# 상태 전환 규칙: 각 상태에서 이동 가능한 다음 상태를 정의
# 이 규칙을 벗어나는 전환은 서버에서 거부됨
# draft → review: 검증 오류가 0건일 때만 가능
# approved → archived: 개정(Revision) 생성 시 기존 버전이 자동으로 전환됨
VALID_STATUS_TRANSITIONS: dict[str, list[str]] = {
    "draft": ["review"],
    "review": ["approved", "rejected"],
    "approved": ["archived"],
    "rejected": ["draft"],
}

# --- 컬럼 카테고리 코드 ---
# SP: Spin/PR (포토레지스트 도포), SC: Scanner/Expose (노광),
# OVL: Overlay (정렬), DEV: Develop (현상)
# 조건표의 ~350개 컬럼이 이 4개 카테고리로 분류됨
CATEGORY_CODES = ("SP", "SC", "OVL", "DEV")

# --- 전산 출력 포맷 타입 ---
# TYPE_A: 수평 포맷 (레이어별 행, 컬럼별 열)
# TYPE_B: 설비 분할 포맷 (설비별로 시트 분리)
# TYPE_C: 키-값 전치 포맷 (컬럼명이 행, 레이어가 열)
EXPORT_FORMAT_TYPES = ("TYPE_A", "TYPE_B", "TYPE_C")

# --- 공지사항 카테고리 ---
# bug_fix: 버그 수정, new_feature: 신규 기능, rule_change: 규칙 변경, general: 일반
ANNOUNCEMENT_CATEGORIES = ("bug_fix", "new_feature", "rule_change", "general")

# --- 공지사항 우선순위 ---
# normal: 일반, important: 중요, critical: 긴급
ANNOUNCEMENT_PRIORITIES = ("normal", "important", "critical")

# --- 설정 변경 합의(Config Change Consensus) ---
# 변경 유형: column_add(컬럼 추가), column_modify(컬럼 수정), validation_change(검증 규칙 변경)
CONFIG_CHANGE_TYPES = ("column_add", "column_modify", "validation_change")

# 요청 상태: pending(대기) → approved(승인) / rejected(반려) → in_progress(진행중) → completed(완료)
# cancelled(취소)는 pending 상태에서만 가능
CONFIG_CHANGE_STATUSES = ("pending", "approved", "rejected", "in_progress", "completed", "cancelled")

# 상태 전환 규칙: 각 상태에서 이동 가능한 다음 상태를 정의
VALID_CONFIG_CHANGE_TRANSITIONS: dict[str, list[str]] = {
    "pending": ["approved", "rejected", "cancelled"],
    "approved": ["in_progress"],
    "in_progress": ["completed"],
}
