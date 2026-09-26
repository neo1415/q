import { ownInvestorOrganisationIn } from "@capital-q/model-gateway/q";
import type { Logger } from "@capital-q/observability";
import {
  GetInvestorMandateOutputSchema,
  type GetInvestorMandateOutput,
} from "@capital-q/q-tools";
import type { QAnswerRequest, QToolPort } from "@capital-q/q-runtime";

/**
 * The person's own mandate for a mandate document (gap 3), read through
 * the same get_investor_mandate tool the model could call, under this
 * run's plan: the tool authorises, and the plan binds a mandate only to
 * the investor's own organisation. Nothing here decides a permission.
 */
export function createToolOwnMandatePort(
  tools: QToolPort,
  logger?: Logger,
): {
  readonly read: (
    request: QAnswerRequest,
  ) => Promise<GetInvestorMandateOutput | "NOT_AN_INVESTOR" | null>;
} {
  return {
    read: async (request) => {
      const own = ownInvestorOrganisationIn(request.plan);
      if (own === null) return "NOT_AN_INVESTOR";
      const outcome = await tools.execute(
        {
          callId: "q-own-mandate-document",
          name: "get_investor_mandate",
          arguments: { investorOrganisationId: own },
        },
        {
          actor: request.actor,
          runId: request.runId,
          correlationId: request.correlationId,
          capability: request.capability,
          plan: request.plan,
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        },
      );
      if (!outcome.result.ok) {
        logger?.warn(
          { qRunId: request.runId, failureCode: outcome.failureCode },
          "the person's own mandate could not be read for a document",
        );
        return null;
      }
      const parsed = GetInvestorMandateOutputSchema.safeParse(
        outcome.result.data,
      );
      return parsed.success ? parsed.data : null;
    },
  };
}
