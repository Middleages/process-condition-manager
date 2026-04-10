# Process Condition Cutover Checklist

## 배포 전(Pre-deploy)
- [ ] `alembic upgrade head`로 `027_add_part_id_to_step_current_and_indexes` 적용 확인
- [ ] `/api/device-masters/step-current/processes` → `/parts` → `/layers` 체인 정상 응답 확인
- [ ] `/api/process-conditions/v2` 생성 요청이 `selected_layer_refs=[]`(full)에서 성공하는지 확인
- [ ] `/api/projects` 경로가 더 이상 라우팅되지 않는지(404) 확인

## 배포 중(Deploy)
- [ ] 생성 요청 p95 지연시간 모니터링 (기준: 2s 이하)
- [ ] 4xx 비율 모니터링: 400/409/422 급증 여부
- [ ] 5xx 비율 모니터링: create/revise 라우트 집중 확인

## 배포 후(Post-deploy)
- [ ] 자연키 `(line_id, process, part_id)` 기준 중복 생성 차단 검증
- [ ] `step_current.part_id` 기준으로 part 자유입력 없이 생성 가능한지 UI 점검
- [ ] backbone 선택 후 생성 결과에서 레이어 조건 복사 정합성 점검
