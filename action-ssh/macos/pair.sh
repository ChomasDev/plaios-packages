#!/bin/zsh
set -euo pipefail

root="$(cd "$(dirname "$0")" && pwd)"
key="${1:-}"
if [[ -z "$key" ]]; then
  echo "Usage: ./pair.sh 'ssh-ed25519 AAAA... agent-os'"
  exit 1
fi

mkdir -p "$HOME/.ssh" "$HOME/.agent-os-remote/bin"
chmod 700 "$HOME/.ssh"
auth="$HOME/.ssh/authorized_keys"
touch "$auth"
chmod 600 "$auth"
if ! grep -Fqx -- "$key" "$auth"; then
  print -- "$key" >> "$auth"
fi

install -m 755 "$root/agent-os-remote" "$HOME/.agent-os-remote/bin/agent-os-remote"

if command -v systemsetup >/dev/null 2>&1; then
  osascript -e 'do shell script "systemsetup -f -setremotelogin on" with administrator privileges' || true
fi

python3 - <<PY
import json, os, socket
print(json.dumps({
  "id": socket.gethostname().lower().replace(" ", "-"),
  "name": socket.gethostname(),
  "host": socket.gethostbyname(socket.gethostname()),
  "user": os.environ.get("USER", ""),
  "port": 22,
  "os": "macos",
  "privateKeyPath": "/home/USER/.ssh/agent-os-mac",
}, indent=2))
PY
