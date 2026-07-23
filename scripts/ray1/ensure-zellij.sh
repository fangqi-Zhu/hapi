#!/usr/bin/env bash
set -euo pipefail

HAPI_ZELLIJ_VERSION="${HAPI_ZELLIJ_VERSION:-0.44.3}"
HAPI_ZELLIJ_BIN="${HAPI_ZELLIJ_BIN:-/root/.local/bin/zellij}"

if [ -x "${HAPI_ZELLIJ_BIN}" ] && \
    "${HAPI_ZELLIJ_BIN}" --version | grep -q "zellij ${HAPI_ZELLIJ_VERSION}"; then
    printf 'Zellij %s is already installed at %s\n' "${HAPI_ZELLIJ_VERSION}" "${HAPI_ZELLIJ_BIN}"
    exit 0
fi

case "$(uname -m)" in
    x86_64)
        HAPI_ZELLIJ_TARGET="x86_64-unknown-linux-musl"
        HAPI_ZELLIJ_SHA256="0f7c346788627f506c0a28296517768633cff24fc822a739f8264b640ecad751"
        ;;
    *)
        printf 'Unsupported architecture for the pinned Zellij build: %s\n' "$(uname -m)" >&2
        exit 1
        ;;
esac

HAPI_ZELLIJ_ARCHIVE="zellij-${HAPI_ZELLIJ_TARGET}.tar.gz"
HAPI_ZELLIJ_TEMP_DIR="$(mktemp -d /tmp/hapi-zellij.XXXXXX)"
trap 'find "${HAPI_ZELLIJ_TEMP_DIR}" -mindepth 1 -delete 2>/dev/null || true; rmdir "${HAPI_ZELLIJ_TEMP_DIR}" 2>/dev/null || true' EXIT

curl --fail --location --silent --show-error \
    "https://github.com/zellij-org/zellij/releases/download/v${HAPI_ZELLIJ_VERSION}/${HAPI_ZELLIJ_ARCHIVE}" \
    --output "${HAPI_ZELLIJ_TEMP_DIR}/${HAPI_ZELLIJ_ARCHIVE}"

printf '%s  %s\n' "${HAPI_ZELLIJ_SHA256}" "${HAPI_ZELLIJ_ARCHIVE}" \
    > "${HAPI_ZELLIJ_TEMP_DIR}/checksum"
(
    cd "${HAPI_ZELLIJ_TEMP_DIR}"
    sha256sum --check checksum
)

tar -xzf "${HAPI_ZELLIJ_TEMP_DIR}/${HAPI_ZELLIJ_ARCHIVE}" \
    -C "${HAPI_ZELLIJ_TEMP_DIR}"
install -d "$(dirname "${HAPI_ZELLIJ_BIN}")"
install -m 0755 "${HAPI_ZELLIJ_TEMP_DIR}/zellij" "${HAPI_ZELLIJ_BIN}"

"${HAPI_ZELLIJ_BIN}" --version
