import { marked } from "marked";

// Rewrites markdown image sources of the form `file:UUID` to the app's file
// variant endpoint so cards render the bytes we own (never remote hotlinks).
const FILE_SRC_RE =
  /^file:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

marked.use({
  renderer: {
    image({ href, title, text }) {
      const m = FILE_SRC_RE.exec(href ?? "");
      const src = m ? `/api/files/${m[1]}/thumb-1200` : href;
      const t = title ? ` title="${title}"` : "";
      return `<img src="${src}" alt="${text ?? ""}"${t} loading="lazy" />`;
    },
  },
});

export function renderMarkdown(body: string | null | undefined): string {
  if (!body) return "";
  return marked.parse(body, { async: false });
}
