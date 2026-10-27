import type { System1, SystemAnswers, SystemAskOptions, SystemQuestions } from "@plaios/core/domain";
import { TypeSafeClient, type Fetch } from "@typesafe-ai/sdk";

export interface JevSystem1Options {
  env?: { get(key: string): string | undefined };
  apiKey?: string;
  /** Jev model; omitted uses TYPESAFE_DEFAULT_MODEL, then jev-latest. */
  model?: string;
  fetch?: Fetch;
}

/** System 1 backed by TypeSafe Jev. */
export class JevSystem1 implements System1 {
  readonly model: string;
  private readonly apiKey: string | undefined;
  private readonly fetch: Fetch | undefined;
  private client: TypeSafeClient | undefined;

  constructor(options: JevSystem1Options = {}) {
    this.apiKey = options.apiKey ?? options.env?.get("JEV_API_KEY") ?? options.env?.get("TYPESAFE_API_KEY");
    this.model = options.model || options.env?.get("TYPESAFE_DEFAULT_MODEL") || "jev-latest";
    this.fetch = options.fetch;
  }

  async ask(state: Record<string, unknown>, questions: SystemQuestions, options: SystemAskOptions = {}): Promise<SystemAnswers> {
    // Lazy: the SDK throws without an API key, which must not break startup.
    this.client ??= new TypeSafeClient({
      ...(this.apiKey ? { apiKey: this.apiKey } : {}),
      ...(this.fetch ? { fetch: this.fetch } : {}),
    });
    const { answers } = await this.client.systemOne(
      { state: state as never, questions: questions as never, model: this.model },
      { signal: options.signal },
    );
    return answers as SystemAnswers;
  }
}
