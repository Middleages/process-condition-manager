"""사용자 시드 데이터 정의.

시스템 초기 구동 시 생성되는 기본 사용자 계정 목록.
비밀번호는 runner.py에서 bcrypt로 해싱하여 저장됨 (기본 비밀번호: 'changeme123!').
"""

# ---------------------------------------------------------------------------
# 3. 사용자 계정
# ---------------------------------------------------------------------------
# roles(역할)에 따른 권한:
#   admin     - 전체 시스템 관리 (사용자 관리, 마스터 데이터, 운영 설정 등)
#   editor    - 공정조건표 편집 (본인이 생성한 프로젝트만)
#   reviewer  - 조건표 검토/승인/반려 (Review 상태 프로젝트에 대해)
#   developer - 시스템 설정 관리 (컬럼/카테고리/매핑/출력 등)
# 새로운 사용자를 추가하려면 이 리스트에 딕셔너리를 추가

USERS = [
    {"userid": "admin1", "roles": ["admin"], "email": "admin@pcm.local"},
    {"userid": "engineer1", "roles": ["editor"], "email": "editor@pcm.local"},
    {"userid": "engineer2", "roles": ["editor"], "email": "editor2@pcm.local"},
    {"userid": "engineer3", "roles": ["editor"], "email": "editor3@pcm.local"},
    {"userid": "reviewer1", "roles": ["reviewer"], "email": "reviewer@pcm.local"},
    {"userid": "developer1", "roles": ["developer"], "email": "developer@pcm.local"},
    {"userid": "superuser1", "roles": ["admin", "developer"], "email": "superuser@pcm.local"},
]
