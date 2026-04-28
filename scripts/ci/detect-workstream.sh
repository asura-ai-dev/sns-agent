#!/usr/bin/env bash
# 変更ファイルから現在の workstream を特定する。
# PR check / merge gate から呼ぶ。
#
# 出力:
#   標準出力に workstream id を改行区切り
#   見つからなければ空文字
# 終了コード:
#   0: 常に成功

set -euo pipefail

base_ref="${1:-origin/main}"

if ! git rev-parse --verify "$base_ref" >/dev/null 2>&1; then
  base_ref="HEAD~1"
fi

changed=$(git diff --name-only "$base_ref"...HEAD 2>/dev/null || git diff --name-only HEAD~1 HEAD)

workstreams=""

if echo "$changed" | grep -Eq '^(docs/x-harness-parity|packages/provider-x/|apps/api/src/routes/engagement-gates|apps/web/src/app/\(dashboard\)/(gates|campaigns|followers|analytics|quotes|sequences)/)'; then
  workstreams="x-harness-parity"
fi

count=$(echo "$workstreams" | grep -c . || true)

if [ "$count" -eq 0 ]; then
  echo ""
else
  echo "$workstreams"
fi

exit 0
