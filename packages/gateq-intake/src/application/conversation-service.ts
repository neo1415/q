import type { GatewayPolicy, PublicGateway } from "@capital-q/gateq";
import type { Logger } from "@capital-q/observability";
import type { ApplicationTranscriptTurnDto } from "@capital-q/contracts";

import {
  IntakeRefusedError,
  type ApplicationDimension,
  type ApplicationView,
} from "../contracts/index.js";
import { explainQualification } from "./coverage.js";
import type { GateQInterviewer, InterviewChannel } from "./interviewer.js";
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

  return {
    openingFor: async (input) => {
      const { guest, policy, publicGateway } = await stateFor(input.token);
      const qualification = await intake.qualification(input.token);
      // Everything already established, so a resumed application opens on
      // what is still open rather than on a greeting from nowhere (§35).
      const facts = await intake.factsFor(input.token);
      const stored =
        turns === undefined ? [] : await turns.listFor(guest.application.id);
      const history = historyFrom(stored);
      const outcome = await interviewer.turn({
        stage: "APPLICATION",
        channel: input.channel ?? "text",
        publicGateway,
        application: {
          policy,
          qualification,
          facts,
          // No document reading reaches the interview in this slice: the
          // only document text an applicant's session could see is
          // Evidence extraction, and no port exposes it to a guest
          // credential without new authority. Values stay unproposed.
          documentProposals: [],
        },
        utterance: "",
        recentTurns: history.recentTurns,
        tangents: history.tangents,
        askedAlready: history.askedAlready,
        attribution: {
          tenantId: guest.application.tenantId,
          correlationId: input.correlationId,
        },
      });
      // Stored once, so the transcript begins with the question the
      // founder was answering. A later opening (a resume) is not stored
      // again: the first one already is.
      if (
        turns !== undefined &&
        stored.length === 0 &&
        guest.application.status !== "SUBMITTED"
      ) {
        await turns.append({
          applicationId: guest.application.id,
          tenantId: guest.application.tenantId,
          role: "Q",
          text: outcome.reply,
          clientTurnId: OPENING_TURN_ID,
          askingDimension: outcome.asking,
          intent: outcome.intent,
        });
      }
      return outcome.reply;
    },

    turn: async (input) => {
      const { guest, policy, publicGateway } = await stateFor(input.token);
      const applicationId = guest.application.id;

      // A retry is the same turn. Before anything is spent or recorded.
      if (turns !== undefined) {
        const exchange = await turns.findExchange(
          applicationId,
          input.clientTurnId,
        );
        if (exchange.q !== null) {
          return resultFor(input.token, exchange.q.text, true);
        }
      } else {
        const last = await turnMemory.lastTurn(guest.sessionId);
        if (last !== null && last.clientTurnId === input.clientTurnId) {
          return resultFor(input.token, last.reply, true);
        }
      }

      if (guest.application.status === "SUBMITTED") {
        throw new IntakeRefusedError("ALREADY_SUBMITTED");
      }

      // What the person said is on the record before the model is asked,
      // so a failed model call loses nothing and a retry resumes it. A
      // retried append of the same exchange writes nothing.
      if (turns !== undefined) {
        await turns.append({
          applicationId,
          tenantId: guest.application.tenantId,
          role: "PERSON",
          text: input.message,
          clientTurnId: input.clientTurnId,
        });
      }

      const qualification = await intake.qualification(input.token);
      const facts = await intake.factsFor(input.token);
      const stored =
        turns === undefined ? [] : await turns.listFor(applicationId);
      // The interviewer gets this turn as the utterance, not twice.
      const prior = stored.filter(
        (turn) =>
          !(
            turn.role === "PERSON" && turn.clientTurnId === input.clientTurnId
          ),
      );
      const history = historyFrom(prior);

      const outcome = await interviewer.turn({
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
      });

      if (outcome.facts.length > 0) {
        await intake.recordFacts({
          token: input.token,
          facts: outcome.facts,
        });
      }
      if (turns !== undefined) {
        await turns.append({
          applicationId,
          tenantId: guest.application.tenantId,
          role: "Q",
          text: outcome.reply,
          clientTurnId: input.clientTurnId,
          askingDimension: outcome.asking,
          intent: outcome.intent,
        });
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
        },
        "gateq applicant turn",
      );

      // Recomputed from what is now recorded, by the deterministic engine.
      // The model's sentence and the applicant's standing come from
      // different places on purpose: a reply that says "looks like you
      // qualify" changes nothing here.
      return resultFor(input.token, outcome.reply, false);
    },

    summary: async (token) => resultFor(token, "", false),

    transcript: async (token) => {
      const guest = await intake.authorise(token);
      if (turns === undefined) return [];
      return transcriptDto(await turns.listFor(guest.application.id));
    },
  };
}
