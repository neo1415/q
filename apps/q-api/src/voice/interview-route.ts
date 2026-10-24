import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  createProblemDetails,
  PROBLEM_CONTENT_TYPE,
  QInterviewTurnRequestSchema,
  QInterviewTurnResponseSchema,
  Q_INTERVIEW_STREAM_EVENTS,
  Q_SSE_CONTENT_TYPE,
  type QInterviewStage,
  type QInterviewTurnResponse,
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
import { formatSseFrame } from "../http/sse.js";

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
      // Turn latency 2026-10-21 (onboarding L9): asked for a stream, the
      // reply goes out a finished sentence at a time while the turn runs;
      // the whole turn still ends it, exactly as the JSON body would be.
      const stream = wantsStream(request.headers.accept)
        ? openSentenceStream(reply)
        : null;
      const outcome = await dependencies.agent
        .turn({
          actor,
          ...(stream === null
            ? {}
            : { onSentence: stream.sentence, onStage: stream.stage }),
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
          // Sentences already went out: the status line is sent, so the
          // failure is the stream's last event rather than an error reply.
          if (stream?.started() === true) {
            request.log.warn(
              { err: error },
              "streamed interview turn failed after its first sentence",
            );
            stream.end(
              Q_INTERVIEW_STREAM_EVENTS.PROBLEM,
              createProblemDetails({
                code: "INTERNAL_SERVER_ERROR",
                requestId: request.id,
              }),
            );
            return "ENDED" as const;
          }
          throw error;
        });
      if (outcome === "ENDED") return reply;
      if (outcome === null) {
        // Founder direction 2026-09-30: a paused account is refused here,
        // whatever the screen shows; the screen reads the code.
        const problem = createProblemDetails({
          code: "PERMISSION_DENIED",
          requestId: request.id,
          detail:
            "Your account is paused. Someone from the Capital Q team will be in touch.",
        });
        if (stream?.started() === true) {
          stream.end(Q_INTERVIEW_STREAM_EVENTS.PROBLEM, {
            ...problem,
            paused: true,
          });
          return reply;
        }
        return reply
          .status(problem.status)
          .type(PROBLEM_CONTENT_TYPE)
          .header("Cache-Control", "no-store")
          .send({ ...problem, paused: true });
      }

      // The public look-ups by name, and the questions their findings
      // become, are the onboarding conductor's (inside `agent.turn`).
      const response = toTurnResponse(outcome);
      if (stream !== null) {
        stream.end(Q_INTERVIEW_STREAM_EVENTS.RESULT, response);
        return reply;
      }
      void reply.header("Cache-Control", "no-store");
      return response;
    },
  );
}

/** Whether the caller asked for the streamed form of the turn. */
export function wantsStream(accept: string | undefined): boolean {
  return (
    typeof accept === "string" &&
    accept.toLowerCase().includes(Q_SSE_CONTENT_TYPE)
  );
}

/**
 * The streamed form of one turn. The response opens at the first sentence,
 * not before: a turn that fails before saying anything still gets the
 * route's ordinary problem reply and status. A closed connection stops the
 * writing, never the turn -- what the person said is still saved.
 */
/** How often an open turn stream says it is still alive. */
const HEARTBEAT_MS = 5_000;

export function openSentenceStream(reply: FastifyReply): {
  readonly sentence: (text: string) => void;
  readonly stage: (stage: QInterviewStage) => void;
  readonly started: () => boolean;
  readonly end: (event: string, data: unknown) => void;
} {
  let open = false;
  let ended = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const start = () => {
    if (open) return;
    open = true;
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": Q_SSE_CONTENT_TYPE,
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    // QA F-67 (24 Oct): a first answer that saved nine facts went quiet
    // between stages long enough for the connection to be cut; the screen
    // said "I lost the connection" while the turn finished and saved. A
    // comment line every few seconds keeps it open (clients skip it).
    heartbeat = setInterval(() => {
      if (reply.raw.destroyed) {
        clearInterval(heartbeat);
        return;
      }
      reply.raw.write(": ping\n\n");
    }, HEARTBEAT_MS);
    heartbeat.unref();
  };
  const write = (event: string, data: unknown) => {
    if (reply.raw.destroyed) return;
    reply.raw.write(formatSseFrame({ event, data: JSON.stringify(data) }));
  };
  return {
    sentence: (text) => {
      const said = text.trim();
      if (ended || said.length === 0) return;
      start();
      write(Q_INTERVIEW_STREAM_EVENTS.SENTENCE, {
        text: said.slice(0, 2_000),
      });
    },
    // What Q is doing, as it happens: the screen shows it from the first
    // event, so the person sees work within the first second.
    stage: (stage) => {
      if (ended) return;
      start();
      write(Q_INTERVIEW_STREAM_EVENTS.STAGE, stage);
    },
    started: () => open,
    end: (event, data) => {
      if (ended) return;
      ended = true;
      start();
      clearInterval(heartbeat);
      write(event, data);
      reply.raw.end();
    },
  };
}
