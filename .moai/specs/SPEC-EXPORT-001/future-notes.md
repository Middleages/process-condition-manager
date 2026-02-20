# SPEC-EXPORT-001 Future Extension Notes

## Export Data Pipeline (SPEC-EXPORT-002 후보)

- 논의일: 2026-02-20
- 맥락: SPEC-EXPORT-001 구현 중 additional_config 논의에서 도출

### 요구사항 요약

전산 출력 시 사내 Big Data 시스템에서 데이터를 불러와 조건표 데이터와 조합/연산하여 출력하는 기능 필요.

예시:
```python
import bigdataquery as bdq
df = bdq.getdata(table=table, custom_columns=columns)
stepseq = df["stepseq"]
# 조건표 데이터와 외부 데이터를 조합하여 연산
output_value = condition_value * external_value / factor
```

### 설계 방향

- `export_data_sources` 테이블: 외부 데이터 소스 정의 (연결 정보, 쿼리 템플릿)
- `export_computed_columns` 테이블: 연산 컬럼 정의 (수식, 참조 컬럼, 데이터 소스)
- `export_column_mappings.source_type` 추가: condition / external / computed 구분

### 현재 결정

- SPEC-EXPORT-001에서는 additional_config JSON textarea 유지
- 별도 SPEC으로 기획 (Phase 5 이후)

### 재논의 시기

SPEC-EXPORT-001 완료 후, Phase 5 기획 시
