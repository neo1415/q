import type { GatewayPolicy, PublicGateway } from "@capital-q/gateq";
import type { Logger } from "@capital-q/observability";
import type { ApplicationTranscriptTurnDto } from "@capital-q/contracts";

import {
  IntakeRefusedError,
  type ApplicationDimension,
  type ApplicationView,
} from "../contracts/index.js";
import { explainQualification } from "./coverage.js";
import {
  InterviewTurnOutcomeSchema,
  type GateQInterviewer,
  type InterviewChannel,
} from "./interviewer.js";
import { transcriptDto, type IntakeService } from "./intake-service.js";
import type {
  ApplicationSessionRepository,
  ApplicationTurnRepository,
  BoundPolicyPort,
  StoredTurn,
} from "./ports.js";

/**
 * One applicant turn, end to end (CQ-GATE-002R §6, §7; GateQ slice 1).
 *
 *   authorise the guest
 *   → a retried exchange returns what it already said
 *   → record what the person said, in order
 *   → load the bounded state the interview may see (facts, recent turns,
 *     what was already asked, how far the talk has drifted)
 *   → ask the interviewer
 *   → validate what it proposed
 *   → record what survived, then Q's reply
 *   → recompute the deterministic answer
 *   → return what is safe to say
 *
 * The order matters. Qualification is computed *after* the turn's facts
 * are recorded and *by GATE-001*, so what the applicant is told about
 * their standing is never the model's opinion about it — even when the
 * model's own sentence says otherwise, which is why the reply and the
 * state come from different places.
 *
 * A retry is the same turn. With a transcript store, the exchange is keyed
 * on the applicant's client turn id: a stored Q reply is returned as it
 * was, and neither the model nor the store is touched again. Without one,
 * the session's single last-turn slot does the same for the turn
 * immediately before.
 */

/** How much of the conversation the interviewer is shown. */
const RECENT_TURNS = 8;

/** Q turn intents that mean the conversation left the application. */
const TANGENT_INTENTS: ReadonlySet<string> = new Set([
  "SMALL_TALK",
  "OFF_TOPIC",
  "SABOTAGE",
]);

/** The client turn id Q's opening line is stored under, once. */
const OPENING_TURN_ID = "opening";

export type ConversationDependencies = {
  readonly intake: IntakeService;
  readonly interviewer: GateQInterviewer;
  readonly policies: BoundPolicyPort;
  /** The gateway as the world may see it. Never the private policy. */
  readonly publicGatewayFor: (
    gatewayId: string,
  ) => Promise<PublicGateway | null>;
  /** Remembers the last turn so a retry is not a second turn. */
  readonly turnMemory: Pick<
    ApplicationSessionRepository,
    "lastTurn" | "rememberTurn"
  >;
  /**
   * GateQ slice 1: the durable transcript. Absent, the interview runs as
   * before (no history, single-slot idempotency).
   */
  readonly turns?: ApplicationTurnRepository | undefined;
  readonly logger?: Logger | undefined;
  /** Monotonic milliseconds, for turn latency. Test seam. */
  readonly now?: (() => number) | undefined;
};

export type ApplicantTurnResult = {
  readonly reply: string;
  readonly deduplicated: boolean;
  readonly view: ApplicationView;
  /** GATE-001's answer after this turn. Never the model's. */
  readonly access: "MAY_APPLY" | "MAY_NOT_APPLY" | "NEEDS_INFORMATION";
  readonly unmet: readonly string[];
  readonly stillNeeded: readonly string[];
};

export type ConversationService = {
  readonly openingFor: (input: {
    readonly token: string;
    readonly channel?: InterviewChannel | undefined;
    readonly correlationId: string;
  }) => Promise<string>;
  readonly turn: (input: {
    readonly token: string;
    readonly message: string;
    readonly clientTurnId: string;
    readonly channel?: InterviewChannel | undefined;
    readonly correlationId: string;
  }) => Promise<ApplicantTurnResult>;
  /** The applicant's own view, with the deterministic answer attached. */
  readonly summary: (token: string) => Promise<ApplicantTurnResult>;
  /** The interview so far, both sides, oldest first. Their own only. */
  readonly transcript: (
    token: string,
  ) => Promise<readonly ApplicationTranscriptTurnDto[]>;
};

