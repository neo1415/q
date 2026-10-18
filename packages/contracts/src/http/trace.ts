/**
 * One client-side trace id carried across browser → web → api/q-api, for
 * latency attribution only (R4 runtime topology).
 *
 * It is NOT the request id: each Fastify service still generates its own
 * `req_*` id and ignores a client-supplied X-Request-Id, so a caller cannot
 * forge or collide with another request's log identity. The trace id is
 * logged as a separate, untrusted field and never authorises anything.
 */
export const CQ_TRACE_HEADER = "x-cq-trace-id" as const;

/** Bounded charset and length: it lands in a log line, nothing else. */
const CQ_TRACE_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** The trace id when well-formed; otherwise nothing (never an error). */
export function parseCqTraceId(raw: unknown): string | undefined {
  return typeof raw === "string" && CQ_TRACE_ID.test(raw) ? raw : undefined;
}
