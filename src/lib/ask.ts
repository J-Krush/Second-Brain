import { llmProvider, type LlmMessage } from "./llm";
import { searchHybrid, type SearchFilters, type SearchHit } from "./search";

/**
 * /ask: retrieve the cards most relevant to a question, hand them to the
 * configured model as numbered passages, and stream the answer back with
 * `[n]` citations that resolve to cards. Without a model the same pipeline
 * still runs retrieval, so the page shows what a model would have read.
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

const SOURCE_LIMIT = 8;
// Per-passage budget. Eight of these plus the prompt stays well inside the
// context of any instruct model worth configuring.
const EXCERPT_CHARS = 1500;
const ANSWER_TOKENS = 1024;

const SYSTEM_PROMPT = `You answer questions about the user's personal notes.
Use only the numbered passages provided. Cite a passage inline as [n] right after the claim it supports; cite every claim.
If the passages do not contain the answer, say so plainly instead of guessing. Do not invent passages.
Answer in markdown, concise, in the user's own voice: no preamble, no restating the question.`;

export function toSource(hit: SearchHit, index: number): AskSource {
  // Inline image embeds carry nothing a model can read (same pattern as INLINE_FILE_RE in brain/item.ts).
  const raw = (hit.body ?? hit.url ?? "").replace(/!\[[^\]]*\]\(file:[0-9a-f-]+\)/gi, "");
  const collapsed = raw.replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const excerpt = collapsed.length > EXCERPT_CHARS ? collapsed.slice(0, EXCERPT_CHARS) + "…" : collapsed;
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

export function buildMessages(question: string, sources: AskSource[]): LlmMessage[] {
  const passages = sources
    .map((s) => {
      const head = [`[${s.index}]`, s.type, s.title ?? "(untitled)", s.url ?? ""].filter(Boolean).join(" · ");
      return `${head}\n${s.excerpt}`;
    })
    .join("\n\n");
  return [
    { role: "system", content: SYSTEM_PROMPT },
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
  let model: string | null;
  let generate: ((messages: LlmMessage[]) => AsyncIterable<string>) | null = null;
  try {
    const provider = llmProvider();
    model = provider?.model ?? null;
    if (provider) generate = (messages) => provider.generate({ messages, maxTokens: ANSWER_TOKENS, signal });
    const result = await searchHybrid(question, { ...filters, limit: SOURCE_LIMIT, match: "any" });
    sources = result.hits.map((hit, i) => toSource(hit, i + 1));
    yield { type: "sources", sources, degraded: result.degraded, model };
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
    for await (const text of generate(buildMessages(question, sources))) {
      answer += text;
      yield { type: "delta", text };
    }
    yield { type: "done", citations: parseCitations(answer, sources.length) };
  } catch (err) {
    yield { type: "error", message: err instanceof Error ? err.message : String(err) };
  }
}
