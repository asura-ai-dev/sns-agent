#!/usr/bin/env bash
# feature/<name>/verify.sh があれば実行する（任意のフック）。
# 機械検証可能な done_when をまとめたスクリプトを置ける。
#
# 使い方:
#   run-feature-verify.sh feature/auth

set -euo pipefail

feature_path="${1:-}"

if [ -z "$feature_path" ]; then
  echo "skip: no feature path"
  exit 0
fi

verify_script="$feature_path/verify.sh"

if [ ! -f "$verify_script" ]; then
  echo "skip: $verify_script not present (optional)"
  exit 0
fi

echo "running $verify_script"
bash "$verify_script"
