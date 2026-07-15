# PCM 재구축 계획 (Rebuild Plan)

> 반도체 Photo 공정조건표 관리 시스템(PCM)을 처음부터 다시 구축하기 위한 아키텍처 및 실행 계획 문서.
> 기존 코드베이스는 참고 자료로만 취급하며, 이 디렉토리의 문서가 재구축의 단일 기준(Single Source of Truth)이다.

## 문서 구성

| 문서 | 내용 |
|------|------|
| [01-architecture.md](./01-architecture.md) | 아키텍처 원칙, 시스템 경계, 백엔드/프론트엔드 구조 |
| [02-data-model.md](./02-data-model.md) | 도메인 모델, DB 스키마 설계, 파라미터 스냅샷 정책 |
| [03-grid-evaluation.md](./03-grid-evaluation.md) | 그리드 라이브러리 평가 기준, 후보 비교, PoC 계획 |
| [04-roadmap.md](./04-roadmap.md) | Phase 0~6 단계별 구축 로드맵 및 완료 기준 |
| [05-ui-wireframe.md](./05-ui-wireframe.md) | Process Catalog, Project Create, Sheet Editor 와이어프레임 계획 |
| [wireframes/phase1-ui-wireframe.html](./wireframes/phase1-ui-wireframe.html) | Phase 1 주요 화면 흐름 HTML 와이어프레임 |

### Phase별 세부 작업 계획

| 문서 | 상태 |
|------|------|
| [phase-0-tasks.md](./phase-0-tasks.md) — 리셋 + 기반 | 완료 (2026-07-05 점검) |
| [phase-1-tasks.md](./phase-1-tasks.md) — 프로젝트 + 백본 (그리드 PoC 병행) | 구현 완료 (2026-07-09 검토 반영, EC1~EC6 충족) |
| [phase-2-tasks.md](./phase-2-tasks.md) — 조건표 편집기 | 구현 완료 (2026-07-13, EC1~EC6 충족) |
| [Phase 2.5 UI/UX 설계](../docs/superpowers/specs/2026-07-13-phase-2-5-ui-ux-design.md) — 구조개편 + 디자인 시스템 | 구현 완료 (2026-07-14, [브라우저 QA 근거](../docs/superpowers/evidence/2026-07-13-phase-2-5-browser-qa.md)) |
| [phase-3-tasks.md](./phase-3-tasks.md) — 검증 엔진 | 계획 |
| [phase-4-tasks.md](./phase-4-tasks.md) — 변경 이력 | 계획 |
| [phase-5-tasks.md](./phase-5-tasks.md) — 승인 + Revision | 계획 |
| [phase-6-tasks.md](./phase-6-tasks.md) — 전산 출력 | 계획 |

## 재구축 배경

기존 시스템의 근본 결함은 **구조를 코드/관리자 등록으로 고정**한 것이었다.

- 관리자가 모든 process와 layer를 사전 등록하는 설계였으나, 실무에서는 process마다 layer 구성이 전부 다르다.
- 실제 업무의 시작점은 **외부 DB에 process 구조가 만들어지는 순간**이며, PCM은 그 적재 데이터를 읽어 구조를 파악해야 했다.
- 이 전제를 나중에 고치려 하자 process가 모든 로직의 시작점이었기 때문에 컬럼명·테이블 참조가 전방위로 꼬였고, 코드 이해 자체가 병목이 되었다.

따라서 재구축의 제1원칙은 **"구조는 코드가 아니라 데이터다"** — layer 구성은 적재 데이터에서 동적으로 파생하고, 파라미터 정의는 관리자가 제어하는 메타데이터(레지스트리)로 두며, 모든 상위 기능은 이 메타데이터 위에서만 동작한다.

## 결정 로그 (인터뷰 결과)

