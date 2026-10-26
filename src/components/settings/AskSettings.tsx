"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  type AskSettings as Doc,
  DEFAULT_ASK_SETTINGS,
  DEFAULT_SYSTEM_PROMPT,
  estimateCost,
  modelInfo,
  USD_PER_1K_NEURONS,
  WORKERS_AI_MODELS,
} from "@/lib/ask-config";

type Status = { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "error"; message: string };

const SAVE_DEBOUNCE_MS = 500;

const FIELD = "w-full rounded-md border border-line bg-inset px-2.5 py-1.5 font-mono text-[12px] text-ink outline-none focus:border-accent";
const LABEL = "font-mono text-[10px] uppercase tracking-widest text-ink-faint";

function Knob({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className={LABEL}>{label}</span>
      <span className="mt-1 block">{children}</span>
      <span className="mt-1 block text-[12px] leading-snug text-ink-faint">{hint}</span>
    </label>
  );
}

function Range({
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <span className="flex items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-line accent-accent"
      />
      <span className="w-16 text-right font-mono text-[12px] tabular-nums text-ink">{format(value)}</span>
    </span>
  );
}

/**
 * Every knob on /ask, saved on change (debounced) through PUT
 * /api/settings/ask. The cost strip recomputes from the draft so the
 * price of a change is visible before it lands.
 */
