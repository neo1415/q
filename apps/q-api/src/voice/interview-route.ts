import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  createProblemDetails,
  PROBLEM_CONTENT_TYPE,
  Q_INTERVIEW_STREAM_CONTENT_TYPE,
  QInterviewStreamEventSchema,
  QInterviewStreamRequestSchema,
  QInterviewTurnRequestSchema,
  QInterviewTurnResponseSchema,
  type QInterviewStreamEvent,
  type QInterviewTurnResponse,
} from "@capital-q/contracts";
import { getOnboardingSession } from "@capital-q/api-client";
import { AuthenticationRequiredError } from "@capital-q/security";

import { extractBearerToken } from "@capital-q/security/supabase";

import {
  getActorContext,
  requireActorContextHook,
  requireActorContextOrPersonalHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";
import type { QVoiceRoutesDependencies } from "./routes.js";
import type {
  InterviewAgent,
  InterviewAgentTurnInput,
} from "./interview-agent.js";
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
  /**
   * The same turn, streamed sentence by sentence for the typed screen
   * (onboarding speed L9). Absent: only the whole-turn route exists.
   */
  readonly streamPath?: string | undefined;
};

type TurnOutcome = Awaited<ReturnType<InterviewAgent["turn"]>>;

/** The outcome as the wire carries it, for both routes. */
function toTurnResponse(outcome: TurnOutcome): QInterviewTurnResponse {
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
}

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
          ...(input.focus === undefined ? {} : { focus: input.focus }),
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
      return toTurnResponse(outcome);
    },
  );

  const streamPath = dependencies.streamPath;
  if (streamPath === undefined) return;
  /**
   * The typed turn, streamed (onboarding speed L9): Q's sentences as the
   * interviewer writes them, then the settled turn and the session. The
   * journey comes from the session itself, read under the caller's bearer
   * (the API checks it is theirs), never from the browser.
   */
  app.post(
    streamPath,
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
      const input = QInterviewStreamRequestSchema.parse(request.body ?? {});
      const session = { baseUrl: dependencies.apiBaseUrl, accessToken };
      // Refused before anything streams: not theirs, or not there.
      const view = await getOnboardingSession(
        session,
        input.onboardingSessionId,
      );

      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        "content-type": Q_INTERVIEW_STREAM_CONTENT_TYPE,
        "cache-control": "no-store",
        "x-accel-buffering": "no",
      });
      const send = (event: QInterviewStreamEvent) => {
        if (raw.writableEnded) return;
        raw.write(
          `${JSON.stringify(QInterviewStreamEventSchema.parse(event))}\n`,
        );
      };
      // The person leaving cancels the turn, as a closed voice line does.
      const left = new AbortController();
      raw.on("close", () => {
        if (!raw.writableEnded) left.abort();
      });
      const turnInput: InterviewAgentTurnInput = {
        actor,
        session,
        onboardingSessionId: input.onboardingSessionId,
        journeyType:
          view.session.journeyType === "investor" ? "investor" : "founder",
        channel: "text",
        attribution: {
          tenantId: actor.tenantId,
          userId: actor.userId,
          correlationId: dependencies.correlation(),
        },
        signup: signupContextFromToken(accessToken),
        utterance: input.utterance,
        recentTurns: [...input.recentTurns],
        ...(input.focus === undefined ? {} : { focus: input.focus }),
        signal: left.signal,
        onSentence: (sentence) => {
          const text = sentence.trim();
          if (text.length > 0)
            send({ type: "sentence", text: text.slice(0, 4_000) });
        },
      };
      try {
        const outcome = await dependencies.agent.turn(turnInput);
        send({
          type: "done",
          turn: toTurnResponse(outcome),
          view: outcome.view,
        });
      } catch (error: unknown) {
        if (error instanceof AccountPausedError) {
          send({
            type: "error",
            code: "PAUSED",
            message:
              "Your account is paused. Someone from the Capital Q team will be in touch.",
          });
        } else {
          request.log.warn({ err: error }, "streamed interview turn failed");
          send({
            type: "error",
            code: "UNAVAILABLE",
            message: "Q couldn't answer that just now. Try again.",
          });
        }
      } finally {
        raw.end();
      }
    },
  );
}