| # | 주제 | 결정 | 비고 |
|---|------|------|------|
| D-01 | 핵심 통증점 | 고정 구조 설계 → 동적(데이터 주도) 구조로 전환 | 재구축의 근본 동기 |
| D-02 | 구축 순서 | 프로젝트+백본 → 편집기+데이터모델 → 검증 → 이력 → 승인 → 출력 | [04-roadmap.md](./04-roadmap.md) |
| D-03 | 기술 스택 | FastAPI + React/TS + PostgreSQL 유지, 그리드 라이브러리만 재검토 | [03-grid-evaluation.md](./03-grid-evaluation.md) |
| D-04 | 기존 데이터 | 이관 없음. 스키마·데이터 전면 리셋 | |
| D-05 | 동적 구조의 범위 | **Process는 제품/route 전체 집합**이며 layer 구성은 process마다 다름. `photo`, `etch`, `계측` 등은 process가 아니라 layer의 이름/유형이다. 파라미터(컬럼) 세트는 전 process 공통 | |
| D-06 | 구조 정보 원천 | 외부 시스템 → Prefect 자동 적재 → PCM이 적재 데이터에서 구조 판독. 데이터 없는 신규 process는 없음 | |
| D-07 | 파라미터 정의 | 관리자가 제어하는 레지스트리. 지속적으로 추가/변경됨. 타입(숫자/문자/선택지)과 카테고리를 컬럼별 속성으로 보유 | |
| D-08 | 파라미터 변경 파급 | **(a) 정책**: Draft는 최신 정의를 따르고, 승인 시점에 파라미터 세트를 스냅샷으로 동결. 승인/아카이브 조건표는 당시 세트 그대로 보존 | [02-data-model.md](./02-data-model.md) |
| D-09 | 동시 편집 | 편집 잠금(프로젝트 단위 lock). 실시간 협업 불필요 | |
| D-10 | 인증 | SSO를 Phase 0부터 도입. 구체 인증 구조는 추후 확정분 반영 예정 | 미확정 항목 |
| D-11 | 데이터 경계 | PCM은 PostgreSQL만 조회. 같은 인스턴스의 타 DB 조회 가능성 있음 → 읽기 전용 커넥션 분리로 대응 | |
| D-12 | 그리드 제약 | 유료 라이선스 불가, 사내망(폐쇄망) 배포. 엑셀 대량 붙여넣기 UX와 100~200 컬럼 가독성이 핵심 요구 | AG Grid 붙여넣기 실패는 클립보드가 Enterprise 전용 기능이었기 때문 |
| D-13 | 레포 전략 | 이 레포에서 기존 코드를 제거하고 재구축. 문서 체계는 `plan/`으로 새로 수립 | Phase 0에서 실행 |
| D-14 | Process/Project 관계 재정의 | **Process는 구조만 갖는 적재 데이터**(`line_id`, `process_id`, `step_seq`, `layer_id`, `eqp_type`, `eqp_type_desc`, `area_name` 등의 컬럼으로 된 layer/step 목록)이며 조건 값이 없다. **백본은 적재가 아니라 기존 프로젝트**다: 신규 프로젝트 생성 = process(구조) 선택 + 백본 프로젝트(값) 선택 → layer 매칭으로 값 복사("파라미터가 프로세스에 매칭되며 프로젝트로 변신"). 레이어별 백본 교체의 소스도 프로젝트. 원천 파라미터 매핑 테이블은 백본 용도로는 불필요(폐기). 장기적으로 process당 활성 프로젝트 1개로 수렴(프로젝트≈프로세스) | 2026-07-07 확정. D-06의 "조건 값 판독"과 Phase 1 초안의 매핑 테이블 항목을 대체 |
| D-15 | layer 매칭 키 + 부트스트랩 | 자동 매칭 키는 **`step_seq + layer_id`** 조합 (`layer_id`가 기존 계획의 layer number 역할). layer 이름은 데이터 품질상 매칭 키로 부적합하고, 단일 컬럼으로는 특정이 어려워 조합 키를 쓴다. **자동 매칭 실패분은 사용자 수동 매칭**으로 보완하며 수동 매칭은 자동 매칭을 override할 수 있고 같은 백본 source layer를 여러 target layer에 매칭할 수 있다. 최종 미매칭은 빈 값 시작. 부트스트랩은 "백본 없이 시작(빈 조건표 + CSV 붙여넣기)" 확정 | 2026-07-07 확정. 레거시 시스템 데이터 이관(D-04의 예외)은 희망 사항 — 실현 가능성 검토 후 결정 |
| D-16 | 다중 조건 행 + POR | 같은 layer/step에 **여러 조건 행**이 존재할 수 있다. 시트의 행 = 조건 행(`layer_condition`)이며, 조건 행에는 최소 라벨(`label`)을 둔다. 전부 표시하되 같은 layer·step임이 드러나게 그룹핑한다. **POR은 layer당 최대 1개** — `is_por`(por_yn) 플래그 + partial unique 제약으로 강제, 사용자가 조건 행 중 하나를 POR로 선택/이양(`change_event(por_change)`). UI 명칭은 **Layer/Step 병기** | 2026-07-07 확정 (P1-D3 병기 포함). 파생 정책도 확정: 백본 복사 시 조건 행 전부+POR 유지(P1-D8), 편집 중 POR 미지정 허용 + Review 게이트에서 완결성 검사(P5-D5), cross-layer 검증 참조는 POR 행 기준(P3-D5), 출력은 기본 POR 행만(P6-D5) |
| D-17 | 파라미터 초기 주입 + 중복 프로젝트 정책 | 약 200개 파라미터의 초기 등록은 **CSV 붙여넣기 임포트 기능**(붙여넣기 → dry-run 미리보기 → code 기준 UPSERT)으로 처리 — 반복 사용 가능한 관리 기능으로 Phase 1에 배정 (D-07 "지속 추가/변경" 대응). 조건표가 이미 있는 process의 신규 프로젝트 생성은 **차단**하고 기존 프로젝트(Draft: 이어서 편집 / Approved: Revision)로 유도 | 2026-07-07 확정 |
| D-18 | 그리드 라이브러리 | **Glide Data Grid 채택** (1순위), RevoGrid 대안 유지. 근거: 200 컬럼 성능(Canvas) + 엑셀 범위 붙여넣기 내장 + MIT/폐쇄망 적합. 그리드 어댑터(`frontend/src/grid/types.ts`) 뒤에 두어 교체 가능. 대화형 붙여넣기·성능 체감 검증은 Phase 2 편집기 착수 첫 스텝에서 확정 라이브러리로 재확인 | 2026-07-09 확정 (D-12 해소). [03-grid-evaluation.md](./03-grid-evaluation.md) §7 |
| D-19 | API 진입점 | 백엔드 API를 **`/api` 단일 프리픽스**로 통합, URL 버저닝(v1)은 미도입 — 소비자가 동반 배포되는 자사 SPA 하나뿐이라 실익이 없다. SPA 페이지 경로(`/projects` 등)와 API 경로의 이름공간 충돌을 제거하고, dev proxy·운영 리버스 프록시 규칙을 1개로 줄인다. `/health`는 컨테이너 헬스체크용으로 루트 유지 | 2026-07-10 확정. 배경: 기능별 루트 경로가 쌓이며 vite proxy에 죽은 `/api` 항목·`/projects` 누락이 발생. [phase-2-tasks.md](./phase-2-tasks.md) P2-D5/T0에서 실행 |
| D-20 | Phase 2.5 UI/UX | **상단 전역 내비 + 조건표 집중 모드**, Precision Teal 디자인 시스템, 프로젝트 목록/생성/상세 route 분리, 목록 중심 파라미터 관리 drawer를 채택한다. 향후 검증·이력·코멘트는 content가 있을 때만 열리는 하단 반응형 workbench가 수용한다. 백엔드/API와 Phase 2 persistence/domain/lock/autosave 정책은 변경하지 않는다 | 2026-07-13 사용자 승인. [`DESIGN.md`](../DESIGN.md), [상세 설계](../docs/superpowers/specs/2026-07-13-phase-2-5-ui-ux-design.md) |

## 미확정 항목

- **인증 구조 상세** (D-10): SSO 방식/IdP 연동 상세는 사용자가 추후 전달. Phase 0에서 인증 어댑터 경계만 먼저 확보한다.
- **레거시 데이터 이관 여부** (D-15 비고): 기존 시스템 데이터를 초기 백본 풀로 이관하는 것은 희망 사항 (D-04 전면 리셋의 예외). Phase 1 실현 가능성 스파이크 결과는 [phase-1-tasks.md](./phase-1-tasks.md) P1-D7 참조 — 적재 스키마 확정 후 재평가 대기.
