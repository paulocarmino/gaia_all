import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import type { Database as SqliteDatabase } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.ts";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Opens the store and brings it up to the current schema. Migrations run at
 * boot because this is a single-writer embedded database: there is no window
 * in which another process could be mid-migration.
 */
export const openDatabase = (
  dbPath: string,
): { db: ReturnType<typeof drizzle<typeof schema>>; sqlite: SqliteDatabase; path: string } => {
  const absolutePath = resolve(packageRoot, dbPath);
  mkdirSync(dirname(absolutePath), { recursive: true });

  const sqlite: SqliteDatabase = new Database(absolutePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: resolve(packageRoot, "drizzle") });

  return { db, sqlite, path: absolutePath };
};

export type Db = ReturnType<typeof openDatabase>["db"];
