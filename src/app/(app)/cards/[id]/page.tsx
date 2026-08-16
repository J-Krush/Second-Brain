import Link from "next/link";
import { notFound } from "next/navigation";
import { CardEditor } from "@/components/CardEditor";
import { getCardDetail } from "@/lib/cards";

export const dynamic = "force-dynamic";

export default async function CardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getCardDetail(id);
  if (!detail) notFound();

  return (
    <main className="mx-auto max-w-2xl px-6 py-8">
      <CardEditor detail={detail} />

      {detail.tags.length > 0 && (
        <div className="mt-6 flex flex-wrap gap-2">
          {detail.tags.map((t) => (
            <span
              key={t.id}
              className="rounded-full border border-line px-2 py-0.5 text-xs text-ink-dim"
              style={t.color ? { borderColor: t.color, color: t.color } : undefined}
            >
              {t.name}
            </span>
          ))}
        </div>
      )}

      {(detail.boards.length > 0 || detail.backlinks.length > 0) && (
        <div className="mt-8 border-t border-line pt-6 text-sm">
          {detail.boards.length > 0 && (
            <div className="mb-4">
              <h4 className="mb-2 text-xs uppercase tracking-wide text-ink-faint">
                Appears on boards
              </h4>
              <ul className="flex flex-col gap-1">
                {detail.boards.map((b) => (
                  <li key={b.id}>
                    <Link href={`/cards/${b.id}`} className="text-accent hover:underline">
                      {b.title ?? "Untitled board"}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {detail.backlinks.length > 0 && (
            <div>
              <h4 className="mb-2 text-xs uppercase tracking-wide text-ink-faint">
                Linked from
              </h4>
              <ul className="flex flex-col gap-1">
                {detail.backlinks.map((b) => (
                  <li key={b.id}>
                    <Link href={`/cards/${b.id}`} className="text-ink-dim hover:text-ink">
                      {b.title ?? "Untitled"}
                    </Link>
                    {b.label && <span className="text-ink-faint"> — {b.label}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
