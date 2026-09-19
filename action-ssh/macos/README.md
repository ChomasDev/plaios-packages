# Agent OS Remote

macOS companion for `@agent-os/action-ssh`. It enables Remote Login, installs the villa public key, and drops a small helper CLI the server can call over SSH.

## App

On this Mac:

```bash
cd packages/action-ssh/macos
./build.sh
open "dist/Agent OS Remote.app"
```

1. Generate the server key on the villa: `ssh-keygen -t ed25519 -f ~/.ssh/agent-os-mac -N "" -C agent-os`
2. Paste `~/.ssh/agent-os-mac.pub` into the app
3. Click **Enable Remote Login**, then **Install key + helper**
4. Copy the pairing JSON into Agent OS Settings (`ssh.jev` / `ssh.control` `devices`)

## CLI only

```bash
./pair.sh "$(cat /path/to/agent-os-mac.pub)"
```

The helper lives at `~/.agent-os-remote/bin/agent-os-remote` and supports `status`, `open`, `quit`, `notify`, `lock`, `wake`, `volume`, `say`, and `screenshot`.
