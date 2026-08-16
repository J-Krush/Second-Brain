"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createShapeId,
  getSnapshot,
  loadSnapshot,
  renderPlaintextFromRichText,
  Tldraw,
  type Editor,
  type TLRichText,
  type TLShapeId,
  type TLShapePartial,
} from "tldraw";
import "tldraw/tldraw.css";
import { CardContext, type BoardCard } from "./card-context";
import { openCapture } from "@/lib/capture-bus";
import { CardShapeUtil, type CardShape } from "./CardShape";
import type { BoardData } from "@/lib/boards";

const shapeUtils = [CardShapeUtil];
const DEFAULT_W = 240;
const DEFAULT_H = 150;
const SAVE_DEBOUNCE_MS = 600;

// Editor shape accessors are typed against tldraw's default (closed) shape
// union, which excludes our custom "card" type. This is the minimal shape we
// read/write at those boundaries.
interface AnyShape {
  id: TLShapeId;
  type: string;
  x: number;
  y: number;
  props: { w: number; h: number; cardId: string };
}

// The subset of tldraw's arrow binding we read for edge sync.
interface ArrowBindingLike {
  toId: TLShapeId;
  props: { terminal: "start" | "end" };
}

/**
 * Arrows whose BOTH terminals are bound to card shapes define card-to-card
 * edges. Key "from|to" -> label (arrow text).
 */
function arrowEdges(editor: Editor): Record<string, { from: string; to: string; label: string }> {
  const result: Record<string, { from: string; to: string; label: string }> = {};
  const shapes = editor.getCurrentPageShapes() as unknown as AnyShape[];
  const cardByShapeId: Record<string, string> = {};
  for (const s of shapes) {
    if (s.type === "card") cardByShapeId[s.id] = s.props.cardId;
  }
  for (const s of shapes) {
    if (s.type !== "arrow") continue;
    const bindings = editor.getBindingsFromShape(
      s.id,
      "arrow",
    ) as unknown as ArrowBindingLike[];
    const start = bindings.find((b) => b.props.terminal === "start");
    const end = bindings.find((b) => b.props.terminal === "end");
    const from = start ? cardByShapeId[start.toId] : undefined;
    const to = end ? cardByShapeId[end.toId] : undefined;
    if (!from || !to || from === to) continue;
    let label = "";
    // Arrow props are outside our AnyShape boundary type; the s.type === "arrow"
    // check above is the runtime guard, and rich text cannot be schema-validated.
    const arrowShape = s as unknown as { props: { richText?: TLRichText } };
    const richText = arrowShape.props.richText;
    if (richText) {
      try {
        label = renderPlaintextFromRichText(editor, richText).trim();
      } catch {
        label = "";
      }
    }
    result[`${from}|${to}`] = { from, to, label };
  }
  return result;
}

