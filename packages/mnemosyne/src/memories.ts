import { desc, like, or, sql } from "drizzle-orm";
import type { Db } from "./db.ts";
import { type Memory, memories } from "./schema.ts";

/** Upper bound on rows scored in JS for a single recall. */
const CANDIDATE_LIMIT = 200;
/** Words shorter than this carry no signal and only add noise. */
const MIN_TOKEN_LENGTH = 3;

const tokenize = (query: string): string[] => {
  const seen = new Set<string>();
  for (const raw of query.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length >= MIN_TOKEN_LENGTH) seen.add(raw);
  }
  return [...seen];
};

const escapeLike = (token: string): string => token.replace(/[\\%_]/g, "\\$&");

const overlapScore = (memory: Memory, tokens: readonly string[]): number => {
  const haystack = `${memory.content} ${memory.tags}`.toLowerCase();
  return tokens.reduce((score, token) => (haystack.includes(token) ? score + 1 : score), 0);
};

export const remember = (db: Db, content: string, tags: readonly string[]): Memory => {
  const [inserted] = db
    .insert(memories)
    .values({
      content,
      tags: tags.join(","),
      createdAt: new Date(),
    })
    .returning()
    .all();

  if (!inserted) throw new Error("Insert returned no row");
  return inserted;
};

const recent = (db: Db, limit: number): Memory[] =>
  db.select().from(memories).orderBy(desc(memories.createdAt)).limit(limit).all();

/**
 * Keyword overlap plus recency. Deliberately the dumbest retrieval that works
 * (see ARCHITECTURE, Memory): matches are ranked by how many query tokens they
 * contain, ties broken by recency, and the result is topped up with the most
 * recent memories so a conversation always starts with some context.
 */
export const recall = (db: Db, query: string | undefined, limit: number): Memory[] => {
  const tokens = query === undefined ? [] : tokenize(query);

  if (tokens.length === 0) return recent(db, limit);

  const candidates = db
    .select()
    .from(memories)
    .where(
      or(
        ...tokens.flatMap((token) => [
          like(sql`lower(${memories.content})`, `%${escapeLike(token)}%`),
          like(sql`lower(${memories.tags})`, `%${escapeLike(token)}%`),
        ]),
      ),
    )
    .orderBy(desc(memories.createdAt))
    .limit(CANDIDATE_LIMIT)
    .all();

  const ranked = [...candidates]
    .sort((a, b) => {
      const byScore = overlapScore(b, tokens) - overlapScore(a, tokens);
      return byScore !== 0 ? byScore : b.createdAt.getTime() - a.createdAt.getTime();
    })
    .slice(0, limit);

  if (ranked.length >= limit) return ranked;

  const chosen = new Set(ranked.map((memory) => memory.id));
  const filler = recent(db, limit).filter((memory) => !chosen.has(memory.id));
  return [...ranked, ...filler].slice(0, limit);
};
