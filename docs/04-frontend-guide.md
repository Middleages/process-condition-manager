# 프론트엔드 수정 가이드

Process Condition Manager의 프론트엔드(React/TypeScript)를 수정하고 유지보수하는 방법을 설명합니다.

## 개발 환경 설정

프론트엔드 개발을 시작하기 전에 필요한 명령어들입니다.

### 설치 및 실행

```bash
# 1. 프로젝트 디렉토리로 이동
cd /home/appuser/process-condition-manager/frontend

# 2. 의존성 설치
npm install

# 3. 개발 서버 시작 (http://localhost:5173)
npm run dev

# 4. 프로덕션 빌드
npm run build

# 5. 빌드된 파일 미리보기
npm run preview

# 6. 테스트 실행
npm run test

# 7. 테스트 감시 모드 (파일 변경 시 자동 재실행)
npm run test:watch
```

### 주요 npm 라이브러리

| 라이브러리 | 버전 | 용도 |
|-----------|------|------|
| React | 18.3.1 | UI 프레임워크 |
| TypeScript | 5.7.3 | 타입 안전성 |
| Vite | 6.0.7 | 빌드 도구 |
| React Router | 7.1.1 | 페이지 라우팅 |
| AG Grid | 32.3.3 | 조건표 그리드 (커뮤니티 에디션) |
| Zustand | 5.0.11 | 상태 관리 |
| Axios | 1.7.9 | HTTP 클라이언트 |
| Tailwind CSS | 4.1.18 | 스타일링 |

---

## 파일 찾기: 화면별 파일 매핑

이 화면의 코드가 어디에 있는지 빠르게 찾을 수 있습니다.

### 페이지(화면) 구조

| 화면 이름 | 파일 경로 | 설명 |
|----------|---------|------|
| 로그인 | `src/pages/LoginPage.tsx` | 사용자 인증 페이지 |
| 대시보드 | `src/pages/DashboardPage.tsx` | 프로젝트 현황 및 활동 요약 |
| 프로젝트 목록 | `src/pages/ProjectListPage.tsx` | 조건표 프로젝트 목록 조회 |
| 조건표 편집 | `src/pages/ConditionEditorPage.tsx` | 메인 작업 화면 (조건 편집) |
| 404 페이지 | `src/pages/NotFoundPage.tsx` | 존재하지 않는 페이지 |
| 관리자 레이아웃 | `src/pages/admin/AdminLayout.tsx` | 관리 섹션 레이아웃 |
| 사용자 관리 | `src/pages/admin/UserManagementPage.tsx` | 사용자 CRUD 관리 |
| 마스터 데이터 | `src/pages/admin/MasterDataPage.tsx` | 라인/제품/레이어 관리 |
| 선택 옵션 관리 | `src/pages/admin/EnumManagementPage.tsx` | 드롭다운 옵션 관리 |
| XML 매핑 | `src/pages/admin/XmlMappingsPage.tsx` | Recipe XML 매핑 설정 |
| 검증 규칙 | `src/pages/admin/ValidationRulesPage.tsx` | 데이터 검증 규칙 관리 |
| 전산 출력 시스템 | `src/pages/admin/ExportSystemsPage.tsx` | 전산 출력 시스템 설정 |
| 데이터 소스 | `src/pages/admin/ExportDataSourcesPage.tsx` | 전산 출력 데이터 소스 관리 |
| 감시 로그 | `src/pages/admin/AuditLogPage.tsx` | 모든 사용자 활동 로그 조회 |

---

## 라우팅 구조: App.tsx 페이지 연결

`src/App.tsx`에 라우트가 정의되어 있습니다.

### 라우트 구조 이해하기

