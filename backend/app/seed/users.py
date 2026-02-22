"""User definitions for seed data.

사용자 시드 데이터.
시스템 초기 구동 시 생성되는 기본 사용자 계정 목록.
비밀번호는 runner.py에서 bcrypt로 해싱하여 저장됨 (기본 비밀번호: 'password123').
"""

# ---------------------------------------------------------------------------
# 3. 사용자 계정
# ---------------------------------------------------------------------------
# role(역할)에 따른 권한:
#   admin    - 전체 시스템 관리 (사용자 관리, 마스터 데이터, 설정 등)
#   editor   - 공정조건표 편집 (본인이 생성한 프로젝트만)
#   reviewer - 조건표 검토/승인/반려 (Review 상태 프로젝트에 대해)
# 새로운 사용자를 추가하려면 이 리스트에 딕셔너리를 추가

USERS = [
    {"username": "admin1", "display_name": "\uad00\ub9ac\uc790", "role": "admin", "email": "admin@pcm.local"},
    {"username": "engineer1", "display_name": "\uae40\uc5d4\uc9c0\ub2c8\uc5b4", "role": "editor", "email": "editor@pcm.local"},
    {"username": "engineer2", "display_name": "\uc774\uc5d4\uc9c0\ub2c8\uc5b4", "role": "editor", "email": "editor2@pcm.local"},
    {"username": "engineer3", "display_name": "\ubc15\uc5d4\uc9c0\ub2c8\uc5b4", "role": "editor", "email": "editor3@pcm.local"},
    {"username": "reviewer1", "display_name": "\ucd5c\uac80\ud1a0\uc790", "role": "reviewer", "email": "reviewer@pcm.local"},
]
