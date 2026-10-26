import { Suspense } from "react";
import { AskPage } from "@/components/ask/AskPage";
import { requireSession } from "@/lib/page-auth";

export const dynamic = "force-dynamic";

export default async function Ask() {
  await requireSession();
  return (
    <Suspense fallback={null}>
      <AskPage />
    </Suspense>
  );
}