- **공개 라우트**: `/login` — 인증이 필요 없음
- **보호된 라우트**: 로그인 후 접근 가능
  - 메인 경로들 (Layout 내부):
    - `/` — 대시보드
    - `/projects` — 프로젝트 목록
    - `/projects/:projectId/edit` — 조건표 편집
  - 관리자 경로들 (`/admin` 내부):
    - `/admin/users` — 사용자 관리
    - `/admin/master-data` — 마스터 데이터
    - 기타 관리 페이지들
- **404**: `*` — 존재하지 않는 경로

### 새 페이지 추가 방법

1. **페이지 컴포넌트 파일 생성**

   `src/pages/MyNewPage.tsx`에 새로운 React 컴포넌트 작성:

   ```typescript
   export default function MyNewPage() {
     return <div>새 페이지 내용</div>
   }
   ```

2. **App.tsx에 라우트 추가**

   `src/App.tsx`의 라우터 설정에 추가:

   ```typescript
   { path: '/my-new-page', element: <MyNewPage /> }
   ```

   관리자 페이지는 AdminLayout의 children에 추가:

   ```typescript
   { path: 'my-admin-page', element: <MyNewPageAdmin /> }
   ```

3. **네비게이션 링크 추가**

   `src/components/layout/Header.tsx`의 헤더에 링크 추가

---

## 페이지 구조: 컴포넌트 조합

각 페이지는 여러 컴포넌트로 구성됩니다. 주요 페이지별 컴포넌트 조합을 알아봅시다.

### 조건표 편집 페이지 (ConditionEditorPage)

이것이 PCM의 핵심 페이지입니다.

```
ConditionEditorPage
├── EditorHeader (헤더 부분)
│   ├── 상태 배지
│   ├── 저장/검증/승인 버튼
│   └── 드롭다운 (라인, 제품, 버전)
├── StatusBanner (상태 메시지)
├── Main Grid Section
│   ├── CategoryTabs (SP/SC/OVL/DEV 탭)
│   ├── ConditionGrid (AG Grid 조건표)
│   ├── GridContextMenu (우클릭 메뉴)
│   └── ValidationPanel (검증 에러 패널)
├── Left Sidebar
│   └── LayerNavPanel (레이어 목록)
└── Right Sidebar (드롭다운으로 전환)
    ├── CommentPanel (코멘트)
    ├── ChangeHistoryPanel (변경 이력)
    ├── VersionHistoryPanel (버전 히스토리)
    ├── ExportPanel (전산 출력)
    └── EquipmentPanel (설비 할당)
```

### 프로젝트 목록 페이지 (ProjectListPage)

```
ProjectListPage
├── 필터 바
│   ├── 라인 선택 드롭다운
│   └── 상태 필터 버튼들
├── ProjectCreateModal (새 프로젝트 생성 모달)
└── 프로젝트 테이블
    ├── 상태 배지
    ├── 프로젝트 정보
    └── 액션 버튼들
```

### 관리자 페이지 (AdminLayout)

```
AdminLayout
├── 수평 탭 네비게이션
│   ├── 사용자 관리
│   ├── 마스터 데이터
│   ├── 선택 옵션
│   ├── XML 매핑
│   ├── 검증 규칙
│   ├── 전산 출력
│   └── 감시 로그
└── 선택된 탭의 컴포넌트
    ├── 테이블 또는 폼
    ├── CRUD 모달들
    └── 관리 기능들
```

---

## 텍스트 변경하기

프론트엔드에서 보이는 텍스트를 변경하는 방법입니다.

### 페이지 제목/설명 변경

각 페이지 파일에서 텍스트를 찾아 수정합니다.

```typescript
// 예: ProjectListPage.tsx에서
return (
  <div>
    <h1>프로젝트 목록</h1>  {/* 이 텍스트를 "공정조건표" 등으로 변경 */}
    <p>조건표를 생성하고 관리합니다</p>  {/* 설명 변경 */}
  </div>
)
```

### 버튼 텍스트 변경

버튼의 label 속성이나 children을 수정합니다.

