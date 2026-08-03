#!/usr/bin/env bash
# Restore an encrypted logical dump into a TARGET database URL.
#
# Usage:
#   BACKUP_ENCRYPTION_PASSPHRASE=... TARGET_DATABASE_URL=postgresql://... \
#     ./infra/backup/restore-postgres.sh /path/to/recruiting-help-....sql.gpg
#
# Safety:
# - Refuses to restore into a URL containing "@postgres:5432/" unless
#   CONFIRM_PRODUCTION_RESTORE=yes (use a temporary DB for drills).
set -euo pipefail

DUMP_FILE="${1:-}"
if [[ -z "${DUMP_FILE}" || ! -f "${DUMP_FILE}" ]]; then
  echo "usage: $0 <encrypted-dump.sql.gpg>" >&2
  exit 1
fi
if [[ -z "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ]]; then
  echo "error: BACKUP_ENCRYPTION_PASSPHRASE is required" >&2
  exit 1
fi
if [[ -z "${TARGET_DATABASE_URL:-}" ]]; then
  echo "error: TARGET_DATABASE_URL is required" >&2
  exit 1
fi

if [[ "${TARGET_DATABASE_URL}" == *"@postgres:5432/"* && "${CONFIRM_PRODUCTION_RESTORE:-}" != "yes" ]]; then
  echo "error: refusing restore into compose service URL without CONFIRM_PRODUCTION_RESTORE=yes" >&2
  echo "hint: restore into a temporary local database for drills" >&2
  exit 1
fi

echo "==> Decrypting and restoring ${DUMP_FILE}"
gpg --batch --yes --decrypt --passphrase "${BACKUP_ENCRYPTION_PASSPHRASE}" "${DUMP_FILE}" \
  | psql "${TARGET_DATABASE_URL}" -v ON_ERROR_STOP=1

echo "Restore complete."
