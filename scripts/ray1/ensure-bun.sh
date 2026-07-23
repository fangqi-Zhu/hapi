#!/usr/bin/env bash
set -euo pipefail

HAPI_BUN_VERSION="${HAPI_BUN_VERSION:-1.3.14}"
HAPI_BUN_ROOT="${HAPI_BUN_ROOT:-/root/.local/bun}"
HAPI_BUN_BIN="${HAPI_BUN_ROOT}/bin/bun"

if [ -x "${HAPI_BUN_BIN}" ] && [ "$("${HAPI_BUN_BIN}" --version)" = "${HAPI_BUN_VERSION}" ]; then
    printf 'Bun %s is already installed at %s\n' "${HAPI_BUN_VERSION}" "${HAPI_BUN_BIN}"
    exit 0
fi

case "$(uname -m)" in
    x86_64)
        HAPI_BUN_TARGET="linux-x64"
        ;;
    aarch64|arm64)
        HAPI_BUN_TARGET="linux-aarch64"
        ;;
    *)
        printf 'Unsupported architecture for Bun: %s\n' "$(uname -m)" >&2
        exit 1
        ;;
esac

HAPI_BUN_ARCHIVE="bun-${HAPI_BUN_TARGET}.zip"
HAPI_BUN_RELEASE_URL="https://github.com/oven-sh/bun/releases/download/bun-v${HAPI_BUN_VERSION}"
HAPI_BUN_TEMP_DIR="$(mktemp -d /tmp/hapi-bun.XXXXXX)"
trap 'find "${HAPI_BUN_TEMP_DIR}" -mindepth 1 -delete 2>/dev/null || true; rmdir "${HAPI_BUN_TEMP_DIR}" 2>/dev/null || true' EXIT

curl --fail --location --silent --show-error \
    "${HAPI_BUN_RELEASE_URL}/${HAPI_BUN_ARCHIVE}" \
    --output "${HAPI_BUN_TEMP_DIR}/${HAPI_BUN_ARCHIVE}"
curl --fail --location --silent --show-error \
    "${HAPI_BUN_RELEASE_URL}/SHASUMS256.txt" \
    --output "${HAPI_BUN_TEMP_DIR}/SHASUMS256.txt"

HAPI_BUN_CHECKSUM_LINE="$(
    awk -v archive="${HAPI_BUN_ARCHIVE}" '$2 == archive { print; exit }' \
        "${HAPI_BUN_TEMP_DIR}/SHASUMS256.txt"
)"
if [ -z "${HAPI_BUN_CHECKSUM_LINE}" ]; then
    printf 'Checksum for %s was not found.\n' "${HAPI_BUN_ARCHIVE}" >&2
    exit 1
fi

(
    cd "${HAPI_BUN_TEMP_DIR}"
    printf '%s\n' "${HAPI_BUN_CHECKSUM_LINE}" | sha256sum --check -
)

unzip -q "${HAPI_BUN_TEMP_DIR}/${HAPI_BUN_ARCHIVE}" -d "${HAPI_BUN_TEMP_DIR}/unpacked"
install -d "${HAPI_BUN_ROOT}/bin"
install -m 0755 \
    "${HAPI_BUN_TEMP_DIR}/unpacked/bun-${HAPI_BUN_TARGET}/bun" \
    "${HAPI_BUN_BIN}"

"${HAPI_BUN_BIN}" --version
