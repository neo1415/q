import { z } from "zod";

import {
  COMPANY_EDITABLE_FIELDS,
  INVESTOR_EDITABLE_FIELDS,
  PERSON_EDITABLE_FIELDS,
  type PermittedContextPlan,
  type QTaskClass,
} from "@capital-q/contracts";
import { CompanyIdSchema } from "@capital-q/companies";
import { InvestorOrganisationIdSchema } from "@capital-q/investors";

import {
  allow,
  defineQTool,
  deny,
  type AnyQToolDefinition,
} from "../definition.js";
import { actorWideScope, scopesOfKind } from "../plan.js";
import type { ProfileChangePort, QToolPorts } from "../ports.js";

/**
 * PROPOSE_PROFILE_CHANGE — `profile.change.propose` v1 (BIZ-002).
 *
 * Parity with the profile page: anything a person can edit there -- their
 * own name and headline, their company's declared profile, their investor
 * organisation's declared profile -- they can ask Q to change. The MODEL
 * reads what they asked into the closed shape below; nothing here matches
 * words (ADR 0011).
 *
 * It writes one thing: a note to this run's Approval Engine proposer. The
 * person is shown exactly what will change and approves it; the approved
 * action then executes through the same write path the page uses
 * (person.profile.update, company.profile.update, investor.profile.update).
 *
 * Which profile is the person's own is decided here, never by the model:
 * their own user id for PERSON, and for a company or an investor
 * organisation the one this conversation's plan binds that belongs to the
 * actor's own organisation. The owning context authorises again at
 * approval and at execution (company.edit / investor.edit).
 */
export const PROPOSE_PROFILE_CHANGE = "profile.change.propose" as const;

const PROFILE_KINDS = ["PERSON", "COMPANY", "INVESTOR_ORGANISATION"] as const;

/** Every field any profile holds; which ones fit which profile is code's to check. */
const ALL_FIELDS = [
  ...new Set<string>([
    ...PERSON_EDITABLE_FIELDS,
    ...COMPANY_EDITABLE_FIELDS,
    ...INVESTOR_EDITABLE_FIELDS,
  ]),
] as [string, ...string[]];

export const FIELDS_BY_PROFILE: Readonly<
  Record<(typeof PROFILE_KINDS)[number], readonly string[]>
> = {
  PERSON: PERSON_EDITABLE_FIELDS,
  COMPANY: COMPANY_EDITABLE_FIELDS,
  INVESTOR_ORGANISATION: INVESTOR_EDITABLE_FIELDS,
};

export const ProposeProfileChangeInputSchema = z
  .object({
    profile: z
      .enum(PROFILE_KINDS)
      .describe(
        "Whose profile: PERSON (the person themselves), COMPANY (their own company) or INVESTOR_ORGANISATION (their own investor organisation).",
      ),
    changes: z
      .array(
        z
          .object({
            field: z.enum(ALL_FIELDS),
            value: z
              .string()
              .max(8000)
              .nullable()
              .describe(
                "The new value in the field's own form; null clears it.",
              ),
          })
          .strict(),
      )
      .min(1)
      .max(9),
  })
  .strict();
export type ProposeProfileChangeInput = z.infer<
  typeof ProposeProfileChangeInputSchema
>;

export const ProposeProfileChangeOutputSchema = z
  .object({
    /**
     * PREPARED: an approval request will be shown with this answer; nothing
     * has changed yet. ONE_PER_TURN: another action is already being
     * prepared in this answer. REFUSED: the change does not fit the profile;
     * `reason` says why in the person's terms.
     */
    status: z.enum(["PREPARED", "ONE_PER_TURN", "REFUSED"]),
    awaitingApprovalOf: z.string().nullable(),
    reason: z.string().max(400).nullable(),
  })
  .strict();
export type ProposeProfileChangeOutput = z.infer<
  typeof ProposeProfileChangeOutputSchema
>;

const PURPOSES: readonly QTaskClass[] = [
  "GENERAL_QUESTION",
  "OWN_COMPANY_QUESTION",
  "INVESTOR_QUESTION",
  "ACTION_PREPARATION",
  "COUNTERPARTY_COMPANY_QUESTION",
  "RELATIONSHIP_QUESTION",
  "COMPARISON",
];

type Grant = { readonly subjectId: string };

/** The bound scope subjects of `kind`, by the id their filter names. */
function boundIds(
  plan: PermittedContextPlan,
  kind: "COMPANY_PROFILE" | "INVESTOR_PROFILE",
): readonly string[] {
  const ids = new Set<string>();
  for (const scope of scopesOfKind(plan, kind)) {
    if (scope.subject === undefined) continue;
    const id =
      kind === "COMPANY_PROFILE"
        ? scope.filter.companyId
        : scope.filter.investorOrganisationId;
    if (id !== undefined) ids.add(id);
  }
  return [...ids];
}

