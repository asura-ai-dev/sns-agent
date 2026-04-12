#!/usr/bin/env bash
# PR 作成後に auto-merge を設定し、マージ完了後に dev を同期する。
#
# 使い方:
#   scripts/pr-auto-merge.sh <PR番号>
#   scripts/pr-auto-merge.sh           # 最新 PR を自動検出

set -euo pipefail

pr="${1:-}"

if [ -z "$pr" ]; then
  pr=$(gh pr list --head "$(git branch --show-current)" --json number --jq '.[0].number' 2>/dev/null || true)
  if [ -z "$pr" ]; then
    echo "ERROR: PR が見つかりません。PR 番号を引数に指定してください。" >&2
    exit 1
  fi
fi

echo "==> PR #${pr} に auto-merge (squash) を設定"
gh pr merge "$pr" --auto --squash

echo "==> CI 通過 + マージ完了を待機中..."
while true; do
  state=$(gh pr view "$pr" --json state --jq '.state' 2>/dev/null || echo "UNKNOWN")
  if [ "$state" = "MERGED" ]; then
    echo "==> PR #${pr} マージ完了"
    break
  fi
  if [ "$state" = "CLOSED" ]; then
    echo "ERROR: PR #${pr} はマージされずにクローズされました" >&2
    exit 1
  fi
  sleep 30
done

echo "==> dev を main に同期"
current=$(git branch --show-current)

git fetch origin

if [ "$current" = "dev" ]; then
  git stash -q 2>/dev/null || true
  git rebase origin/main
  git push --force-with-lease
  git stash pop -q 2>/dev/null || true
else
  git fetch origin dev:dev 2>/dev/null || true
  echo "WARN: 現在 $current ブランチのため、dev の自動同期はスキップしました。"
  echo "      手動で: git checkout dev && git rebase origin/main && git push --force-with-lease"
fi

echo "==> 完了: dev = main 同期済み"
