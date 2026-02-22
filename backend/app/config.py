from pydantic_settings import BaseSettings


# 애플리케이션 설정 클래스
# .env 파일 또는 환경변수로 값을 오버라이드할 수 있음
# Docker 환경에서는 docker-compose.yml의 environment 섹션에서 주입됨
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
    # 새로운 프론트엔드 도메인을 추가할 때 여기에 추가
    CORS_ORIGINS: str = "http://localhost:5173,http://localhost:80,http://localhost"

    class Config:
        # .env 파일 경로 (backend/ 디렉토리 기준)
        env_file = ".env"


# 전역 설정 인스턴스 - 앱 전체에서 이 객체를 import하여 사용
settings = Settings()
