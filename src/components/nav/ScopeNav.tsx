"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { onCardChanged } from "@/lib/card-events";

interface CountResponse {
  inbox: number;
}

const SCOPES = ["inbox", "library"] as const;

/**
 * Header tabs for the two scopes of `/`. On the home page they rewrite only
 * `scope` so filters survive; from any other page they're plain links. The
 * inbox badge is an exact count, refreshed whenever a card changes.
 */
export function ScopeNav() {
  const pathname = usePathname();
  const params = useSearchParams();
  const onHome = pathname === "/";
  const current = params.get("scope") === "library" ? "library" : "inbox";
  const [inbox, setInbox] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    function refresh() {
      fetch("/api/cards/count")
        .then((res) => (res.ok ? (res.json() as Promise<CountResponse>) : null))
        .then((data) => {
          if (alive && data) setInbox(data.inbox);
        })
        .catch(() => {});
    }
    refresh();
    const off = onCardChanged(refresh);
    return () => {
      alive = false;
      off();
    };
  }, []);

  return (
    <nav className="flex items-center gap-1 font-mono text-[13px] uppercase tracking-widest" aria-label="scope">
      {SCOPES.map((scope) => {
        const next = new URLSearchParams(onHome ? params : undefined);
        next.delete("card");
        if (scope === "inbox") next.delete("scope");
        else next.set("scope", scope);
        const qs = next.toString();
        const active = onHome && current === scope;
        return (
          <Link
            key={scope}
            href={qs ? `/?${qs}` : "/"}
            replace={onHome}
            aria-current={active ? "page" : undefined}
            className={`flex h-8 items-center border-b-2 px-2 pt-0.5 transition-colors ${
              active ? "border-accent text-ink" : "border-transparent text-ink-faint hover:text-ink"
            }`}
          >
            {scope}
            {scope === "inbox" && inbox !== null && inbox > 0 && (
              <span className="ml-1.5 text-accent">{inbox}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
