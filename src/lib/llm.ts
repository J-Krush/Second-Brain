import type { AskSettings } from "./ask-config";
import { workersAi } from "./llm-workers-ai";

/**
 * The seam between /ask and whatever model answers it. A provider turns a
 * chat request into a stream of text deltas and nothing more: retrieval,
 * prompt construction and citation parsing live in ask.ts, so changing the
 * model is a one-entry change in PROVIDERS. Which provider and model run is
 * chosen on /settings (`AskSettings.provider` / `.model`).
 */
export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmRequest {
  messages: LlmMessage[];
  maxTokens: number;
  temperature: number;
  signal?: AbortSignal;
}

export interface LlmProvider {
  /** Stable id used in logs and the UI badge, e.g. "workers-ai". */
  id: string;
  /** Model identifier as the vendor names it, e.g. "@cf/openai/gpt-oss-120b". */
  model: string;
  /** Yields text deltas in order; throw to abort the answer. */
  generate(req: LlmRequest): AsyncIterable<string>;
}

type ProviderId = Exclude<AskSettings["provider"], "none">;

// Each factory reads its own credentials lazily so an unselected provider
// costs nothing.
const PROVIDERS: Record<ProviderId, (model: string) => LlmProvider> = {
  "workers-ai": workersAi,
};

export function llmProvider(settings: AskSettings): LlmProvider | null {
  if (settings.provider === "none") return null;
  return PROVIDERS[settings.provider](settings.model);
}
