import { z } from "zod";

import {
  CompanyIdSchema,
  type CompanyProfileFacts,
} from "@capital-q/companies";
import {
  CompanyStatusSchema,
  UuidSchema,
  type QSensitivityClass,
} from "@capital-q/contracts";
import { actorPrincipal } from "@capital-q/permissions";
import { capability } from "@capital-q/security";

import {
  allow,
  defineQTool,
  deny,
  type AnyQToolDefinition,
} from "../definition.js";
import { actorWideScope, boundScopeFor } from "../plan.js";
import type { QToolPorts } from "../ports.js";

/**
 * GET_COMPANY — `company.get` v1 (doc 12 §28.1 `getCompany`; packet §33-§39).
 *
 * The canonical profile core of one company, for the actor, in this run:
 *
 *   - a company the plan bound a COMPANY_PROFILE scope to: the owning
 *     side must hold `company.view` on it (authorization layer); anyone
 *     else must be granted view by disclosure (permissions layer);
 *   - any other company only under the actor-wide NETWORK_VISIBLE_DATA
 *     scope, and only when disclosure says it is network-visible or
 *     public — never by ownership, never by an explicit share the plan
 *     did not admit;
 *   - a company the run is about whose profile the firewall denied stays
 *     denied here, whatever the actor could otherwise see.
 *
 * Absent, cross-tenant, unshared and out-of-plan are one answer. No
 * founder, financial, evidence, relationship or score content: those are
 * other scopes, other tools, other packets.
 */

export const GET_COMPANY = "company.get" as const;

export const GetCompanyInputSchema = z
  .object({
    companyId: UuidSchema.describe(
      "The canonical company identifier (UUID), as given in the conversation context.",
    ),
  })
  .strict();
export type GetCompanyInput = z.infer<typeof GetCompanyInputSchema>;

const DESCRIPTION_MAX = 4_000;

export const GetCompanyOutputSchema = z
  .object({
    companyId: UuidSchema,
    canonicalName: z.string(),
    legalName: z.string().nullable(),
    websiteUrl: z.string().nullable(),
    foundedDate: z.string().nullable(),
    headquartersCountry: z.string().nullable(),
    headquartersCity: z.string().nullable(),
    currentStageCode: z.string().nullable(),
    shortDescription: z.string().nullable(),
    primaryDescription: z.string().max(DESCRIPTION_MAX).nullable(),
    companyStatus: CompanyStatusSchema,
    /** OWN: the actor's organisation owns it; SHARED: reached through disclosure. */
    relationToYou: z.enum(["OWN", "SHARED"]),
    /** Profile fields are what the company declared about itself. */
    truthClass: z.literal("USER_CLAIM"),
  })
  .strict();
export type GetCompanyOutput = z.infer<typeof GetCompanyOutputSchema>;

type Grant = {
  readonly profile: CompanyProfileFacts;
  readonly relation: "OWN" | "SHARED";
};

export function createGetCompanyTool(ports: QToolPorts): AnyQToolDefinition {
  return defineQTool<GetCompanyInput, GetCompanyOutput, Grant>({
    id: GET_COMPANY,
    version: 1,
    status: "ACTIVE",
    providerName: "get_company",
    description:
      "Returns the canonical profile of one company (name, website, founding date, headquarters, stage, descriptions, status) when it is available in this conversation. Call it when the answer depends on company profile facts that were not supplied. Returns an error when the company is not available.",
    classification: "READ_ONLY",
    riskClass: "SAFE_READ",
    requiredCapabilities: [capability("company.view")],
    supportedPurposes: [
      "OWN_COMPANY_QUESTION",
      "COUNTERPARTY_COMPANY_QUESTION",
      "INVESTOR_QUESTION",
      "RELATIONSHIP_QUESTION",
      "COMPARISON",
      "GENERAL_QUESTION",
    ],
    requiredScopeKinds: ["COMPANY_PROFILE", "NETWORK_VISIBLE_DATA"],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "q-tools",
    visibleStage: "REVIEWING_COMPANY",
    input: GetCompanyInputSchema,
    output: GetCompanyOutputSchema,
    authorize: async (input, context) => {
      const { actor, plan } = context;
      const profile = await ports.companies.findCanonicalCompanyProfile(
        CompanyIdSchema.parse(input.companyId),
      );
      if (profile === null) {
        return deny("NOT_AVAILABLE");
      }
      const bound = boundScopeFor(
        plan,
        "COMPANY_PROFILE",
        (filter) => filter.companyId === profile.id,
      );
      if (bound !== undefined) {
        const owner =
          actor.organisationId !== undefined &&
          actor.tenantId === profile.tenantId &&
          actor.organisationId === profile.organisationId;
        if (owner) {
          const decision = await ports.authorization.authorize({
            actor,
            capability: capability("company.view"),
            resource: {
              kind: "RESOURCE",
              tenantId: profile.tenantId,
              organisationId: profile.organisationId,
              resourceType: "company",
              resourceId: profile.id,
            },
          });
          return decision.outcome === "ALLOW"
            ? allow(bound.sensitivity, { profile, relation: "OWN" })
            : deny("NOT_AVAILABLE");
        }
        const disclosed = await ports.disclosure.canDisclose({
          principal: actorPrincipal(actor),
          resource: { type: "company", id: profile.id },
          requestedAccess: "view",
        });
        return disclosed.outcome === "ALLOW"
          ? allow(bound.sensitivity, { profile, relation: "SHARED" })
          : deny("NOT_AVAILABLE");
      }
      const isSubject = plan.subjects.some(
        (subject) =>
          subject.kind === "COMPANY" && subject.companyId === profile.id,
      );
      const network = actorWideScope(plan, "NETWORK_VISIBLE_DATA");
      if (isSubject || network === undefined) {
        return deny("NOT_AVAILABLE");
      }
      const disclosed = await ports.disclosure.canDisclose({
        principal: actorPrincipal(actor),
        resource: { type: "company", id: profile.id },
        requestedAccess: "view",
      });
      if (
        disclosed.outcome !== "ALLOW" ||
        (disclosed.reasonCode !== "NETWORK_VISIBLE" &&
          disclosed.reasonCode !== "PUBLIC_EXTERNAL")
      ) {
        return deny("NOT_AVAILABLE");
      }
      const sensitivity: QSensitivityClass =
        disclosed.reasonCode === "PUBLIC_EXTERNAL"
          ? "PUBLIC"
          : "NETWORK_VISIBLE";
      return allow(sensitivity, { profile, relation: "SHARED" });
    },
    execute: (_input, _context, grant) =>
      Promise.resolve({
        companyId: grant.profile.id,
        canonicalName: grant.profile.canonicalName,
        legalName: grant.profile.legalName,
        websiteUrl: grant.profile.websiteUrl,
        foundedDate: grant.profile.foundedDate,
        headquartersCountry: grant.profile.headquartersCountry,
        headquartersCity: grant.profile.headquartersCity,
        currentStageCode: grant.profile.currentStageCode,
        shortDescription: grant.profile.shortDescription,
        primaryDescription:
          grant.profile.primaryDescription === null
            ? null
            : grant.profile.primaryDescription.slice(0, DESCRIPTION_MAX),
        companyStatus: grant.profile.companyStatus,
        relationToYou: grant.relation,
        truthClass: "USER_CLAIM",
      }),
  });
}
