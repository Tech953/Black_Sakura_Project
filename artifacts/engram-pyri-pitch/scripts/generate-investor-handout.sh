#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARTIFACT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${ARTIFACT_DIR}/../.." && pwd)"
OUTPUT_DIR="${REPO_ROOT}/.local/outputs"
OUTPUT_PATH="${OUTPUT_DIR}/ENGRAM-PYRI-Investor-Handout.pdf"
CHROMIUM_BIN="${CHROMIUM_BIN:-chromium}"

mkdir -p "${OUTPUT_DIR}"
"${CHROMIUM_BIN}" \
  --headless \
  --no-sandbox \
  --disable-gpu \
  --disable-dev-shm-usage \
  --no-first-run \
  --no-default-browser-check \
  --no-pdf-header-footer \
  --print-to-pdf="${OUTPUT_PATH}" \
  "file://${SCRIPT_DIR}/investor-handout.html"

printf 'Wrote %s\n' "${OUTPUT_PATH}"