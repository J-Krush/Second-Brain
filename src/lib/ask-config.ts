import { z } from "zod";

/**
 * Everything tunable about /ask, as one document edited on /settings and
 * stored in the `settings` table. Pure module: the page, the API and the
 * pipeline all import the same schema, defaults and price table.
 */
export const DEFAULT_SYSTEM_PROMPT = `You answer questions about the user's personal notes.
Use only the numbered passages provided. Cite a passage inline as [n] right after the claim it supports; cite every claim.
If the passages do not contain the answer, say so plainly instead of guessing. Do not invent passages.
Answer in markdown, concise, in the user's own voice: no preamble, no restating the question.`;

// Constraints without defaults, so the PUT patch schema can't fill in
// defaults for absent keys (which `.partial()` on a defaulted schema does,
// silently resetting every knob the patch didn't mention).
const fields = {
  /** "none" keeps /ask in retrieval-only mode. */
  provider: z.enum(["none", "workers-ai"]),
  /** Vendor model id; any Workers AI text model works, the catalog just prices the known ones. */
  model: z.string().trim().min(1).max(120),
  retrieval: z.enum(["hybrid", "fts", "semantic"]),
  match: z.enum(["any", "all"]),
  sourceLimit: z.number().int().min(1).max(20),
  excerptChars: z.number().int().min(200).max(6000),
  maxTokens: z.number().int().min(64).max(4096),
  temperature: z.number().min(0).max(2),
  systemPrompt: z.string().max(4000),
};

export const askSettingsSchema = z.object({
  provider: fields.provider.default("workers-ai"),
  model: fields.model.default("@cf/openai/gpt-oss-120b"),
  retrieval: fields.retrieval.default("hybrid"),
  match: fields.match.default("any"),
  sourceLimit: fields.sourceLimit.default(8),
  excerptChars: fields.excerptChars.default(1500),
  maxTokens: fields.maxTokens.default(1024),
  temperature: fields.temperature.default(0.2),
  systemPrompt: fields.systemPrompt.default(DEFAULT_SYSTEM_PROMPT),
});

export const askSettingsPatchSchema = z.object(fields).partial();

export type AskSettings = z.infer<typeof askSettingsSchema>;

export const DEFAULT_ASK_SETTINGS: AskSettings = askSettingsSchema.parse({});

export interface ModelInfo {
  id: string;
  label: string;
  /** Neurons per million tokens, from developers.cloudflare.com/workers-ai/platform/pricing (Oct 2026). */
  inputNeurons: number;
  outputNeurons: number;
  note: string;
}

/** Curated Workers AI text models; order is the recommendation order. */
export const WORKERS_AI_MODELS: ModelInfo[] = [
  { id: "@cf/openai/gpt-oss-120b", label: "gpt-oss 120B", inputNeurons: 31818, outputNeurons: 68182, note: "Best citation discipline per neuron. Default." },
  { id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", label: "Llama 3.3 70B", inputNeurons: 26668, outputNeurons: 204805, note: "Strong, but output is 3× the price of gpt-oss." },
  { id: "@cf/qwen/qwen3-30b-a3b-fp8", label: "Qwen3 30B-A3B", inputNeurons: 4625, outputNeurons: 30475, note: "MoE: 70B-class quality at 8B-class price." },
  { id: "@cf/google/gemma-4-26b-a4b-it", label: "Gemma 4 26B-A4B", inputNeurons: 9091, outputNeurons: 27273, note: "Cheap and capable; newer, less proven." },
  { id: "@cf/openai/gpt-oss-20b", label: "gpt-oss 20B", inputNeurons: 18182, outputNeurons: 27273, note: "Smaller sibling; fine for short factual answers." },
  { id: "@cf/meta/llama-3.1-8b-instruct-fp8-fast", label: "Llama 3.1 8B", inputNeurons: 4119, outputNeurons: 34868, note: "Cheapest. Sloppier about [n] placement." },
];

export const FREE_NEURONS_PER_DAY = 10_000;
export const USD_PER_1K_NEURONS = 0.011;
// Rough English tokenizer rate; the prompt scaffolding adds a fixed overhead.
const CHARS_PER_TOKEN = 4;
const PROMPT_OVERHEAD_TOKENS = 220;

export interface CostEstimate {
  inputTokens: number;
  /** maxTokens as an upper bound; real answers are usually a third of it. */
  outputTokens: number;
  neurons: number;
  freeQuestionsPerDay: number;
  usdPer1kQuestions: number;
}

export function modelInfo(id: string): ModelInfo | undefined {
  return WORKERS_AI_MODELS.find((m) => m.id === id);
}

/** Worst-case neurons for one question: every passage full, answer at maxTokens. */
export function estimateCost(s: AskSettings): CostEstimate | null {
  const m = modelInfo(s.model);
  if (!m || s.provider === "none") return null;
  const promptChars = s.sourceLimit * s.excerptChars + s.systemPrompt.length;
  const inputTokens = Math.ceil(promptChars / CHARS_PER_TOKEN) + PROMPT_OVERHEAD_TOKENS;
  const outputTokens = s.maxTokens;
  const neurons = (inputTokens * m.inputNeurons + outputTokens * m.outputNeurons) / 1_000_000;
  return {
    inputTokens,
    outputTokens,
    neurons,
    freeQuestionsPerDay: Math.floor(FREE_NEURONS_PER_DAY / neurons),
    usdPer1kQuestions: (neurons * 1000 * USD_PER_1K_NEURONS) / 1000,
  };
}