export function AskSettings({ initial }: { initial: Doc }) {
  const [doc, setDoc] = useState<Doc>(initial);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const pending = useRef<Partial<Doc>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function set<K extends keyof Doc>(key: K, value: Doc[K]) {
    setDoc((d) => ({ ...d, [key]: value }));
    pending.current[key] = value;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
  }

  async function flush() {
    const patch = pending.current;
    pending.current = {};
    setStatus({ kind: "saving" });
    try {
      const res = await fetch("/api/settings/ask", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = (await res.json()) as { settings?: Doc; error?: string };
      if (!res.ok || !data.settings) throw new Error(data.error ?? `save failed: ${res.status}`);
      // Only adopt the server's view if nothing changed while saving.
      if (Object.keys(pending.current).length === 0) setDoc(data.settings);
      setStatus({ kind: "saved" });
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  /** Back to defaults for the tuning knobs; provider and model are deliberate choices and stay. */
  function reset() {
    const { retrieval, match, sourceLimit, excerptChars, maxTokens, temperature, systemPrompt } = DEFAULT_ASK_SETTINGS;
    const knobs = { retrieval, match, sourceLimit, excerptChars, maxTokens, temperature, systemPrompt };
    setDoc((d) => ({ ...d, ...knobs }));
    Object.assign(pending.current, knobs);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
  }

  const cost = estimateCost(doc);
  const known = modelInfo(doc.model);
  const off = doc.provider === "none";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <span className={LABEL}>
          {status.kind === "saving" && "saving…"}
          {status.kind === "saved" && <span className="text-accent">saved</span>}
          {status.kind === "error" && <span className="text-ember">{status.message}</span>}
          {status.kind === "idle" && "saves as you change"}
        </span>
        <button type="button" onClick={reset} className="font-mono text-[10px] uppercase tracking-widest text-ink-faint hover:text-ink">
          reset knobs
        </button>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Knob label="Provider" hint="Off keeps /ask as a retrieval preview: no model call, no cost.">
          <select value={doc.provider} onChange={(e) => set("provider", e.target.value as Doc["provider"])} className={FIELD}>
            <option value="workers-ai">Workers AI (Cloudflare)</option>
            <option value="none">Off — retrieval only</option>
          </select>
        </Knob>

        <Knob label="Model" hint={known ? known.note : "Unlisted model id: runs, but the cost strip can't price it."}>
          <select
            value={known ? doc.model : "__custom"}
            onChange={(e) => {
              if (e.target.value !== "__custom") set("model", e.target.value);
            }}
            disabled={off}
            className={FIELD}
          >
            {WORKERS_AI_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} · {m.id}
              </option>
            ))}
            {!known && <option value="__custom">custom · {doc.model}</option>}
          </select>
          <input
            type="text"
            value={doc.model}
            onChange={(e) => set("model", e.target.value)}
            disabled={off}
            spellCheck={false}
            aria-label="Model id"
            className={`${FIELD} mt-1.5 text-ink-dim`}
          />
        </Knob>

        <Knob label="Retrieval" hint="Hybrid fuses full-text and semantic ranks. Full-text alone is free of embedding dependence; semantic alone needs every card embedded.">
          <select value={doc.retrieval} onChange={(e) => set("retrieval", e.target.value as Doc["retrieval"])} className={FIELD}>
            <option value="hybrid">Hybrid (text + semantic)</option>
            <option value="fts">Full-text only</option>
            <option value="semantic">Semantic only</option>
          </select>
        </Knob>

        <Knob label="Term matching" hint="Any: a card matching some of the question's words qualifies, ranked by how many. All: every word must appear (search-box semantics; strict, often empty for questions).">
          <select value={doc.match} onChange={(e) => set("match", e.target.value as Doc["match"])} className={FIELD}>
            <option value="any">Any term</option>
            <option value="all">All terms</option>
          </select>
        </Knob>

        <Knob label="Passages" hint="How many cards the model reads. More recall, more input tokens; past ~10 the extra ones rarely get cited.">
          <Range value={doc.sourceLimit} min={1} max={20} step={1} format={(v) => `${v}`} onChange={(v) => set("sourceLimit", v)} />
        </Knob>

        <Knob label="Passage length" hint="Characters per card. Long documents get cut here; the model never sees past the cap.">
          <Range value={doc.excerptChars} min={200} max={6000} step={100} format={(v) => `${v} ch`} onChange={(v) => set("excerptChars", v)} />
        </Knob>

        <Knob label="Answer length" hint="Max output tokens. Output is the expensive side on most models; 512 covers a tight paragraph with citations.">
          <Range value={doc.maxTokens} min={64} max={4096} step={64} format={(v) => `${v} tok`} onChange={(v) => set("maxTokens", v)} />
        </Knob>

        <Knob label="Temperature" hint="0 is deterministic and sticks to the passages; above ~0.7 answers get looser and citations sloppier.">
          <Range value={doc.temperature} min={0} max={2} step={0.1} format={(v) => v.toFixed(1)} onChange={(v) => set("temperature", v)} />
        </Knob>
      </div>

      <Knob label="System prompt" hint="The instructions the model gets before the passages. Keep the [n] citation rule or the answer loses its links.">
        <textarea
          value={doc.systemPrompt}
          onChange={(e) => set("systemPrompt", e.target.value)}
          rows={6}
          spellCheck={false}
          className={`${FIELD} resize-y leading-relaxed`}
        />
        {doc.systemPrompt !== DEFAULT_SYSTEM_PROMPT && (
          <button
            type="button"
            onClick={() => set("systemPrompt", DEFAULT_SYSTEM_PROMPT)}
            className="mt-1 font-mono text-[10px] uppercase tracking-widest text-ink-faint hover:text-ink"
          >
            restore default prompt
          </button>
        )}
      </Knob>

      <div className="rounded-lg border border-line bg-surface px-4 py-3">
        <div className={LABEL}>Cost per question, worst case</div>
        {cost ? (
          <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1.5 font-mono text-[12px] sm:grid-cols-4">
            <div>
              <dt className="text-ink-faint">input</dt>
              <dd className="text-ink tabular-nums">~{cost.inputTokens.toLocaleString()} tok</dd>
            </div>
            <div>
              <dt className="text-ink-faint">output cap</dt>
              <dd className="text-ink tabular-nums">{cost.outputTokens.toLocaleString()} tok</dd>
            </div>
            <div>
              <dt className="text-ink-faint">neurons</dt>
              <dd className="text-ink tabular-nums">~{Math.ceil(cost.neurons)}</dd>
            </div>
            <div>
              <dt className="text-ink-faint">free / day</dt>
              <dd className="text-accent tabular-nums">~{cost.freeQuestionsPerDay} questions</dd>
            </div>
          </dl>
        ) : (
          <p className="mt-2 font-mono text-[12px] text-ink-faint">{off ? "no model call" : "unknown model — not in the price table"}</p>
        )}
        <p className="mt-2 text-[12px] leading-snug text-ink-faint">
          {cost
            ? `Beyond the free 10,000 neurons/day: $${(cost.usdPer1kQuestions).toFixed(2)} per 1,000 questions at $${USD_PER_1K_NEURONS}/1k neurons. Real answers usually use a third of the output cap.`
            : "Prices from developers.cloudflare.com/workers-ai/platform/pricing."}
        </p>
      </div>
    </div>
  );
}
