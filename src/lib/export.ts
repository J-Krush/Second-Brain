import { Archiver, ZipArchive } from "archiver";
import { eq, isNull } from "drizzle-orm";
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
 */
export function buildExportArchive(): Archiver {
  const archive = new ZipArchive({ zlib: { level: 6 } });

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
        archive.append(md, { name: `cards/${card.id}.md` });
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
          archive.append(bytes, {
            name: `files/${file.id}.${extForMime(file.mime)}`,
          });
        }
      }

      await archive.finalize();
    } catch (err) {
      archive.abort();
      throw err;
    }
  })();

  return archive;
}
