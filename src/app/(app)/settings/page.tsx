import { AdminActions } from "@/components/AdminActions";
import { LogoutButton } from "@/components/LogoutButton";
import { AskSettings } from "@/components/settings/AskSettings";
import { requireSession } from "@/lib/page-auth";
import { getAskSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requireSession();
  const ask = await getAskSettings();
  return (
    <main className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="mb-1 font-display text-2xl font-bold tracking-tight text-ink">Settings</h1>
      <p className="mb-6 text-sm text-ink-faint">
        Ownership and maintenance. Export is the escape hatch; everything else
        also runs on a nightly cron.
      </p>
      <AdminActions />
      <section className="mt-12 border-t border-line pt-6">
        <h2 className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">Ask</h2>
        <p className="mb-5 mt-1 text-sm text-ink-dim">
          What answers questions on <span className="font-mono text-ink">/ask</span>, how much it reads, and how long it may talk. The cost strip prices the current knobs.
        </p>
        <AskSettings initial={ask} />
      </section>
      <section className="mt-12 border-t border-line pt-6">
        <h2 className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">Session</h2>
        <p className="mb-4 mt-1 text-sm text-ink-dim">Signs this browser out. Other devices keep their sessions.</p>
        <LogoutButton />
      </section>
    </main>
  );
}
