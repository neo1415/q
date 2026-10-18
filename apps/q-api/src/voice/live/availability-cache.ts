import { createHash } from "node:crypto";

import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  onRequestHookHandler,
} from "fastify";

/**
 * V (2026-10-09 stack runs): "is GPT-Live on for me?" took 1.7-4.1 s under
 * load, although the answer itself is a set lookup. The time was the
 * protected-route hook: the access token verified with the Auth server
 * (a network round trip) and the actor resolved from the database, on every
 * ask. Every page asks once, so every page paid it.
 *
 * The answer is remembered per access token, for a short while: a repeat
 * ask with the same token is answered from memory, with no Auth server call
 * and no database read. Keyed by the token's SHA-256 (the token itself is
 * never kept). Only this boolean is cached; opening a line still goes
 * through the full hook, so a revoked token gets at most a stale "yes" for
 * the TTL and can open nothing with it.
 */

export const AVAILABILITY_TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 1_000;

export type AvailabilityCache = {
  /** The remembered answer for this request's token, or null. */
  readonly read: (request: FastifyRequest) => boolean | null;
  readonly remember: (request: FastifyRequest, available: boolean) => void;
  /** The route hook: a remembered answer replies at once; else `inner`. */
  readonly hook: (inner: onRequestHookHandler) => onRequestHookHandler;
};

function tokenKey(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header !== "string") return null;
  const match = /^Bearer\s+(\S+)$/iu.exec(header.trim());
  const token = match?.[1];
  if (token === undefined || token.length < 20) return null;
  return createHash("sha256").update(token).digest("hex");
}

export function createAvailabilityCache(
  now: () => number = Date.now,
): AvailabilityCache {
  const entries = new Map<string, { available: boolean; until: number }>();
  const read = (request: FastifyRequest): boolean | null => {
    const key = tokenKey(request);
    if (key === null) return null;
    const entry = entries.get(key);
    if (entry === undefined) return null;
    if (entry.until <= now()) {
      entries.delete(key);
      return null;
    }
    return entry.available;
  };
  return {
    read,
    remember: (request, available) => {
      const key = tokenKey(request);
      if (key === null) return;
      entries.delete(key);
      entries.set(key, { available, until: now() + AVAILABILITY_TTL_MS });
      if (entries.size > MAX_ENTRIES) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) entries.delete(oldest);
      }
    },
    hook: (inner) =>
      function availabilityHook(
        this: FastifyInstance,
        request: FastifyRequest,
        reply: FastifyReply,
        done: (error?: Error) => void,
      ): void {
        const remembered = read(request);
        if (remembered === null) {
          inner.call(this, request, reply, done);
          return;
        }
        // Answered here: the lifecycle ends with this reply.
        void reply
          .code(200)
          .header("Cache-Control", "no-store")
          .send({ available: remembered });
      },
  };
}
