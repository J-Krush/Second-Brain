import Link from "next/link";
import { LogoutButton } from "@/components/LogoutButton";
import { SearchPalette } from "@/components/SearchPalette";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-base/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-4xl items-center gap-6 px-6">
          <Link href="/" className="font-serif text-lg text-ink">
            Second Brain
          </Link>
          <nav className="flex gap-4 text-sm text-ink-dim">
            <Link href="/" className="hover:text-ink">
              Inbox
            </Link>
            <Link href="/library" className="hover:text-ink">
              Library
            </Link>
          </nav>
          <div className="ml-auto">
            <LogoutButton />
          </div>
        </div>
      </header>
      {children}
      <SearchPalette />
    </div>
  );
}