interface Geometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function BoardCanvas({
  data,
  trailIds,
}: {
  data: BoardData;
  trailIds: string[];
}) {
  const router = useRouter();
  const boardId = data.board.id;

  const [cards, setCards] = useState<Record<string, BoardCard>>(() =>
    Object.fromEntries(data.cards.map((c) => [c.id, c as BoardCard])),
  );

  const editorRef = useRef<Editor | null>(null);
  const placementsRef = useRef<Record<string, Geometry>>({});
  const edgesRef = useRef<Record<string, string>>({}); // "from|to" -> label
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cardsRef = useRef(cards);
  cardsRef.current = cards;

  const openBoard = useCallback(
    (cardId: string) => {
      const nextTrail = [...trailIds, boardId];
      router.push(`/boards/${cardId}?trail=${nextTrail.join(",")}`);
    },
    [router, trailIds, boardId],
  );

  const persist = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return;

    const cardShapes = (
      editor.getCurrentPageShapes() as unknown as AnyShape[]
    ).filter((s) => s.type === "card");

    const current: Record<string, Geometry> = {};
    for (const s of cardShapes) {
      current[s.props.cardId] = { x: s.x, y: s.y, w: s.props.w, h: s.props.h };
    }
    const known = placementsRef.current;

    // Deleted placements.
    for (const cardId of Object.keys(known)) {
      if (!current[cardId]) {
        await fetch(`/api/boards/${boardId}/placements/${cardId}`, {
          method: "DELETE",
        });
      }
    }
    // Added / moved placements.
    for (const [cardId, g] of Object.entries(current)) {
      const prev = known[cardId];
      if (!prev) {
        await fetch(`/api/boards/${boardId}/placements`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cardId, ...g }),
        });
      } else if (
        prev.x !== g.x || prev.y !== g.y || prev.w !== g.w || prev.h !== g.h
      ) {
        await fetch(`/api/boards/${boardId}/placements/${cardId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(g),
        });
      }
    }
    placementsRef.current = current;

    // Sync card-to-card edges from arrows bound to card shapes.
    const currentEdges = arrowEdges(editor);
    const knownEdges = edgesRef.current;
    for (const key of Object.keys(knownEdges)) {
      if (!currentEdges[key]) {
        const [from, to] = key.split("|");
        await fetch("/api/edges", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ fromCard: from, toCard: to }),
        });
      }
    }
    for (const [key, edge] of Object.entries(currentEdges)) {
      if (knownEdges[key] === undefined || knownEdges[key] !== edge.label) {
        await fetch("/api/edges", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ fromCard: edge.from, toCard: edge.to, label: edge.label || null }),
        });
      }
    }
    edgesRef.current = Object.fromEntries(
      Object.entries(currentEdges).map(([k, v]) => [k, v.label]),
    );

    // Persist the full snapshot INCLUDING card shapes. Stripping them orphans
    // arrow bindings on reload (loadSnapshot prunes bindings to missing
    // shapes), silently unbinding arrows. Placements stay authoritative for
    // card geometry: onMount reconciles card shapes against them after load.
    const snapshot = getSnapshot(editor.store);
    await fetch(`/api/boards/${boardId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ snapshot }),
    });
  }, [boardId]);

  const scheduleSave = useCallback(() => {
    clearTimeout(saveTimer.current ?? undefined);
    saveTimer.current = setTimeout(() => void persist(), SAVE_DEBOUNCE_MS);
  }, [persist]);

  const onMount = useCallback(
    (editor: Editor) => {
      editorRef.current = editor;
      editor.user.updateUserPreferences({ colorScheme: "dark" });

      // Load the saved snapshot (native shapes + card shapes + bindings).
      if (data.snapshot) {
        try {
          loadSnapshot(editor.store, data.snapshot as Parameters<typeof loadSnapshot>[1]);
        } catch {
          // Corrupt/legacy snapshot: start clean rather than crash the board.
        }
      }

      // Reconcile card shapes against placements (the source of truth for
      // membership + geometry): create missing, correct drifted, drop stale.
      const known: Record<string, Geometry> = {};
      for (const p of data.placements) {
        const w = p.w ?? DEFAULT_W;
        const h = p.h ?? DEFAULT_H;
        const id = createShapeId(p.cardId) as TLShapeId;
        known[p.cardId] = { x: p.x, y: p.y, w, h };
        const existing = editor.getShape(id) as unknown as AnyShape | undefined;
        if (!existing) {
          editor.createShape({
            id,
            type: "card",
            x: p.x,
            y: p.y,
            props: { w, h, cardId: p.cardId },
          } as unknown as TLShapePartial);
        } else if (
          existing.x !== p.x ||
          existing.y !== p.y ||
          existing.props.w !== w ||
          existing.props.h !== h
        ) {
          editor.updateShape({
            id,
            type: "card",
            x: p.x,
            y: p.y,
            props: { w, h },
          } as unknown as TLShapePartial);
        }
      }
      // Card shapes in the snapshot whose placement is gone (removed elsewhere).
      const stale = (editor.getCurrentPageShapes() as unknown as AnyShape[]).filter(
        (s) => s.type === "card" && !known[s.props.cardId],
      );
      if (stale.length > 0) editor.deleteShapes(stale.map((s) => s.id));
      placementsRef.current = known;
      editor.zoomToFit();

      // Upsert edges for arrows already on the board (idempotent), so boards
      // drawn before edge-sync existed still surface their relations.
      const existingEdges = arrowEdges(editor);
      edgesRef.current = Object.fromEntries(
        Object.entries(existingEdges).map(([k, v]) => [k, v.label]),
      );
      for (const edge of Object.values(existingEdges)) {
        void fetch("/api/edges", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ fromCard: edge.from, toCard: edge.to, label: edge.label || null }),
        });
      }

      editor.store.listen(scheduleSave, { source: "user", scope: "document" });
    },
    [data, scheduleSave],
  );

  useEffect(() => {
    return () => clearTimeout(saveTimer.current ?? undefined);
  }, []);

  async function addCard(card: BoardCard) {
    const editor = editorRef.current;
    if (!editor) return;
    if (placementsRef.current[card.id]) return; // already on the board
    // Cascade from center so consecutive additions don't stack exactly.
    const cascade = Object.keys(placementsRef.current).length % 5;
    const center = editor.getViewportPageBounds().center;
    const x = center.x - DEFAULT_W / 2 + cascade * 32;
    const y = center.y - DEFAULT_H / 2 + cascade * 32;
    setCards((prev) => ({ ...prev, [card.id]: card }));
    const id = createShapeId(card.id) as TLShapeId;
    editor.createShape({
      id,
      type: "card",
      x,
      y,
      props: { w: DEFAULT_W, h: DEFAULT_H, cardId: card.id },
    } as unknown as TLShapePartial);
    placementsRef.current[card.id] = { x, y, w: DEFAULT_W, h: DEFAULT_H };
    await fetch(`/api/boards/${boardId}/placements`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cardId: card.id, x, y, w: DEFAULT_W, h: DEFAULT_H }),
    });
  }

  useEffect(() => {
    function onOpenCard(e: Event) {
      const cardId = (e as CustomEvent<string>).detail;
      if (cardsRef.current[cardId]?.type === "board") openBoard(cardId);
    }
    window.addEventListener("sb:open-card", onOpenCard);
    return () => window.removeEventListener("sb:open-card", onOpenCard);
  }, [openBoard]);

  const contextValue = useMemo(
    () => ({ cards, onOpen: openBoard }),
    [cards, openBoard],
  );

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) {
    return <div className="h-full w-full bg-base" />;
  }

  return (
    <CardContext.Provider value={contextValue}>
      <div className="relative h-full w-full">
        <Tldraw shapeUtils={shapeUtils} onMount={onMount} />
        <AddCardButton
          existing={cards}
          onAdd={addCard}
        />
      </div>
    </CardContext.Provider>
  );
}

