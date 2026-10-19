# 현재 데이터 모델 검토 HTML

- 진입점: `index.html` — 스키마 JSON을 내장한 단일 HTML, CDN/외부 폰트/서버 API 요청 없음. 파일을 직접 열어도 동작한다.
- 보조 원본: `schema.json` — SQLAlchemy metadata에서 추출한 앱 DB 13개 테이블, 151개 컬럼, 12개 FK. source는 저장소 상대 경로이다.
- 기준: 2026-10-17 작업 트리, HEAD `52b64c6`, `backend/app/models/` 및 `backend/alembic/versions/0001`–`0008` 대조.
- 실행 DB는 introspection하지 않았다. ORM의 NULL/체크 제약과 마이그레이션의 차이는 HTML 본문에 별도 표시했다. 이를 배포 DB의 확정 스키마로 읽지 않는다.
- 실선은 실제 FK, 점선은 명시적으로 설명된 코드/JSON/실행 시 관계다. 리비전 뷰의 v1–v3는 구조 설명용 예시이며 실제 레코드가 아니다.
- 실행 동작 안내는 2026-10-19 기준 main `8aa5052`의 projects repository·wizardState와 동기화했다. 목록은 LINE/Process/Part ID별 최신 버전을 서버에서 고른 뒤 25건씩 조회한다. 등록은 별도 프로젝트명 입력 없이 trimmed Part ID를 호환용 필수 name에 보낸다. 모델 inventory와 스키마 추출 기준은 위의 2026-10-17 기록 그대로다.
- 2026-10-17 독립 검증: inventory와 HTML 내장 JSON 일치, 모델/마이그레이션 의미 검토, 4개 뷰·다이얼로그/ESC·검색·확대·축소·오프라인 열기, 1440/1024/390 화면 검토. 발견한 카드 필드 가림과 선택지 관계선 중첩을 수정했다.
- 이 모델 검토에서는 앱 코드, DB 스키마, 실제 데이터를 변경하지 않았다. 모델 변경 후에는 metadata 재추출과 마이그레이션 대조 후 schema.json 및 HTML 내장 JSON을 함께 갱신해야 한다.
