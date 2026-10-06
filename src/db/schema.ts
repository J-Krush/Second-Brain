import { sql } from "drizzle-orm";
import {
  bigint,
  customType,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Drizzle schema mirrors src/db/0000_init.sql plus later migrations
 * (src/db/0001_*.sql, 0002_*.sql, ...), which are the DDL source of
 * truth (generated columns, extensions, and HNSW indexes are clearer in raw
 * SQL). This file exists for typed queries; keep the two in sync.
 */

// pgvector column, fixed at 1024 dims (Workers AI @cf/baai/bge-m3).
const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(1024)";
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    return JSON.parse(value) as number[];
  },
});

// Generated tsvector; read-only from the app's perspective.
const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

export const cards = pgTable(
  "cards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type").notNull(),
    title: text("title"),
    body: text("body"),
    url: text("url"),
    props: jsonb("props").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    search: tsvector("search"),
    embedding: vector("embedding"),
    embeddingHash: text("embedding_hash"),
    embeddedAt: timestamp("embedded_at", { withTimezone: true }),
    triagedAt: timestamp("triaged_at", { withTimezone: true }),
  },
  (t) => [
    index("cards_search_idx").using("gin", t.search),
    index("cards_title_trgm").using("gin", sql`${t.title} gin_trgm_ops`),
    index("cards_type_idx")
      .on(t.type)
      .where(sql`${t.deletedAt} IS NULL`),
    index("cards_inbox_idx")
      .on(t.createdAt.desc())
      .where(sql`${t.deletedAt} IS NULL`),
    index("cards_untriaged_idx")
      .on(t.createdAt.desc())
      .where(sql`${t.deletedAt} IS NULL AND ${t.triagedAt} IS NULL`),
    index("cards_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

export const edges = pgTable(
  "edges",
  {
    fromCard: uuid("from_card")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    toCard: uuid("to_card")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    label: text("label"),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.fromCard, t.toCard] })],
);

export const placements = pgTable(
  "placements",
  {
    boardId: uuid("board_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    cardId: uuid("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    x: doublePrecision("x").notNull(),
    y: doublePrecision("y").notNull(),
    w: doublePrecision("w"),
    h: doublePrecision("h"),
    z: integer("z").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.boardId, t.cardId] }),
    index("placements_card_idx").on(t.cardId),
  ],
);

export const tags = pgTable("tags", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  color: text("color"),
});

export const cardTags = pgTable(
  "card_tags",
  {
    cardId: uuid("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.cardId, t.tagId] })],
);

export const files = pgTable("files", {
  id: uuid("id").primaryKey().defaultRandom(),
  r2Prefix: text("r2_prefix").notNull(),
  mime: text("mime").notNull(),
  bytes: bigint("bytes", { mode: "number" }).notNull(),
  width: integer("width"),
  height: integer("height"),
  sha256: text("sha256").notNull().unique(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const fileRefs = pgTable(
  "file_refs",
  {
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    cardId: uuid("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
  },
  (t) => [primaryKey({ columns: [t.fileId, t.cardId, t.role] })],
);

// Login rate limiting: fixed-window counter, serverless-safe (in-memory is not).
export const loginAttempts = pgTable(
  "login_attempts",
  {
    ip: text("ip").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.ip, t.windowStart] })],
);

// Per-feature settings documents; see src/lib/settings.ts.
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Card = typeof cards.$inferSelect;
export type NewCard = typeof cards.$inferInsert;
export type Placement = typeof placements.$inferSelect;
export type FileRow = typeof files.$inferSelect;
