import { type AskSettings, DEFAULT_ASK_SETTINGS } from "./ask-config";
import { llmProvider, type LlmMessage } from "./llm";
import { searchFts, searchHybrid, searchSemantic, type SearchFilters, type SearchHit } from "./search";
import { getAskSettings } from "./settings";
import { workersAiConfigured } from "./workers-ai";

/**
 * /ask: retrieve the cards most relevant to a question, hand them to the
 * configured model as numbered passages, and stream the answer back with
 * `[n]` citations that resolve to cards. Every knob (model, retrieval mode,
 * passage count and size, answer length, temperature, prompt) comes from
 * the settings document edited on /settings. Without a model the same
 * pipeline still runs retrieval, so the page shows what a model would read.
 */
export interface AskSource {
  /** 1-based; what the answer cites as `[n]`. */
  index: number;
  id: string;
  type: string;
  title: string | null;
  excerpt: string;
  url: string | null;
  createdAt: string;
  score: number;
}

export type AskEvent =
  | { type: "sources"; sources: AskSource[]; degraded: boolean; model: string | null }
  | { type: "delta"; text: string }
  | { type: "done"; citations: number[] }
  | { type: "error"; message: string };

export function toSource(hit: SearchHit, index: number, excerptChars = DEFAULT_ASK_SETTINGS.excerptChars): AskSource {
  // Inline image embeds carry nothing a model can read (same pattern as INLINE_FILE_RE in brain/item.ts).
  const raw = (hit.body ?? hit.url ?? "").replace(/!\[[^\]]*\]\(file:[0-9a-f-]+\)/gi, "");
  const collapsed = raw.replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const excerpt = collapsed.length > excerptChars ? collapsed.slice(0, excerptChars) + "…" : collapsed;
  return {
    index,
    id: hit.id,
    type: hit.type,
    title: hit.title,
    excerpt,
    url: hit.url,
    createdAt: hit.createdAt,
    score: hit.score,
  };
}

export function buildMessages(question: string, sources: AskSource[], systemPrompt: string): LlmMessage[] {
  const passages = sources
    .map((s) => {
      const head = [`[${s.index}]`, s.type, s.title ?? "(untitled)", s.url ?? ""].filter(Boolean).join(" · ");
      return `${head}\n${s.excerpt}`;
    })
    .join("\n\n");
  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: `Passages:\n\n${passages}\n\nQuestion: ${question}` },
  ];
}

const CITATION_RE = /\[(\d{1,2})\]/g;

/** Distinct `[n]` markers in order of first appearance, limited to known indexes. */
export function parseCitations(text: string, sourceCount: number): number[] {
  const seen = new Set<number>();
  for (const m of text.matchAll(CITATION_RE)) {
    const n = Number(m[1]);
    if (n >= 1 && n <= sourceCount) seen.add(n);
  }
  return [...seen];
}

/**
 * Retrieval per the configured mode. `semantic` without Workers AI falls
 * back to full-text and flags it, like hybrid does.
 */
async function retrieve(question: string, filters: SearchFilters, s: AskSettings) {
  const f: SearchFilters = { ...filters, limit: s.sourceLimit, match: s.match };
  if (s.retrieval === "fts") return { hits: await searchFts(question, f), degraded: false };
  if (s.retrieval === "semantic") {
    if (!workersAiConfigured()) return { hits: await searchFts(question, f), degraded: true };
    return { hits: await searchSemantic(question, f), degraded: false };
  }
  return searchHybrid(question, f);
}

/**
 * The first event is always `sources` (or `error`), so a caller can await it
 * before committing to a streamed response; everything after it needs no
 * database access.
 */
export async function* askStream(
  question: string,
  filters: SearchFilters = {},
  signal?: AbortSignal,
): AsyncGenerator<AskEvent> {
  let sources: AskSource[];
  let settings: AskSettings;
  let generate: ((messages: LlmMessage[]) => AsyncIterable<string>) | null = null;
  try {
    settings = await getAskSettings();
    const provider = llmProvider(settings);
    if (provider) {
      const { maxTokens, temperature } = settings;
      generate = (messages) => provider.generate({ messages, maxTokens, temperature, signal });
    }
    const result = await retrieve(question, filters, settings);
    sources = result.hits.map((hit, i) => toSource(hit, i + 1, settings.excerptChars));
    yield { type: "sources", sources, degraded: result.degraded, model: provider?.model ?? null };
  } catch (err) {
    yield { type: "error", message: err instanceof Error ? err.message : String(err) };
    return;
  }

  if (!generate || sources.length === 0) {
    yield { type: "done", citations: [] };
    return;
  }

  let answer = "";
  try {
    for await (const text of generate(buildMessages(question, sources, settings.systemPrompt))) {
      answer += text;
      yield { type: "delta", text };
    }
    yield { type: "done", citations: parseCitations(answer, sources.length) };
  } catch (err) {
    yield { type: "error", message: err instanceof Error ? err.message : String(err) };
  }
}
