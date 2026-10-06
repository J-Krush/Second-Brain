import Link from "next/link";
import { Suspense } from "react";
import { CaptureDialog } from "@/components/capture/CaptureDialog";
import { AddButton } from "@/components/capture/AddButton";
import { ScopeNav } from "@/components/nav/ScopeNav";
import { GlobalSearch } from "@/components/search/GlobalSearch";
import { ServiceWorker } from "@/components/ServiceWorker";
import { SessionRefresh } from "@/components/SessionRefresh";
import { ResumeRefresh } from "@/components/ResumeRefresh";
import { requireSession } from "@/lib/page-auth";
import { shouldRoll } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  return (
    <div className="min-h-screen pb-[env(safe-area-inset-bottom)]">
      <header className="sticky top-0 z-30 border-b border-line bg-base/80 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[96rem] items-center gap-3 px-4 sm:gap-5 sm:px-6 lg:px-10">
          <Link href="/" className="flex-none font-display text-lg font-bold tracking-tight text-ink">
            <span className="text-accent">&gt;</span>
            <span className="hidden sm:inline"> second brain</span>
          </Link>
          <Suspense fallback={null}>
            <ScopeNav />
          </Suspense>
          <div className="ml-auto flex min-w-0 w-full max-w-xs justify-end">
            <Suspense fallback={null}>
              <GlobalSearch />
            </Suspense>
          </div>
          <AddButton />
        </div>
      </header>
      {children}
      <CaptureDialog />
      <ServiceWorker />
      <ResumeRefresh />
      {shouldRoll(session) && <SessionRefresh />}
    </div>
  );
}
