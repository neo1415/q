import { z } from "zod";

import { ChatMessageBodySchema, type QTaskClass } from "@capital-q/contracts";
import { closestByName, nameSkeleton } from "@capital-q/q-runtime";
import { capability } from "@capital-q/security";

import {
  allow,
  defineQTool,
  deny,
  type AnyQToolDefinition,
} from "../definition.js";
import type { RelationshipIntelligencePort } from "../ports.js";

/**
 * An investor's answer to founders' Connection Requests, by Q (live
 * 2026-10-01/02, Zino: "accept their connection and send them a message"
 * was met with "which one?" three times, then, after "Kazikit", the
 * company-side propose_interest_answer failed INVALID_ARGUMENTS -- an
 * investor had no tool for its own inbox at all).
 *
 * One tool prepares ONE approval: accept (or decline) one founder's
 * request and, on acceptance, the opening message Q drafted, posted as
 * the investor once they are connected. The company is named as the
 * person named it; it is resolved against the investor's OWN pending
 * requests only (their inbox, never the network), so no firewall plan
 * for a company off screen is needed and nothing outside the inbox can be
 * reached. When it cannot prepare, it says exactly why and what is there.
 */

export const PROPOSE_CONNECTION_REQUEST_ANSWER =
  "relationship.connection_request.answer.propose" as const;

const PURPOSES: readonly QTaskClass[] = [
  "OWN_COMPANY_QUESTION",
  "COUNTERPARTY_COMPANY_QUESTION",
  "INVESTOR_QUESTION",
  "RELATIONSHIP_QUESTION",
  "COMPARISON",
  "ACTION_PREPARATION",
  "GENERAL_QUESTION",
];

export const ProposeConnectionRequestAnswerInputSchema = z
  .object({
    company: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .nullable()
      .default(null)
      .describe(
        "The founder's company whose Connection Request this answers: its name as the person said it, or its id. Null when they did not say which: with one request waiting it is that one, with several the result names them to ask once.",
      ),
    decision: z
      .enum(["ACCEPTED", "DECLINED"])
      .default("ACCEPTED")
      .describe(
        "ACCEPTED connects both sides; DECLINED does not take it forward.",
      ),
    openingMessage: ChatMessageBodySchema.nullable()
      .default(null)
      .describe(
        "On acceptance, when they asked for a message: the first message to the founders, in the person's voice, drafted by you (short, warm, specific to the company). Posted once both sides are connected. Null: no message, unless withMessage.",
      ),
    withMessage: z
      .boolean()
      .default(false)
      .describe(
        "True with a null openingMessage: a short standard opening message naming the company is drafted for their approval.",
      ),
  })
  .strict();
export type ProposeConnectionRequestAnswerInput = z.input<
  typeof ProposeConnectionRequestAnswerInputSchema
>;
type ParsedInput = z.output<typeof ProposeConnectionRequestAnswerInputSchema>;

export const ConnectionRequestAnswerOutputSchema = z
  .object({
    /**
     * PREPARED: shown for approval, nothing happened yet. ONE_PER_TURN:
     * another action waits in this answer. NO_PENDING_REQUESTS / NOT_FOUND
     * / WHICH_ONE: nothing prepared; `awaitingApprovalOf` says exactly why
     * and names what is pending, to say to the person as it is.
     */
    status: z.enum([
      "PREPARED",
      "ONE_PER_TURN",
      "NO_PENDING_REQUESTS",
      "NOT_FOUND",
      "WHICH_ONE",
    ]),
    awaitingApprovalOf: z.string(),
  })
  .strict();
export type ConnectionRequestAnswerOutput = z.infer<
  typeof ConnectionRequestAnswerOutputSchema
>;

export type PendingConnectionRequest = {
  readonly interestId: string;
  readonly companyId: string;
  readonly companyName: string;
  readonly relationshipId: string;
};

export { closestByName, nameSkeleton };

/** The one pending request the words name; never a guess among several. */
export function matchPendingRequest(
  pending: readonly PendingConnectionRequest[],
  said: string,
): PendingConnectionRequest | null {
  const found = closestByName(
    pending,
    said,
    (item) => item.companyName,
    (item) => item.companyId,
  );
  return found.length === 1 ? (found[0] ?? null) : null;
}

export function listedNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} or ${names.at(-1) ?? ""}`;
}

/** What an approval of this answer is called, for the card and for Q. */
export function connectionAnswerSummary(
  companyName: string,
  decision: "ACCEPTED" | "DECLINED",
  withMessage: boolean,
): string {
  if (decision === "DECLINED") {
    return `Decline ${companyName}'s connection request`;
  }
  return withMessage
    ? `Accept ${companyName}'s connection request and send them your message`
    : `Accept ${companyName}'s connection request`;
}

/** The message drafted when none was written: the person approves it word for word. */
export function standardOpeningMessage(companyName: string): string {
  return `Hi ${companyName} team, thank you for reaching out through Capital Q. I've accepted your connection request and would be glad to learn more about ${companyName}. What would be most useful to cover first?`;
}

