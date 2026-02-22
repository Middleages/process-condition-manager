# SPEC-ADMIN-001: Admin Enhancement Plan (P1+P2+P3)

## Context

PCM 관리자 섹션은 현재 3개 탭(XML 매핑, 검증 규칙, 전산 출력 시스템)만 존재한다.
사용자 관리, 마스터 데이터 관리, 감사 로그 등 핵심 관리 기능이 부재하여 운영에 어려움이 있다.
기존 `ExportSystemsPage`/`ExportAdminService` CRUD 패턴을 재사용하여 일관성 있게 확장한다.

**DB 마이그레이션 불필요** - 모든 모델이 이미 존재함.

## Milestones

| Milestone | Scope | Est. Files | Complexity |
|-----------|-------|------------|------------|
| M1 | User CRUD + Enum(select_options) 관리 | ~20 | Medium |
| M2 | Master Data (Line/Product/Layer/Column) 관리 | ~16 | Medium-High |
| M3 | Audit Log 조회 + Category 관리 | ~12 | Low-Medium |

## Final AdminLayout Tab Order

```
사용자 관리 | 마스터 데이터 관리 | 선택 옵션 관리 | XML 매핑 관리 | 검증 규칙 관리 | 전산 출력 시스템 관리 | 변경 이력 조회
```

Default: `/admin/users`

---

## M1: User & Enum Management (P1)

### M1.1 Backend - User CRUD

| Action | File | Description |
|--------|------|-------------|
| CREATE | `backend/app/schemas/admin_user.py` | AdminUserCreate, AdminUserUpdate, AdminUserResponse, AdminPasswordReset |
| CREATE | `backend/app/services/admin_user_service.py` | User CRUD (list/create/update/deactivate/reset_password) |
| CREATE | `backend/app/routers/admin_users.py` | 5 endpoints: GET/POST/PUT users, PUT deactivate, PUT password |
| MODIFY | `backend/app/main.py` | Register admin_users router |

Endpoints:
- `GET /api/admin/users` - 전체 사용자 목록 (include_inactive 필터)
- `POST /api/admin/users` - 사용자 생성 (username 중복 체크, bcrypt 해싱)
- `PUT /api/admin/users/{id}` - 사용자 정보 수정
- `PUT /api/admin/users/{id}/deactivate` - 비활성화 (자기 자신 불가)
- `PUT /api/admin/users/{id}/password` - 비밀번호 초기화

### M1.2 Backend - Enum(select_options) Editing

| Action | File | Description |
|--------|------|-------------|
| MODIFY | `backend/app/schemas/admin.py` | SelectOptionsUpdate, ColumnSelectOptionsResponse 추가 |
| MODIFY | `backend/app/services/admin_service.py` | list_select_columns, update_select_options 추가 |
| MODIFY | `backend/app/routers/admin.py` | 2 endpoints: GET select columns, PUT select_options |

Endpoints:
- `GET /api/admin/columns/select-options` - data_type='select' 컬럼 목록
- `PUT /api/admin/columns/{id}/select-options` - select_options JSONB 업데이트

### M1.3 Frontend - User Management Page

| Action | File | Description |
|--------|------|-------------|
| CREATE | `frontend/src/types/adminUser.ts` | AdminUser, AdminUserCreate, AdminUserUpdate 타입 |
| MODIFY | `frontend/src/types/index.ts` | Re-export adminUser |
| CREATE | `frontend/src/api/adminUsers.ts` | CRUD API 함수 5종 |
| CREATE | `frontend/src/hooks/useAdminUsers.ts` | React Query hooks (query + 4 mutations) |
| CREATE | `frontend/src/pages/admin/UserManagementPage.tsx` | 사용자 목록 + CRUD 테이블 |
| CREATE | `frontend/src/components/admin/UserFormModal.tsx` | 생성/수정 다이얼로그 |
| CREATE | `frontend/src/components/admin/PasswordResetModal.tsx` | 비밀번호 초기화 다이얼로그 |

### M1.4 Frontend - Enum(select_options) Editing Page

| Action | File | Description |
|--------|------|-------------|
| CREATE | `frontend/src/api/adminColumns.ts` | select columns API 함수 2종 |
| CREATE | `frontend/src/hooks/useAdminColumns.ts` | React Query hooks (query + mutation) |
| CREATE | `frontend/src/pages/admin/EnumManagementPage.tsx` | select 컬럼 목록 + 옵션 편집 |
| CREATE | `frontend/src/components/admin/SelectOptionsEditModal.tsx` | 옵션 동적 추가/삭제/재정렬 다이얼로그 |

### M1.5 Route & Tab Integration

| Action | File | Description |
|--------|------|-------------|
| MODIFY | `frontend/src/pages/admin/AdminLayout.tsx` | Users + Enum 탭 추가 |
| MODIFY | `frontend/src/App.tsx` | users, enum-options 라우트 추가, default → /admin/users |

---

## M2: Master Data Management (P2)

### M2.1 Backend - Master Data CRUD

| Action | File | Description |
|--------|------|-------------|
| CREATE | `backend/app/schemas/admin_master.py` | Line/Product/Layer Create/Update + Column MetadataUpdate |
| CREATE | `backend/app/services/admin_master_service.py` | CRUD + FK 보호 삭제 + reorder |
| CREATE | `backend/app/routers/admin_master.py` | ~13 endpoints |
| MODIFY | `backend/app/main.py` | Register admin_master router |

Endpoints:
- Lines: GET/POST/PUT/DELETE `/api/admin/lines/*`
- Products: GET/POST/PUT/DELETE `/api/admin/products/*` (line_id 필터)
- Layers: GET/POST/PUT/DELETE `/api/admin/layers/*` + PUT reorder
- Columns: PUT `/api/admin/columns/{id}/metadata`

