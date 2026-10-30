import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/** Calls one T3 Code MCP tool and returns its structured result. */
export interface T3Client {
  call(tool: string, args: Record<string, unknown>): Promise<unknown>;
}

export class T3McpClient implements T3Client {
  private client: Promise<Client> | undefined;

  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  async call(tool: string, args: Record<string, unknown>): Promise<unknown> {
    try {
      return await this.callOnce(tool, args);
    } catch (error) {
      if (error instanceof T3ToolError) throw error;
      // The MCP session dies when T3 restarts or the Mac sleeps: reconnect once.
      this.reset();
      return this.callOnce(tool, args);
    }
  }

  private async callOnce(tool: string, args: Record<string, unknown>): Promise<unknown> {
    const client = await this.connect();
    const result = await client.callTool({ name: tool, arguments: args });
    const text = Array.isArray(result.content)
      ? result.content.map((part) => (part.type === "text" ? part.text : "")).join("\n")
      : "";
    if (result.isError) throw new T3ToolError(text || `${tool} failed`);
    if (result.structuredContent) return result.structuredContent;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  private connect(): Promise<Client> {
    this.client ??= (async () => {
      const client = new Client({ name: "plaios", version: "0.1.0" });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(this.url), {
          requestInit: { headers: { authorization: `Bearer ${this.token}` } },
        }),
      );
      return client;
    })().catch((error: unknown) => {
      this.client = undefined;
      throw error;
    });
    return this.client;
  }

  private reset(): void {
    const stale = this.client;
    this.client = undefined;
    void stale?.then((client) => client.close()).catch(() => undefined);
  }
}

/** The tool ran and refused; retrying the connection will not help. */
export class T3ToolError extends Error {}
