#!/usr/bin/env bash

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
ENV_EXAMPLE="$ROOT_DIR/.env.example"
ENV_FILE="$ROOT_DIR/.env"

if [ -f "$ENV_FILE" ]; then
  echo "Warning: $ENV_FILE already exists. Refusing to overwrite."
  exit 0
fi

if [ ! -f "$ENV_EXAMPLE" ]; then
  echo "Error: $ENV_EXAMPLE not found."
  exit 1
fi

ENCRYPTION_KEY=$(openssl rand -hex 32)
TMP_FILE=$(mktemp "${TMPDIR:-/tmp}/sns-agent-env.XXXXXX")
trap 'rm -f "$TMP_FILE"' EXIT

cp "$ENV_EXAMPLE" "$ENV_FILE"

sed "s/^ENCRYPTION_KEY=$/ENCRYPTION_KEY=$ENCRYPTION_KEY/" "$ENV_FILE" >"$TMP_FILE"
mv "$TMP_FILE" "$ENV_FILE"
trap - EXIT

echo "Created $ENV_FILE"
