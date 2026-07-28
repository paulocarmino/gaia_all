import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import * as schema from "./schema.ts";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Opens the store and brings it up to the current schema.
 *
 * The same driver talks to the local container and to CloudNativePG on the VPS,
 * so there is no dialect gap between development and production.
 */
export const openDatabase = async (connectionString: string) => {
  const pool = new Pool({ connectionString, max: 5 });
  const db = drizzle(pool, { schema });

  await migrate(db, { migrationsFolder: resolve(packageRoot, "drizzle") });

  return { db, pool };
};

export type Db = Awaited<ReturnType<typeof openDatabase>>["db"];
