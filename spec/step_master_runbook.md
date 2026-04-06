# Step Master Operations Runbook

Last updated: 2026-04-03 (UTC)

## 1) Scope
- 대상 DAG
  - `full_to_current_hourly`
  - `incremental_audit_daily`
- 대상 운영 테이블
  - `etl_run_log`
  - `etl_run_line_status`
  - `sync_watermark`
  - `step_current`
  - `step_event_audit`

---

## 2) Per-line Recovery (E2)

### 2.1 장애 식별
1. 최근 실패 런 조회:
```sql
SELECT id, dag_id, run_id, status, started_at, finished_at, failed_lines, error_summary
FROM etl_run_log
WHERE dag_id = 'full_to_current_hourly'
ORDER BY started_at DESC
LIMIT 20;
```
2. 실패 라인 조회:
```sql
SELECT run_log_id, line_id, status, extracted_rows, merged_rows, deleted_rows, dq_violation_count, error_reason
FROM etl_run_line_status
WHERE run_log_id = :run_log_id
ORDER BY line_id;
```

### 2.2 복구 절차
1. 실패 원인 분류
   - source 연결/권한 오류
   - stage 품질 오류(`dq_failed`)
   - delete guardrail 차단(`validated_with_delete_block`)
2. source 또는 설정값 수정
   - Airflow Variable (`STEP_LINE_WHITELIST`, threshold, source DB URL 등)
3. 실패 라인만 재실행
   - mapped task 재실행 대상: `extract_stage_line[line_id]` 이후 체인
4. 재실행 검증
   - `etl_run_line_status`의 해당 `line_id` 상태가 `validated` 또는 `validated_with_delete_block`인지 확인
5. 종료 기록
   - incident ticket에 `run_id`, `line_id`, root-cause, 조치내용 기록

### 2.3 재실행 금지 조건
- source snapshot readiness 미충족(`upstream ready` 미달)
- stage row가 `STEP_MIN_STAGE_ROWS` 미만
- delete ratio / delete count guardrail 초과 상태

---

## 3) Alerting Policy (E3)

### 3.1 Critical
- `full_to_current_hourly` 2회 연속 실패 또는 skip
- freshness SLA 위반(`STEP_CURRENT_FRESHNESS_SLA_MINUTES`, 기본 120분) 지속 30분+

### 3.2 Warning
- `failed_lines > 0`
- `delete_blocked_lines > 0`
- incremental `dq_violation_count > 0`
- incremental `inserted_rows > 0` 이지만 `watermark_advanced=false` (non-backfill)

### 3.3 Signal Source
- DB 기반: `etl_run_log`, `etl_run_line_status`
- 로그 기반:
  - hourly finalize warning
  - incremental publish warning
  - service freshness guard warning (`create_project_v2`)
- webhook 기반(옵션):
  - Airflow Variable `STEP_ALERT_WEBHOOK_URL` 설정 시 JSON alert event POST
  - 이벤트 타입: `run_failed_lines`, `delete_guardrail_blocked`, `incremental_dq_violation`, `watermark_not_advanced`
  - healthcheck critical 이벤트: `service_health_breach`

### 3.4 Healthcheck DAG
- DAG: `step_master_healthcheck_hourly` (`15 * * * *`)
- 판정 기준:
  - latest successful `full_to_current_hourly` freshness가 SLA(기본 120분) 이내
  - `sync_watermark(step_incremental)` 레코드 존재
- 실패 시:
  - critical webhook alert emit
  - DAG task fail (`AirflowFailException`)

---

## 4) Reconciliation Report Queries (E4 support)

### 4.1 line별 current/stage 비교
```sql
-- stage 테이블명은 run/line별로 치환
SELECT
  (SELECT COUNT(*) FROM step_current WHERE line_id = :line_id) AS current_rows,
  (SELECT COUNT(*) FROM step_stage_123) AS stage_rows; -- 예시: 대상 line_id stage 테이블명으로 치환
```

### 4.2 최근 런 요약
```sql
SELECT
  id, run_id, status, failed_lines, extracted_rows, merged_rows, deleted_rows, duration_seconds
FROM etl_run_log
WHERE dag_id = 'full_to_current_hourly'
ORDER BY started_at DESC
LIMIT 50;
```

### 4.3 watermark 진행 확인
```sql
SELECT pipeline_name, last_event_ts, last_sys_key_vals, updated_at
FROM sync_watermark
WHERE pipeline_name = 'step_incremental';
```

---

## 5) Dashboard Definition (E5)

대시보드 최소 위젯:
1. Hourly run status trend (`success/failed/skip`)
2. Freshness lag (now - latest successful full run)
3. Failed lines count by run
4. Delete blocked lines count by run
5. Incremental DQ violations trend
6. Watermark advance ratio (`advanced_runs / total_runs`)

권장 집계 주기:
- 실시간(5분): run 상태 / freshness
- 일간: delete rate / DQ 추세

---

## 6) Incident Severity Matrix (E6)

- **SEV-1**: 서비스 생성 플로우 광범위 중단 (`step_current` stale + fallback 불가)
- **SEV-2**: 다수 라인 실패(`failed_lines` 다수) 또는 watermark 정체 지속
- **SEV-3**: 일부 라인 실패/guardrail 차단 (서비스 영향 제한적)
- **SEV-4**: 일시적 경고(재시도로 자동 회복)

온콜 에스컬레이션:
1) On-call engineer  
2) Data pipeline owner  
3) Backend service owner  
4) Product/PM (고객 영향 시)

---

## 7) Cutover / Rollback Checklist (E7)

### 7.1 Cutover 전
- `USE_STEP_CURRENT` rollout 전략 확정(라인/트래픽 단계적)
- 최근 24시간 `full_to_current_hourly` 성공률 확인
- freshness SLA 위반 이력 확인
- incremental watermark 정상 진행 확인

### 7.2 Cutover 중
- 배포 후 1시간 집중 모니터링
- failed_lines / dq_violation / delete_blocked 급증 여부 확인

### 7.3 Rollback 기준
- SEV-1 발생
- 2회 연속 hourly 실패 + 수동 복구 실패
- freshness SLA 지속 위반(> 120분) + 사용자 영향 확인

### 7.4 Rollback 절차
1. `USE_STEP_CURRENT=false`로 즉시 전환
2. 장애 run_id 캡처 및 증적 보존
3. source/stage/guardrail 원인 분석 후 재배포

---

## 8) Real DB Validation Command (Staging/Prod pre-check)

아래 명령으로 서비스 DB readiness를 빠르게 점검한다.

```bash
python scripts/step_master_db_validation.py \
  --db-url "$STEP_SERVICE_DB_URL" \
  --freshness-sla-minutes 120
```

검증 항목:
- 필수 테이블 존재 여부
- 최근 `full_to_current_hourly` 성공 런 존재 여부
- `sync_watermark(step_incremental)` 존재 여부
- freshness SLA 이내 여부

종료 코드:
- `0`: 모든 체크 통과
- `2`: 하나 이상 실패 (배포/컷오버 중지 권장)