/** What the interviewer is shown of the conversation so far. */
function historyFrom(stored: readonly StoredTurn[]): {
  readonly recentTurns: readonly {
    readonly role: "person" | "q";
    readonly text: string;
  }[];
  readonly askedAlready: readonly ApplicationDimension[];
  readonly tangents: number;
} {
  const recentTurns = stored.slice(-RECENT_TURNS).map((turn) => ({
    role: turn.role === "PERSON" ? ("person" as const) : ("q" as const),
    text: turn.text,
  }));
  // What Q actually asked about, in the order it first asked: not what
  // happens to be answered, which is a different list.
  const askedAlready: ApplicationDimension[] = [];
  for (const turn of stored) {
    if (
      turn.askingDimension !== null &&
      !askedAlready.includes(turn.askingDimension)
    ) {
      askedAlready.push(turn.askingDimension);
    }
  }
  // Consecutive Q turns, newest first, that read the person as off the
  // application. One on-topic turn ends the run.
  let tangents = 0;
  for (const turn of [...stored].reverse()) {
    if (turn.role !== "Q") continue;
    if (turn.intent !== null && TANGENT_INTENTS.has(turn.intent)) {
      tangents += 1;
    } else {
      break;
    }
  }
  return { recentTurns, askedAlready, tangents };
}

