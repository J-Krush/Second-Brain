import { getCloudflareContext } from "@opennextjs/cloudflare";
import { env } from "./env";

/**
 * One door to Workers AI for every model we run (embeddings, /ask). In the
 * deployed Worker it is the `AI` binding; under `next dev` remote bindings
 * are off and wrangler hands back a stub that throws, so dev goes through
 * the REST API when CF_ACCOUNT_ID / CF_AI_TOKEN are set.
 */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatInput {
  messages: ChatMessage[];
  max_tokens: number;
  temperature: number;
}

export interface AiBinding {
  run(model: string, input: { text: string[] }): Promise<{ data: number[][] }>;
  run(model: string, input: ChatInput & { stream: true }): Promise<ReadableStream<Uint8Array>>;
}

interface AiEnv {
  AI?: AiBinding;
}

export function aiBinding(): AiBinding | undefined {
  if (process.env.NODE_ENV === "development") return undefined;
  const { env: cfEnv } = getCloudflareContext() as { env: AiEnv };
  return cfEnv.AI;
}

export function workersAiConfigured(): boolean {
  return Boolean(aiBinding() || (env.CF_ACCOUNT_ID && env.CF_AI_TOKEN));
}

/** POST /accounts/{id}/ai/run/{model}; the caller reads JSON or the SSE body. */
export async function aiRest(model: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  if (!env.CF_ACCOUNT_ID || !env.CF_AI_TOKEN) {
    throw new Error("CF_ACCOUNT_ID / CF_AI_TOKEN not set");
  }
  return fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai/run/${model}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.CF_AI_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });
}
