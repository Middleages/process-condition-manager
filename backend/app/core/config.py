"""애플리케이션 설정 (pydantic-settings).

앱 DB와 적재(ingest) DB URL을 분리해 보관한다.
- 앱 DB: Alembic이 소유하는 읽기/쓰기 데이터베이스
- 적재 DB: 외부(Prefect) 소유의 읽기 전용 데이터베이스 (D-11: 같은 인스턴스의 타 DB 허용)

환경변수(대문자)로 각 값을 주입한다. 예: APP_DATABASE_URL, INGEST_DATABASE_URL.
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """환경변수/`.env`에서 로드되는 애플리케이션 설정."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "process-condition-manager"
    debug: bool = False

    # 앱 DB (Alembic 소유, 읽기/쓰기)
    app_database_url: str = (
        "postgresql+asyncpg://pcm_user:pcm_pass@localhost:5432/pcm"
    )
    # 적재 DB (외부 소유, 읽기 전용)
    ingest_database_url: str = (
        "postgresql+asyncpg://pcm_user:pcm_pass@localhost:5432/ingest"
    )

    # 적재 판독기 선택: "fixture"(기본, 개발/단위테스트) | "pg"(실 적재 테이블)
    ingest_reader: str = "fixture"
    # 실 적재 테이블 (단일 테이블, 1행=1 layer — P1-D2 확정 스키마)
    ingest_layer_schema: str | None = "public"
    ingest_layer_table: str = "f_stpes"

    # 개발용 인증 스텁 활성화 여부 (실제 어댑터 구현은 T5)
    auth_dev_stub: bool = True

    # Phase 4 writer 릴리스 게이트: false면 project truth mutation을 503으로 차단한다.
    project_mutations_enabled: bool = True

    # 편집 잠금(T5): TTL 3분, 하트비트 45초. 상수 조정 지점.
    edit_lock_ttl_seconds: int = 180
    edit_lock_heartbeat_seconds: int = 45

    @property
    def app_database_url_sync(self) -> str:
        """동기 드라이버가 필요한 도구(Alembic)를 위한 앱 DB URL."""
        return self.app_database_url.replace("+asyncpg", "+psycopg2")


@lru_cache
def get_settings() -> Settings:
    """설정 싱글턴을 반환한다."""
    return Settings()


settings = get_settings()
