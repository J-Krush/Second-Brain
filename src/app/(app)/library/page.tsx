import { LibraryView } from "@/components/LibraryView";
import { listTags } from "@/lib/tags";
import { requireSession } from "@/lib/page-auth";

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  await requireSession();
  const tags = await listTags();
  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <LibraryView tags={tags} />
    </main>
  );
}
