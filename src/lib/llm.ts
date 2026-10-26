import { env } from "./env";

/**
 * The seam between /ask and whatever model answers it. A provider turns a
 * chat request into a stream of text deltas and nothing more: retrieval,
 * prompt construction and citation parsing live in ask.ts, so changing the
 * model is a one-entry change in PROVIDERS. Selected by LLM_PROVIDER; unset
 * means /ask runs in retrieval-only mode and says so.
 */
export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmRequest {
  messages: LlmMessage[];
  maxTokens: number;
  signal?: AbortSignal;
}

export interface LlmProvider {
  /** Stable id used in logs and the UI badge, e.g. "workers-ai". */
  id: string;
  /** Model identifier as the vendor names it, e.g. "@cf/meta/llama-3.3-70b-instruct". */
  model: string;
  /** Yields text deltas in order; throw to abort the answer. */
  generate(req: LlmRequest): AsyncIterable<string>;
}

// Keyed by the LLM_PROVIDER value. Each factory reads its own credentials
// from env lazily so an unconfigured provider costs nothing until selected.
const PROVIDERS: Record<string, () => LlmProvider> = {};

export function llmProvider(): LlmProvider | null {
  const id = env.LLM_PROVIDER;
  if (!id) return null;
  const make = PROVIDERS[id];
  if (!make) {
    const known = Object.keys(PROVIDERS).join(", ") || "none";
    throw new Error(`Unknown LLM_PROVIDER "${id}" (known: ${known})`);
  }
  return make();
}
