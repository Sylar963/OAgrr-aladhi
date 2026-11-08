#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
assistant_node="$(command -v node)"
assistant_check='packages/server/dist/scripts/portfolio-assistant-check.js'

if [[ ! -f "$assistant_check" ]]; then
  echo 'Build core and server before restarting: pnpm --filter @oggregator/core build && pnpm --filter @oggregator/server build' >&2
  exit 1
fi

systemctl --user restart ogg-backend.service
"$assistant_node" --env-file-if-exists=.env "$assistant_check" --transport-only --wait-ms 60000
systemctl --user restart hermes-gateway.service
"$assistant_node" --env-file-if-exists=.env "$assistant_check" --wait-ms 60000