/** Prepares the answer to one pending request, or says exactly why not. */
export function prepareConnectionAnswer(
  relationships: Pick<RelationshipIntelligencePort, "prepareForApproval">,
  entry: {
    readonly runId: string;
    readonly tenantId: string;
    readonly actorUserId: string;
  },
  pending: readonly PendingConnectionRequest[],
  input: {
    readonly company: string | null;
    readonly decision: "ACCEPTED" | "DECLINED";
    readonly openingMessage: string | null;
    readonly withMessage?: boolean | undefined;
  },
): ConnectionRequestAnswerOutput {
  if (pending.length === 0) {
    return {
      status: "NO_PENDING_REQUESTS",
      awaitingApprovalOf:
        "No founder's connection request is waiting for your answer, so there is nothing to accept.",
    };
  }
  const names = pending.map((item) => item.companyName);
  const chosen =
    input.company === null
      ? pending.length === 1
        ? (pending[0] ?? null)
        : null
      : matchPendingRequest(pending, input.company);
  if (chosen === null) {
    return input.company === null
      ? {
          status: "WHICH_ONE",
          awaitingApprovalOf: `${String(pending.length)} connection requests are waiting: ${listedNames(names)}. Which one should I accept?`,
        }
      : {
          status: "NOT_FOUND",
          awaitingApprovalOf: `"${input.company}" isn't one of the connection requests waiting for you; those are ${listedNames(names)}.`,
        };
  }
  const message =
    input.decision !== "ACCEPTED"
      ? null
      : (input.openingMessage ??
        (input.withMessage === true
          ? standardOpeningMessage(chosen.companyName)
          : null));
  const status = relationships.prepareForApproval({
    ...entry,
    actionType: "relationship.connection_request.respond",
    payload: {
      interestId: chosen.interestId,
      companyId: chosen.companyId,
      relationshipId: chosen.relationshipId,
      companyName: chosen.companyName,
      decision: input.decision,
      openingMessage: message,
    },
  });
  return {
    status,
    awaitingApprovalOf: connectionAnswerSummary(
      chosen.companyName,
      input.decision,
      message !== null,
    ),
  };
}

export function createProposeConnectionRequestAnswerTool(
  relationships: RelationshipIntelligencePort,
): AnyQToolDefinition | null {
  const pendingOf = relationships.pendingConnectionRequests;
  if (pendingOf === undefined) return null;
  return defineQTool<
    ParsedInput,
    ConnectionRequestAnswerOutput,
    { readonly pending: readonly PendingConnectionRequest[] }
  >({
    id: PROPOSE_CONNECTION_REQUEST_ANSWER,
    version: 1,
    status: "ACTIVE",
    providerName: "propose_connection_request_answer",
    description:
      "For an investor: prepares the answer to a founder's Connection Request to their investor organisation -- accept (both sides connect) or decline -- and, on acceptance, the opening message you drafted, as ONE approval. Use it whenever they want a pending connection request (a founder's request, a company waiting for their answer) accepted, answered or handled, with or without a message. Name the company as they did; it is matched against their own pending requests. It does nothing until they approve exactly what is shown. If the result is not PREPARED, tell them its words as they are.",
    classification: "SIDE_EFFECT",
    riskClass: "LOW_RISK_INTERNAL",
    requiredCapabilities: [capability("investor.connection.respond")],
    supportedPurposes: [...PURPOSES],
    requiredScopeKinds: [],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "q-tools",
    visibleStage: "WAITING_FOR_APPROVAL",
    input: ProposeConnectionRequestAnswerInputSchema,
    output: ConnectionRequestAnswerOutputSchema,
    authorize: async (_input, { actor }) => {
      try {
        // Their own inbox, read by the Network context's own rule: only an
        // investor organisation's member who may see its requests.
        return allow("CONFIDENTIAL", { pending: await pendingOf(actor) });
      } catch {
        return deny("NOT_AVAILABLE");
      }
    },
    execute: async (input, context, grant) => {
      const prepared = prepareConnectionAnswer(
        relationships,
        {
          runId: context.runId,
          tenantId: context.actor.tenantId,
          actorUserId: context.actor.userId,
        },
        grant.pending,
        {
          company: input.company,
          decision: input.decision,
          openingMessage: input.openingMessage,
          withMessage: input.withMessage,
        },
      );
      if (
        input.company === null ||
        (prepared.status !== "NOT_FOUND" &&
          prepared.status !== "NO_PENDING_REQUESTS")
      ) {
        return prepared;
      }
      // Not a request of theirs to accept: say what the relationship
      // really is, and the one thing Q can do (live 2026-10-02: Zino's own
      // interest in Tallyloom was met with a request for an id).
      const own =
        relationships.ownRelationships === undefined
          ? null
          : await relationships
              .ownRelationships(context.actor)
              .catch(() => null);
      const found = closestByName(
        own?.items ?? [],
        input.company,
        (item) => item.counterpart.name,
        (item) => item.counterpart.id,
      );
      const only = found.length === 1 ? found[0] : undefined;
      return only === undefined
        ? prepared
        : {
            status: prepared.status,
            awaitingApprovalOf: relationshipTruth(
              only.counterpart.name,
              only.state,
            ),
          };
    },
  });
}

/**
 * What an existing relationship is, when the person asked to accept it,
 * and the one thing Q can do next. Plain words; no id, no tool.
 */
export function relationshipTruth(name: string, state: string): string {
  switch (state) {
    case "CONNECTED":
    case "MEETING_HELD":
    case "IN_DILIGENCE":
    case "PAUSED":
    case "INVESTED":
      return `You're already connected with ${name}, so there's nothing to accept. I can send them a message or book a call with them.`;
    case "PASSED":
      return `${name} has decided not to proceed for now, so there's nothing to accept.`;
    case "INTEREST_EXPRESSED":
      return `${name} hasn't accepted your interest yet, so there's no request of theirs to accept. I can look after it for you: wait for them to accept, then message them and book an introductory call.`;
    case "DECLINED":
      return `${name} isn't taking this forward, so there's nothing to accept.`;
    default:
      return `There's no request from ${name} to accept. I can express interest and look after it from there.`;
  }
}
