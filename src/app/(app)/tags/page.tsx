import { TagManager } from "@/components/TagManager";
import { requireSession } from "@/lib/page-auth";

export const dynamic = "force-dynamic";

export default async function TagsPage() {
  await requireSession();
  return (
    <main className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="mb-1 font-display text-2xl font-bold tracking-tight text-ink">Tags</h1>
      <p className="mb-6 text-sm text-ink-faint">
        Renaming a tag renames it on every card. Rename onto an existing name to merge two tags.
      </p>
      <TagManager />
    </main>
  );
}
