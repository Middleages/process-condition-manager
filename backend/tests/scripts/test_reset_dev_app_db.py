"""Safety contract for the explicit app-database-only Compose reset path."""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[3]
_SCRIPT = _REPO_ROOT / "backend" / "scripts" / "reset_dev_app_db.sh"


def _fake_docker(tmp_path: Path) -> tuple[dict[str, str], Path]:
    binary_directory = tmp_path / "bin"
    binary_directory.mkdir()
    log_path = tmp_path / "docker.log"
    docker = binary_directory / "docker"
    docker.write_text(
        """#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> "$FAKE_DOCKER_LOG"
if [[ "$*" == "compose ps -aq app-db" ]]; then
  echo "fake-app-db-container"
elif [[ "${1:-}" == "inspect" ]]; then
  echo "pcm_phase26_app-db-data"
elif [[ "${1:-}" == "volume" && "${2:-}" == "inspect" ]]; then
  echo "${FAKE_VOLUME_LABEL:-app-db-data}"
fi
"""
    )
    docker.chmod(0o755)
    environment = os.environ.copy()
    environment["PATH"] = f"{binary_directory}:{environment['PATH']}"
    environment["FAKE_DOCKER_LOG"] = str(log_path)
    return environment, log_path


def test_reset_requires_explicit_confirmation_before_calling_docker(tmp_path: Path) -> None:
    environment, log_path = _fake_docker(tmp_path)

    result = subprocess.run(
        [str(_SCRIPT)],
        cwd=_REPO_ROOT,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 2
    assert "--confirm-disposable" in result.stderr
    assert not log_path.exists()


def test_confirmed_reset_only_recreates_the_verified_app_database(tmp_path: Path) -> None:
    environment, log_path = _fake_docker(tmp_path)

    result = subprocess.run(
        [str(_SCRIPT), "--confirm-disposable"],
        cwd=_REPO_ROOT,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    commands = log_path.read_text().splitlines()
    assert "compose stop backend app-db" in commands
    assert "compose rm -f app-db" in commands
    assert "volume rm pcm_phase26_app-db-data" in commands
    assert "compose up -d app-db" in commands
    assert "compose up -d backend" in commands
    assert all("down -v" not in command for command in commands)
    destructive = [
        command
        for command in commands
        if command.startswith(("compose stop", "compose rm", "volume rm"))
    ]
    assert all("ingest-db" not in command for command in destructive)
    assert all("frontend-node-modules" not in command for command in destructive)


def test_reset_refuses_an_unexpected_volume_label(tmp_path: Path) -> None:
    environment, log_path = _fake_docker(tmp_path)
    environment["FAKE_VOLUME_LABEL"] = "ingest-db-data"

    result = subprocess.run(
        [str(_SCRIPT), "--confirm-disposable"],
        cwd=_REPO_ROOT,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 1
    assert "unverified app-db volume" in result.stderr
    commands = log_path.read_text().splitlines()
    assert not any(command.startswith("compose rm") for command in commands)
    assert not any(command.startswith("volume rm") for command in commands)


def test_compose_ports_keep_defaults_and_allow_isolated_overrides() -> None:
    compose = (_REPO_ROOT / "docker-compose.yml").read_text()
    assert '${APP_DB_PORT:-5432}:5432' in compose
    assert '${INGEST_DB_PORT:-5433}:5432' in compose
    assert '${BACKEND_PORT:-8000}:8000' in compose
    assert '${FRONTEND_PORT:-5173}:5173' in compose
