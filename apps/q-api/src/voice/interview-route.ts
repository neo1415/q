import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  QInterviewTurnRequestSchema,
  QInterviewTurnResponseSchema,
} from "@capital-q/contracts";
import { AuthenticationRequiredError } from "@capital-q/security";

import { extractBearerToken } from "@capital-q/security/supabase";

import {
  getActorContext,
  requireActorContextHook,
  requireActorContextOrPersonalHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";
import type { QVoiceRoutesDependencies } from "./routes.js";
import type { InterviewAgent } from "./interview-agent.js";
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

export type QInterviewRouteDependencies = ActorContextDependencies & {
  /**
   * A person with no organisation yet is still attributed to themselves,
   * under the personal bootstrap tenant — exactly as the voice routes do.
   */
  readonly identity?: QVoiceRoutesDependencies["identity"] | undefined;
  readonly path: string;
  readonly interviewer: Interviewer;
  /** The interview as a tool-calling Q run (ADR 0016). When present, it answers. */
  readonly agent?: InterviewAgent | undefined;
  /** Where the onboarding session lives; the interviewer calls it as the person. */
  readonly apiBaseUrl: string;
  readonly correlation: () => string;
};

export function registerQInterviewRoute(
  app: FastifyInstance,
  dependencies: QInterviewRouteDependencies,
): void {
  const identity = dependencies.identity;
  const withContext =
    identity === undefined
      ? requireActorContextHook(dependencies)
      : requireActorContextOrPersonalHook({ ...dependencies, identity });
  app.post(
    dependencies.path,
    { onRequest: withContext },
    async (request: FastifyRequest, reply) => {
      const header = request.headers.authorization;
      const accessToken = extractBearerToken(
        typeof header === "string" ? header : undefined,
      );
      if (accessToken === null) {
        throw new AuthenticationRequiredError();
      }

      const actor = getActorContext(request);
      const input = QInterviewTurnRequestSchema.parse(request.body ?? {});
      const conductor = dependencies.agent;
      const turn = (
        turnInput: Parameters<Interviewer["turn"]>[0],
      ): ReturnType<Interviewer["turn"]> =>
        conductor === undefined
          ? dependencies.interviewer.turn(turnInput)
          : conductor.turn({ ...turnInput, actor });
      const outcome = await turn({
        session: { baseUrl: dependencies.apiBaseUrl, accessToken },
        onboardingSessionId: input.onboardingSessionId,
        journeyType: input.journeyType === "investor" ? "investor" : "founder",
        channel: input.channel,
        // Attribution: the person, resolved server-side like every other Q
        // route — never a placeholder. A constant tenant failed every
        // usage-ledger write on its foreign key and, worse, made the typed
        // interview recall memory for nobody, so Q forgot between sessions
        // what the person had told it. Authority is still the bearer above;
        // the onboarding service re-derives everything from it.
        attribution: {
          tenantId: actor.tenantId,
          userId: actor.userId,
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
        askingAbout: [
          ...(outcome.askingAbout ??
            (outcome.asking === null ? [] : [outcome.asking.stepKey])),
        ],
        pending: {
          recommendations: [...(outcome.pending?.recommendations ?? [])],
          held: [...(outcome.pending?.held ?? [])],
        },
      });
    },
  );
}
