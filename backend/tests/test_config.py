"""config.py 운영 환경 검증 및 logging_config.py 테스트.

Covers:
- Settings 기본값 (development 환경)
- 운영 환경(production) SECRET_KEY 기본값 차단
- 운영 환경(production) 짧은 SECRET_KEY 차단
- 운영 환경(production) 기본 DB 비밀번호 차단
- 운영 환경(production) 복합 오류 메시지
- 올바른 운영 환경 설정 통과
- ENVIRONMENT / LOG_LEVEL / JWT 토큰 설정 필드 존재
- JsonFormatter JSON 출력 형식
- setup_logging 환경별 포맷 전환
"""

import json
import io
import logging

import pytest

from app.config import Settings
from app.logging_config import JsonFormatter, setup_logging


# ---------------------------------------------------------------------------
# config.py: 개발 환경 기본값
# ---------------------------------------------------------------------------

class TestSettingsDefaults:
    """개발 환경 기본값 테스트."""

    def test_default_environment_is_development(self):
        s = Settings()
        assert s.ENVIRONMENT == "development"

    def test_default_log_level(self):
        s = Settings()
        assert s.LOG_LEVEL == "INFO"

    def test_default_jwt_access_token_expire(self):
        s = Settings()
        assert s.ACCESS_TOKEN_EXPIRE_MINUTES == 15

    def test_default_jwt_refresh_token_expire(self):
        s = Settings()
        assert s.REFRESH_TOKEN_EXPIRE_DAYS == 7

    def test_development_allows_default_secret_key(self):
        """개발 환경에서는 기본 SECRET_KEY로 정상 생성된다."""
        s = Settings(ENVIRONMENT="development")
        assert s.SECRET_KEY == "change-this-secret-key"


# ---------------------------------------------------------------------------
# config.py: 운영 환경 검증
# ---------------------------------------------------------------------------

class TestProductionValidation:
    """운영 환경(production) validator 테스트."""

    def test_rejects_default_secret_key(self):
        with pytest.raises(ValueError, match="SECRET_KEY가 기본값"):
            Settings(ENVIRONMENT="production")

    def test_rejects_short_secret_key(self):
        with pytest.raises(ValueError, match="너무 짧습니다"):
            Settings(ENVIRONMENT="production", SECRET_KEY="short-key")

    def test_rejects_default_db_password(self):
        with pytest.raises(ValueError, match="기본 비밀번호"):
            Settings(
                ENVIRONMENT="production",
                SECRET_KEY="a" * 32,
                DATABASE_URL="postgresql+asyncpg://pcm_user:pcm_pass@db:5432/pcm",
            )

    def test_multiple_errors_combined(self):
        """여러 검증 실패가 하나의 ValueError에 합쳐진다."""
        with pytest.raises(ValueError) as exc_info:
            Settings(
                ENVIRONMENT="production",
                SECRET_KEY="short",
                DATABASE_URL="postgresql+asyncpg://pcm_user:pcm_pass@db:5432/pcm",
            )
        msg = str(exc_info.value)
        assert "너무 짧습니다" in msg
        assert "기본 비밀번호" in msg

    def test_accepts_valid_production_settings(self):
        s = Settings(
            ENVIRONMENT="production",
            SECRET_KEY="a" * 32,
            DATABASE_URL="postgresql+asyncpg://pcm_user:strong_pw@db:5432/pcm",
            DATABASE_URL_SYNC="postgresql://pcm_user:strong_pw@db:5432/pcm",
        )
        assert s.ENVIRONMENT == "production"

    def test_secret_key_exactly_32_chars_passes(self):
        """SECRET_KEY가 정확히 32자일 때 통과한다."""
        s = Settings(
            ENVIRONMENT="production",
            SECRET_KEY="x" * 32,
            DATABASE_URL="postgresql+asyncpg://u:safe_pw@db:5432/pcm",
            DATABASE_URL_SYNC="postgresql://u:safe_pw@db:5432/pcm",
        )
        assert len(s.SECRET_KEY) == 32


# ---------------------------------------------------------------------------
# logging_config.py: 로깅 설정
# ---------------------------------------------------------------------------

class TestLoggingConfig:
    """logging_config.py 테스트."""

    def test_setup_logging_development_uses_text_format(self):
        setup_logging("development", "DEBUG")
        root = logging.getLogger()
        assert root.level == logging.DEBUG
        assert not isinstance(root.handlers[0].formatter, JsonFormatter)

    def test_setup_logging_production_uses_json_format(self):
        setup_logging("production", "WARNING")
        root = logging.getLogger()
        assert root.level == logging.WARNING
        assert isinstance(root.handlers[0].formatter, JsonFormatter)

    def test_json_formatter_output_is_valid_json(self):
        formatter = JsonFormatter()
        stream = io.StringIO()
        handler = logging.StreamHandler(stream)
        handler.setFormatter(formatter)

        logger = logging.getLogger("test_json_output")
        logger.handlers = [handler]
        logger.setLevel(logging.INFO)
        logger.info("테스트 메시지")

        output = stream.getvalue().strip()
        parsed = json.loads(output)

        assert parsed["level"] == "INFO"
        assert parsed["message"] == "테스트 메시지"
        assert "timestamp" in parsed
        assert parsed["logger"] == "test_json_output"

    def test_json_formatter_includes_exception(self):
        formatter = JsonFormatter()
        stream = io.StringIO()
        handler = logging.StreamHandler(stream)
        handler.setFormatter(formatter)

        logger = logging.getLogger("test_json_exception")
        logger.handlers = [handler]
        logger.setLevel(logging.ERROR)

        try:
            raise RuntimeError("테스트 예외")
        except RuntimeError:
            logger.exception("오류 발생")

        output = stream.getvalue().strip()
        parsed = json.loads(output)

        assert "exception" in parsed
        assert "RuntimeError" in parsed["exception"]

    def test_setup_logging_clears_existing_handlers(self):
        """setup_logging 재호출 시 핸들러가 중복되지 않는다."""
        setup_logging("development", "INFO")
        setup_logging("production", "WARNING")
        root = logging.getLogger()
        assert len(root.handlers) == 1

    def test_uvicorn_log_level_adjusted(self):
        setup_logging("production", "DEBUG")
        uvicorn_logger = logging.getLogger("uvicorn.access")
        assert uvicorn_logger.level == logging.WARNING
