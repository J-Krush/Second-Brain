import { eq, isNull } from "drizzle-orm";
import { Zip, ZipDeflate, strToU8 } from "fflate";
import { db } from "@/db";
import { cardTags, cards, files, tags } from "@/db/schema";
import { extForMime } from "./files";
import { getObjectBytes } from "./r2";

function yamlString(value: string): string {
  // Quote and escape for a YAML scalar.
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function frontmatter(
  card: {
    id: string;
    type: string;
    title: string | null;
    url: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
  cardTagNames: string[],
): string {
  const lines = [
    "---",
    `id: ${card.id}`,
    `type: ${card.type}`,
    `title: ${yamlString(card.title ?? "")}`,
    `created: ${card.createdAt.toISOString()}`,
    `updated: ${card.updatedAt.toISOString()}`,
  ];
  if (card.url) lines.push(`url: ${yamlString(card.url)}`);
  if (cardTagNames.length) lines.push(`tags: [${cardTagNames.join(", ")}]`);
  lines.push("---", "");
  return lines.join("\n");
}

/**
 * Stream a zip of the entire knowledge base: one markdown file per card (with
 * frontmatter) plus every active file's original bytes. This is the hard
 * ownership guarantee, not a nice-to-have.
 *
 * fflate emits compressed chunks through `ondata` as entries are pushed, so
 * the zip is produced incrementally instead of being buffered whole.
 */
export function buildExportArchive(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const zip = new Zip((err, chunk, final) => {
        if (err) {
          controller.error(err);
          return;
        }
        controller.enqueue(chunk);
        if (final) controller.close();
      });

      function addEntry(name: string, data: Uint8Array): void {
        const entry = new ZipDeflate(name, { level: 6 });
        zip.add(entry);
        entry.push(data, true);
      }

      void (async () => {
        try {
          const allCards = await db
            .select()
            .from(cards)
            .where(isNull(cards.deletedAt));

          const tagRows = await db
            .select({ cardId: cardTags.cardId, name: tags.name })
            .from(cardTags)
            .innerJoin(tags, eq(tags.id, cardTags.tagId));
          const tagsByCard = new Map<string, string[]>();
          for (const r of tagRows) {
            const list = tagsByCard.get(r.cardId) ?? [];
            list.push(r.name);
            tagsByCard.set(r.cardId, list);
          }

          for (const card of allCards) {
            const md =
              frontmatter(card, tagsByCard.get(card.id) ?? []) + (card.body ?? "");
            addEntry(`cards/${card.id}.md`, strToU8(md));
          }

          const activeFiles = await db
            .select()
            .from(files)
            .where(eq(files.status, "active"));
          for (const file of activeFiles) {
            const bytes = await getObjectBytes(
              `${file.r2Prefix}original.${extForMime(file.mime)}`,
            );
            if (bytes) {
              addEntry(`files/${file.id}.${extForMime(file.mime)}`, new Uint8Array(bytes));
            }
          }

          zip.end();
        } catch (err) {
          zip.terminate();
          controller.error(err);
        }
      })();
    },
  });
}
