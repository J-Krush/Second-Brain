import Link from "next/link";
import { Suspense } from "react";
import { CaptureDialog } from "@/components/capture/CaptureDialog";
import { AddButton } from "@/components/capture/AddButton";
import { ScopeNav } from "@/components/nav/ScopeNav";
import { GlobalSearch } from "@/components/search/GlobalSearch";
import { ServiceWorker } from "@/components/ServiceWorker";
import { SessionRefresh } from "@/components/SessionRefresh";
import { requireSession } from "@/lib/page-auth";
import { shouldRoll } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-base/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[96rem] items-center gap-5 px-6 lg:px-10">
          <Link href="/" className="flex-none font-display text-lg font-bold tracking-tight text-ink">
            <span className="text-accent">&gt;</span> second brain
          </Link>
          <Suspense fallback={null}>
            <ScopeNav />
          </Suspense>
          <div className="ml-auto flex w-full max-w-xs justify-end">
            <Suspense fallback={null}>
              <GlobalSearch />
            </Suspense>
          </div>
          <AddButton />
          <Link
            href="/settings"
            className="flex h-8 flex-none items-center rounded-md px-3 font-mono text-xs uppercase tracking-widest text-ink-faint transition-colors hover:text-ink"
          >
            Settings
          </Link>
        </div>
      </header>
      {children}
      <CaptureDialog />
      <ServiceWorker />
      {shouldRoll(session) && <SessionRefresh />}
    </div>
  );
}
