import { Suspense } from "react";
import { BrainPage } from "@/components/brain/BrainPage";
import { listTags } from "@/lib/tags";
import { requireSession } from "@/lib/page-auth";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  await requireSession();
  const tags = await listTags();
  return (
    <main>
      <Suspense fallback={null}>
        <BrainPage tags={tags} />
      </Suspense>
    </main>
  );
}
