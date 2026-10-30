export interface ClaudeCodeProviderData {
  provider: "claude-code";
  model: string;
  effort: string;
  credentialMode: "api-key" | "claude-code-session";
  workingDirectory: string;
}
