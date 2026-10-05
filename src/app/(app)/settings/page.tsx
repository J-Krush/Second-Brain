import { AdminActions } from "@/components/AdminActions";
import { requireSession } from "@/lib/page-auth";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requireSession();
  return (
    <main className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="mb-1 font-display text-2xl font-bold tracking-tight text-ink">Settings</h1>
      <p className="mb-6 text-sm text-ink-faint">
        Ownership and maintenance. Export is the escape hatch; everything else
        also runs on a nightly cron.
      </p>
      <AdminActions />
    </main>
  );
}