```typescript
// 변경 전
<button className="bg-blue-500">저장하기</button>

// 변경 후
<button className="bg-blue-500">변경사항 저장</button>
```

### 폼 레이블과 플레이스홀더 변경

input이나 select의 label/placeholder를 수정합니다.

```typescript
<label htmlFor="project-name">프로젝트명</label>  {/* 레이블 변경 */}
<input
  placeholder="예: PRODUCT_A_v1.0"  {/* 플레이스홀더 변경 */}
/>
```

### 오류/성공 메시지 변경

toast나 alert 메시지를 수정합니다.

```typescript
// Toast 메시지
toast.success('저장되었습니다.')  // 이 메시지 변경

// 알림 메시지
alert('변경사항이 저장되었습니다.')  // 이 메시지 변경
```

---

## 스타일 변경하기

UI 스타일은 Tailwind CSS로 관리됩니다.

### 자주 사용하는 Tailwind 클래스

```typescript
// 레이아웃
<div className="flex gap-4">  {/* 가로 정렬, 간격 4 */}
<div className="grid grid-cols-3">  {/* 3열 그리드 */}
<div className="p-4">  {/* padding 4 */}

// 색상
<button className="bg-blue-500">파랑</button>
<button className="bg-green-500">초록</button>
<button className="bg-red-500">빨강</button>
<button className="bg-gray-100">회색</button>

// 텍스트
<p className="text-2xl font-bold">큰 굵은 텍스트</p>
<p className="text-sm text-gray-600">작은 회색 텍스트</p>

// 보더와 모서리
<div className="border border-gray-300">경계선</div>
<div className="rounded-lg">모서리 둥글게</div>

// 반응형
<div className="w-full md:w-1/2 lg:w-1/3">
  {/* 모바일에서 100%, 태블릿에서 50%, PC에서 33% */}
</div>

// 어둡게/밝게 (다크 모드)
<div className="dark:bg-gray-900 dark:text-white">
  {/* 다크 모드에서만 적용 */}
</div>
```

### 색상 변경 예시

버튼 색을 파란색에서 초록색으로 변경:

```typescript
// 변경 전
<button className="bg-blue-500 hover:bg-blue-600">승인</button>

// 변경 후
<button className="bg-green-500 hover:bg-green-600">승인</button>
```

### 레이아웃 변경 예시

두 컬럼을 세 컬럼으로 변경:

```typescript
// 변경 전
<div className="grid grid-cols-2 gap-4">

// 변경 후
<div className="grid grid-cols-3 gap-4">
```

---

## 상태 관리: Zustand 스토어

프론트엔드의 데이터는 주로 Zustand 스토어에서 관리됩니다.

### 스토어 위치와 역할

| 스토어 파일 | 관리 데이터 | 용도 |
|-----------|----------|------|
| `src/stores/useAuthStore.ts` | 사용자, 인증 토큰 | 로그인/로그아웃, 사용자 권한 |
| `src/stores/useEditorStore.ts` | 편집 중인 조건, dirty cells | 그리드 편집 상태 |
| `src/stores/useToastStore.ts` | 토스트 메시지 | 알림 메시지 표시 |

### 스토어 사용 예시

```typescript
// 1. 스토어 import
import { useAuthStore } from '@/stores/useAuthStore'

// 2. 컴포넌트에서 사용
function MyComponent() {
  const user = useAuthStore((state) => state.user)
  const logout = useAuthStore((state) => state.logout)

  return (
    <div>
      <p>사용자: {user?.name}</p>
      <button onClick={logout}>로그아웃</button>
    </div>
  )
}
```

### 데이터 저장/로드 패턴

```typescript
// 데이터 저장
const { setData } = useEditorStore()
setData(newData)

// 데이터 읽기
const data = useEditorStore((state) => state.data)

// 여러 값 한 번에 읽기
const { data, isDirty } = useEditorStore((state) => ({
  data: state.data,
  isDirty: state.isDirty,
}))
```

---

