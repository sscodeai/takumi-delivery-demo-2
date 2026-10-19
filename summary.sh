#!/usr/bin/env bash
# Entry point: bash summary.sh <csv>
#
# Reads exactly one CSV file of `date,station,temperature_c` records and writes
# the per-station summary, the SKIPPED count and the TOTAL count to stdout.
# The tool makes no network access and reads no input other than the given path.

set -u

if [ "$#" -ne 1 ]; then
  printf 'usage: bash summary.sh <csv>\n' >&2
  exit 2
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1

if ! command -v node >/dev/null 2>&1; then
  printf 'summary.sh: node (>=18) is required but was not found in PATH\n' >&2
  exit 127
fi

exec node "$script_dir/src/cli.mjs" "$1"
