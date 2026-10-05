import Link from "next/link";
import { Suspense } from "react";
import { CaptureModal } from "@/components/CaptureModal";
import { LogoutButton } from "@/components/LogoutButton";
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
        <div className="mx-auto flex h-14 max-w-[96rem] items-center gap-6 px-6 lg:px-10">
          <Link href="/" className="flex-none font-display text-lg font-bold tracking-tight text-ink">
            <span className="text-accent">&gt;</span> second brain
          </Link>
          <div className="mx-auto w-full max-w-xl">
            <Suspense fallback={null}>
              <GlobalSearch />
            </Suspense>
          </div>
          <nav className="flex flex-none items-center gap-1 font-mono text-xs uppercase tracking-widest text-ink-faint">
            <Link href="/settings" className="rounded px-3 py-1.5 hover:text-ink">
              Settings
            </Link>
            <LogoutButton />
          </nav>
        </div>
      </header>
      {children}
      <CaptureModal />
      <ServiceWorker />
      {shouldRoll(session) && <SessionRefresh />}
    </div>
  );
}
