export interface CodexProviderData {
  provider: "codex";
  model: string;
  credentialMode: "api-key" | "codex-session";
  workingDirectory: string;
  sandboxMode: string;
  approvalPolicy: string;
  networkAccessEnabled: boolean;
  webSearchMode: string;
  modelReasoningEffort?: string;
}
