import type { FastifyInstance } from "fastify";

import { CQ_TRACE_HEADER, parseCqTraceId } from "@capital-q/contracts";
import {
  createRoundTripCounter,
  currentRoundTripCounter,
  withRoundTripCounter,
} from "@capital-q/database";

/**
 * One "request timing" line per request (R4 runtime topology): the route
 * template, status, server time and the database round trips the request
 * made, plus the caller's untrusted trace id so a web log line, this line
 * and a Q run's correlation id can be joined. Additive only: the request id
 * and the framework's own "request completed" line are unchanged.
 *
 * The counter is entered in onRequest so every query issued while handling
 * the request is counted; work the handler detaches and that outlives the
 * response is counted after this line is written and is not reported.
 */
export function registerRequestTiming(app: FastifyInstance): void {
  app.addHook("onRequest", (_request, _reply, done) => {
    withRoundTripCounter(createRoundTripCounter(), done);
  });
  app.addHook("onResponse", (request, reply, done) => {
    const url = request.routeOptions.url;
    if (url === undefined || !url.startsWith("/health/")) {
      const trace = parseCqTraceId(request.headers[CQ_TRACE_HEADER]);
      request.log.info(
        {
          route: url ?? "unmatched",
          method: request.method,
          statusCode: reply.statusCode,
          durationMs: Math.round(reply.elapsedTime),
          dbRoundTrips: currentRoundTripCounter()?.count ?? 0,
          ...(trace === undefined ? {} : { clientTraceId: trace }),
        },
        "request timing",
      );
    }
    done();
  });
}
