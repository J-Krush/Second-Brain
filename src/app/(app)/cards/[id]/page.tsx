import Link from "next/link";
import { notFound } from "next/navigation";
import { CardEditor } from "@/components/CardEditor";
import { TagEditor } from "@/components/TagEditor";
import { getCardDetail } from "@/lib/cards";
import { listTags } from "@/lib/tags";
import { renderMarkdown } from "@/lib/markdown";

export const dynamic = "force-dynamic";

export default async function CardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getCardDetail(id);
  if (!detail) notFound();
  const allTags = await listTags();
  const props = (detail.card.props as Record<string, unknown> | null) ?? {};
  const og = props.og as
    | { title?: string; description?: string; image?: string }
    | undefined;
  const html = renderMarkdown(detail.card.body);

  return (
    <main className="mx-auto max-w-2xl px-6 py-8">
      <CardEditor detail={detail} />

      <div className="mt-6">
        <TagEditor cardId={detail.card.id} attached={detail.tags} allTags={allTags} />
      </div>

      {og && (og.image || og.description) && (
        <a
          href={detail.card.url ?? "#"}
          target="_blank"
          rel="noreferrer"
          className="mt-6 block overflow-hidden rounded-lg border border-line bg-surface transition-colors hover:bg-surface-2"
        >
          {og.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/files/${og.image}/thumb-1200`}
              alt=""
              className="max-h-64 w-full object-cover"
            />
          )}
          <div className="p-3">
            {og.title && <div className="font-medium text-ink">{og.title}</div>}
            {og.description && (
              <p className="mt-1 line-clamp-2 text-sm text-ink-dim">{og.description}</p>
            )}
          </div>
        </a>
      )}

      {html && (
        <div className="mt-8 border-t border-line pt-6">
          <h4 className="mb-3 text-xs uppercase tracking-wide text-ink-faint">
            Preview
          </h4>
          <div className="prose-sb" dangerouslySetInnerHTML={{ __html: html }} />
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
