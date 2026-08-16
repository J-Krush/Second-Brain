/**
 * Browser-side upload flow: hash -> presign (dedupe) -> PUT to R2 -> confirm.
 * Returns the file id to embed as `file:<id>` in markdown.
 */
export async function uploadFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const sha256 = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const presignRes = await fetch("/api/files/presign", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sha256, mime: file.type, bytes: file.size }),
  });
  if (!presignRes.ok) throw new Error("presign failed");
  const presign = await presignRes.json();

  // Deduped: identical bytes already stored, nothing to upload.
  if (presign.existing) return presign.fileId as string;

  const put = await fetch(presign.uploadUrl, {
    method: "PUT",
    headers: { "content-type": file.type },
    body: file,
  });
  if (!put.ok) throw new Error("upload failed");

  const confirm = await fetch(`/api/files/${presign.fileId}/confirm`, {
    method: "POST",
  });
  if (!confirm.ok) throw new Error("confirm failed");
  return presign.fileId as string;
}