삭제 보호: Line→Products, Product→Projects, Layer→ProjectLayers 참조 시 400 에러

### M2.2 Frontend - Master Data Pages

| Action | File | Description |
|--------|------|-------------|
| CREATE | `frontend/src/api/adminMaster.ts` | 전체 마스터 데이터 API 함수 |
| CREATE | `frontend/src/hooks/useAdminMaster.ts` | React Query hooks + public key 무효화 |
| CREATE | `frontend/src/pages/admin/MasterDataPage.tsx` | 내부 서브탭 (Lines/Products/Layers/Columns) |
| CREATE | `frontend/src/components/admin/LineManagementPanel.tsx` | Line CRUD 패널 |
| CREATE | `frontend/src/components/admin/LineFormModal.tsx` | Line 생성/수정 다이얼로그 |
| CREATE | `frontend/src/components/admin/ProductManagementPanel.tsx` | Product CRUD 패널 |
| CREATE | `frontend/src/components/admin/ProductFormModal.tsx` | Product 생성/수정 다이얼로그 |
| CREATE | `frontend/src/components/admin/LayerManagementPanel.tsx` | Layer CRUD + 순서 변경 |
| CREATE | `frontend/src/components/admin/LayerFormModal.tsx` | Layer 생성/수정 다이얼로그 |
| CREATE | `frontend/src/components/admin/ColumnMetadataPanel.tsx` | Column 메타데이터 편집 |

### M2.3 Route & Tab Integration

| Action | File | Description |
|--------|------|-------------|
| MODIFY | `frontend/src/pages/admin/AdminLayout.tsx` | Master Data 탭 추가 |
| MODIFY | `frontend/src/App.tsx` | master-data 라우트 추가 |

---

## M3: Audit Log & Category (P3)

### M3.1 Backend - Audit Log & Category

| Action | File | Description |
|--------|------|-------------|
| MODIFY | `backend/app/schemas/admin.py` | AuditLogEntry, AuditLogListResponse, CategoryUpdate |
| MODIFY | `backend/app/services/admin_service.py` | list_audit_logs (JOIN 5 tables), category CRUD |
| MODIFY | `backend/app/routers/admin.py` | 4 endpoints: audit-logs GET, categories GET/PUT/reorder |

Audit Log 쿼리: change_logs JOIN project_layers → layers + projects → products + users
필터: project_id, changed_by, change_type, date_from, date_to, offset/limit

### M3.2 Frontend - Audit Log & Category

| Action | File | Description |
|--------|------|-------------|
| CREATE | `frontend/src/api/adminAudit.ts` | Audit log API 함수 |
| CREATE | `frontend/src/hooks/useAdminAudit.ts` | React Query hook (필터 기반 쿼리) |
| CREATE | `frontend/src/pages/admin/AuditLogPage.tsx` | 필터 바 + 테이블 + 페이지네이션 |
| CREATE | `frontend/src/components/admin/CategoryManagementPanel.tsx` | Category 이름/순서 편집 |
| MODIFY | `frontend/src/hooks/useAdminMaster.ts` | Category queries/mutations 추가 |
| MODIFY | `frontend/src/api/adminMaster.ts` | Category API 함수 추가 |
| MODIFY | `frontend/src/pages/admin/MasterDataPage.tsx` | Categories 서브탭 추가 |

### M3.3 Route & Tab Integration

| Action | File | Description |
|--------|------|-------------|
| MODIFY | `frontend/src/pages/admin/AdminLayout.tsx` | Audit Log 탭 추가 |
| MODIFY | `frontend/src/App.tsx` | audit-logs 라우트 추가 |

---

## Key Design Decisions

1. **Admin 전용 라우터 분리**: 기존 `users.py`, `lines.py` 등은 일반 사용자용 조회 API 유지. Admin CRUD는 `/api/admin/*` 하위에 별도 라우터
2. **User soft delete**: `is_active=False`로 비활성화 (change_log 등 참조 보존)
3. **Master data FK 보호**: 참조 관계 있을 시 hard delete 차단 (400 에러)
4. **MasterDataPage 내부 서브탭**: 라우터 기반이 아닌 로컬 state 기반 탭 전환 (URL 복잡성 방지)
5. **Public 쿼리 키 무효화**: Admin에서 데이터 변경 시 일반 사용자 드롭다운도 즉시 갱신

## Reference Patterns (재사용 대상)

| Pattern | Source File |
|---------|------------|
| Admin CRUD Router | `backend/app/routers/export_admin.py` |
| Admin Service | `backend/app/services/export_admin_service.py` |
| CRUD Page | `frontend/src/pages/admin/ExportSystemsPage.tsx` |
| Form Modal | `frontend/src/components/admin/ExportSystemForm.tsx` |
| React Query Hooks | `frontend/src/hooks/useExportAdmin.ts` |
| API Functions | `frontend/src/api/exportAdmin.ts` |

## Verification

```bash
# Backend: 전체 테스트 통과 확인
cd backend && python -m pytest tests/ --tb=short -q

# Frontend: TypeScript 빌드 확인
cd frontend && npx tsc --noEmit

# Manual: 각 admin 탭 UI 동작 확인
# - 사용자 생성/수정/비활성화/비밀번호 초기화
# - select_options 편집 및 조건표 편집기에서 반영 확인
# - Line/Product/Layer/Column CRUD + 삭제 보호
# - Audit log 필터링 + 페이지네이션
# - Category 이름/순서 변경
```
