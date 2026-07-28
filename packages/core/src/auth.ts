import { timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

const BEARER_PREFIX = "Bearer ";

/** Constant-time compare so the token cannot be recovered by timing the endpoint. */
const tokensMatch = (candidate: string, expected: string): boolean => {
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * The lock on the public front door (ARCHITECTURE, Front door authentication).
 * Applied to every exposed endpoint; /health is registered outside it.
 */
export const requireBearerToken =
  (expected: string) =>
  async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const header = request.headers.authorization;

    if (header === undefined || !header.startsWith(BEARER_PREFIX)) {
      await reply.code(401).send({ error: "Missing bearer token" });
      return;
    }

    if (!tokensMatch(header.slice(BEARER_PREFIX.length), expected)) {
      await reply.code(401).send({ error: "Invalid bearer token" });
    }
  };