export function createConversationService(
  dependencies: ConversationDependencies,
): ConversationService {
  const {
    intake,
    interviewer,
    policies,
    publicGatewayFor,
    turnMemory,
    turns,
    logger,
  } = dependencies;
  const now = dependencies.now ?? (() => performance.now());

  /**
   * The published criteria an applicant may be told about, by the
   * investor's own label.
   *
   * The label is published; the configuration is not. "Where you are"
   * tells a founder what is being asked without telling them which
   * countries would have worked, which is the difference between an
   * explanation and a hint (§27).
   */
  const explain = (
    policy: GatewayPolicy,
    qualification: Awaited<ReturnType<IntakeService["qualification"]>>,
  ) => explainQualification(policy, qualification);

  const stateFor = async (token: string) => {
    const guest = await intake.authorise(token);
    const policy = await policies.policyByVersionId({
      gatewayId: guest.application.gatewayId,
      gatewayVersionId: guest.application.gatewayVersionId,
    });
    if (policy === null) throw new IntakeRefusedError("NOT_FOUND");
    const publicGateway = await publicGatewayFor(guest.application.gatewayId);
    if (publicGateway === null) throw new IntakeRefusedError("NOT_FOUND");
    return { guest, policy, publicGateway };
  };

  const resultFor = async (
    token: string,
    reply: string,
    deduplicated: boolean,
  ): Promise<ApplicantTurnResult> => {
    const view = await intake.resume(token);
    const qualification = await intake.qualification(token);
    const guest = await intake.authorise(token);
    const policy = await policies.policyByVersionId({
      gatewayId: guest.application.gatewayId,
      gatewayVersionId: guest.application.gatewayVersionId,
    });
    if (policy === null) throw new IntakeRefusedError("NOT_FOUND");
    return { reply, deduplicated, view, ...explain(policy, qualification) };
  };

  const executeTurn = async (
    input: Parameters<ConversationService["turn"]>[0],
    opening = false,
  ): Promise<ApplicantTurnResult> => {
    // Server latency, from the turn arriving to Q's reply being ready.
    const receivedAt = now();
    const { guest, policy, publicGateway } = await stateFor(input.token);
    const applicationId = guest.application.id;

    // A retry is the same turn. Before anything is spent or recorded.
    if (turns !== undefined) {
      const exchange = await turns.findExchange(
        applicationId,
        input.clientTurnId,
      );
      if (exchange.person !== null && exchange.person.text !== input.message)
        throw new IntakeRefusedError("NOT_READY_TO_SUBMIT");
      if (exchange.q !== null) {
        return resultFor(input.token, exchange.q.text, true);
      }
    }
    // The single slot as well: a turn answered just before the
    // transcript store existed is still the same turn on retry.
    {
      const last = await turnMemory.lastTurn(guest.sessionId);
      if (last !== null && last.clientTurnId === input.clientTurnId) {
        return resultFor(input.token, last.reply, true);
      }
    }

    await intake.assertInterviewReady(input.token);
    if (guest.application.status === "SUBMITTED") {
      throw new IntakeRefusedError("ALREADY_SUBMITTED");
    }

    const claimId =
      turns === undefined
        ? null
        : await turns.claimExchange({
            applicationId,
            tenantId: guest.application.tenantId,
            clientTurnId: input.clientTurnId,
            text: input.message,
            recordPerson: !opening,
          });
    if (turns !== undefined && claimId === null) {
      const completed = await turns.findExchange(
        applicationId,
        input.clientTurnId,
      );
      if (completed.q === null)
        throw new IntakeRefusedError("NOT_READY_TO_SUBMIT");
      return resultFor(input.token, completed.q.text, true);
    }
    try {
      const qualification = await intake.qualification(input.token);
      const facts = await intake.factsFor(input.token);
      const stored =
        turns === undefined ? [] : await turns.listFor(applicationId);
      // The interviewer gets this turn as the utterance, not twice.
      const prior = stored.filter(
        (turn) =>
          !(turn.role === "PERSON" && turn.clientTurnId === input.clientTurnId),
      );
      const history = historyFrom(prior);

      const cached =
        turns === undefined || claimId === null
          ? null
          : await turns.readOutcome(applicationId, claimId);
      const outcome =
        cached === null
          ? await interviewer.turn({
              stage: "APPLICATION",
              channel: input.channel ?? "text",
              publicGateway,
              application: {
                policy,
                qualification,
                facts,
                // See openingFor: no authorised document-text port for a guest.
                documentProposals: [],
              },
              utterance: input.message,
              recentTurns: history.recentTurns,
              // The model is told how far off the application the conversation
              // has drifted; it decides how much of a person to be about it.
              tangents: history.tangents,
              askedAlready: history.askedAlready,
              attribution: {
                tenantId: guest.application.tenantId,
                correlationId: input.correlationId,
              },
              signal: AbortSignal.timeout(120_000),
            })
          : InterviewTurnOutcomeSchema.parse(cached);
      const latencyMs = Math.max(0, Math.round(now() - receivedAt));
      if (turns !== undefined && claimId !== null) {
        if (cached === null)
          await turns.checkpointOutcome(applicationId, claimId, outcome);
        await intake.completeTurn({
          token: input.token,
          claimId,
          clientTurnId: input.clientTurnId,
          reply: outcome.reply,
          asking: outcome.asking,
          intent: outcome.intent,
          facts: opening ? [] : outcome.facts,
          sourceTurnSeq: stored.find(
            (turn) =>
              turn.role === "PERSON" &&
              turn.clientTurnId === input.clientTurnId,
          )?.seq,
          latencyMs,
        });
      } else {
        if (!opening && outcome.facts.length > 0) {
          await intake.recordFacts({
            token: input.token,
            facts: outcome.facts,
          });
        }
      }
      // Kept as well: the single slot still answers for a composition, or
      // an older client, that has no transcript store.
      await turnMemory.rememberTurn({
        sessionId: guest.sessionId,
        clientTurnId: input.clientTurnId,
        reply: outcome.reply,
      });

      logger?.debug(
        {
          correlationId: input.correlationId,
          intent: outcome.intent,
          recorded: outcome.facts.length,
          rejected: outcome.rejectedFacts,
          history: history.recentTurns.length,
          latencyMs,
        },
        "gateq applicant turn",
      );

      // Recomputed from what is now recorded, by the deterministic engine.
      // The model's sentence and the applicant's standing come from
      // different places on purpose: a reply that says "looks like you
      // qualify" changes nothing here.
      return await resultFor(input.token, outcome.reply, false);
    } catch (error) {
      if (turns !== undefined && claimId !== null)
        await turns.releaseExchange(applicationId, claimId);
      throw error;
    }
  };

  return {
    openingFor: async (input) => {
      const guest = await intake.authorise(input.token);
      try {
        await intake.assertInterviewReady(input.token);
      } catch (error) {
        if (
          error instanceof IntakeRefusedError &&
          error.refusal === "CONTACT_NOT_CONFIRMED"
        )
          return "Please confirm your contact details before starting your investment interview.";
        throw error;
      }
      if (turns !== undefined) {
        const existing = await turns.listFor(guest.application.id);
        const lastQuestion = [...existing]
          .reverse()
          .find((turn) => turn.role === "Q");
        if (lastQuestion !== undefined) return lastQuestion.text;
      }
      return (
        await executeTurn(
          { ...input, message: "", clientTurnId: OPENING_TURN_ID },
          true,
        )
      ).reply;
    },

    turn: (input) => executeTurn(input),

    summary: async (token) => resultFor(token, "", false),

    transcript: async (token) => {
      const guest = await intake.authorise(token);
      if (turns === undefined) return [];
      return transcriptDto(await turns.listFor(guest.application.id));
    },
  };
}
