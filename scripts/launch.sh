#!/bin/sh
# GUI hosts do not inherit the user's interactive shell PATH.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
compatible() {
  [ -x "$1" ] && "$1" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>20||(a===20&&b>=19)?0:1)' >/dev/null 2>&1
}
node_path=$(command -v node || true)
for candidate in "${ANIMATION_NODE_BINARY:-}" \
  "${HOME:-}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" \
  "$node_path" /opt/homebrew/bin/node /usr/local/bin/node \
  "${HOME:-}"/.nvm/versions/node/*/bin/node "${HOME:-}"/.volta/bin/node; do
  if compatible "$candidate"; then
    if [ -f "$root/run.mjs" ]; then
      exec "$candidate" "$root/run.mjs" "$@"
    fi
    exec "$candidate" "$root/dist/server.js" "$@"
  fi
done
printf '%s\n' 'Animation Builder requires Node.js >=20.19. Install Node or set ANIMATION_NODE_BINARY to its absolute path, then reconnect the plugin.' >&2
exit 127
