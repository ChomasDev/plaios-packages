# @plaios/action-t3code

Lets the PLAIOS agent drive T3 Code on your Mac over Tailscale: launch coding agents in your repos, follow their threads, list projects, clone repos, and open a project in the T3 Code desktop app ("apri il progetto voya").

## Setup

1. In T3 Code turn on Tailscale Serve (Settings), so the server is reachable at `https://<mac>.<tailnet>.ts.net`.
2. On the Mac, issue a token for PLAIOS:
   ```sh
   ~/.t3/bin/t3 auth session issue --subject mcp-client \
     --scope orchestration:read --scope orchestration:operate \
     --ttl 365d --label plaios --token-only
   ```
   Revoke it with `t3 auth session list` / `t3 auth session revoke <id>`.
3. Configure the package:
   - `T3_MCP_URL`: `https://<mac>.<tailnet>.ts.net/mcp`, or `http://<mac tailscale ip>:3773/mcp` when the server has MagicDNS off (the villa server does)
   - `T3_MCP_TOKEN`: the token (secret)
   - Mac SSH for `open_project` (it runs `t3 app <path>` there): `host`, `user`, `privateKeyPath` as in `action-ssh` (or `SSH_*` env vars).

Agents started with this token cannot go above `approval-required` mode: T3 asks you to approve edits.
