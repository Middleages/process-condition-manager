# 도메인 용어 사전

PCM(Process Condition Manager)이 다루는 반도체 Photo 공정 도메인의 용어만 정리한 사전.
구현(코드/컴포넌트/테이블) 용어는 재구축 아키텍처가 바뀌므로 제외한다. 전산출력(Export) 도메인은 Phase 6 대상이라 현재는 제외한다.

## Backbone (백본)

| 용어 | 영문 | 설명 |
|------|------|------|
| **Backbone** | Backbone / Base Condition | 기존 양산 제품의 공정조건표. 신규 프로젝트 생성 시 복사하여 초안의 기반이 되는 참조 데이터 |
| **메인 Backbone** | Main Backbone | 프로젝트 생성 시 선택한 기준 제품의 Backbone |
| **레이어별 Backbone 교체** | Layer Backbone Replacement | 특정 레이어만 다른 제품의 조건으로 교체. 레이어별로 다른 제품 조합 가능 |

## Recipe (레시피)

| 용어 | 영문 | 설명 |
|------|------|------|
| **Recipe XML** | Recipe XML / Equipment Recipe | 설비에서 추출한 공정 조건 데이터(XML 형식) |
| **Recipe 적용** | Recipe Apply | XML 데이터를 조건표에 반영하는 작업. Diff 계산 후 선택적 적용 |
| **Recipe Diff** | Recipe Diff | XML의 조건값과 현재 조건표의 차이 |
| **XML 매핑** | XML Column Mapping | XML의 XPath와 조건표 파라미터명 간 매핑 (관리자 설정) |

## Layer (레이어)

| 용어 | 영문 | 설명 |
|------|------|------|
| **Layer** | Layer / Process Step | process 내부의 개별 제조 step. 조건표의 행(Row). 제품당 100개 미만을 기준으로 하며 **process마다 구성이 다름**. `photo`, `etch`, `계측` 등은 layer의 이름/유형으로 표현한다 |
| **Layer Name** | Layer Name | 레이어의 이름. 예: AA_PHOTO, GATE_PHOTO |
| **Step Seq** | Step Sequence | 레이어의 공정 순서 번호 |

## 공정조건표

| 용어 | 영문 | 설명 |
|------|------|------|
| **공정조건표** | Process Condition Table | 레이어(행) × 파라미터(열)로 구성된 반도체 공정 조건 데이터. 프로젝트의 핵심 |
| **조건 (Condition)** | Condition / Parameter Value | 특정 레이어-파라미터의 값 |
| **파라미터** | Parameter / Column | 공정 조건의 항목. 100~200개 이상. 예: PR_TYPE, SPIN_SPEED. 전 process 공통이며 관리자가 제어하는 레지스트리로 관리 |
| **셀** | Cell | 조건표의 한 칸. 레이어 × 파라미터의 교점 |
| **Dirty Cell** | Dirty Cell / Modified Cell | 사용자가 편집했으나 아직 저장하지 않은 셀 |

## 카테고리

| 용어 | 영문 | 설명 |
|------|------|------|
| **SP (Spin/PR)** | SP (Spin/PR) | 코팅 관련 카테고리. PR 도포, 스핀, 프리베이크, 접착제 등 |
| **SC (Scanner/Expose)** | SC (Scanner/Expose) | 노광 관련 카테고리. 노광 장비, 레티클, 에너지, 포커스 등 |
| **OVL (Overlay)** | OVL (Overlay) | 정렬 정밀도 관련 카테고리. 오버레이 측정, 보정, APC 등 |
| **DEV (Develop)** | DEV (Develop) | 후처리 관련 카테고리. 현상, 린스, 포스트베이크, CD 측정 등 |

> 카테고리는 파라미터별 속성이며 관리자가 설정 가능한 구조로 재설계됨 (기존처럼 고정 4종이 아님 — [02-data-model.md](./02-data-model.md) 참조).

## Photo 공정

| 용어 | 영문 | 설명 |
|------|------|------|
| **Photo 공정** | Photolithography Process | 반도체 제조의 미세 패턴 형성 공정. PCM의 대상 |
| **제품** | Product | 반도체 칩의 종류. 예: Product_A, Product_B |
| **라인** | Line | 제조 생산 라인. 제품은 라인에 속함 |
| **Process** | Process | 하나의 제품/route가 완성될 때까지 통과하는 전체 layer/step 집합. 단일 `photo`, `etch`, `계측` 공정 종류가 아니라 프로젝트 생성의 기준이 되는 제품 공정 흐름이다 — 재구축 아키텍처의 핵심 전제. **구조(partid, processid, stepseq, area 등)만 가지며 조건 값은 없다** — 값은 백본 프로젝트에서 온다 (D-14). 장기적으로 process당 활성 프로젝트 1개로 수렴한다 |

## 프로젝트 상태 (Workflow)

| 용어 | 영문 | 설명 | 다음 상태 |
|------|------|------|----------|
| **Draft** | Draft | 초안 상태. 작성 중이거나 검토 반려됨. 수정 가능 | Review (검증 오류 0건 필수) |
| **Review** | Review / Under Review | 검토 중. 편집 불가 | Approved 또는 Rejected |
| **Approved** | Approved | 승인 완료. 파라미터 세트가 스냅샷으로 동결됨 | Archived (Revision 생성 시) |
| **Rejected** | Rejected | 반려. Draft로 복귀 가능 | Draft |
| **Archived** | Archived | 보관. Revision 생성으로 이전 버전이 됨. 읽기 전용 | (최종 상태) |

## Revision (개정)

| 용어 | 영문 | 설명 |
|------|------|------|
| **Revision** | Revision / Version | 프로젝트의 버전 번호. Approved → Revision 시 증가 |
| **Revision 생성** | Create Revision | Approved 상태에서 새 Draft(버전+1) 생성, 기존은 Archived로 전환 |

## 프로젝트 약어

| 약어 | 영문 | 설명 |
|------|------|------|
| **PCM** | Process Condition Manager | 이 프로젝트의 이름 |
| **SP** | Spin/PR | 카테고리: 코팅 관련 |
| **SC** | Scanner/Expose | 카테고리: 노광 관련 |
| **OVL** | Overlay | 카테고리: 정렬 정밀도 관련 |
| **DEV** | Develop | 카테고리: 후처리 관련 |
| **PR** | Photoresist | PR 레지스트. 감광성 물질 |
