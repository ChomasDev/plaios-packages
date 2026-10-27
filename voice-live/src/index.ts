import { randomUUID } from "node:crypto";
import type {
  CapabilityDiscovery,
  CapabilityManifest,
  InputInterface,
  InputListener,
  Memory,
} from "@plaios/core/domain";

export interface VoiceLiveInputOptions {
  apiKey?: string;
  model?: string;
  voice?: string;
  instructions?: string;
  userId?: string;
  capabilityDiscovery?: CapabilityDiscovery;
  memory?: Memory;
  /** Overridable for tests. */
  fetch?: typeof fetch;
}

export interface RealtimeTool {
  type: "function";
  name: string;
  description: string;
  parameters: Readonly<Record<string, unknown>>;
}

const DEFAULT_INSTRUCTIONS =
  "You are PLAIOS, a live voice assistant. Answer briefly and naturally in the user's language. " +
  "Use the available tools whenever the request needs an action or data; say what you are doing while a tool runs. " +
  "Use the memory retrieval tool when the user refers to something you may have been told before.";
const MEMORY_LIMIT = 20;

/** Browser-driven OpenAI Realtime input. The microfrontend owns the WebRTC call; this class mints client secrets and runs tools. */
export class VoiceLiveInput implements InputInterface {
  readonly channel = "voice-live" as const;
  private readonly fetchImpl: typeof fetch;
  private readonly toolIds = new Map<string, string>();
  private readonly sessionId = `voice-live-${randomUUID()}`;
  private resolveStopped?: () => void;

  constructor(private readonly options: VoiceLiveInputOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  // The runtime listener is unused: the voice model talks to capabilities directly for low latency.
  async start(_listener: InputListener): Promise<void> {
    await new Promise<void>((resolve) => { this.resolveStopped = resolve; });
  }

  async stop(): Promise<void> {
    this.resolveStopped?.();
    this.resolveStopped = undefined;
  }

  microfrontendData() {
    return {
      configured: Boolean(this.options.apiKey),
      model: this.options.model ?? "gpt-realtime",
      voice: this.options.voice ?? "marin",
      createSession: () => this.createSession(),
      callTool: (name: string, args: unknown) => this.callTool(name, args),
      remember: (role: "user" | "assistant", text: string) => this.remember(role, text),
    };
  }

  private async tools(): Promise<RealtimeTool[]> {
    const manifests = await this.options.capabilityDiscovery?.discover({}) ?? [];
    this.toolIds.clear();
    return manifests.map((manifest) => {
      const name = toolName(manifest, this.toolIds);
      this.toolIds.set(name, manifest.id);
      return { type: "function", name, description: manifest.description, parameters: manifest.inputSchema };
    });
  }

  /** Mints an ephemeral client secret whose session already carries instructions and tools. */
  async createSession(): Promise<{ clientSecret: string; tools: RealtimeTool[] }> {
    if (!this.options.apiKey) throw new Error("voice-live requires OPENAI_API_KEY");
    const [tools, memories] = await Promise.all([this.tools(), this.recallMemories()]);
    const response = await this.fetchImpl("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: { authorization: `Bearer ${this.options.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model: this.options.model ?? "gpt-realtime",
          instructions: [DEFAULT_INSTRUCTIONS, this.options.instructions, memories].filter(Boolean).join("\n\n"),
          tools,
          tool_choice: "auto",
          audio: {
            output: { voice: this.options.voice ?? "marin" },
            input: { transcription: { model: "gpt-4o-mini-transcribe" } },
          },
        },
      }),
    });
    if (!response.ok) throw new Error(`OpenAI client secret failed (${response.status}): ${await response.text()}`);
    const data = await response.json() as { value?: string };
    if (!data.value) throw new Error("OpenAI client secret response has no value");
    return { clientSecret: data.value, tools };
  }

  /** Same chat-history shape the message runtime writes, so other channels see voice turns too. */
  async remember(role: "user" | "assistant", text: string): Promise<void> {
    if (!text.trim()) return;
    await this.options.memory?.remember({
      id: `chat-${role}-${randomUUID()}`,
      kind: "working",
      content: text,
      createdAt: new Date(),
      userId: this.options.userId,
      sessionId: this.sessionId,
      metadata: { namespace: "chat-history", role, channel: this.channel },
    });
  }

  private async recallMemories(): Promise<string> {
    if (!this.options.memory || !this.options.userId) return "";
    const entries = await this.options.memory.recall({
      kinds: ["semantic", "episodic", "procedural"],
      userId: this.options.userId,
      limit: MEMORY_LIMIT,
      order: "newest",
    });
    if (entries.length === 0) return "";
    const lines = entries.map(({ content }) => `- ${typeof content === "string" ? content : JSON.stringify(content)}`);
    return `What you already know about the user:\n${lines.join("\n")}`;
  }

  async callTool(name: string, args: unknown): Promise<unknown> {
    if (this.toolIds.size === 0) await this.tools();
    const id = this.toolIds.get(name);
    const capability = id ? await this.options.capabilityDiscovery?.get(id) : undefined;
    if (!capability) return { success: false, error: { code: "unknown_tool", message: `Unknown tool ${name}` } };
    try {
      return await capability.execute(args ?? {}, {
        runId: `voice-${randomUUID()}`,
        callId: `call-${randomUUID()}`,
        sessionId: this.sessionId,
        userId: this.options.userId,
        startedAt: new Date(),
      });
    } catch (error) {
      return { success: false, error: { code: "tool_failed", message: error instanceof Error ? error.message : String(error) } };
    }
  }
}

// Realtime tool names must match ^[a-zA-Z0-9_-]{1,64}$ and be unique.
export function toolName(manifest: CapabilityManifest, taken: ReadonlyMap<string, string>): string {
  const base = (manifest.name || manifest.id).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60) || "tool";
  let name = base;
  for (let index = 2; taken.has(name); index += 1) name = `${base}_${index}`;
  return name;
}
