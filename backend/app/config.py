from pydantic import model_validator
from pydantic_settings import BaseSettings


# @MX:ANCHOR: [AUTO] 앱 전역 설정 — 모든 모듈에서 import
# @MX:REASON: fan_in >= 3 (main, routers, auth 등 다수 모듈에서 참조)
class Settings(BaseSettings):
    # 비동기 DB 접속 URL (asyncpg 드라이버 사용, FastAPI의 async 핸들러에서 사용)
    DATABASE_URL: str = "postgresql+asyncpg://pcm_user:pcm_pass@db:5432/pcm"

    # 동기 DB 접속 URL (Alembic 마이그레이션 등 동기 작업에서 사용)
    DATABASE_URL_SYNC: str = "postgresql://pcm_user:pcm_pass@db:5432/pcm"

    # JWT 토큰 서명에 사용하는 비밀키 (운영 환경에서는 반드시 변경 필요)
    SECRET_KEY: str = "change-this-secret-key"

    # 애플리케이션 이름 (API 문서 제목 등에 표시)
    APP_NAME: str = "Process Condition Manager"

    # CORS 허용 출처 (쉼표 구분, 프론트엔드 개발서버와 nginx 주소)
    CORS_ORIGINS: str = "http://localhost:5173,http://localhost:80,http://localhost"

    # 실행 환경 (development | production)
    ENVIRONMENT: str = "development"

    # 로그 레벨 (DEBUG, INFO, WARNING, ERROR, CRITICAL)
    LOG_LEVEL: str = "INFO"

    # SSO / Cookie 설정
    FRONTEND_URL: str = "https://pcm.fhoto.net"
    IDP_ENTITY_ID: str = ""
    IDP_SIGNOUT_URL: str = ""
    IDP_CLIENT_ID: str = ""
    SP_REDIRECT_URL: str = ""
    CERTFILE_NAME: str = ""
    CERTFILE_PATH: str = ""

    COOKIE_SECURE: bool = False
    COOKIE_SAMESITE: str = "lax"

    # Step Master 최신 스냅샷(step_current) 기반 레이어 조회 전환 플래그
    USE_STEP_CURRENT: bool = False


    # 개발 전용 로그인 우회
    DEV_LOGIN_ENABLED: bool = False
    DEV_LOGIN_ALLOWLIST: str = ""
    DEV_LOGIN_DEFAULT_USERNAME: str = "dev_user"

    # JWT 액세스 토큰 만료 시간 (분)
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480

    # JWT 리프레시 토큰 만료 시간 (일)
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # @MX:WARN: [AUTO] 운영 환경 안전 검증 — 기본값으로 기동 시 데이터 유출 위험
    # @MX:REASON: SECRET_KEY/DB 비밀번호 기본값이면 운영 환경에서 보안 사고 발생 가능
    @model_validator(mode="after")
    def validate_production_settings(self) -> "Settings":
        """운영 환경(production)일 때 보안 설정을 검증한다."""
        if self.ENVIRONMENT != "production":
            return self

        errors: list[str] = []

        if self.SECRET_KEY == "change-this-secret-key":
            errors.append(
                "SECRET_KEY가 기본값입니다. "
                "운영 환경에서는 반드시 변경하세요: "
                "openssl rand -hex 32"
            )

        if len(self.SECRET_KEY) < 32:
            errors.append(
                f"SECRET_KEY가 너무 짧습니다 ({len(self.SECRET_KEY)}자). "
                "최소 32자 이상이어야 합니다."
            )

        if "pcm_pass@" in self.DATABASE_URL:
            errors.append(
                "DATABASE_URL에 기본 비밀번호(pcm_pass)가 사용되고 있습니다. "
                "운영 환경에서는 반드시 변경하세요."
            )

        if errors:
            raise ValueError(
                "운영 환경 설정 검증 실패:\n" + "\n".join(f"  - {e}" for e in errors)
            )

        return self

    class Config:
        env_file = ".env"


# 전역 설정 인스턴스 — 앱 전체에서 이 객체를 import하여 사용
settings = Settings()
