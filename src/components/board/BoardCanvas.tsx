"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createShapeId,
  getSnapshot,
  loadSnapshot,
  Tldraw,
  type Editor,
  type TLShapeId,
  type TLShapePartial,
} from "tldraw";
import "tldraw/tldraw.css";
import { CardContext, type BoardCard } from "./card-context";
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

    // Persist only the native (non-card) shapes as the board snapshot.
    const snap = getSnapshot(editor.store);
    const store = snap.document.store as Record<string, { typeName?: string; type?: string }>;
    const filteredStore = Object.fromEntries(
      Object.entries(store).filter(
        ([, v]) => !(v.typeName === "shape" && v.type === "card"),
      ),
    );
    const snapshot = { ...snap, document: { ...snap.document, store: filteredStore } };
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

      // Load native shapes first (placements are authoritative for cards).
      if (data.snapshot) {
        try {
          loadSnapshot(editor.store, data.snapshot as Parameters<typeof loadSnapshot>[1]);
        } catch {
          // Corrupt/legacy snapshot: start clean rather than crash the board.
        }
      }

      // Create card shapes from placements.
      const known: Record<string, Geometry> = {};
      for (const p of data.placements) {
        const w = p.w ?? DEFAULT_W;
        const h = p.h ?? DEFAULT_H;
        const id = createShapeId(p.cardId) as TLShapeId;
        known[p.cardId] = { x: p.x, y: p.y, w, h };
        if (!editor.getShape(id)) {
          editor.createShape({
            id,
            type: "card",
            x: p.x,
            y: p.y,
            props: { w, h, cardId: p.cardId },
          } as unknown as TLShapePartial);
        }
      }
      placementsRef.current = known;
      editor.zoomToFit();

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
    const center = editor.getViewportPageBounds().center;
    const x = center.x - DEFAULT_W / 2;
    const y = center.y - DEFAULT_H / 2;
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
    <div className="absolute left-3 top-3 z-[300]">
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-base shadow-lg"
      >
        + Add card
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
  );
}
