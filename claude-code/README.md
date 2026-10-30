# @plaios/claude-code

Claude as the PLAIOS model (`system2`), through the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk). The Claude Code sibling of `@plaios/codex`.

- **Credentials:** your local Claude Code login (run `claude` once and sign in with your claude.ai account), or an Anthropic API key in `ANTHROPIC_API_KEY` / the `apiKey` config.
- **Model:** `claude-opus-5-5` by default; any Claude model id or Claude Code alias (`opus`, `sonnet`) works. `effort` sets the effort level.
- **Isolation:** Claude Code's built-in tools, your `~/.claude` settings, CLAUDE.md, hooks and MCP servers are all off, and nothing is saved under `~/.claude/projects`. Claude only sees the request and the PLAIOS capabilities.
- **Tools:** capabilities run through the same JSON step protocol as Codex (one structured step per turn, final answers stream as they arrive). One Claude Code process serves the whole tool loop.

```yaml
- package: "@plaios/claude-code"
  version: latest
  interface: claude-code.ai
  instanceId: ai:claude-code
```
