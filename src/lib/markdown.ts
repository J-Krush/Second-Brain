import { marked } from "marked";

// Rewrites markdown image sources and link hrefs of the form `file:UUID` to the
// app's file endpoints so cards render the bytes we own (never remote hotlinks).
// Images embed a thumbnail; links (audio, video, documents) open the original.
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
    link({ href, title, tokens }) {
      const m = FILE_SRC_RE.exec(href);
      // Anything that isn't a file reference keeps marked's default link rendering.
      if (!m) return false;
      const t = title ? ` title="${title}"` : "";
      return `<a href="/api/files/${m[1]}/original" target="_blank" rel="noreferrer"${t}>${this.parser.parseInline(tokens)}</a>`;
    },
  },
});

export function renderMarkdown(body: string | null | undefined): string {
  if (!body) return "";
  return marked.parse(body, { async: false });
}