function AddCardButton({
  existing,
  onAdd,
}: {
  existing: Record<string, BoardCard>;
  onAdd: (card: BoardCard) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<BoardCard[]>([]);

  useEffect(() => {
    if (!open) return;
    const query = q.trim();
    if (!query) {
      setHits([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      const res = await fetch(`/api/search?mode=quick&q=${encodeURIComponent(query)}`, {
        signal: ctrl.signal,
      }).catch(() => null);
      if (res?.ok) setHits((await res.json()).hits ?? []);
    }, 120);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, open]);

  return (
    <div className="absolute left-3 top-3 z-[300] flex items-start gap-2">
      <button
        onClick={() => {
          setOpen(false);
          openCapture({
            onCreated: (card) => {
              onAdd(card as BoardCard);
              return true; // stay on the board; the card lands on the canvas
            },
          });
        }}
        className="rounded-md bg-accent px-3 py-1.5 font-mono text-xs font-bold uppercase tracking-wider text-inset shadow-lg"
      >
        + New card
      </button>
      <div>
        <button
          onClick={() => setOpen((o) => !o)}
          className="rounded-md border border-line-2 bg-surface px-3 py-1.5 font-mono text-xs font-bold uppercase tracking-wider text-ink-dim shadow-lg hover:text-ink"
        >
          Place existing
        </button>
      {open && (
        <div className="mt-2 w-72 overflow-hidden rounded-lg border border-line bg-surface shadow-2xl">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search cards to place…"
            className="w-full border-b border-line bg-transparent px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-faint"
          />
          <ul className="max-h-64 overflow-y-auto">
            {hits.map((hit) => (
              <li key={hit.id}>
                <button
                  disabled={Boolean(existing[hit.id])}
                  onClick={() => {
                    onAdd(hit);
                    setOpen(false);
                    setQ("");
                  }}
                  className="block w-full px-3 py-2 text-left text-sm text-ink-dim hover:bg-surface-2 hover:text-ink disabled:opacity-40"
                >
                  {hit.title || hit.body || "Untitled"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      </div>
    </div>
  );
}
