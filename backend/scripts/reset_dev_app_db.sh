#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" != "--confirm-disposable" ]]; then
  echo "usage: backend/scripts/reset_dev_app_db.sh --confirm-disposable" >&2
  exit 2
fi
repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$repo_root"
docker compose stop backend app-db
container="$(docker compose ps -aq app-db)"
if [[ -z "$container" ]]; then
  docker compose create app-db >/dev/null
  container="$(docker compose ps -aq app-db)"
fi
volume="$(docker inspect "$container" --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}')"
if [[ -z "$volume" ]] || [[ "$(docker volume inspect "$volume" --format '{{index .Labels "com.docker.compose.volume"}}')" != "app-db-data" ]]; then
  echo "refusing to remove an unverified app-db volume" >&2
  exit 1
fi
docker compose rm -f app-db
docker volume rm "$volume"
docker compose up -d app-db
docker compose up -d backend
