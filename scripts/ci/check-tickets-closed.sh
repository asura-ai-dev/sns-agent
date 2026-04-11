#!/usr/bin/env bash
# tickets.md の全 issue が [x] か検証する。
#
# 使い方:
#   check-tickets-closed.sh feature/auth
#
# 終了コード:
#   0: 全 [x]（merge OK）
#   1: 未完あり（merge ブロック）

set -euo pipefail

feature_path="${1:-}"

if [ -z "$feature_path" ]; then
  echo "skip: no feature path"
  exit 0
fi

tickets="$feature_path/tickets.md"

if [ ! -f "$tickets" ]; then
  echo "ERROR: $tickets not found" >&2
  exit 1
fi

open=$(grep -E '^\s*-\s+\[ \]' "$tickets" || true)

if [ -n "$open" ]; then
  echo "ERROR: open tickets remain in $tickets:" >&2
  echo "$open" >&2
  exit 1
fi

total=$(grep -cE '^\s*-\s+\[[ x]\]' "$tickets" || echo 0)
echo "OK: all $total tickets closed in $tickets"
