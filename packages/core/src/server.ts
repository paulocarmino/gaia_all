import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { createClaudeCodeArm } from "./arms/claude-code.ts";
import { createDelegateCodeTool } from "./arms/delegate.ts";
import { createGlmArm } from "./arms/glm.ts";
import { requireBearerToken } from "./auth.ts";
import { createBrain } from "./brain.ts";
import { env } from "./env.ts";
import { createMemoryClient, createRememberTool } from "./memory.ts";
import { SYSTEM_PROMPT } from "./persona.ts";
import { createSession } from "./session.ts";
import { createLookAtImageTool, createVision, SUPPORTED_MEDIA_TYPES } from "./vision.ts";

const MAX_MESSAGE_LENGTH = 16_000;
/** Screenshots are routinely a few MB once base64 inflates them by a third. */
const MAX_BODY_BYTES = 25 * 1024 * 1024;
const MAX_IMAGES_PER_MESSAGE = 4;

const memory = createMemoryClient(env.mnemosyneUrl);

const vision = createVision({
  modelId: env.visionModel,
  baseUrl: env.ollamaBaseUrl,
  apiKey: env.ollamaApiKey,
  imageDir: `${env.dataDir}/images`,
});

const delegateCode = createDelegateCodeTool({
  arms: [
    createClaudeCodeArm({
      binary: env.claudeBinary,
      timeoutMs: env.armTimeoutMs,
      permissionMode: env.claudePermissionMode,
    }),
    createGlmArm({
      modelId: env.armModel,
      baseUrl: env.ollamaBaseUrl,
      timeoutMs: env.armTimeoutMs,
    }),
  ],
  workspaceDir: env.workspaceDir,
  concurrency: env.armConcurrency,
});

const agent = createBrain({
  modelId: env.brainModel,
  baseUrl: env.ollamaBaseUrl,
  systemPrompt: SYSTEM_PROMPT,
  tools: [createRememberTool(memory), delegateCode, createLookAtImageTool(vision)],
});

const session = createSession(agent, memory, SYSTEM_PROMPT, vision);

const app = Fastify({ logger: true, bodyLimit: MAX_BODY_BYTES });

const chatBodySchema = {
  type: "object",
  required: ["message"],
  additionalProperties: false,
  properties: {
    message: { type: "string", minLength: 1, maxLength: MAX_MESSAGE_LENGTH },
    images: {
      type: "array",
      maxItems: MAX_IMAGES_PER_MESSAGE,
      items: {
        type: "object",
        required: ["mediaType", "data"],
        additionalProperties: false,
        properties: {
          mediaType: { type: "string", enum: SUPPORTED_MEDIA_TYPES },
          data: { type: "string", minLength: 1 },
        },
      },
    },
  },
} as const;

interface ChatBody {
  message: string;
  images?: { mediaType: string; data: string }[];
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
        const stored = await Promise.all(
          (request.body.images ?? []).map((image) => vision.store(image)),
        );
        const { mode, reply: text } = await session.send(request.body.message, stored);
        return { mode, reply: text, images: stored };
      } catch (error) {
        request.log.error(error, "chat turn failed");
        const detail = error instanceof Error ? error.message : "Unknown brain failure";
        // GAIA is down when her brain is down; say so instead of pretending.
        return reply.code(502).send({ error: "Brain unavailable", detail });
      }
    },
  );

  /**
   * The conversation so far. The panel is a window onto a conversation that
   * lives in this process, so a page reload reads it back instead of losing it.
   */
  protectedRoutes.get("/messages", () => ({
    messages: session.transcript(),
    busy: session.isBusy(),
    model: env.brainModel,
  }));

  /** Serves back an image Paulo attached, so the panel can render it. */
  protectedRoutes.get<{ Params: { id: string } }>(
    "/images/:id",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string", pattern: "^[0-9a-f-]{36}$" },
          },
        },
      },
    },
    async (request, reply) => {
      for (const mediaType of SUPPORTED_MEDIA_TYPES) {
        const bytes = await vision.read(request.params.id, mediaType).catch(() => undefined);
        if (bytes !== undefined) {
          return reply.type(mediaType).header("cache-control", "private, max-age=31536000").send(bytes);
        }
      }
      return reply.code(404).send({ error: "No such image" });
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

/**
 * Serves the built panel, when there is one.
 *
 * Production never runs a dev server: an unbundled dev server serves hundreds of
 * separate modules and leaks memory through its own watchers the longer it stays
 * up, which is exactly the slowness the previous build suffered from. Here the
 * panel is static files, and the panel's dev server proxies to this process.
 */
const panelDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../panel/dist",
);

if (existsSync(panelDir)) {
  await app.register(fastifyStatic, { root: panelDir });
  // Client-side routing: anything not matched by an API route is the app shell.
  app.setNotFoundHandler((request, reply) => {
    if (request.method !== "GET") return reply.code(404).send({ error: "Not found" });
    return reply.sendFile("index.html");
  });
  app.log.info(`Serving the panel from ${panelDir}`);
} else {
  app.log.info("No panel build found; run `pnpm build:panel` to serve one");
}

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
