#!/usr/bin/env bash
set -euo pipefail

HAPI_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HAPI_REPO_ROOT="$(cd "${HAPI_SCRIPT_DIR}/../.." && pwd)"

"${HAPI_SCRIPT_DIR}/ensure-bun.sh"
export PATH="/root/.local/bun/bin:/root/.local/node/bin:/root/.local/bin:/usr/local/bin:/usr/bin:/bin"

cd "${HAPI_REPO_ROOT}"

printf '\nInstalling locked dependencies...\n'
bun install --frozen-lockfile

printf '\nChecking all workspace types...\n'
bun typecheck

printf '\nRunning the full test suite...\n'
bun run test

printf '\nBuilding the host single executable with embedded web assets...\n'
bun run build:single-exe

case "$(uname -m)" in
    x86_64)
        HAPI_BUILD_TARGET="bun-linux-x64-baseline"
        ;;
    aarch64|arm64)
        HAPI_BUILD_TARGET="bun-linux-aarch64"
        ;;
    *)
        printf 'Unsupported build architecture: %s\n' "$(uname -m)" >&2
        exit 1
        ;;
esac

HAPI_BUILD_OUTPUT="${HAPI_REPO_ROOT}/cli/dist-exe/${HAPI_BUILD_TARGET}/hapi"
test -x "${HAPI_BUILD_OUTPUT}"

printf '\nBuild complete:\n'
ls -lh "${HAPI_BUILD_OUTPUT}"
sha256sum "${HAPI_BUILD_OUTPUT}"
"${HAPI_BUILD_OUTPUT}" --version
