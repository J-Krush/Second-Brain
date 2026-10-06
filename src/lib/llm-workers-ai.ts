import type { LlmProvider, LlmRequest } from "./llm";
import { aiBinding, aiRest, type ChatInput } from "./workers-ai";

/**
 * Workers AI text generation. Both doors (binding in the Worker, REST in
 * dev) return the same server-sent-event body with `stream: true`, so one
 * parser serves both.
 */
export function workersAi(model: string): LlmProvider {
  return {
    id: "workers-ai",
    model,
    async *generate(req: LlmRequest) {
      const input: ChatInput = {
        messages: req.messages,
        max_tokens: req.maxTokens,
        temperature: req.temperature,
      };
      const body = await openStream(model, input, req.signal);
      yield* sseDeltas(body);
    },
  };
}

interface WorkersAiError {
  success?: boolean;
  errors?: { message: string }[];
}

async function openStream(model: string, input: ChatInput, signal?: AbortSignal): Promise<ReadableStream<Uint8Array>> {
  const binding = aiBinding();
  if (binding) return binding.run(model, { ...input, stream: true });
  const res = await aiRest(model, { ...input, stream: true }, signal);
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as WorkersAiError;
    throw new Error(`Workers AI ${model} failed: ${data.errors?.[0]?.message ?? res.status}`);
  }
  return res.body;
}

/**
 * The text carried by one event, across the shapes Workers AI emits:
 * `{response}` for chat-template models, OpenAI `choices[].delta.content`,
 * and Responses-API `{type:"response.output_text.delta", delta}` (reasoning
 * deltas, which share that shape under another `type`, are dropped).
 */
export function deltaOf(event: unknown): string {
  if (typeof event !== "object" || event === null) return "";
  const e = event as {
    response?: unknown;
    delta?: unknown;
    type?: unknown;
    choices?: { delta?: { content?: unknown } }[];
  };
  if (typeof e.response === "string") return e.response;
  const choice = e.choices?.[0]?.delta?.content;
  if (typeof choice === "string") return choice;
  if (typeof e.delta === "string" && (e.type === undefined || e.type === "response.output_text.delta")) return e.delta;
  return "";
}

/** Yields the text of each `data:` event in an SSE body until `[DONE]` or EOF. */
export async function* sseDeltas(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl = buffer.indexOf("\n");
      while (nl !== -1) {
        const line = buffer.slice(0, nl).trimEnd();
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf("\n");
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") return;
        let event: unknown;
        try {
          event = JSON.parse(payload);
        } catch {
          continue;
        }
        const text = deltaOf(event);
        if (text) yield text;
      }
    }
  } finally {
    // Early exit (stop button, [DONE]) must release the upstream connection.
    void reader.cancel().catch(() => {});
  }
}
