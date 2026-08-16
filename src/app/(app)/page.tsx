import { CaptureBox } from "@/components/CaptureBox";
import { CardRow } from "@/components/CardRow";
import { listCards } from "@/lib/cards";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const { items } = await listCards({ view: "inbox" });

  return (
    <main className="mx-auto max-w-2xl px-6 py-8">
      <div className="mb-6">
        <CaptureBox />
      </div>
      {items.length === 0 ? (
        <p className="py-16 text-center text-ink-faint">
          Nothing captured yet. Press <kbd className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">c</kbd> to start.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((card) => (
            <CardRow key={card.id} card={card} />
          ))}
        </div>
      )}
    </main>
  );
}
