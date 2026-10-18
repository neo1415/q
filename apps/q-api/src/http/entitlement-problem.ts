import type { FastifyReply, FastifyRequest } from "fastify";
import {
  createEntitlementProblem,
  PROBLEM_CONTENT_TYPE,
  type EntitlementProblemExtension,
} from "@capital-q/contracts";

/** BILLING (ADR 0034): the plan does not cover this now; say so plainly. */
export function sendEntitlementRequired(
  request: FastifyRequest,
  reply: FastifyReply,
  entitlement: EntitlementProblemExtension,
) {
  const body = createEntitlementProblem({ requestId: request.id, entitlement });
  return reply
    .status(body.status)
    .type(PROBLEM_CONTENT_TYPE)
    .header("Cache-Control", "no-store")
    .send(body);
}
