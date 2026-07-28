import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * A single thing GAIA decided was worth remembering.
 *
 * Deliberately flat: one row is one note, in her own words. Structure can be
 * added when retrieval quality actually demands it, not before.
 */
export const memories = sqliteTable(
  "memories",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    content: text("content").notNull(),
    /** Free-form comma-separated labels, e.g. "preference,tooling". */
    tags: text("tags").notNull().default(""),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("memories_created_at_idx").on(table.createdAt)],
);

export type Memory = typeof memories.$inferSelect;
export type NewMemory = typeof memories.$inferInsert;
