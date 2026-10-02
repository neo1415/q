import { z } from "zod";

import { Q_TASK_CLASSES, UuidSchema } from "@capital-q/contracts";

import {
  allow,
  defineQTool,
  deny,
  type AnyQToolDefinition,
} from "../definition.js";
import type { QToolPorts, RelationshipIntelligencePort } from "../ports.js";
import { matchCounterpart, nameableRecords } from "./client-actions.js";

/**
 * A founder's Connection Request to an investor, by Q (action parity
 * 2026-10-02: the investor's page has Send request; asking Q to "send
 * Kazikit Capital a connection request" only took them to the page).
 *
 * The investor is named as the founder said it and resolved among the
 * investor organisations they can already see (their Discover investors
 * and their own relationships), by the same matcher every name uses; the
 * Network context's own check says whether a request may be sent now.
 * The tool prepares ONE approval; the request is sent only when the
 * founder approves exactly it, through the same command the page calls.
 */

export const PROPOSE_CONNECTION_REQUEST =
  "relationship.connection_request.send" as const;

export const ProposeConnectionRequestInputSchema = z
  .object({
    investor: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe(
        "The investor organisation's name as the person said it, misheard spellings included.",
      ),
    investorOrganisationId: UuidSchema.optional().describe(
      "Or its id, when a tool returned it.",
    ),
  })
  .strict()
  .refine(
    (input) =>
      (input.investor === undefined) !==
      (input.investorOrganisationId === undefined),
    { message: "name exactly one of investor or investorOrganisationId" },
  );

export const ProposeConnectionRequestOutputSchema = z
  .object({
    status: z.enum(["PREPARED", "ONE_PER_TURN"]),
    awaitingApprovalOf: z.string(),
  })
  .strict();

export function createProposeConnectionRequestTool(
  ports: Pick<
    QToolPorts,
    "companies" | "relationships" | "disclosure" | "discovery" | "investorFeed"
  >,
  relationships: RelationshipIntelligencePort,
  mayRequest: NonNullable<RelationshipIntelligencePort["mayRequestConnection"]>,
): AnyQToolDefinition {
  return defineQTool<
    z.infer<typeof ProposeConnectionRequestInputSchema>,
    z.infer<typeof ProposeConnectionRequestOutputSchema>,
    { readonly investorOrganisationId: string; readonly investorName: string }
  >({
    id: PROPOSE_CONNECTION_REQUEST,
    version: 1,
    status: "ACTIVE",
    providerName: "propose_connection_request",
    description:
      "For a founder: prepares a Connection Request to one investor organisation (introducing their company), for their own approval, exactly as Send request on the investor's page. Name the investor as they said it. It sends nothing by itself; only where the investor takes requests and none is already open.",
    classification: "SIDE_EFFECT",
    riskClass: "LOW_RISK_INTERNAL",
    requiredCapabilities: [],
    supportedPurposes: [...Q_TASK_CLASSES],
    requiredScopeKinds: ["NETWORK_VISIBLE_DATA"],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "q-tools",
    visibleStage: "WAITING_FOR_APPROVAL",
    input: ProposeConnectionRequestInputSchema,
    output: ProposeConnectionRequestOutputSchema,
    authorize: async (input, { actor }) => {
      if (actor.actorType !== "HUMAN") return deny("NOT_AVAILABLE");
      const seen = await nameableRecords(
        ports,
        actor,
        "INVESTOR_ORGANISATION",
        input.investor ?? null,
      ).catch(() => []);
      const id =
        input.investorOrganisationId !== undefined
          ? (seen.find((record) => record.id === input.investorOrganisationId)
              ?.id ?? null)
          : matchCounterpart(input.investor ?? "", seen);
      const record =
        id === null ? undefined : seen.find((entry) => entry.id === id);
      if (record === undefined) return deny("NOT_AVAILABLE");
      if (!(await mayRequest(actor, record.id).catch(() => false))) {
        return deny("NOT_AVAILABLE");
      }
      return allow("NETWORK_VISIBLE", {
        investorOrganisationId: record.id,
        investorName: record.name,
      });
    },
    execute: (_input, context, grant) => {
      const status = relationships.prepareForApproval({
        runId: context.runId,
        tenantId: context.actor.tenantId,
        actorUserId: context.actor.userId,
        actionType: "relationship.connection_request.send",
        payload: {
          investorOrganisationId: grant.investorOrganisationId,
          investorName: grant.investorName,
        },
      });
      return Promise.resolve({
        status,
        awaitingApprovalOf: `Send ${grant.investorName} a Connection Request`,
      });
    },
  });
}
