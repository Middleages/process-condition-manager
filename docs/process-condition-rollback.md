# Process Condition Rollback Procedure

## 원칙
- 롤백은 **동일 도메인(process-condition) 내 이전 커밋으로만** 수행한다.
- `/projects` legacy 경로 복구는 금지한다.

## 절차
1. 장애 커밋 식별: API 오류율/로그(`process_condition.create_v2`) 기준으로 문제 SHA 확인.
2. 애플리케이션 롤백: `git revert <SHA>` 또는 직전 안정 SHA로 재배포.
3. 데이터 검증:
   - `step_current.part_id` null/blank 건수
   - `projects`(현행 테이블)의 `(line_id, process, part_id, status in draft/review, is_latest=true)` 중복 건수
4. 기능 스모크:
   - `/api/device-masters/step-current/parts`
   - `/api/device-masters/step-current/layers?line_id=&process_id=&part_id=`
   - `/api/process-conditions/v2`
5. 사후 조치: 원인 수정 후 동일 도메인 경로에서 재배포.
