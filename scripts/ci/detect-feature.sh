#!/usr/bin/env bash
# 変更ファイルから feature/<name>/ パスを 1 つ特定する。
# PR check / merge gate から呼ぶ。
#
# 出力:
#   標準出力に feature path（例: feature/auth）を 1 行
#   見つからなければ空文字
# 終了コード:
#   0: 0 個 or 1 個発見（正常）
#   1: 複数 feature にまたがる（異常）

set -euo pipefail

base_ref="${1:-origin/main}"

if ! git rev-parse --verify "$base_ref" >/dev/null 2>&1; then
  base_ref="HEAD~1"
fi

changed=$(git diff --name-only "$base_ref"...HEAD 2>/dev/null || git diff --name-only HEAD~1 HEAD)

features=$(echo "$changed" | grep -E '^feature/[^/]+/' | sed -E 's|^(feature/[^/]+)/.*|\1|' | sort -u || true)

count=$(echo "$features" | grep -c . || true)

if [ "$count" -eq 0 ]; then
  echo ""
  exit 0
elif [ "$count" -eq 1 ]; then
  echo "$features"
  exit 0
else
  echo "ERROR: PR spans multiple features:" >&2
  echo "$features" >&2
  exit 1
fi