## API 호출하기

백엔드와의 통신은 `src/api/` 폴더의 함수들을 사용합니다.

### API 함수 위치와 역할

| API 파일 | 담당 기능 |
|---------|---------|
| `api/authToken.ts` | 로그인, 토큰 갱신 |
| `api/projects.ts` | 프로젝트 CRUD |
| `api/columns.ts` | 컬럼 조회 |
| `api/products.ts` | 제품/Backbone 조회 |
| `api/lines.ts` | 라인 목록 조회 |
| `api/comments.ts` | 코멘트 CRUD |
| `api/export.ts` | 전산 출력 (미리보기, 다운로드) |
| `api/exportAdmin.ts` | 전산 시스템/매핑 관리 |
| `api/equipment.ts` | 설비 할당 CRUD |
| `api/admin.ts` | 일반 관리 기능 |
| `api/adminUsers.ts` | 사용자 관리 API |
| `api/adminMaster.ts` | 마스터 데이터 관리 |
| `api/adminColumns.ts` | 컬럼 메타데이터 관리 |

### API 호출 패턴

```typescript
// 1. 훅으로 API 호출 (권장 방식)
import { useProjects } from '@/hooks/useProjects'

function MyComponent() {
  const { projects, isLoading, error } = useProjects()

  if (isLoading) return <div>로딩중...</div>
  if (error) return <div>오류 발생</div>

  return (
    <ul>
      {projects.map(p => <li key={p.id}>{p.name}</li>)}
    </ul>
  )
}

// 2. 직접 API 함수 호출
import { fetchProjects } from '@/api/projects'

async function loadProjects() {
  try {
    const data = await fetchProjects()
    console.log(data)
  } catch (error) {
    console.error('프로젝트 로드 실패:', error)
  }
}
```

### 새로운 API 함수 추가

1. **api/ 폴더에 새 파일 생성**

   `api/myFeature.ts`:

   ```typescript
   import { client } from './client'

   export async function fetchMyData(id: number) {
     const response = await client.get(`/api/my-endpoint/${id}`)
     return response.data
   }

   export async function createMyData(data: MyDataInput) {
     const response = await client.post('/api/my-endpoint', data)
     return response.data
   }
   ```

2. **훅 파일에서 감싸기**

   `hooks/useMyFeature.ts`:

   ```typescript
   import { useState, useEffect } from 'react'
   import { fetchMyData } from '@/api/myFeature'

   export function useMyFeature(id: number) {
     const [data, setData] = useState(null)
     const [isLoading, setLoading] = useState(true)
     const [error, setError] = useState(null)

     useEffect(() => {
       fetchMyData(id)
         .then(setData)
         .catch(setError)
         .finally(() => setLoading(false))
     }, [id])

     return { data, isLoading, error }
   }
   ```

3. **컴포넌트에서 사용**

   ```typescript
   import { useMyFeature } from '@/hooks/useMyFeature'

   function MyComponent({ id }) {
     const { data, isLoading } = useMyFeature(id)
     return isLoading ? <div>로딩</div> : <div>{JSON.stringify(data)}</div>
   }
   ```

---

## 커스텀 훅 사용

복잡한 로직은 훅으로 분리되어 있습니다.

### 주요 훅들

| 훅 파일 | 역할 |
|--------|------|
| `useEditorCellEdit.ts` | 셀 편집, 저장, 자동저장 |
| `useEditorNavigation.ts` | 레이어/셀 탐색, 에러 포커싱 |
| `useEditorModals.ts` | 모달 상태 (코멘트, Recipe 업로드 등) |
| `useProjects.ts` | 프로젝트 목록 조회 |
| `useLines.ts` | 라인 목록 조회 및 필터링 |
| `useProducts.ts` | 제품/Backbone 조회 |
| `useColumns.ts` | 컬럼 메타데이터 조회 |
| `useComments.ts` | 코멘트 CRUD |
| `useExportSystems.ts` | 전산 출력 시스템 조회 |
| `useDashboard.ts` | 대시보드 데이터 |

