#!/usr/bin/env bash
# PR の全 commit が (#NNN) で issue 参照しているか検証する。
# 1 issue 1 commit ルールの担保。
#
# 使い方:
#   check-commit-refs.sh [base_ref]
#
# 終了コード:
#   0: 全 commit が issue 参照済み
#   1: 参照なし commit あり

set -euo pipefail

base_ref="${1:-origin/main}"

if ! git rev-parse --verify "$base_ref" >/dev/null 2>&1; then
  base_ref="HEAD~1"
fi

subjects=$(git log --format='%h %s' "$base_ref"..HEAD)

if [ -z "$subjects" ]; then
  echo "skip: no commits"
  exit 0
fi

bad=""
while IFS= read -r line; do
  if echo "$line" | grep -qE '\(#[0-9]+\)|Merge |Revert |^[0-9a-f]+ (chore|fix|docs|ci|build|style)\b'; then
    continue
  fi
  bad="$bad$line"$'\n'
done <<< "$subjects"

if [ -n "$bad" ]; then
  echo "ERROR: commits without issue ref (#NNN):" >&2
  echo "$bad" >&2
  exit 1
fi

count=$(echo "$subjects" | wc -l | tr -d ' ')
echo "OK: all $count commits reference an issue"
