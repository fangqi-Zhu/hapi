#!/usr/bin/env bash
set -euo pipefail

HAPI_REPO_URL="${HAPI_REPO_URL:-https://github.com/fangqi-Zhu/hapi.git}"
HAPI_REPO_BRANCH="${HAPI_REPO_BRANCH:-custom/ray1-terminal}"
HAPI_REPO_DIR="${HAPI_REPO_DIR:-/workspace/hapi-custom}"

if [ ! -d "${HAPI_REPO_DIR}/.git" ]; then
    if [ -e "${HAPI_REPO_DIR}" ]; then
        printf '%s exists but is not a Git repository.\n' "${HAPI_REPO_DIR}" >&2
        exit 1
    fi
    git clone --branch "${HAPI_REPO_BRANCH}" "${HAPI_REPO_URL}" "${HAPI_REPO_DIR}"
fi

cd "${HAPI_REPO_DIR}"
git fetch origin "${HAPI_REPO_BRANCH}"
git switch "${HAPI_REPO_BRANCH}"
git merge --ff-only "origin/${HAPI_REPO_BRANCH}"

scripts/ray1/ensure-bun.sh
scripts/ray1/ensure-zellij.sh
scripts/ray1/build-custom-hapi.sh
scripts/ray1/install-custom-hapi.sh --activate
