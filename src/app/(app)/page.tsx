import { CardBrowser } from "@/components/CardBrowser";
import { listTags } from "@/lib/tags";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const tags = await listTags();
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="mb-5 font-display text-3xl font-bold tracking-tight text-ink">
        Inbox
      </h1>
      <CardBrowser tags={tags} />
    </main>
  );
}
