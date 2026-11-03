#!/bin/sh
# Bootstrap with the system shell; the server only uses Codex's managed Node.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
node="${HOME:?HOME is required}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
if [ ! -x "$node" ]; then
  printf '%s\n' "Animation Builder: Codex managed Node is missing: $node. Repair the Codex runtime and reconnect the plugin." >&2
  exit 127
fi
if ! "$node" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>20||(a===20&&b>=19)?0:1)' >/dev/null 2>&1; then
  printf '%s\n' 'Animation Builder requires Codex managed Node >=20.19.' >&2
  exit 127
fi
# Keep run.mjs on the same managed runtime, even when external overrides exist.
export ANIMATION_NODE_BINARY="$node"
exec "$node" "$root/run.mjs" "$@"
