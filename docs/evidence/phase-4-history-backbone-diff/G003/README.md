# G003 Backbone diff 20k 성능 증거

상태: **PASS**. 정본 수치는 같은 디렉터리의 [`run.json`](run.json)이다.

## 재현 명령

```bash
cd backend
APP_TEST_DATABASE_URL=postgresql+asyncpg://<guard-admin-host>/<source-db> \
  uv run python -m scripts.measure_backbone_diff_perf

APP_TEST_DATABASE_URL=postgresql+asyncpg://<guard-admin-host>/<source-db> \
  uv run pytest tests/performance/test_measure_backbone_diff_perf.py -q --no-cov
```

`APP_TEST_DATABASE_URL`은 기존 DB를 측정 대상으로 쓰지 않는다. 공용 guard가
`pcm_phase26_test_<uuid>` child DB만 생성·삭제하며, 이번 실행의 child
`pcm_phase26_test_8b72b6e2bbb142b6b185ce2857c47e8c`도 종료 전에 삭제됐다. 기존 review DB/volume은 변경하지 않았다.

## 고정 fixture와 측정 규약

- seed `20260717`; project 1, layer 100, layer당 condition 1,
  parameter 200개, 총 coordinate 20,000개.
- 각 layer는 같은 객체를 재사용하지 않는 **서로 다른 immutable snapshot**을 가진다.
- parameter type은 number 50, text 100,
  choice 50개다. 현재 null coordinate는
  1,000개다.
- `changed` 2,000개(10%)와 `cleared`
  1,000개(5%)는 겹치지 않는다. 총 non-unchanged 비율은
  15%다.
- setup/seed는 측정 밖이다. 각 경로를 1회 warm한 뒤 다음 5회를 측정한다.
- p50/p95는 보수적인 `nearest-rank-ceiling`이다. 표본 5개의 p95는 최댓값이다.
- pure compute는 DB에서 immutable graph를 materialize한 뒤 fresh child process에서 측정한다.
  Timing 5회 동안 cyclic GC는 비활성화하며, tracemalloc은 GC를 복원한 뒤 timing과
  분리된 1회 실행이다. HTTP gate는 GC를 비활성화하지 않는다.
- HTTP는 등록된 FastAPI route를 ASGI HTTP client로 실제 호출한다. root는 preview 20,
  condition은 limit 50, cell은 include-unchanged scope에서 limit 100을 요청한다.
- HTTP 각 요청은 독립적으로 loader와 pure compute를 다시 수행한다. SQL recorder는
  `SET TRANSACTION READ ONLY`가 첫 문장인지와 SELECT/round-trip 수를 함께 고정한다.
- CPU affinity를 강제하지 않았다. 캡처 시 1/5/15분 load average는
  `3.75/3.36/3.48`
  (6 logical CPUs)였다.

## 결과

| gate | p50 ms | p95 ms | max ms | SQL / trips | response | budget |
|---|---:|---:|---:|---:|---:|---|
| pure diff 20k | 183.16 | 186.31 | 186.31 | n/a | peak 30.10 MiB | p95 <=250 ms, peak <=64 MiB |
| root preview 20 | 482.13 | 501.09 | 501.09 | 5 / 6 | 80,472 B | p95 <=600 ms, <=8 / <=9, <=256 KiB |
| condition limit 50 | 450.76 | 482.64 | 482.64 | 5 / 6 | 1,708 B | p95 <=600 ms, <=8 / <=9, <=256 KiB |
| cell limit 100 | 515.84 | 545.40 | 545.40 | 5 / 6 | 49,205 B | p95 <=600 ms, <=8 / <=9, <=256 KiB |

Pure 결과의 실제 분류 합은 `changed=2,000`, `cleared=1,000`, `unchanged=17,000`,
`added=removed=0`이다. HTTP 세 경로 모두 매 요청 5 SELECT / 6 round-trips였고,
첫 문장은 `SET TRANSACTION READ ONLY`였다. 별도 transaction probe도
`isolation=repeatable read`, `read_only=on`를 확인했다.
`run.json.failures`는 빈 배열이다.

## 해석 범위

이 증거는 동일 host의 guarded local PostgreSQL과 in-process ASGI transport를 사용한다.
따라서 외부 network/TLS latency를 대표하지 않지만, 계약 대상인 loader, transaction setup,
pure comparison, FastAPI validation/serialization, 실제 response bytes는 모두 포함한다.
수치는 기준 완화, percentile 보간, 추가 warmup, CPU pinning 없이 얻었다.

## 재현성 보강

병렬 reviewer가 함께 실행 중이던 진단 1회에서 cell p95가 `692.62 ms`로 실패했고,
이를 숨기거나 기준을 완화하지 않았다. 병렬 작업을 종료한 독점 환경에서 같은 runner를
변경 없이 3회 연속 재실행한 결과, cell p95는 각각 `508.91 / 507.43 / 540.87 ms`였고
세 실행 모두 전체 gate를 통과했다. executable binding test도 runner를 3회 순차 실행해
이 안정성 규칙을 지속적으로 고정한다.
