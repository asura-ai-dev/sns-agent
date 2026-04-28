#!/usr/bin/env bash
# workstream 用の verify hook があれば実行する（任意）。
#
# 使い方:
#   run-workstream-verify.sh x-harness-parity

set -euo pipefail

workstream="${1:-}"

if [ -z "$workstream" ]; then
  echo "skip: no workstream"
  exit 0
fi

verify_script="scripts/ci/verify-${workstream}.sh"

if [ ! -f "$verify_script" ]; then
  echo "skip: $verify_script not present (optional)"
  exit 0
fi

echo "running $verify_script"
bash "$verify_script"
