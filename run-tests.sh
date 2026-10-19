#!/usr/bin/env bash
# Discoverable test entry point for the smoke gate and CI.
#
# Runs the unit and integration suites and exits non-zero if any test fails.
# Usage: bash run-tests.sh

set -euo pipefail

cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
  printf 'run-tests.sh: node (>=18) is required but was not found in PATH\n' >&2
  exit 127
fi

exec node --test ./*.test.mjs
