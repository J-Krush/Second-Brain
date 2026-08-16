import { AdminActions } from "@/components/AdminActions";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="mb-1 font-serif text-2xl text-ink">Settings</h1>
      <p className="mb-6 text-sm text-ink-faint">
        Ownership and maintenance. Export is the escape hatch; everything else
        also runs on a nightly cron.
      </p>
      <AdminActions />
    </main>
  );
}
