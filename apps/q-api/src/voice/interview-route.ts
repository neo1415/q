import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  createProblemDetails,
  PROBLEM_CONTENT_TYPE,
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
import type { PresenceTrigger } from "./presence-trigger.js";
import { signupContextFromToken } from "./interview-steps.js";
import { AccountPausedError } from "./standing.js";

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
  /** The interview as a tool-calling Q run (ADR 0016): the one conductor. */
  readonly agent: InterviewAgent;
  /** Where the onboarding session lives; the interviewer calls it as the person. */
  readonly apiBaseUrl: string;
  readonly correlation: () => string;
  /**
   * The public presence read that fills a profile's "Signals &
   * verification", started when the setup names a subject. Only the voice
   * path had it, so a typed onboarding never looked the company up (live
   * 2026-09-30: an empty rail for Nixo).
   */
  readonly presence?: PresenceTrigger | undefined;
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
      const outcome = await dependencies.agent
        .turn({
          actor,
          session: { baseUrl: dependencies.apiBaseUrl, accessToken },
          onboardingSessionId: input.onboardingSessionId,
          journeyType:
            input.journeyType === "investor" ? "investor" : "founder",
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
        })
        .catch((error: unknown) => {
          if (error instanceof AccountPausedError) return null;
          throw error;
        });
      if (outcome === null) {
        // Founder direction 2026-09-30: a paused account is refused here,
        // whatever the screen shows; the screen reads the code.
        const problem = createProblemDetails({
          code: "PERMISSION_DENIED",
          requestId: request.id,
          detail:
            "Your account is paused. Someone from the Capital Q team will be in touch.",
        });
        return reply
          .status(problem.status)
          .type(PROBLEM_CONTENT_TYPE)
          .header("Cache-Control", "no-store")
          .send({ ...problem, paused: true });
      }

      // The public look-ups by name, and the questions their findings
      // become, are the onboarding conductor's (inside `agent.turn`).
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
        ...(outcome.conduct === undefined ? {} : { conduct: outcome.conduct }),
        ...(outcome.gestures === undefined || outcome.gestures.length === 0
          ? {}
          : { gestures: [...outcome.gestures] }),
        ...(outcome.resumed === true ? { resumed: true } : {}),
        ...(outcome.confirming === undefined
          ? {}
          : { confirming: { kind: outcome.confirming.kind } }),
      });
    },
  );
}
