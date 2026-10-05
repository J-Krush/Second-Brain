"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { headline } from "@/components/brain/item";
import { Kbd } from "@/components/brain/parts";
import { CardModal } from "@/components/card/CardModal";
import { styleFor } from "@/components/card-style";
import type { AskEvent, AskSource } from "@/lib/ask";
import { openCard } from "@/lib/card-url";
import { relativeTime } from "@/lib/format";
import { renderMarkdown } from "@/lib/markdown";

type Status = "retrieving" | "answering" | "done" | "error";

interface Exchange {
  id: number;
  question: string;
  status: Status;
  sources: AskSource[];
  degraded: boolean;
  model: string | null;
  answer: string;
  citations: number[];
  error: string | null;
}

const CITATION_RE = /\[(\d{1,2})\]/g;

/** `[n]` markers become clickable superscripts; marked passes inline HTML through. */
function answerHtml(answer: string): string {
  const marked = answer.replace(CITATION_RE, (_, n: string) => `<sup><a href="#source-${n}" data-cite="${n}">${n}</a></sup>`);
  return renderMarkdown(marked);
}

/** Title line and the text beneath it, so untitled cards don't repeat their first line. */
function split(s: AskSource): { title: string; rest: string } {
  const title = headline({ type: s.type, title: s.title, body: s.excerpt }).replace(/^#+\s*/, "");
  const rest = s.title ? s.excerpt : s.excerpt.split("\n").slice(1).join(" ").trim();
  return { title, rest };
}

function SourceList({ sources, cited, open }: { sources: AskSource[]; cited: Set<number>; open: (s: AskSource) => void }) {
  return (
    <ol className="mt-3 grid gap-1.5 sm:grid-cols-2">
      {sources.map((s) => {
        const style = styleFor(s.type);
        const isCited = cited.has(s.index);
        const { title, rest } = split(s);
        return (
          <li key={s.id} id={`source-${s.index}`}>
            <button
              type="button"
              onClick={() => open(s)}
              className={`group flex w-full gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors hover:border-line-2 ${
                isCited ? "border-accent/40 bg-accent/5" : "border-line bg-surface"
              }`}
            >
              <span className={`w-5 flex-none pt-px text-center font-mono text-[11px] ${isCited ? "text-accent" : "text-ink-faint"}`}>
                {s.index}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className={`font-mono text-sm ${style.text}`}>{style.glyph}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{title}</span>
                  <span className="flex-none font-mono text-[10px] text-ink-faint">{relativeTime(s.createdAt)}</span>
                </span>
                {rest && <span className="mt-0.5 line-clamp-2 block text-[12px] leading-snug text-ink-faint">{rest}</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function ExchangeView({ x, open }: { x: Exchange; open: (s: AskSource) => void }) {
  const cited = new Set(x.status === "done" ? x.citations : [...x.answer.matchAll(CITATION_RE)].map((m) => Number(m[1])));
  const working = x.status === "retrieving" || x.status === "answering";

  function onAnswerClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target instanceof Element ? e.target.closest("[data-cite]") : null;
    if (!(target instanceof HTMLElement)) return;
    e.preventDefault();
    const s = x.sources[Number(target.dataset.cite) - 1];
    if (s) open(s);
  }

  return (
    <article className="border-b border-line py-6 last:border-b-0">
      <h2 className="font-display text-xl font-bold leading-snug tracking-tight text-ink">{x.question}</h2>

      {x.status === "retrieving" && <p className="mt-3 font-mono text-[12px] text-ink-faint">reading your notes…</p>}

      {x.status === "error" && (
        <p className="mt-3 rounded-lg border border-ember/40 bg-ember/10 px-3 py-2 font-mono text-[12px] text-ember">{x.error}</p>
      )}

      {x.status !== "retrieving" && x.status !== "error" && x.sources.length === 0 && (
        <p className="mt-3 text-sm text-ink-dim">Nothing in your notes matches this. Try different words, or capture what you know first.</p>
      )}

      {x.answer && (
        <div className="prose-sb mt-4 text-[15px]" onClick={onAnswerClick} dangerouslySetInnerHTML={{ __html: answerHtml(x.answer) }} />
      )}
      {x.status === "answering" && <span className="mt-1 inline-block h-4 w-2 animate-pulse bg-accent align-text-bottom" aria-hidden />}

      {x.sources.length > 0 && (
        <section className="mt-5">
          <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-widest text-ink-faint">
            <span>{x.model ? "sources" : "what a model would read"}</span>
            {x.degraded && <span className="text-amber">text only — semantic index unavailable</span>}
            {!x.model && !working && <span className="text-amber">no model configured</span>}
          </div>
          <SourceList sources={x.sources} cited={cited} open={open} />
        </section>
      )}
    </article>
  );
}

/**
 * Ask a question, get an answer grounded in cards. Each exchange streams:
 * the retrieved sources arrive first, then the answer as deltas. Citations
 * and source rows open the card modal in place, so the thread survives.
 * Without a configured model the page is a transparent retrieval preview.
 */
export function AskPage() {
  const router = useRouter();
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [question, setQuestion] = useState("");
  const [model, setModel] = useState<string | null | undefined>(undefined);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const nextId = useRef(1);
  const busy = exchanges.some((x) => x.status === "retrieving" || x.status === "answering");

  useEffect(() => () => abortRef.current?.abort(), []);

  const patch = useCallback((id: number, fn: (x: Exchange) => Exchange) => {
    setExchanges((list) => list.map((x) => (x.id === id ? fn(x) : x)));
  }, []);

  const open = useCallback(
    (s: AskSource) => {
      if (s.type === "board") router.push(`/boards/${s.id}`);
      else openCard(s.id);
    },
    [router],
  );

  async function submit() {
    const q = question.trim();
    if (!q || busy) return;
    const id = nextId.current++;
    setExchanges((list) => [
      ...list,
      { id, question: q, status: "retrieving", sources: [], degraded: false, model: null, answer: "", citations: [], error: null },
    ]);
    setQuestion("");
    const controller = new AbortController();
    abortRef.current = controller;
    let received = 0;
    function consume(line: string) {
      if (!line) return;
      received += 1;
      apply(id, JSON.parse(line) as AskEvent);
    }
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error(`ask failed: ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        lines.forEach(consume);
      }
      consume(buffer);
    } catch (err) {
      if (!controller.signal.aborted) {
        patch(id, (x) => ({ ...x, status: "error", error: err instanceof Error ? err.message : String(err) }));
      } else if (received === 0) {
        // Stopped before anything came back: drop the row and hand the question back.
        setExchanges((list) => list.filter((x) => x.id !== id));
        setQuestion((cur) => cur || q);
      } else {
        patch(id, (x) => ({ ...x, status: "done" }));
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      inputRef.current?.focus();
    }
  }

  function apply(id: number, event: AskEvent) {
    if (event.type === "sources") {
      setModel(event.model);
      patch(id, (x) => ({ ...x, status: "answering", sources: event.sources, degraded: event.degraded, model: event.model }));
    } else if (event.type === "delta") {
      patch(id, (x) => ({ ...x, answer: x.answer + event.text }));
    } else if (event.type === "done") {
      patch(id, (x) => ({ ...x, status: "done", citations: event.citations }));
    } else {
      patch(id, (x) => ({ ...x, status: "error", error: event.message }));
    }
  }

  const empty = exchanges.length === 0;

  return (
    <main className="mx-auto max-w-2xl px-6 py-8">
      {empty ? (
        <div className="pb-6">
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Ask your notes</h1>
          <p className="mt-1 text-sm text-ink-faint">
            Questions are answered from what you&apos;ve captured, with every claim cited back to a card.
          </p>
        </div>
      ) : (
        <div className="pb-2">
          {exchanges.map((x) => (
            <ExchangeView key={x.id} x={x} open={open} />
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className={`rounded-xl border border-line-2 bg-surface-2 ${empty ? "" : "sticky bottom-4 mt-4 shadow-[0_24px_60px_-16px_rgba(0,0,0,0.9)]"}`}
      >
        <div className="flex items-start gap-3 px-4 py-3">
          <span className="pt-0.5 font-mono font-bold text-accent">?</span>
          <textarea
            ref={inputRef}
            autoFocus
            rows={1}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder={empty ? "What did I think about…" : "Ask a follow-up…"}
            aria-label="Question"
            spellCheck={false}
            className="max-h-40 min-h-[1.75rem] flex-1 resize-none bg-transparent text-[15px] leading-relaxed text-ink outline-none placeholder:text-ink-faint field-sizing-content"
          />
          {busy ? (
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              className="rounded-md border border-line px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider text-ink-dim hover:border-line-2 hover:text-ink"
            >
              stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!question.trim()}
              className="rounded-md bg-accent px-2.5 py-1 font-mono text-[11px] font-bold uppercase tracking-wider text-inset transition-opacity disabled:opacity-30"
            >
              ask
            </button>
          )}
        </div>
        <div className="flex items-center gap-3 border-t border-line px-4 py-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-faint">
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd> ask
          </span>
          <span className="flex items-center gap-1">
            <Kbd>⇧↵</Kbd> newline
          </span>
          <span className="ml-auto">
            {model === undefined ? "" : model ? `model · ${model}` : "no model · retrieval only"}
          </span>
        </div>
      </form>

      <CardModal />
    </main>
  );
}
