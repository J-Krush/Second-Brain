import { redirect } from "next/navigation";

/** Card detail lives in the modal over `/`; keep old links working. */
export default async function CardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/?card=${encodeURIComponent(id)}`);
}
