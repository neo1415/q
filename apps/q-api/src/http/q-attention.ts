import type { FastifyInstance } from "fastify";

import {
  createProblemDetails,
  PROBLEM_CONTENT_TYPE,
  Q_ATTENTION_PATH,
  QAttentionReportSchema,
} from "@capital-q/contracts";
import type { AttentionReader } from "@capital-q/q-tools";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * RECOVERY-2026-10 B1: "what needs you", as one read for every surface
 * (the arrival briefing, the voice opener, the Work page). The same reader
 * Q's `what_needs_me` tool uses, so a page and Q's answer can never
 * disagree about what is waiting. The person's own report only, by the
 * resolved actor; a source that could not be read is in `unread`.
 *
 * Path proposed to the lead (B spec §5): `GET /v1/q/attention?since=`.
 */
export type AttentionRoutesDependencies = ActorContextDependencies & {
  readonly attention: AttentionReader;
};

/** How far back `since` may reach: a month is "since your last visit". */
const SINCE_MAX_MS = 31 * 24 * 3_600_000;

export function registerAttentionRoutes(
  app: FastifyInstance,
  dependencies: AttentionRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  app.get(
    Q_ATTENTION_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const query = (request.query ?? {}) as { readonly since?: unknown };
      const now = new Date();
      let since: Date | null = null;
      if (query.since !== undefined) {
        const at =
          typeof query.since === "string" ? new Date(query.since) : null;
        if (
          at === null ||
          Number.isNaN(at.getTime()) ||
          at.getTime() > now.getTime() ||
          now.getTime() - at.getTime() > SINCE_MAX_MS
        ) {
          const problem = createProblemDetails({
            code: "INVALID_REQUEST",
            requestId: request.id,
            detail: "since must be an ISO time within the last month.",
          });
          return reply
            .status(problem.status)
            .type(PROBLEM_CONTENT_TYPE)
            .send(problem);
        }
        since = at;
      }
      const actor = getActorContext(request);
      const report = await dependencies.attention(actor, { now, since });
      void reply.header("Cache-Control", "no-store");
      return QAttentionReportSchema.parse(report);
    },
  );
}
