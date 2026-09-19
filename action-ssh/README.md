# Remote Computers

Pair one or more Macs (or Linux hosts) with Agent OS and control them over SSH.
Natural-language requests go through TypeSafe Jev (`ssh.jev`) and skip the generative model.

## Pair a Mac

1. On the **server**, create an ed25519 key the villa will use to reach the Mac:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/agent-os-mac -N "" -C agent-os
```

2. On the **Mac**, install [Agent OS Remote](./macos/README.md). Paste the public key (`~/.ssh/agent-os-mac.pub`), enable Remote Login, and copy the pairing JSON.

3. Add the computer to Agent OS:

```yaml
- package: "@agent-os/action-ssh"
  version: 0.1.1
  interface: ssh.jev
  instanceId: action:ssh-jev
  config:
    devices: |
      [
        {
          "id": "mac-studio",
          "name": "Mac di Thomas",
          "host": "192.168.1.230",
          "user": "thomasfavero",
          "port": 22,
          "os": "macos",
          "privateKeyPath": "/home/villafavero/.ssh/agent-os-mac"
        }
      ]
```

Enable both `ssh.control` and `ssh.jev` if you want the Settings dashboard plus Jev bypass.

A single device can also be set with `SSH_HOST`, `SSH_USER`, and `SSH_PRIVATE_KEY_PATH`.