export function createProposeProfileChangeTool(
  ports: QToolPorts,
  profileChanges: ProfileChangePort,
): AnyQToolDefinition {
  return defineQTool<
    ProposeProfileChangeInput,
    ProposeProfileChangeOutput,
    Grant
  >({
    id: PROPOSE_PROFILE_CHANGE,
    version: 1,
    status: "ACTIVE",
    providerName: "propose_profile_change",
    description:
      "Prepares a change to the person's own profile for their approval, when they have asked for one: PERSON fields displayName and headline (a one-line description of themselves); COMPANY fields canonicalName, legalName, websiteUrl, foundedDate (YYYY-MM-DD), headquartersCountry (ISO 3166 two-letter code), headquartersCity, currentStageCode (lower_snake_case stage code), shortDescription (one line) and primaryDescription; INVESTOR_ORGANISATION fields displayName, investorType, websiteUrl, hqCountry (two-letter code), publicDescription and deploymentState. It changes nothing by itself: the person is shown exactly what will change and approves or declines it. Result: PREPARED, ONE_PER_TURN, or REFUSED with the reason the value does not fit.",
    classification: "SIDE_EFFECT",
    riskClass: "LOW_RISK_INTERNAL",
    // Checked where it binds: company.edit / investor.edit by the action
    // at approval and execution, and the subject's ownership below.
    requiredCapabilities: [],
    supportedPurposes: [...PURPOSES],
    requiredScopeKinds: [
      "OWN_Q_CONVERSATION",
      "COMPANY_PROFILE",
      "INVESTOR_PROFILE",
    ],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "q-tools",
    visibleStage: "WAITING_FOR_APPROVAL",
    input: ProposeProfileChangeInputSchema,
    output: ProposeProfileChangeOutputSchema,
    authorize: async (input, { actor, plan }) => {
      if (actor.actorType !== "HUMAN") {
        return deny<Grant>("NOT_AVAILABLE");
      }
      switch (input.profile) {
        case "PERSON": {
          // Their own record, under the actor-wide own-conversation scope
          // filtered to this very person.
          const scope = actorWideScope(plan, "OWN_Q_CONVERSATION");
          if (scope === undefined || scope.filter.userId !== actor.userId) {
            return deny<Grant>("NOT_AVAILABLE");
          }
          return allow<Grant>("CONFIDENTIAL", { subjectId: actor.userId });
        }
        case "COMPANY": {
          const owned: string[] = [];
          for (const id of boundIds(plan, "COMPANY_PROFILE")) {
            const profile = await ports.companies.findCanonicalCompanyProfile(
              CompanyIdSchema.parse(id),
            );
            if (
              profile !== null &&
              profile.tenantId === actor.tenantId &&
              actor.organisationId !== undefined &&
              profile.organisationId === actor.organisationId
            ) {
              owned.push(profile.id);
            }
          }
          const [only] = owned;
          return owned.length === 1 && only !== undefined
            ? allow<Grant>("CONFIDENTIAL", { subjectId: only })
            : deny<Grant>("NOT_AVAILABLE");
        }
        case "INVESTOR_ORGANISATION": {
          const owned: string[] = [];
          for (const id of boundIds(plan, "INVESTOR_PROFILE")) {
            const identity =
              await ports.investors.findCanonicalInvestorOrganisation(
                InvestorOrganisationIdSchema.parse(id),
              );
            if (
              identity !== null &&
              identity.tenantId === actor.tenantId &&
              actor.organisationId !== undefined &&
              identity.organisationId === actor.organisationId
            ) {
              owned.push(identity.id);
            }
          }
          const [only] = owned;
          return owned.length === 1 && only !== undefined
            ? allow<Grant>("CONFIDENTIAL", { subjectId: only })
            : deny<Grant>("NOT_AVAILABLE");
        }
      }
    },
    execute: (input, context, grant) => {
      const fields = FIELDS_BY_PROFILE[input.profile];
      const misplaced = input.changes
        .map((change) => change.field)
        .filter((field) => !fields.includes(field));
      if (misplaced.length > 0) {
        return Promise.resolve({
          status: "REFUSED",
          awaitingApprovalOf: null,
          reason: `${misplaced.join(", ")} is not part of that profile`,
        });
      }
      return profileChanges.prepareForApproval({
        runId: context.runId,
        tenantId: context.actor.tenantId,
        actorUserId: context.actor.userId,
        profile: input.profile,
        subjectId: grant.subjectId,
        changes: input.changes,
      });
    },
  });
}
