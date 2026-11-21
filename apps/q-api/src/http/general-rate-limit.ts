import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  createProblemDetails,
  PROBLEM_CONTENT_TYPE,
} from "@capital-q/contracts";
import {
  createGeneralRateLimiter,
  type GeneralRateLimits,
} from "@capital-q/security";

/**
 * W1-A (enterprise audit 21 Nov 2026): the general rate limit, a generous
 * backstop on every route but the health probes. Runs after each route's
 * own authentication (preHandler), so a signed-in request counts against
 * the person the server resolved; anything else counts against the client
 * address. Over the limit: 429 as RFC 9457 problem details with
 * Retry-After, naming nobody. The tighter limits some routes keep (the
 * GateQ guest throttle) are unchanged and run as before.
 */
export function clientAddressOf(request: FastifyRequest): string {
  // The right-most X-Forwarded-For entry is the one the platform's edge
  // added (a client can only prepend to it); without one, the socket.
  const forwarded = request.headers["x-forwarded-for"];
  const value = Array.isArray(forwarded) ? forwarded.at(-1) : forwarded;
  const last = value?.split(",").at(-1)?.trim() ?? "";
  return last.length > 0 && last.length <= 64 ? last : request.ip;
}

/**
 * Our own services on the private network (the web server calling for
 * anonymous visitors, a worker) share one address, so an address there is
 * no client: such requests are counted only when they carry a person.
 */
export function isPrivateAddress(address: string): boolean {
  const ip = address.toLowerCase().replace(/^::ffff:/u, "");
  if (ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd")) return true;
  if (ip.startsWith("fe80:")) return true;
  const octets = ip.split(".").map(Number);
  if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o))) {
    return false;
  }
  const [a = -1, b = -1] = octets;
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

export function registerGeneralRateLimit(
  app: FastifyInstance,
  limits: GeneralRateLimits,
  now?: () => number,
): void {
  const limiter = createGeneralRateLimiter(limits, now);
  app.addHook("preHandler", async (request, reply) => {
    if (request.url.startsWith("/health/")) return;
    const userId = request.actorContext?.userId ?? null;
    const address = clientAddressOf(request);
    if (userId === null && isPrivateAddress(address)) return;
    const verdict = limiter.take({ userId, address });
    if (verdict.allowed) return;
    return reply
      .status(429)
      .header("Retry-After", String(verdict.retryAfterSeconds))
      .type(PROBLEM_CONTENT_TYPE)
      .send(
        createProblemDetails({ code: "RATE_LIMITED", requestId: request.id }),
      );
  });
}
