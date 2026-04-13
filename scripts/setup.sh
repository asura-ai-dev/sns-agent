#!/usr/bin/env bash

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
ENV_EXAMPLE="$ROOT_DIR/.env.example"
ENV_FILE="$ROOT_DIR/.env"

if [ -f "$ENV_FILE" ]; then
  echo "Warning: $ENV_FILE already exists. Skipping .env generation."
else
  if [ ! -f "$ENV_EXAMPLE" ]; then
    echo "Error: $ENV_EXAMPLE not found."
    exit 1
  fi

  ENCRYPTION_KEY=$(openssl rand -hex 32)
  TMP_FILE=$(mktemp "${TMPDIR:-/tmp}/sns-agent-env.XXXXXX")
  trap 'rm -f "$TMP_FILE"' EXIT

  cp "$ENV_EXAMPLE" "$ENV_FILE"

  DB_PATH="$ROOT_DIR/packages/db/dev.db"
  sed -e "s/^ENCRYPTION_KEY=$/ENCRYPTION_KEY=$ENCRYPTION_KEY/" \
      -e "s|^DATABASE_URL=file:./dev.db|DATABASE_URL=file:$DB_PATH|" \
      "$ENV_FILE" >"$TMP_FILE"
  mv "$TMP_FILE" "$ENV_FILE"
  trap - EXIT

  {
    echo ""
    echo "# Web UI セッション（ローカル開発用 owner ユーザー）"
    echo "SNS_AGENT_API_KEY=sns-agent-dev-key-00000000"
    echo "SNS_AGENT_SESSION_USER_ID=user-owner-00000000"
  } >> "$ENV_FILE"

  echo "Created $ENV_FILE"
fi
echo "Applying database schema..."
pnpm --filter @sns-agent/db db:push
echo "Seeding database..."
pnpm --filter @sns-agent/db db:seed
echo "Database initialized."
