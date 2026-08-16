import Link from "next/link";
import { CaptureModal } from "@/components/CaptureModal";
import { LogoutButton } from "@/components/LogoutButton";
import { SearchPalette } from "@/components/SearchPalette";
import { ServiceWorker } from "@/components/ServiceWorker";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-base/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-4xl items-center gap-6 px-6">
          <Link href="/" className="font-display text-lg font-bold tracking-tight text-ink">
            <span className="text-accent">&gt;</span> second brain
          </Link>
          <nav className="flex gap-1 font-mono text-xs uppercase tracking-widest text-ink-faint">
            <Link href="/" className="rounded px-3 py-1.5 hover:text-ink">
              Inbox
            </Link>
            <Link href="/library" className="rounded px-3 py-1.5 hover:text-ink">
              Library
            </Link>
            <Link href="/settings" className="rounded px-3 py-1.5 hover:text-ink">
              Settings
            </Link>
          </nav>
          <div className="ml-auto">
            <LogoutButton />
          </div>
        </div>
      </header>
      {children}
      <SearchPalette />
      <CaptureModal />
      <ServiceWorker />
    </div>
  );
}
