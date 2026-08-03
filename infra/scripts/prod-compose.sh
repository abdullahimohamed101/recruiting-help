#!/usr/bin/env bash
# Thin wrappers around production Compose. Never creates cloud resources.
#
# Usage from repo root:
#   ./infra/scripts/prod-compose.sh config|ps|logs|up|down|pull|migrate|backup
#
# Env file: .env.production (mode 0600 recommended)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-${ROOT}/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-${ROOT}/infra/compose.prod.yaml}"
CMD="${1:-}"
shift || true

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "error: missing ${ENV_FILE} (copy from infra/env.example)" >&2
  exit 1
fi

compose() {
  docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" "$@"
}

case "${CMD}" in
  config)
    compose config "$@"
    ;;
  ps | status)
    compose ps "$@"
    ;;
  logs)
    compose logs "$@"
    ;;
  up)
    compose up -d "$@"
    ;;
  down)
    compose down "$@"
    ;;
  pull)
    compose pull "$@"
    ;;
  migrate)
    # Runs migrations via a one-shot Node container built from the repo, or host pnpm if present.
    if command -v corepack >/dev/null 2>&1 && [[ -f "${ROOT}/package.json" ]]; then
      (
        cd "${ROOT}"
        # shellcheck disable=SC1091
        set -a
        # DATABASE_URL for migrator should be the admin/superuser URL if set.
        source "${ENV_FILE}"
        set +a
        export DATABASE_URL="${DATABASE_URL:?DATABASE_URL required for migrations}"
        corepack pnpm db:migrate
      )
    else
      echo "error: corepack/pnpm not available on host for migrations" >&2
      exit 1
    fi
    ;;
  backup)
    compose --profile backup run --rm backup "$@"
    ;;
  *)
    cat <<'EOF' >&2
usage: prod-compose.sh <config|ps|logs|up|down|pull|migrate|backup> [args...]

Examples:
  ./infra/scripts/prod-compose.sh config
  ./infra/scripts/prod-compose.sh up
  ./infra/scripts/prod-compose.sh logs -f github-poller
  ./infra/scripts/prod-compose.sh migrate
  ./infra/scripts/prod-compose.sh backup
EOF
    exit 1
    ;;
esac
