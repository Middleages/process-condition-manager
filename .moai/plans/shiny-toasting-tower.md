# Plan: Seed Data Expansion + Searchable Combobox

## Context

PCM 프로젝트는 현재 15개 레이어 / 67개 컬럼의 소규모 시드 데이터로 운영 중. 실제 반도체 Photo 공정은 150개 레이어 / 350개 컬럼 규모. 실제와 유사한 스케일로 시드 데이터를 확장하고, 제품 수가 늘어남에 따라 프로젝트 생성 시 검색 가능한 Combobox UI가 필요.

---

## Feature 1: Seed Data 확장 (150 Layers / 350 Columns)

### 변경 파일
- `backend/app/seed.py` — 전면 재작성 (단일 파일 유지, 패키지 분리 불필요)

### 확장 규모

| 항목 | 현재 | 목표 |
|------|------|------|
| Layers | 15 | 150 |
| Columns | 67 (SP:20, SC:19, OVL:14, DEV:14) | 350 (SP:~85, SC:~90, OVL:~80, DEV:~95) |
| Backbone Products | 3 | 8 |
| Non-backbone Products | 2 | 4 |
| Validation Rules | 19 | ~80 |
| Export Mappings | 67 | 350 |

### Layer 확장 전략 (150개)
- **FEOL** (~40): STI, Wells, Gates, Spacers, Implants, Contacts + 다중 패터닝(LELE)
- **MOL** (~10): Via0, Local Interconnect
- **BEOL** (~80): M1~M15, V1~V14 + Critical layers에 _A/_B 이중 패터닝 + Cut masks
- **Special** (~20): PAD, FUSE, TRIM, RDL, BUMP

### Column 확장 전략 (350개)
- **SP(~85)**: 기존 20 + BARC/TARC, 듀얼코팅, Edge처리, 온도프로파일, 분사설정, PR특성, 공정관리
- **SC(~90)**: 기존 19 + 렌즈수차, Dose/Focus맵핑, Shot레이아웃, 정렬보정, Focus레벨링, Pellicle, EUV전용
- **OVL(~80)**: 기존 14 + 다중참조, 고차보정, 웨이퍼왜곡, 공정유발OVL, 측정설정, SPC한계
- **DEV(~95)**: 기존 14 + OCD/AFM계측, 결함분류, 재작업기준, Post-process검사, SPC한계, 현상상세, PEB

### Product 확장 (12개)
- 기존 3 backbone (PROD-2024X/Y/Z) 유지
- 추가 backbone 5: HBM메모리, 모바일AP, 자동차MCU, 서버HPC, IoT칩
- 비backbone 4: 개발중 제품들 (레이어 수 다양화: 80~150)

### 핵심 구현 포인트
- `random.seed(42)` 유지 (재현성)
- 기존 67개 컬럼 key 이름 그대로 보존 (기존 테스트 호환)
- `generate_conditions()` 함수 확장: 새 컬럼에 대해 레이어 프로파일 기반 값 생성
- Export mapping, Validation rules 비례 확장
- 기존 idempotency 패턴 유지

### 주의 사항
- DB를 초기화(`alembic downgrade base && alembic upgrade head`)한 후 seed 재실행 필요
- 기존 테스트(250개)는 컬럼 key가 보존되므로 영향 없음

---

## Feature 2: Searchable Combobox

### 변경 파일
- `frontend/src/components/ui/combobox.tsx` — **신규 생성**
- `frontend/src/components/projects/ProjectCreateModal.tsx` — `<select>` → `<Combobox>` 교체

### Combobox 동작
- 클릭 시 드롭다운 열림 + 검색 입력 필드 표시
- 타이핑 시 client-side 필터링 (case-insensitive includes)
- "2"를 입력하면 "PROD-2024X", "PROD-2025A" 등 매칭되는 것만 표시
- 키보드 내비게이션: ArrowUp/Down, Enter(선택), Escape(닫기)
- 클릭 외부 → 드롭다운 닫힘
- 기존 UI 패턴 준수 (Tailwind, lucide-react icons, cn() utility)
- 외부 라이브러리 없이 커스텀 구현 (기존 Select, Input, Dialog 패턴 따름)

### 적용 위치
- "대상 제품" 드롭다운 → Combobox (전체 제품 목록)
- "Backbone 제품" 드롭다운 → Combobox (backbone 제품만)

---

## 구현 순서

1. **Combobox 컴포넌트 생성** → ProjectCreateModal에 적용
2. **seed.py 확장** — 350 컬럼 정의 + 150 레이어 + 12 제품 + 조건 생성
3. **DB 초기화 + seed 실행** → 데이터 확인
4. **통합 테스트** — 기존 pytest 250건 + vitest 71건 통과 확인

## 검증

- `docker-compose exec backend python -m pytest tests/ -v` → 250 passed
- `cd frontend && npx vitest run` → 71 passed
- DB 확인: `SELECT count(*) FROM layers` = 150, `column_definitions` = 350
- UI 확인: 프로젝트 생성 모달에서 Combobox 검색 동작 확인
