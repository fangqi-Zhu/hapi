#!/usr/bin/env bash
set -euo pipefail

HAPI_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HAPI_REPO_ROOT="$(cd "${HAPI_SCRIPT_DIR}/../.." && pwd)"
HAPI_INSTALL_STATE="/root/.local/share/hapi-custom"
HAPI_BIN_LINK="/root/.local/bin/hapi"

case "$(uname -m)" in
    x86_64)
        HAPI_BUILD_TARGET="bun-linux-x64-baseline"
        ;;
    aarch64|arm64)
        HAPI_BUILD_TARGET="bun-linux-aarch64"
        ;;
    *)
        printf 'Unsupported install architecture: %s\n' "$(uname -m)" >&2
        exit 1
        ;;
esac

HAPI_BUILD_OUTPUT="${HAPI_REPO_ROOT}/cli/dist-exe/${HAPI_BUILD_TARGET}/hapi"
if [ ! -x "${HAPI_BUILD_OUTPUT}" ]; then
    printf 'Custom binary is missing: %s\n' "${HAPI_BUILD_OUTPUT}" >&2
    printf 'Run scripts/ray1/build-custom-hapi.sh first.\n' >&2
    exit 1
fi

HAPI_CUSTOM_VERSION="$("${HAPI_BUILD_OUTPUT}" --version | awk '{print $NF}')"
HAPI_SOURCE_COMMIT="$(git -C "${HAPI_REPO_ROOT}" rev-parse HEAD)"
HAPI_SOURCE_COMMIT_SHORT="${HAPI_SOURCE_COMMIT:0:12}"
HAPI_BUILD_DIR="${HAPI_INSTALL_STATE}/builds/${HAPI_CUSTOM_VERSION}-${HAPI_SOURCE_COMMIT_SHORT}"
HAPI_BACKUP_DIR="${HAPI_INSTALL_STATE}/backups/$(date -u +%Y%m%dT%H%M%SZ)-$$"

install -d "${HAPI_BUILD_DIR}" /root/.local/bin /root/bin /root/.config/hapi
install -d -m 0700 "${HAPI_BACKUP_DIR}"
install -m 0755 "${HAPI_BUILD_OUTPUT}" "${HAPI_BUILD_DIR}/hapi"
sha256sum "${HAPI_BUILD_DIR}/hapi" > "${HAPI_BUILD_DIR}/sha256.txt"
printf '%s\n' "${HAPI_SOURCE_COMMIT}" > "${HAPI_BUILD_DIR}/source-commit.txt"

if [ -d /root/.hapi ]; then
    cp -a /root/.hapi "${HAPI_BACKUP_DIR}/hapi-data-raw"
    if [ -f /root/.hapi/hapi.db ]; then
        python3 - "${HAPI_BACKUP_DIR}/hapi.db.snapshot" <<'PY'
import sqlite3
import sys

source = sqlite3.connect("file:/root/.hapi/hapi.db?mode=ro", uri=True)
target = sqlite3.connect(sys.argv[1])
with target:
    source.backup(target)
if target.execute("pragma integrity_check").fetchone()[0] != "ok":
    raise SystemExit("HAPI database snapshot failed its integrity check")
target.close()
source.close()
PY
    fi
    find /root/.hapi -type f -exec sha256sum {} + \
        > "${HAPI_BACKUP_DIR}/hapi-data-source-sha256.txt"
fi

if [ -e "${HAPI_BIN_LINK}" ] || [ -L "${HAPI_BIN_LINK}" ]; then
    cp -a "${HAPI_BIN_LINK}" "${HAPI_BACKUP_DIR}/hapi"
    readlink -f "${HAPI_BIN_LINK}" > "${HAPI_BACKUP_DIR}/resolved-target.txt"
fi

if [ -x /root/.local/node/bin/hapi ]; then
    ln -sfn /root/.local/node/bin/hapi /root/.local/bin/hapi-official
elif [ -s "${HAPI_BACKUP_DIR}/resolved-target.txt" ]; then
    HAPI_OFFICIAL_TARGET="$(sed -n '1p' "${HAPI_BACKUP_DIR}/resolved-target.txt")"
    ln -sfn "${HAPI_OFFICIAL_TARGET}" /root/.local/bin/hapi-official
else
    printf 'Could not identify an official HAPI binary for rollback.\n' >&2
    exit 1
fi

install -m 0755 "${HAPI_SCRIPT_DIR}/hapi-zellij-shell" /root/bin/hapi-zellij-shell
install -m 0644 "${HAPI_SCRIPT_DIR}/zellij.kdl" /root/.config/hapi/zellij.kdl
install -m 0755 "${HAPI_SCRIPT_DIR}/hapi-hub-service" /root/bin/hapi-hub-service
install -m 0755 "${HAPI_SCRIPT_DIR}/hapi-runner-service" /root/bin/hapi-runner-service
install -m 0755 "${HAPI_SCRIPT_DIR}/manage-hapi-services.sh" /root/bin/manage-hapi-services

HAPI_NEW_LINK="${HAPI_BIN_LINK}.custom-new"
ln -sfn "${HAPI_BUILD_DIR}/hapi" "${HAPI_NEW_LINK}"
mv -Tf "${HAPI_NEW_LINK}" "${HAPI_BIN_LINK}"
ln -sfn "${HAPI_BUILD_DIR}/hapi" /root/.local/bin/hapi-custom

printf '%s\n' "${HAPI_BUILD_DIR}" > "${HAPI_INSTALL_STATE}/active-build.txt"
printf '%s\n' "${HAPI_BACKUP_DIR}" > "${HAPI_INSTALL_STATE}/latest-backup.txt"

"${HAPI_BIN_LINK}" --version

if [ "${1:-}" = "--activate" ]; then
    /root/bin/manage-hapi-services restart
fi
