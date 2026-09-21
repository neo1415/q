import type { GatewayPolicy, PublicGateway } from "@capital-q/gateq";
import type { Logger } from "@capital-q/observability";

import {
  IntakeRefusedError,
  type ApplicationView,
} from "../contracts/index.js";
import type { GateQInterviewer, InterviewChannel } from "./interviewer.js";
import type { IntakeService } from "./intake-service.js";
import type { ApplicationSessionRepository, BoundPolicyPort } from "./ports.js";

/**
 * One applicant turn, end to end (CQ-GATE-002R §6, §7).
 *
 *   authorise the guest
 *   → load the bounded state the interview may see
 *   → ask the interviewer
 *   → validate what it proposed
 *   → record what survived
 *   → recompute the deterministic answer
 *   → return what is safe to say
 *
 * The order matters. Qualification is computed *after* the turn's facts
 * are recorded and *by GATE-001*, so what the applicant is told about
 * their standing is never the model's opinion about it — even when the
 * model's own sentence says otherwise, which is why the reply and the
 * state come from different places.
 *
 * A retry is the same turn. The session remembers the last client turn id
 * and the answer it produced, so a double-tapped send returns what the
 * applicant already saw instead of paying for a second model call and
 * recording the same sentence twice.
 */

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
};

export function createConversationService(
  dependencies: ConversationDependencies,
): ConversationService {
  const {
    intake,
    interviewer,
    policies,
    publicGatewayFor,
    turnMemory,
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
  ) => {
    const label = (criterionId: string) =>
      policy.criteria.find((c) => c.id === criterionId)?.label ?? "a criterion";
    return {
      access: qualification.access,
      unmet: qualification.principalMismatches.map(label),
      stillNeeded: qualification.unknowns.map(label),
    };
  };

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
      const outcome = await interviewer.turn({
        stage: "APPLICATION",
        channel: input.channel ?? "text",
        publicGateway,
        application: {
          policy,
          qualification,
          // Nothing yet, or everything from a resumed application — the
          // opening reads differently because the state does, not because
          // a branch chose a different sentence (§35).
          facts: [],
          documentProposals: [],
        },
        utterance: "",
        recentTurns: [],
        tangents: 0,
        askedAlready: [],
        attribution: {
          tenantId: guest.application.tenantId,
          correlationId: input.correlationId,
        },
      });
      return outcome.reply;
    },

    turn: async (input) => {
      const { guest, policy, publicGateway } = await stateFor(input.token);

      // A retry is the same turn. Before anything is spent or recorded.
      const last = await turnMemory.lastTurn(guest.sessionId);
      if (last !== null && last.clientTurnId === input.clientTurnId) {
        return resultFor(input.token, last.reply, true);
      }

      if (guest.application.status === "SUBMITTED") {
        throw new IntakeRefusedError("ALREADY_SUBMITTED");
      }

      const view = await intake.resume(input.token);
      const qualification = await intake.qualification(input.token);
      const facts = await intake.factsFor(input.token);

      const outcome = await interviewer.turn({
        stage: "APPLICATION",
        channel: input.channel ?? "text",
        publicGateway,
        application: {
          policy,
          qualification,
          facts,
          documentProposals: [],
        },
        utterance: input.message,
        recentTurns: [],
        // The model is told how far off the application the conversation
        // has drifted; it decides how much of a person to be about it.
        tangents: 0,
        askedAlready: view.facts.map((fact) => fact.dimension),
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
  };
}
