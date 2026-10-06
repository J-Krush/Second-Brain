import { Suspense } from "react";
import { BrainPage } from "@/components/brain/BrainPage";
import { requireSession } from "@/lib/page-auth";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  await requireSession();
  return (
    <main>
      <Suspense fallback={null}>
        <BrainPage />
      </Suspense>
    </main>
  );
}