### 훅 사용 패턴

```typescript
import { useEditorCellEdit } from '@/hooks/useEditorCellEdit'

function MyComponent() {
  const {
    editCell,
    saveChanges,
    cellErrors,
  } = useEditorCellEdit()

  return (
    <button onClick={() => editCell(rowId, colId, newValue)}>
      편집
    </button>
  )
}
```

---

## 타입 정의

TypeScript 타입들은 `src/types/` 폴더에 정의되어 있습니다.

### 타입 파일 구조

| 타입 파일 | 정의 내용 |
|----------|---------|
| `types/user.ts` | User, UserRole 등 사용자 관련 타입 |
| `types/project.ts` | Project, ProjectStatus 등 프로젝트 타입 |
| `types/editor.ts` | GridCell, EditableCell 등 편집기 타입 |
| `types/column.ts` | ColumnDef, ColumnCategory 등 컬럼 타입 |
| `types/master.ts` | Line, Product, Layer 등 마스터 데이터 타입 |
| `types/export.ts` | ExportSystem, ExportFormat 등 전산 출력 타입 |
| `types/changelog.ts` | ChangeLog, StatusLog 등 변경 로그 타입 |
| `types/dashboard.ts` | DashboardStats 등 대시보드 타입 |
| `types/admin.ts` | Admin 관련 타입들 |
| `types/index.ts` | 모든 타입 재내보내기 |

### 타입 사용 예시

```typescript
import { Project, ProjectStatus } from '@/types/project'
import { User } from '@/types/user'

function MyComponent(project: Project) {
  if (project.status === 'approved') {
    return <div>승인됨</div>
  }
  return null
}
```

### 새로운 타입 추가

1. 관련 타입 파일 열기 (예: `types/project.ts`)
2. 새 인터페이스 정의 추가:

   ```typescript
   export interface MyNewType {
     id: number
     name: string
     status: 'active' | 'inactive'
   }
   ```

3. `types/index.ts`에 재내보내기 추가:

   ```typescript
   export * from './project'  // 이미 있으면 자동 포함
   ```

---

## 컴포넌트 수정하기

이미 존재하는 컴포넌트를 수정하는 방법입니다.

### UI 컴포넌트 수정

기본 UI 컴포넌트들은 `src/components/ui/` 폴더에 있습니다:

- `button.tsx` — 버튼 스타일과 크기 옵션
- `input.tsx` — 입력 필드
- `dialog.tsx` — 모달 다이얼로그
- `badge.tsx` — 배지 (상태 표시)
- `select.tsx` — 드롭다운
- `toast.tsx` — 알림 메시지

이들을 수정하면 전체 앱에 영향을 미치므로 주의해야 합니다.

### 특화된 컴포넌트 수정

기능별 컴포넌트는 `src/components/` 하위 폴더에 있습니다:

```
components/
├── editor/           # 편집기 컴포넌트
├── export/          # 전산 출력 컴포넌트
├── projects/        # 프로젝트 목록 컴포넌트
├── admin/           # 관리 컴포넌트
├── auth/            # 인증 관련
├── layout/          # 레이아웃
└── ui/              # 기본 UI 컴포넌트
```

### 컴포넌트 수정 체크리스트

1. 수정 대상 컴포넌트 파일 열기
2. 변경할 코드 섹션 찾기
3. TypeScript 문법 유지
4. 관련된 타입 확인
5. 필요한 import 확인
6. `npm run dev`로 변경 확인
7. 브라우저 개발자 도구에서 콘솔 에러 확인

---

## 모달(대화상자) 추가/수정

모달은 주로 `useEditorModals` 훅으로 상태를 관리합니다.

### 새 모달 추가 단계

