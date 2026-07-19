"""애플리케이션 설정 (pydantic-settings)."""

from __future__ import annotations

import json
from functools import lru_cache
from typing import Any

from pydantic import Field, ValidationInfo, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_ENV_DEFAULTS = {
    "app_name": "process-condition-manager",
    "debug": False,
    "app_database_url": "postgresql+asyncpg://pcm_user:pcm_pass@localhost:5432/pcm",
    "ingest_database_url": "postgresql+asyncpg://pcm_user:pcm_pass@localhost:5432/ingest",
    "ingest_reader": "fixture",
    "ingest_layer_schema": "public",
    "ingest_layer_table": "f_stpes",
    "project_mutations_enabled": True,
    "edit_lock_ttl_seconds": 180,
    "edit_lock_heartbeat_seconds": 45,
    "pcm_environment": "development",
    "pcm_auth_mode": "dev_stub",
    "pcm_auth_issuer": "",
    "pcm_auth_proxy_secrets": [],
    "pcm_auth_admin_groups": [],
    "pcm_auth_reviewer_groups": [],
    "pcm_auth_editor_groups": [],
}


_AUTH_PARSE_ISSUES: dict[str, str] = {}


def _record_auth_parse_issue(field: str, message: str) -> None:
    _AUTH_PARSE_ISSUES[field] = message


def get_auth_parse_issues() -> dict[str, str]:
    return dict(_AUTH_PARSE_ISSUES)


def clear_auth_parse_issues() -> None:
    _AUTH_PARSE_ISSUES.clear()


class Settings(BaseSettings):
    """환경변수/`.env`에서 로드되는 애플리케이션 설정."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = _ENV_DEFAULTS["app_name"]
    debug: bool = _ENV_DEFAULTS["debug"]

    # 앱 DB (Alembic 소유, 읽기/쓰기)
    app_database_url: str = _ENV_DEFAULTS["app_database_url"]
    # 적재 DB (외부 소유, 읽기 전용)
    ingest_database_url: str = _ENV_DEFAULTS["ingest_database_url"]

    # 적재 판독기 선택: "fixture"(기본, 개발/단위테스트) | "pg"(실 적재 테이블)
    ingest_reader: str = _ENV_DEFAULTS["ingest_reader"]
    # 실 적재 테이블 (단일 테이블, 1행=1 layer — P1-D2 확정 스키마)
    ingest_layer_schema: str | None = _ENV_DEFAULTS["ingest_layer_schema"]
    ingest_layer_table: str = _ENV_DEFAULTS["ingest_layer_table"]

    # Phase 4 writer 릴리스 게이트: false면 project truth mutation을 503으로 차단한다.
    project_mutations_enabled: bool = _ENV_DEFAULTS["project_mutations_enabled"]

    # 편집 잠금(T5): TTL 3분, 하트비트 45초. 상수 조정 지점.
    edit_lock_ttl_seconds: int = _ENV_DEFAULTS["edit_lock_ttl_seconds"]
    edit_lock_heartbeat_seconds: int = _ENV_DEFAULTS["edit_lock_heartbeat_seconds"]

    # D-10: SSO/trusted proxy settings
    pcm_environment: str = Field(default=_ENV_DEFAULTS["pcm_environment"])
    pcm_auth_mode: str = Field(default=_ENV_DEFAULTS["pcm_auth_mode"])
    pcm_auth_issuer: str = Field(default=_ENV_DEFAULTS["pcm_auth_issuer"])
    pcm_auth_proxy_secrets: list[str] = Field(default_factory=list)
    pcm_auth_admin_groups: list[str] = Field(default_factory=list)
    pcm_auth_reviewer_groups: list[str] = Field(default_factory=list)
    pcm_auth_editor_groups: list[str] = Field(default_factory=list)

    @field_validator(
        "pcm_auth_proxy_secrets",
        "pcm_auth_admin_groups",
        "pcm_auth_reviewer_groups",
        "pcm_auth_editor_groups",
        mode="before",
    )
    @classmethod
    def _parse_json_list(cls, raw: Any, info: ValidationInfo) -> list[str]:
        """JSON 배열 문자열을 실제 목록으로 해석한다.

        `.env` 기반 설정에서 문자열 입력을 받아 `list[str]`로 변환한다.
        """
        if raw is None:
            return []
        if isinstance(raw, list):
            if not all(isinstance(item, str) for item in raw):
                _record_auth_parse_issue(info.field_name or "unknown", "non-string list item")
                return []
            return raw
        if not isinstance(raw, str):
            _record_auth_parse_issue(info.field_name or "unknown", "non-string auth list payload")
            return []
        text = raw.strip()
        if text == "":
            return []
        try:
            loaded = json.loads(text)
        except json.JSONDecodeError as exc:
            _record_auth_parse_issue(info.field_name or "unknown", str(exc))
            return []
        if not isinstance(loaded, list):
            _record_auth_parse_issue(info.field_name or "unknown", "Expected JSON array")
            return []
        if not all(isinstance(item, str) for item in loaded):
            _record_auth_parse_issue(info.field_name or "unknown", "non-string list item")
            return []
        return loaded

    @property
    def auth_dev_stub(self) -> bool:
        """하위 호환성 속성: 기존 `auth_dev_stub` 시맨틱을 유지한다."""
        return self.pcm_auth_mode == "dev_stub"

    @property
    def app_database_url_sync(self) -> str:
        """동기 드라이버가 필요한 도구(Alembic)를 위한 앱 DB URL."""
        return self.app_database_url.replace("+asyncpg", "+psycopg2")


@lru_cache
def get_settings() -> Settings:
    """설정 싱글턴을 반환한다."""
    return Settings()


settings = get_settings()
