import Link from "next/link";
import { notFound } from "next/navigation";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { cards } from "@/db/schema";
import { BoardCanvas } from "@/components/board/BoardCanvas";
import { getBoard } from "@/lib/boards";

export const dynamic = "force-dynamic";

export default async function BoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ trail?: string }>;
}) {
  const { id } = await params;
  const { trail } = await searchParams;
  const board = await getBoard(id);
  if (!board) notFound();

  const trailIds = (trail ?? "").split(",").filter(Boolean);
  const crumbs = trailIds.length
    ? await db
        .select({ id: cards.id, title: cards.title })
        .from(cards)
        .where(inArray(cards.id, trailIds))
    : [];
  // Preserve trail order (inArray does not guarantee it).
  const crumbById = new Map(crumbs.map((c) => [c.id, c.title]));

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <div className="flex items-center gap-2 border-b border-line px-6 py-2 text-sm">
        {trailIds.map((tid, i) => (
          <span key={tid} className="flex items-center gap-2">
            <Link
              href={`/boards/${tid}?trail=${trailIds.slice(0, i).join(",")}`}
              className="text-ink-dim hover:text-ink"
            >
              {crumbById.get(tid) ?? "Board"}
            </Link>
            <span className="text-ink-faint">/</span>
          </span>
        ))}
        <span className="font-medium text-ink">
          {board.board.title ?? "Untitled board"}
        </span>
      </div>
      <div className="flex-1">
        <BoardCanvas data={board} trailIds={trailIds} />
      </div>
    </div>
  );
}
