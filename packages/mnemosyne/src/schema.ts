import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * A single thing GAIA decided was worth remembering.
 *
 * Deliberately flat for now: one row is one note, in her own words. Tags are
 * jsonb rather than a comma-joined string because Postgres can query inside
 * them, which is what a comma-joined string was quietly preventing.
 */
export const memories = pgTable(
  "memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    content: text("content").notNull(),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("memories_created_at_idx").on(table.createdAt)],
);

export type Memory = typeof memories.$inferSelect;
export type NewMemory = typeof memories.$inferInsert;
