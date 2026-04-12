#!/usr/bin/env bash
# 変更ファイルから feature/<name>/ パスを特定する。
# PR check / merge gate から呼ぶ。
#
# 出力:
#   標準出力に feature path を改行区切り（複数 OK）
#   見つからなければ空文字
# 終了コード:
#   0: 常に成功（0 個でも複数でも正常）

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
else
  echo "$features"
fi

exit 0
