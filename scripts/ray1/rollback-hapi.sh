#!/usr/bin/env bash
set -euo pipefail

HAPI_OFFICIAL_BIN="/root/.local/bin/hapi-official"
HAPI_ACTIVE_BIN="/root/.local/bin/hapi"

if [ ! -x "${HAPI_OFFICIAL_BIN}" ]; then
    printf 'Official rollback binary is unavailable: %s\n' "${HAPI_OFFICIAL_BIN}" >&2
    exit 1
fi

HAPI_ROLLBACK_LINK="${HAPI_ACTIVE_BIN}.official-new"
ln -sfn "${HAPI_OFFICIAL_BIN}" "${HAPI_ROLLBACK_LINK}"
mv -Tf "${HAPI_ROLLBACK_LINK}" "${HAPI_ACTIVE_BIN}"

printf 'Rolled back to '
"${HAPI_ACTIVE_BIN}" --version

if [ "${1:-}" = "--activate" ]; then
    /root/bin/manage-hapi-services restart
fi
