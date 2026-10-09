import "server-only";

import { headers } from "next/headers";

import { CQ_TRACE_HEADER, parseCqTraceId } from "@capital-q/contracts";

/**
 * The trace id this web request forwards to q-api/api (R4 runtime topology):
 * a browser-supplied x-cq-trace-id when present, else the Railway edge's
 * request id, which is the `requestId` in Railway's HTTP logs for the web
 * service. Either way it is untrusted, format-checked, and only logged.
 */
export async function forwardedTraceId(): Promise<string | undefined> {
  try {
    const incoming = await headers();
    return (
      parseCqTraceId(incoming.get(CQ_TRACE_HEADER)) ??
      parseCqTraceId(incoming.get("x-railway-request-id"))
    );
  } catch {
    // Outside a request scope (a build-time render): nothing to forward.
    return undefined;
  }
}
