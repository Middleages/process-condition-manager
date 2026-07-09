-- 적재 영역 샘플 스키마 (P1-D2 확정: 단일 테이블, 1행 = 1 layer).
-- ingest-db 최초 기동 시 자동 실행되어, INGEST_READER=pg 로 전환하면 바로 읽을 수 있다.
-- 실제 운영에서는 외부(Prefect) 적재가 이 테이블을 채운다 — PCM은 읽기 전용으로만 접근한다.

CREATE TABLE IF NOT EXISTS public.f_stpes (
    line_id       TEXT NOT NULL,
    process_id    TEXT NOT NULL,
    step_seq      TEXT NOT NULL,
    layer_id      TEXT NOT NULL,
    eqp_type      TEXT,
    eqp_type_desc TEXT,
    area_name     TEXT
);

-- (line_id, process_id, step_seq, layer_id) 는 process 안에서 유일 (P1-D2).
CREATE UNIQUE INDEX IF NOT EXISTS uq_f_stpes_layer
    ON public.f_stpes (line_id, process_id, step_seq, layer_id);

INSERT INTO public.f_stpes
    (line_id, process_id, step_seq, layer_id, eqp_type, eqp_type_desc, area_name)
VALUES
    ('L1', 'PROC_ALPHA', '001', 'CLN', 'CLEAN', 'Initial Clean', 'CLEAN'),
    ('L1', 'PROC_ALPHA', '010', 'ACT', 'PHOTO', 'Active Photo',  'PHOTO'),
    ('L1', 'PROC_ALPHA', '020', 'ACT', 'ETCH',  'Active Etch',   'ETCH'),
    ('L1', 'PROC_BETA',  '001', 'CLN', 'CLEAN', 'Initial Clean', 'CLEAN'),
    ('L1', 'PROC_BETA',  '015', 'WELL','DEP',   'Well Deposition','DEP')
ON CONFLICT DO NOTHING;
