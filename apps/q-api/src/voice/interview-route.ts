import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  QInterviewTurnRequestSchema,
  QInterviewTurnResponseSchema,
} from "@capital-q/contracts";
import { AuthenticationRequiredError } from "@capital-q/security";

import { extractBearerToken } from "@capital-q/security/supabase";

import { signupContextFromToken, type Interviewer } from "./interviewer.js";

/**
 * One turn of the Q interview, over HTTP (QX-004 core gate: one Q).
 *
 * Capital Q had grown two conversational implementations. The typed
 * onboarding screen composed its own replies in the browser from
 * templates, while the spoken one ran this interviewer. Two engines, two
 * sets of rules, and the one people actually type into was the poorer:
 * it read a step's raw prompt back as a question — "Your firm" — and
 * asked for an organisation the person had typed at registration two
 * screens earlier.
 *
 * This route is how they became one. It is a thin transport in front of
 * the interviewer that already exists: no rules live here, nothing is
 * composed here, and nothing about a turn depends on whether it arrived
 * from a keyboard or a microphone.
 *
 * The caller's own bearer is what the interviewer uses to read and write
 * the onboarding session, exactly as the spoken path does. No service
 * credential, no ambient tenant: a typed turn can do what the person
 * could have done by tapping, and no more.
 */

export type QInterviewRouteDependencies = {
  readonly path: string;
  readonly interviewer: Interviewer;
  /** Where the onboarding session lives; the interviewer calls it as the person. */
  readonly apiBaseUrl: string;
  readonly correlation: () => string;
};

export function registerQInterviewRoute(
  app: FastifyInstance,
  dependencies: QInterviewRouteDependencies,
): void {
  app.post(dependencies.path, async (request: FastifyRequest, reply) => {
    const header = request.headers.authorization;
    const accessToken = extractBearerToken(
      typeof header === "string" ? header : undefined,
    );
    if (accessToken === null) {
      throw new AuthenticationRequiredError();
    }

    const input = QInterviewTurnRequestSchema.parse(request.body ?? {});
    const outcome = await dependencies.interviewer.turn({
      session: { baseUrl: dependencies.apiBaseUrl, accessToken },
      onboardingSessionId: input.onboardingSessionId,
      journeyType: input.journeyType === "investor" ? "investor" : "founder",
      channel: input.channel,
      // Attribution only. Authority is the bearer above, and the
      // onboarding service re-derives everything from it.
      attribution: {
        tenantId: "00000000-0000-4000-8000-000000000000",
        userId: "00000000-0000-4000-8000-000000000000",
        correlationId: dependencies.correlation(),
      },
      signup: signupContextFromToken(accessToken),
      utterance: input.utterance,
      recentTurns: [...input.recentTurns],
    });

    void reply.header("Cache-Control", "no-store");
    return QInterviewTurnResponseSchema.parse({
      reply: outcome.reply,
      intent: outcome.intent,
      asking:
        outcome.asking === null
          ? null
          : {
              stepKey: outcome.asking.stepKey,
              kind: outcome.asking.kind,
              options: outcome.asking.options.map((option) => ({
                key: option.key,
                label: option.label,
                ...(option.description === undefined
                  ? {}
                  : { description: option.description }),
              })),
              ...(outcome.asking.maxChoices === undefined
                ? {}
                : { maxChoices: outcome.asking.maxChoices }),
            },
      recorded: [...outcome.recorded],
      skipped: [...outcome.skipped],
      questionForQ: outcome.questionForQ,
      researching: outcome.researching,
      navigate: outcome.navigate,
      handoff: outcome.handoff,
      degraded: outcome.degraded,
    });
  });
}
