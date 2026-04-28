#!/usr/bin/env bash
# docs/x-harness-parity-tickets.json の妥当性、または指定 XHP チケットの完了状態を検証する。
#
# 使い方:
#   check-workstream-tickets.sh x-harness-parity
#   check-workstream-tickets.sh XHP-001 XHP-002
#
# 終了コード:
#   0: JSON が妥当、または指定チケットが implemented / verified / evaluated
#   1: JSON 不正、未完、または未知のチケットあり

set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "skip: no workstream or ticket ids"
  exit 0
fi

tickets="docs/x-harness-parity-tickets.json"

if [ ! -f "$tickets" ]; then
  echo "ERROR: $tickets not found" >&2
  exit 1
fi

node - "$tickets" "$@" <<'NODE'
const fs = require("fs");
const [, , file, ...ids] = process.argv;
const data = JSON.parse(fs.readFileSync(file, "utf8"));
const tickets = new Map(data.tickets.map((ticket) => [ticket.id, ticket]));
const done = new Set(["implemented", "verified", "evaluated"]);
let failed = false;

if (ids.length === 1 && ids[0] === data.workstream.id) {
  const phases = new Set(data.phases.map((phase) => phase.id));
  for (const ticket of data.tickets) {
    if (!phases.has(ticket.phase)) {
      console.error(`ERROR: ${ticket.id} references unknown phase ${ticket.phase}`);
      failed = true;
    }
    for (const dependency of ticket.dependencies || []) {
      if (!tickets.has(dependency)) {
        console.error(`ERROR: ${ticket.id} references unknown dependency ${dependency}`);
        failed = true;
      }
    }
  }
  if (failed) process.exit(1);
  console.log(`OK: ${data.workstream.id} ticket registry is valid (${data.tickets.length} tickets)`);
  process.exit(0);
}

for (const id of ids) {
  const ticket = tickets.get(id);
  if (!ticket) {
    console.error(`ERROR: unknown ticket ${id}`);
    failed = true;
    continue;
  }
  if (!done.has(ticket.status)) {
    console.error(`ERROR: ${id} is ${ticket.status}`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log(`OK: ${ids.length} ticket(s) complete in ${file}`);
NODE
