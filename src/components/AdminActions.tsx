"use client";

import { useState } from "react";

interface Action {
  label: string;
  path: string;
  running: string;
}

const ACTIONS: Action[] = [
  { label: "Run garbage collection", path: "/api/admin/gc", running: "Cleaning…" },
  { label: "Reconcile storage", path: "/api/admin/reconcile", running: "Reconciling…" },
  { label: "Embed stale cards", path: "/api/admin/embed-sweep", running: "Embedding…" },
];

export function AdminActions() {
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, string>>({});

  async function run(action: Action) {
    setBusy(action.path);
    try {
      const res = await fetch(action.path, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      setResult((r) => ({ ...r, [action.path]: JSON.stringify(data) }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <a
        href="/api/export"
        className="rounded-lg border border-line bg-surface px-4 py-3 text-ink hover:bg-surface-2"
      >
        Export everything (markdown + files) →
      </a>
      {ACTIONS.map((action) => (
        <div key={action.path} className="flex items-center gap-3">
          <button
            onClick={() => void run(action)}
            disabled={busy !== null}
            className="rounded-lg border border-line px-4 py-2 text-sm text-ink-dim hover:text-ink disabled:opacity-40"
          >
            {busy === action.path ? action.running : action.label}
          </button>
          {result[action.path] && (
            <span className="font-mono text-xs text-ink-faint">
              {result[action.path]}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
