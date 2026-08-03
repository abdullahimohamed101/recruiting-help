#!/usr/bin/env bash
# Encrypted logical Postgres backup for Phase 7.
#
# Produces: <BACKUP_LOCAL_DIR>/recruiting-help-YYYYMMDDTHHMMSSZ.sql.gpg
# Optionally uploads to S3-compatible storage (R2) when BACKUP_UPLOAD=1.
#
# Required env:
#   DATABASE_URL or POSTGRES_* connection vars
#   BACKUP_ENCRYPTION_PASSPHRASE
# Optional:
#   BACKUP_LOCAL_DIR (default /var/backups/recruiting-help)
#   BACKUP_KEEP (default 11 ≈ 7 daily + 4 weekly)
#   BACKUP_UPLOAD (default 0)
#   BACKUP_BUCKET / BACKUP_ENDPOINT / BACKUP_ACCESS_KEY_ID / BACKUP_SECRET_ACCESS_KEY
set -euo pipefail

BACKUP_LOCAL_DIR="${BACKUP_LOCAL_DIR:-/var/backups/recruiting-help}"
BACKUP_KEEP="${BACKUP_KEEP:-11}"
BACKUP_UPLOAD="${BACKUP_UPLOAD:-0}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BASENAME="recruiting-help-${STAMP}.sql.gpg"
OUT_FILE="${BACKUP_LOCAL_DIR}/${BASENAME}"

if [[ -z "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ]]; then
  echo "error: BACKUP_ENCRYPTION_PASSPHRASE is required" >&2
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  if [[ -z "${POSTGRES_USER:-}" || -z "${POSTGRES_DB:-}" || -z "${POSTGRES_PASSWORD:-}" ]]; then
    echo "error: set DATABASE_URL or POSTGRES_USER/POSTGRES_DB/POSTGRES_PASSWORD" >&2
    exit 1
  fi
  DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST:-postgres}:5432/${POSTGRES_DB}"
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "error: pg_dump not found" >&2
  exit 1
fi
if ! command -v gpg >/dev/null 2>&1; then
  echo "error: gpg not found" >&2
  exit 1
fi

mkdir -p "${BACKUP_LOCAL_DIR}"
chmod 700 "${BACKUP_LOCAL_DIR}"

echo "==> Dumping and encrypting to ${OUT_FILE}"
pg_dump --no-owner --format=plain "${DATABASE_URL}" \
  | gpg --batch --yes --symmetric --cipher-algo AES256 \
    --passphrase "${BACKUP_ENCRYPTION_PASSPHRASE}" \
    -o "${OUT_FILE}"
chmod 600 "${OUT_FILE}"

echo "==> Applying retention (keep newest ${BACKUP_KEEP})"
shopt -s nullglob
mapfile -t ALL_BACKUPS < <(ls -1t "${BACKUP_LOCAL_DIR}"/recruiting-help-*.sql.gpg)
if ((${#ALL_BACKUPS[@]} > BACKUP_KEEP)); then
  for file in "${ALL_BACKUPS[@]:BACKUP_KEEP}"; do
    rm -f "${file}"
  done
fi

if [[ "${BACKUP_UPLOAD}" == "1" ]]; then
  for required in BACKUP_BUCKET BACKUP_ENDPOINT BACKUP_ACCESS_KEY_ID BACKUP_SECRET_ACCESS_KEY; do
    if [[ -z "${!required:-}" ]]; then
      echo "error: ${required} required when BACKUP_UPLOAD=1" >&2
      exit 1
    fi
  done
  if ! command -v aws >/dev/null 2>&1; then
    echo "error: aws CLI required when BACKUP_UPLOAD=1" >&2
    exit 1
  fi
  echo "==> Uploading ${BASENAME} to ${BACKUP_BUCKET}"
  AWS_ACCESS_KEY_ID="${BACKUP_ACCESS_KEY_ID}" \
    AWS_SECRET_ACCESS_KEY="${BACKUP_SECRET_ACCESS_KEY}" \
    aws --endpoint-url "${BACKUP_ENDPOINT}" s3 cp "${OUT_FILE}" "s3://${BACKUP_BUCKET}/${BASENAME}"
fi

echo "Backup complete: ${OUT_FILE}"
