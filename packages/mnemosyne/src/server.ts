import Fastify from "fastify";
import { openDatabase } from "./db.ts";
import { env } from "./env.ts";
import { recall, remember } from "./memories.ts";
import type { Memory } from "./schema.ts";

const MAX_CONTENT_LENGTH = 4000;
const DEFAULT_RECALL_LIMIT = 10;
const MAX_RECALL_LIMIT = 50;

const { db, sqlite, path } = openDatabase(env.dbPath);

const app = Fastify({ logger: true });

const toWire = (memory: Memory) => ({
  id: memory.id,
  content: memory.content,
  tags: memory.tags === "" ? [] : memory.tags.split(","),
  createdAt: memory.createdAt.toISOString(),
});

const rememberBodySchema = {
  type: "object",
  required: ["content"],
  additionalProperties: false,
  properties: {
    content: { type: "string", minLength: 1, maxLength: MAX_CONTENT_LENGTH },
    tags: { type: "array", items: { type: "string", minLength: 1 }, maxItems: 10 },
  },
} as const;

const recallBodySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    query: { type: "string" },
    limit: { type: "integer", minimum: 1, maximum: MAX_RECALL_LIMIT },
  },
} as const;

interface RememberBody {
  content: string;
  tags?: string[];
}

interface RecallBody {
  query?: string;
  limit?: number;
}

app.get("/health", () => ({ status: "ok", store: path }));

app.post<{ Body: RememberBody }>(
  "/remember",
  { schema: { body: rememberBodySchema } },
  async (request, reply) => {
    const stored = remember(db, request.body.content, request.body.tags ?? []);
    return reply.code(201).send({ memory: toWire(stored) });
  },
);

app.post<{ Body: RecallBody }>(
  "/recall",
  { schema: { body: recallBodySchema } },
  async (request) => {
    const limit = request.body?.limit ?? DEFAULT_RECALL_LIMIT;
    const found = recall(db, request.body?.query, limit);
    return { memories: found.map(toWire) };
  },
);

const shutdown = async (signal: string): Promise<void> => {
  app.log.info(`${signal} received, shutting down`);
  await app.close();
  sqlite.close();
  process.exit(0);
};

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

try {
  await app.listen({ port: env.port, host: "127.0.0.1" });
} catch (error) {
  app.log.error(error, "Mnemosyne failed to start");
  process.exit(1);
}