1. **모달 컴포넌트 파일 생성**

   `src/components/editor/MyModal.tsx`:

   ```typescript
   interface MyModalProps {
     isOpen: boolean
     onClose: () => void
     onSubmit?: (data: any) => void
   }

   export function MyModal({ isOpen, onClose, onSubmit }: MyModalProps) {
     return (
       <Dialog open={isOpen} onOpenChange={onClose}>
         <DialogContent>
           <DialogHeader>
             <DialogTitle>모달 제목</DialogTitle>
           </DialogHeader>
           {/* 모달 내용 */}
         </DialogContent>
       </Dialog>
     )
   }
   ```

2. **훅에 상태 추가**

   `useEditorModals.ts`에서:

   ```typescript
   const [myModalOpen, setMyModalOpen] = useState(false)

   return {
     myModalOpen,
     openMyModal: () => setMyModalOpen(true),
     closeMyModal: () => setMyModalOpen(false),
   }
   ```

3. **페이지에서 사용**

   ```typescript
   const { myModalOpen, openMyModal, closeMyModal } = useEditorModals()

   return (
     <>
       <button onClick={openMyModal}>모달 열기</button>
       <MyModal isOpen={myModalOpen} onClose={closeMyModal} />
     </>
   )
   ```

---

## 권한/역할 처리

특정 권한이 필요한 화면은 `RequireRole` 컴포넌트로 보호됩니다.

### 권한 확인 방법

```typescript
import { RequireRole } from '@/components/auth/RequireRole'

function AdminFeature() {
  return (
    <RequireRole roles={['admin']}>
      {/* admin 사용자만 볼 수 있음 */}
      <AdminPanel />
    </RequireRole>
  )
}
```

### 개발 중 권한 무시 (임시)

개발 중에 인증을 테스트하고 싶지 않으면 `useAuthStore`에서 user 객체를 임시로 설정할 수 있습니다.

```typescript
// app에서 임시 user 설정 (개발 전용)
const { setUser } = useAuthStore()

useEffect(() => {
  setUser({
    id: 1,
    username: 'dev_user',
    role: 'admin',
  })
}, [])
```

---

## 그리드(조건표) 커스터마이징

AG Grid로 만들어진 조건표는 `src/components/editor/ConditionGrid.tsx`에 정의됩니다.

### 그리드 구조 이해하기

- **ConditionGrid.tsx** — 메인 그리드 컴포넌트
- **buildColumnDefs.ts** — 컬럼 정의 생성 함수
- **GridContextMenu.tsx** — 우클릭 메뉴
- **useEditorCellEdit.ts** — 셀 편집 로직

### 컬럼 추가/수정

`buildColumnDefs`에서 columnDefs를 수정합니다:

```typescript
const columnDefs = [
  { field: 'layer_name', headerName: '레이어', width: 100 },
  { field: 'parameter_1', headerName: 'Param1', editable: true },
  // 새 컬럼 추가
  { field: 'new_param', headerName: '새 파라미터', editable: true, width: 150 },
]
```

### 셀 스타일 조정

```typescript
const columnDefs = [
  {
    field: 'status',
    cellStyle: (params) => {
      if (params.value === 'error') {
        return { backgroundColor: '#ffcccc' }  // 에러는 빨강
      }
      return {}
    },
  },
]
```

---

## 자동저장 기능

`useAutoSave` 훅이 일정 시간마다 자동으로 변경사항을 저장합니다.

### 자동저장 동작

1. 사용자가 셀을 편집
2. dirty cells을 Zustand 스토어에 저장
3. 30초마다 자동으로 서버에 반영
4. 브라우저 닫음 방지 (unsaved changes 경고)

### 자동저장 간격 조정

`useAutoSave.ts`에서:

```typescript
useEffect(() => {
  const interval = setInterval(() => {
    // 30000 (30초)를 다른 값으로 변경
    saveChanges()
  }, 30000)

  return () => clearInterval(interval)
}, [])
```

---

## 브라우저 개발자 도구 활용

