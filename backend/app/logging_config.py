"""구조화된 로깅 설정 모듈.

운영 환경에서는 JSON 형식, 개발 환경에서는 텍스트 형식으로 로그를 출력한다.
Docker 로그 드라이버와 호환되는 한 줄 JSON 포맷을 사용한다.
"""

import json
import logging
import sys
from datetime import datetime, timezone


class JsonFormatter(logging.Formatter):
    """운영 환경용 JSON 로그 포매터.

    Docker json-file 로그 드라이버와 호환되는 한 줄 JSON 형식으로 출력한다.
    """

    def format(self, record: logging.LogRecord) -> str:
        log_entry = {
            "timestamp": datetime.fromtimestamp(
                record.created, tz=timezone.utc
            ).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }

        if record.exc_info and record.exc_info[0] is not None:
            log_entry["exception"] = self.formatException(record.exc_info)

        request_method = getattr(record, "request_method", None)
        if request_method is not None:
            log_entry["request_method"] = request_method
        request_path = getattr(record, "request_path", None)
        if request_path is not None:
            log_entry["request_path"] = request_path

        return json.dumps(log_entry, ensure_ascii=False)


def setup_logging(environment: str = "development", log_level: str = "INFO") -> None:
    """환경에 따라 로깅을 설정한다.

    Args:
        environment: 실행 환경 (production / development)
        log_level: 로그 레벨 (DEBUG, INFO, WARNING, ERROR, CRITICAL)
    """
    level = getattr(logging, log_level.upper(), logging.INFO)

    root_logger = logging.getLogger()
    root_logger.setLevel(level)

    # 기존 핸들러 제거 (중복 방지)
    root_logger.handlers.clear()

    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(level)

    if environment == "production":
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(
            logging.Formatter(
                "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
                datefmt="%Y-%m-%d %H:%M:%S",
            )
        )

    root_logger.addHandler(handler)

    # 외부 라이브러리 로그 레벨 조정
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)
