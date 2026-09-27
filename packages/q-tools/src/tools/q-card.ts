import { z } from "zod";

import {
  HandleSchema,
  UtcTimestampSchema,
  type PermittedContextPlan,
  type QTaskClass,
} from "@capital-q/contracts";
import { CompanyIdSchema } from "@capital-q/companies";
import { InvestorOrganisationIdSchema } from "@capital-q/investors";
import type { ActorContext } from "@capital-q/security";

import {
  allow,
  defineQTool,
  deny,
  type AnyQToolDefinition,
} from "../definition.js";
import { scopesOfKind } from "../plan.js";
import type { QCardReadPort, QToolPorts } from "../ports.js";

/**
 * get_q_card (founder live test 2026-09-27 #4: "is my card saved?").
 *
 * Reads the person's own Q Card — whether one has been made, its handle
 * and whether it is findable — through the same service the Q Card screen
 * reads, which authorises again (card.view on their own organisation).
 * Only their own company or investor organisation, bound in this plan and
 * owned by their organisation; anything else is NOT_AVAILABLE. A handle
 * claim still waiting for their approval is not a card: its proposal
 * status is in the conversation's records.
 */

export const GET_Q_CARD = "q_card.get" as const;

const PURPOSES: readonly QTaskClass[] = [
  "GENERAL_QUESTION",
  "OWN_COMPANY_QUESTION",
  "INVESTOR_QUESTION",
  "ACTION_PREPARATION",
];

export const GetQCardInputSchema = z
  .object({
    subject: z
      .enum(["COMPANY", "INVESTOR_ORGANISATION"])
      .describe(
        "Whose card: their own COMPANY or their own INVESTOR_ORGANISATION.",
      ),
  })
  .strict();
export type GetQCardInput = z.infer<typeof GetQCardInputSchema>;

export const GetQCardOutputSchema = z
  .object({
    /** SAVED: the card exists. NOT_MADE: none has been made yet. */
    status: z.enum(["SAVED", "NOT_MADE"]),
    handle: HandleSchema.nullable(),
    /** Where the card is shared from, when it has a handle. */
    publicPath: z.string().max(80).nullable(),
    findableBySearchEngines: z.boolean().nullable(),
    updatedAt: UtcTimestampSchema.nullable(),
  })
  .strict();
export type GetQCardOutput = z.infer<typeof GetQCardOutputSchema>;

type Grant = {
  readonly subjectType: "COMPANY" | "INVESTOR_ORGANISATION";
  readonly subjectId: string;
};

/** Their own subject of `kind`, bound in the plan; exactly one, or null. */
async function ownSubject(
  ports: Pick<QToolPorts, "companies" | "investors">,
  actor: ActorContext,
  plan: PermittedContextPlan,
  kind: GetQCardInput["subject"],
): Promise<string | null> {
  if (actor.actorType !== "HUMAN" || actor.organisationId === undefined) {
    return null;
  }
  const owned = new Set<string>();
  const scopeKind = kind === "COMPANY" ? "COMPANY_PROFILE" : "INVESTOR_PROFILE";
  for (const scope of scopesOfKind(plan, scopeKind)) {
    if (scope.subject === undefined) continue;
    if (kind === "COMPANY") {
      const id = CompanyIdSchema.safeParse(scope.filter.companyId);
      if (!id.success) continue;
      const profile = await ports.companies
        .findCanonicalCompanyProfile(id.data)
        .catch(() => null);
      if (
        profile !== null &&
        profile.tenantId === actor.tenantId &&
        profile.organisationId === actor.organisationId
      ) {
        owned.add(profile.id);
      }
    } else {
      const id = InvestorOrganisationIdSchema.safeParse(
        scope.filter.investorOrganisationId,
      );
      if (!id.success) continue;
      const identity = await ports.investors
        .findCanonicalInvestorOrganisation(id.data)
        .catch(() => null);
      if (
        identity !== null &&
        identity.tenantId === actor.tenantId &&
        identity.organisationId === actor.organisationId
      ) {
        owned.add(identity.id);
      }
    }
  }
  const [only] = owned;
  return owned.size === 1 && only !== undefined ? only : null;
}

export function createGetQCardTool(
  ports: Pick<QToolPorts, "companies" | "investors">,
  cards: QCardReadPort,
): AnyQToolDefinition {
  return defineQTool<GetQCardInput, GetQCardOutput, Grant>({
    id: GET_Q_CARD,
    version: 1,
    status: "ACTIVE",
    providerName: "get_q_card",
    description:
      "Reads their own Q Card: whether it has been made and saved, its handle, where it is shared from, and whether search engines may find it. Call it when they ask about their card or handle. NOT_MADE means no card yet; a handle waiting for their approval is not saved until they approve it.",
    classification: "READ_ONLY",
    riskClass: "SAFE_READ",
    // card.view on their own organisation, checked by the service.
    requiredCapabilities: [],
    supportedPurposes: [...PURPOSES],
    requiredScopeKinds: ["COMPANY_PROFILE", "INVESTOR_PROFILE"],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "q-tools",
    visibleStage: null,
    input: GetQCardInputSchema,
    output: GetQCardOutputSchema,
    authorize: async (input, { actor, plan }) => {
      const subjectId = await ownSubject(ports, actor, plan, input.subject);
      return subjectId === null
        ? deny<Grant>("NOT_AVAILABLE")
        : allow<Grant>("INTERNAL", { subjectType: input.subject, subjectId });
    },
    execute: async (_input, { actor }, grant) => {
      const card = await cards.getCard(actor, grant);
      if (card === null) {
        return {
          status: "NOT_MADE",
          handle: null,
          publicPath: null,
          findableBySearchEngines: null,
          updatedAt: null,
        };
      }
      return {
        status: "SAVED",
        handle: card.handle,
        publicPath: card.handle === null ? null : `/u/${card.handle}`,
        findableBySearchEngines: card.indexable,
        updatedAt: card.updatedAt,
      };
    },
  });
}