문제 해결을 위해 브라우저 개발자 도구를 사용합니다.

### F12 개발자 도구 탭

| 탭 | 용도 |
|----|------|
| Elements | HTML 구조 확인, 인라인 스타일 수정 |
| Console | 에러 메시지, console.log() 확인 |
| Network | API 호출 확인, 응답 데이터 보기 |
| Application | 로컬 스토리지, 쿠키 확인 |
| React DevTools | 컴포넌트 계층도, 상태 추적 |

### 흔한 에러와 해결법

| 에러 | 해결 방법 |
|-----|---------|
| "Cannot read property 'xxx' of undefined" | null/undefined 체크 추가 |
| "API 호출 401" | 로그인 되지 않음, 토큰 만료 |
| "Missing dependency in useEffect" | useEffect 의존성 배열 확인 |
| "State update on unmounted component" | cleanup 함수에서 interval/timeout 정리 |

---

## 프로덕션 빌드

배포를 위한 최적화된 빌드입니다.

```bash
# 1. 빌드 실행
npm run build

# 2. 결과 확인
ls -la dist/

# 3. 지역 미리보기
npm run preview
```

빌드된 파일들은 `dist/` 폴더에 생성되며, 이를 웹 서버(Nginx 등)에서 제공합니다.

---

## 디버깅 팁

### console.log 사용

```typescript
function MyComponent() {
  const data = useProjects()
  console.log('Projects data:', data)  // 브라우저 콘솔에 출력

  return <div>{data.length}</div>
}
```

### React DevTools 설치

Chrome/Firefox에서 "React Developer Tools" 확장 설치 후:
- 컴포넌트 계층도 확인
- 상태(state) 실시간 모니터링
- props 확인

### Network 탭으로 API 확인

F12 → Network → API 호출 클릭:
- Request Headers (요청 헤더)
- Response (응답 데이터)
- Status (상태 코드)

### 타입 에러 확인

```bash
# TypeScript 컴파일 에러 확인
npm run build

# 에러가 있으면 메시지 확인하고 수정
```

---

## 문제 해결

### 개발 서버가 시작 안 됨

```bash
# 1. 포트 확인 (5173 사용 중?)
lsof -i :5173

# 2. node_modules 재설치
rm -rf node_modules package-lock.json
npm install

# 3. 캐시 초기화
npm cache clean --force
```

### 스타일이 적용 안 됨

1. Tailwind CSS 클래스명 확인 (오타?)
2. 브라우저 캐시 초기화 (Ctrl+Shift+Del)
3. `npm run dev` 재시작

### API 호출 안 됨

1. 백엔드 서버 동작 확인 (`http://localhost:8000/api/health`)
2. CORS 설정 확인 (backend config.py)
3. Network 탭에서 API URL 확인
4. 인증 토큰 확인 (Application → Cookies)

### 빌드 실패

```bash
# 1. 에러 메시지 읽기
npm run build 2>&1 | tail -50

# 2. 타입 에러 확인
npx tsc --noEmit

# 3. 모든 의존성 재설치
npm ci
```

---

## 핵심 개념 정리

- **컴포넌트**: 재사용 가능한 UI 조각
- **훅**: 함수형 컴포넌트에서 상태 관리
- **Zustand**: 전역 상태 저장소
- **Tailwind**: CSS 유틸리티 클래스 기반 스타일
- **React Router**: 페이지 간 네비게이션
- **AG Grid**: 강력한 데이터 그리드
- **Axios**: HTTP 클라이언트
- **TypeScript**: 타입 안전성

---

## 더 배우기

- React 공식 문서: https://react.dev
- TypeScript 핸드북: https://www.typescriptlang.org/docs/
- Tailwind CSS: https://tailwindcss.com/docs
- AG Grid: https://www.ag-grid.com/javascript-data-grid/getting-started/
- Zustand: https://github.com/pmndrs/zustand

