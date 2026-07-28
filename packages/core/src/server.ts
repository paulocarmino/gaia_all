import Fastify from "fastify";
import { requireBearerToken } from "./auth.ts";
import { createBrain } from "./brain.ts";
import { env } from "./env.ts";
import { createMemoryClient, createRememberTool } from "./memory.ts";
import { SYSTEM_PROMPT } from "./persona.ts";
import { createSession } from "./session.ts";

const MAX_MESSAGE_LENGTH = 16_000;

const memory = createMemoryClient(env.mnemosyneUrl);

const agent = createBrain({
  modelId: env.brainModel,
  baseUrl: env.ollamaBaseUrl,
  systemPrompt: SYSTEM_PROMPT,
  tools: [createRememberTool(memory)],
});

const session = createSession(agent, memory, SYSTEM_PROMPT);

const app = Fastify({ logger: true });

const chatBodySchema = {
  type: "object",
  required: ["message"],
  additionalProperties: false,
  properties: {
    message: { type: "string", minLength: 1, maxLength: MAX_MESSAGE_LENGTH },
  },
} as const;

interface ChatBody {
  message: string;
}

/** Liveness only, no secrets, so it stays outside the front door. */
app.get("/health", () => ({ status: "ok", model: env.brainModel, busy: session.isBusy() }));

app.register(async (protectedRoutes) => {
  protectedRoutes.addHook("preHandler", requireBearerToken(env.authToken));

  protectedRoutes.post<{ Body: ChatBody }>(
    "/chat",
    { schema: { body: chatBodySchema } },
    async (request, reply) => {
      try {
        const { mode, reply: text } = await session.send(request.body.message);
        return { mode, reply: text };
      } catch (error) {
        request.log.error(error, "chat turn failed");
        const detail = error instanceof Error ? error.message : "Unknown brain failure";
        // GAIA is down when her brain is down; say so instead of pretending.
        return reply.code(502).send({ error: "Brain unavailable", detail });
      }
    },
  );

  /**
   * Live view of the loop. This is how a message sent mid-run can be observed
   * landing inside the run it interrupted, and it is the transport shape the
   * panel will reuse later.
   */
  protectedRoutes.get("/stream", (request, reply) => {
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    reply.raw.write(`event: ready\ndata: {}\n\n`);

    const unsubscribe = session.subscribe((event) => {
      reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    });

    const heartbeat = setInterval(() => reply.raw.write(": ping\n\n"), 15_000);

    request.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
});

const shutdown = async (signal: string): Promise<void> => {
  app.log.info(`${signal} received, shutting down`);
  agent.abort();
  await app.close();
  process.exit(0);
};

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

try {
  const recalledCount = await session.primeMemory();
  app.log.info(`Recalled ${recalledCount} memories from ${env.mnemosyneUrl}`);
  await app.listen({ port: env.port, host: "127.0.0.1" });
} catch (error) {
  app.log.error(error, "GAIA core failed to start");
  process.exit(1);
}
