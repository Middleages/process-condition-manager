# Phase 4 — 변경 이력 (작업 계획)

> 목표: Phase 1~2에서 append-only로 쌓아 온 `change_event`를 사용자에게 보여준다. 통합 타임라인과 셀 단위 연대기가 핵심이며, **새 기록 체계를 만들지 않는다** — 이미 기록된 이벤트의 조회/표현만 다룬다.

관련 문서: [02-data-model.md](./02-data-model.md) §5 · [04-roadmap.md](./04-roadmap.md)

선행 조건: Phase 2 완료 (cell_update 이벤트가 실제로 쌓이고 있어야 화면 검증이 의미 있음).

## 완료 기준 (Exit Criteria)

- [ ] EC1. Phase 1~2에서 기록해 온 이벤트(backbone_copy / backbone_layer_replace / cell_update)가 타임라인에 정확히 나타난다
- [ ] EC2. 임의 셀의 값 변천사를 추적할 수 있다 (셀 우클릭 → 해당 셀의 변경 연대기)
- [ ] EC3. 타임라인 필터(layer / 이벤트 유형 / 사용자 / 소스)가 동작하고, 항목에서 해당 셀로 점프할 수 있다
- [ ] EC4. 벌크 이벤트(백본 복사, 엑셀 붙여넣기)가 배치 단위로 묶여 표시되고, 펼치면 셀 단위 상세가 보인다

## 선행 확정 필요 (결정 항목)

| # | 항목 | 내용 | 권고 |
|---|------|------|------|
| P4-D1 | 붙여넣기 이벤트 배치화 | Phase 2의 엑셀 붙여넣기 저장이 배치 식별자를 payload에 남기고 있는지 확인 — 누락 시 소급 불가 | Phase 2 T4 구현 시 배치 id 기록을 완료 조건에 포함(이 문서를 Phase 2 착수 전에 교차 확인) |
| P4-D2 | 타임라인 페이징 방향 | 최신순 무한 스크롤 vs 기간 필터 | 최신순 커서(bigserial id 역순) + 기간 필터 병행 |
| P4-D3 | 이벤트 표시명 | event_type/소스의 사용자용 라벨(한글) 매핑 위치 | 프론트 상수로 관리 (이벤트 타입 추가는 코드 변경이 수반되는 영역이므로 레지스트리화 불필요) |

## 작업 분해 (Work Breakdown)

의존 관계: T1 → {T2, T3}. T4는 T1과 병행 가능.

```mermaid
flowchart LR
    T1[T1 타임라인 조회 API] --> T2[T2 셀 이력 API]
    T1 --> T3[T3 이력 UI]
    T2 --> T3
    T4[T4 인덱스/성능] -.병행.- T1
```

### T1. 통합 타임라인 조회 API

- `GET /projects/{project_id}/events` (`features/history`):
  - 필터: `layer_key`, `event_type`, `actor`, `source`, 기간
  - 커서 페이징: `change_event.id`(bigserial) 역순
  - 벌크 묶음: payload의 배치 id로 그룹핑 — 배치 요약(유형/건수/시각/actor) + 상세 확장 조회
- append-only 원칙 재확인: 이 feature는 SELECT만 한다 (repository에 쓰기 메서드를 두지 않음)

산출물: 타임라인 API + 필터/페이징 테스트.

### T2. 셀 단위 이력 API

- `GET /projects/{project_id}/cells/{layer_key}/{parameter_code}/history`
- 해당 셀의 이벤트를 시간순으로 반환: old_value → new_value 연대기, 소스(manual/backbone/…), actor
- 파라미터 표시명은 레지스트리(비활성 포함)에서 역참조 — soft delete 정책 덕에 과거 code도 항상 해석 가능

산출물: 셀 이력 API + 테스트. **EC2의 축.**

### T3. 이력 UI

- **타임라인 패널**: 프로젝트 상세/편집기에서 열람. 필터 바(layer/유형/사용자/소스) + 무한 스크롤
- **벌크 묶음 표시**: "백본 복사 17,226건" 형태의 요약 행 → 펼치면 셀 단위 상세 (지연 로드)
- **셀 점프**: 타임라인 항목 클릭 → 편집기 해당 셀로 스크롤 + 포커스 (Phase 2 검색-점프 재사용)
- **셀 우클릭 → 이력**: 그리드 컨텍스트 메뉴에서 해당 셀의 변경 연대기 팝업
- `features/history` 프론트 슬라이스

산출물: 타임라인 + 셀 이력 화면. **EC1·EC3·EC4 충족.**

### T4. 인덱스/성능

- `change_event` 조회 패턴에 맞는 인덱스: `(project_id, id DESC)`, `(project_id, layer_key, parameter_code, id)` — Alembic 마이그레이션
- 수만~수십만 이벤트 fixture로 타임라인/셀 이력 쿼리 실행 계획 확인
- payload 배치 id 조회가 느리면 배치 id를 컬럼으로 승격하는 개선안 검토 (실측 후 결정)

산출물: 인덱스 마이그레이션 + 성능 확인 기록.

## 실행 순서 요약

1. P4-D1을 Phase 2 착수 전에 교차 확인 (배치 id 기록 누락 방지)
2. T1 타임라인 API + T4 인덱스 (병행)
3. T2 셀 이력 API
4. T3 이력 UI
5. EC1~EC4 점검 → Phase 5 착수 판단
