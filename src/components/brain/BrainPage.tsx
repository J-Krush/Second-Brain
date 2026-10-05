"use client";

import "./brain.css";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CardModal } from "@/components/card/CardModal";
import { CARD_STYLE } from "@/components/card-style";
import { onCardChanged } from "@/lib/card-events";
import { replaceParams } from "@/lib/card-url";
import { Composer } from "./Composer";
import { Desk } from "./Desk";
import type { BrainCard, Scope, View } from "./item";
import { useToast } from "./parts";
import { Shell, type TagOption } from "./Shell";
import { Timeline } from "./Timeline";

interface Page {
  items: BrainCard[];
  nextCursor: string | null;
}

/**
 * `/`: one list of cards seen two ways (Timeline daybook or Desk), scoped to
 * the inbox (untriaged) or the whole library. All view state is in the URL;
 * `?card=<id>` is handled by the modal.
 */
export function BrainPage({ tags }: { tags: TagOption[] }) {
  const params = useSearchParams();
  const scope: Scope = params.get("scope") === "library" ? "library" : "inbox";
  const view: View = params.get("view") === "desk" ? "desk" : "timeline";
  const rawType = params.get("type");
  const type = rawType && Object.hasOwn(CARD_STYLE, rawType) ? rawType : null;
  const rawTag = Number(params.get("tag"));
  const tagId = tags.some((t) => t.id === rawTag) ? rawTag : null;

  const toast = useToast();
  const [page, setPage] = useState<Page | null>(null);
  const [failed, setFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reload, setReload] = useState(0);
  const [inboxCount, setInboxCount] = useState<string | null>(null);
  const [types, setTypes] = useState<string[]>([]);
  const request = useRef(0);
  const bar = useRef<HTMLDivElement>(null);
  const [barHeight, setBarHeight] = useState(0);

  const query = new URLSearchParams({ view: scope });
  if (type) query.set("type", type);
  if (tagId !== null) query.set("tag", String(tagId));
  const queryKey = query.toString();

  useEffect(() => onCardChanged(() => setReload((n) => n + 1)), []);

  // Day headers in the Timeline stick just under this bar.
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBarHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const id = ++request.current;
    const q = new URLSearchParams(queryKey);
    const unfiltered = !q.has("type") && !q.has("tag");
    const isInbox = q.get("view") === "inbox";
    fetch(`/api/cards?${queryKey}`)
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json() as Promise<Page>;
      })
      .then((data) => {
        if (id !== request.current) return;
        setPage(data);
        setFailed(false);
        if (unfiltered) {
          setTypes(Object.keys(CARD_STYLE).filter((t) => data.items.some((c) => c.type === t)));
          if (isInbox) setInboxCount(`${data.items.length}${data.nextCursor ? "+" : ""}`);
        }
      })
      .catch(() => {
        if (id === request.current) setFailed(true);
      });
  }, [queryKey, reload]);

  async function loadMore() {
    if (!page?.nextCursor) return;
    const id = request.current;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/cards?${queryKey}&cursor=${encodeURIComponent(page.nextCursor)}`);
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as Page;
      if (id !== request.current) return;
      setPage((prev) => ({ items: [...(prev?.items ?? []), ...data.items], nextCursor: data.nextCursor }));
    } catch {
      toast.show("couldn't load more");
    } finally {
      setLoadingMore(false);
    }
  }

  const shownTypes = type && !types.includes(type) ? [...types, type] : types;
  const filtered = type !== null || tagId !== null;
  const items = page?.items ?? [];

  return (
    <div style={{ "--sb-bar": `${barHeight}px` } as React.CSSProperties}>
      <div ref={bar} className="sticky top-14 z-20 border-b border-line bg-base/85 backdrop-blur">
        <div className="mx-auto max-w-[96rem] px-6 pt-3 lg:px-10">
          <div className="mx-auto max-w-[46rem]">
            <Composer onToast={toast.show} />
          </div>
          <Shell
            scope={scope}
            view={view}
            type={type}
            tagId={tagId}
            inboxCount={inboxCount}
            types={shownTypes}
            tags={tags}
          />
        </div>
      </div>

      <div className="mx-auto max-w-[96rem] px-6 pb-32 lg:px-10">
        {failed && items.length === 0 ? (
          <Empty title="couldn't load" hint="the cards API didn't answer. retry in a moment." />
        ) : page === null ? (
          <p className="py-24 text-center font-mono text-[12px] text-ink-faint">loading…</p>
        ) : items.length === 0 ? (
          filtered ? (
            <Empty
              title="nothing matches"
              hint={
                <button
                  type="button"
                  onClick={() => replaceParams({ type: null, tag: null })}
                  className="text-accent hover:underline"
                >
                  clear filters
                </button>
              }
            />
          ) : scope === "inbox" ? (
            <Empty title="inbox zero" hint="everything's filed. capture something above, or browse the library." />
          ) : (
            <Empty title="nothing here yet" hint="type, paste a link, or drop a file above." />
          )
        ) : (
          <div key={`${scope}-${view}`}>
            {view === "timeline" ? (
              <Timeline items={items} scope={scope} onToast={toast.show} />
            ) : (
              <Desk items={items} onToast={toast.show} />
            )}
          </div>
        )}

        {page?.nextCursor && (
          <div className="mt-12 text-center">
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loadingMore}
              className="rounded-full border border-line px-4 py-1.5 font-mono text-[12px] text-ink-dim transition-colors hover:border-line-2 hover:text-ink disabled:opacity-50"
            >
              {loadingMore ? "loading…" : "load more"}
            </button>
          </div>
        )}
      </div>

      <CardModal />
      {toast.node}
    </div>
  );
}

function Empty({ title, hint }: { title: string; hint: React.ReactNode }) {
  return (
    <div className="sb-fade py-28 text-center">
      <p className="font-display text-5xl font-extrabold tracking-tighter text-ink">
        <span className="text-accent">&gt;</span> {title}
      </p>
      <p className="mt-3 font-mono text-[12px] text-ink-faint">{hint}</p>
    </div>
  );
}
