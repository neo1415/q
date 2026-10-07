import { z } from "zod";

import { CompanyIdSchema } from "@capital-q/companies";
import { UuidSchema, type InvestorGateFitDto } from "@capital-q/contracts";
import {
  DISCOVERY_LIMIT_MAX,
  PROSPECT_FIT_VERSION,
  rankProspects,
  type ProspectCompany,
} from "@capital-q/discovery";
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
 * FIND_PROSPECTIVE_INVESTORS — `investor.prospects` v1 (CQ-QX-007,
 * acceptance directive E).
 *
 * "Which investors would likely invest in X?" is prospecting: who on
 * Capital Q a company might approach, and why. It is answered from the
 * investors' network-visible declared profiles only — never a mandate,
 * which is investor-private and must not shape what a founder sees
 * (doc 19 §204.9) — with deterministic, named reasons from
 * `@capital-q/discovery`'s prospect fit. Every result is a likely fit,
 * never evidence of interest, and the output says so.
 *
 * The company is either the person's own (read from its canonical record,
 * only when the plan binds its profile to them) or a company described in
 * the conversation from cited public sources, whose attributes arrive as
 * input. Unknown attributes are never counted against a candidate.
 */
export const FIND_PROSPECTIVE_INVESTORS = "investor.prospects" as const;

const LIMIT_DEFAULT = 10;
const LIMIT_MAX = 20;

export const FindProspectiveInvestorsInputSchema = z
  .object({
    companyId: UuidSchema.optional().describe(
      "The person's own company on Capital Q (UUID), when the question is about it.",
    ),
    company: z
      .object({
        name: z.string().trim().min(1).max(160).optional(),
        countryCode: z
          .string()
          .regex(/^[A-Za-z]{2}$/)
          .optional()
          .describe("ISO 3166-1 alpha-2 country the company operates from."),
        stageCode: z
          .enum(["pre_seed", "seed", "series_a", "series_b", "series_c_plus"])
          .optional(),
      })
      .strict()
      .optional()
      .describe(
        "What is known of a company that is not the person's own, from cited public sources. Leave out what is unknown.",
      ),
    limit: z.number().int().min(1).max(LIMIT_MAX).optional(),
  })
  .strict();
export type FindProspectiveInvestorsInput = z.infer<
  typeof FindProspectiveInvestorsInputSchema
>;

const ProspectSchema = z
  .object({
    investorOrganisationId: UuidSchema,
    name: z.string(),
    investorType: z.string().nullable(),
    hqCountry: z.string().nullable(),
    publicDescription: z.string().nullable(),
    websiteUrl: z.string().nullable(),
    deploymentState: z.string().nullable(),
    reasons: z
      .array(z.object({ kind: z.string(), detail: z.string() }).strict())
      .max(8),
    label: z.literal("likely fit, not evidence of interest"),
    /**
     * Q.05: their published gate, checked against the person's own
     * company (met / not met / not known yet per criterion, by the
     * investor's label). Null: no published gate, or not their company.
     */
    gate: z
      .object({
        title: z.string(),
        acceptingApplications: z.boolean(),
        criteria: z
          .array(
            z
              .object({
                label: z.string(),
                required: z.boolean(),
                standing: z.enum(["MET", "NOT_MET", "UNKNOWN"]),
              })
              .strict(),
          )
          .max(64),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();

export const FindProspectiveInvestorsOutputSchema = z
  .object({
    fitVersion: z.literal(PROSPECT_FIT_VERSION),
    /** Where the company's attributes came from. */
    companySource: z.enum(["CAPITAL_Q_RECORD", "CONVERSATION", "NONE"]),
    compared: z
      .object({
        countryCode: z.string().nullable(),
        stageCode: z.string().nullable(),
      })
      .strict(),
    prospects: z.array(ProspectSchema).max(LIMIT_MAX),
    /** Always said: what these are and are not. */
    notes: z.array(z.string()).max(4),
  })
  .strict();
export type FindProspectiveInvestorsOutput = z.infer<
  typeof FindProspectiveInvestorsOutputSchema
>;

type Grant = {
  readonly company: ProspectCompany;
  readonly source: "CAPITAL_Q_RECORD" | "CONVERSATION" | "NONE";
};

const NOTES = [
  "Based on what investors publish (their public profile and their published gate); no investor's private mandate is read.",
  "Each is a likely fit to be checked, not evidence of interest.",
] as const;

function gateWords(gate: InvestorGateFitDto | undefined) {
  return gate === undefined
    ? null
    : {
        title: gate.title,
        acceptingApplications: gate.acceptingApplications,
        criteria: gate.criteria.map((criterion) => ({
          label: criterion.label,
          required: criterion.requiredness === "REQUIRED",
          standing: criterion.standing,
        })),
      };
}

export function createFindProspectiveInvestorsTool(
  ports: QToolPorts,
): AnyQToolDefinition {
  return defineQTool<
    FindProspectiveInvestorsInput,
    FindProspectiveInvestorsOutput,
    Grant
  >({
    id: FIND_PROSPECTIVE_INVESTORS,
    version: 1,
    status: "ACTIVE",
    providerName: "find_prospective_investors",
    description:
      "Finds investors on Capital Q a company might approach, from their network-visible declared profiles (where they are based, what kind of investor they are, whether they say they are deploying), each with deterministic reasons and labelled a likely fit, never interest. For their own company, each investor with a published gate also carries that gate's criteria and whether the company meets each (met, not met, not known yet; unknown is never a no). Call it when the person asks which investors fit them, would likely invest in, suit or be worth approaching for a company: pass companyId for their own company, or the company's country and stage as found in cited public sources. Public research remains the source for investors not on Capital Q.",
    classification: "READ_ONLY",
    riskClass: "SAFE_READ",
    requiredCapabilities: [],
    supportedPurposes: [
      "OWN_COMPANY_QUESTION",
      "COUNTERPARTY_COMPANY_QUESTION",
      "INVESTOR_QUESTION",
      "RELATIONSHIP_QUESTION",
      "COMPARISON",
      "GENERAL_QUESTION",
    ],
    requiredScopeKinds: ["NETWORK_VISIBLE_DATA"],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "q-tools",
    visibleStage: "COMPARING_OPPORTUNITIES",
    input: FindProspectiveInvestorsInputSchema,
    output: FindProspectiveInvestorsOutputSchema,
    authorize: async (input, context) => {
      const { actor, plan } = context;
      const network = actorWideScope(plan, "NETWORK_VISIBLE_DATA");
      if (network === undefined) {
        return deny("NOT_AVAILABLE");
      }
      if (input.companyId === undefined) {
        const described = input.company;
        return allow(network.sensitivity, {
          company: {
            countryCode: described?.countryCode ?? null,
            stageCode: described?.stageCode ?? null,
          },
          source:
            described?.countryCode === undefined &&
            described?.stageCode === undefined
              ? "NONE"
              : "CONVERSATION",
        });
      }
      // Their own company: its record, only when the plan binds its profile
      // to them and they may view it. Anyone else's is described, not read.
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
      const owner =
        actor.organisationId !== undefined &&
        actor.tenantId === profile.tenantId &&
        actor.organisationId === profile.organisationId;
      if (bound === undefined || !owner) {
        return deny("NOT_AVAILABLE");
      }
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
      if (decision.outcome !== "ALLOW") {
        return deny("NOT_AVAILABLE");
      }
      // Only what the prospect list compares on leaves the record here, and
      // it never leaves Capital Q.
      return allow(network.sensitivity, {
        company: {
          countryCode: profile.headquartersCountry,
          stageCode: profile.currentStageCode,
        },
        source: "CAPITAL_Q_RECORD",
      });
    },
    execute: async (input, context, grant) => {
      const discovery = ports.discovery;
      const compared = {
        countryCode: grant.company.countryCode?.toUpperCase() ?? null,
        stageCode: grant.company.stageCode,
      };
      if (discovery === undefined) {
        return {
          fitVersion: PROSPECT_FIT_VERSION,
          companySource: grant.source,
          compared,
          prospects: [],
          notes: [
            ...NOTES,
            "Investor discovery is not available on this build.",
          ],
        };
      }
      // Network-visible, disclosure-permitted investor organisations: the
      // same candidate set a founder's slate is drawn from.
      const slate = await discovery.discoverInvestors({
        actor: context.actor,
        limit: DISCOVERY_LIMIT_MAX,
      });
      const ranked = rankProspects(
        grant.company,
        slate.items.map((item) => ({
          investorOrganisationId: item.investorOrganisationId,
          displayName: item.displayName,
          investorType: item.investorType,
          hqCountry: item.hqCountry,
          deploymentState: item.deploymentState,
          publicDescription: item.publicDescription,
          websiteUrl: item.websiteUrl,
        })),
      ).slice(0, input.limit ?? LIMIT_DEFAULT);
      // Q.05: published gates, only for the person's own company (the
      // grant proved ownership); a described company is never checked.
      const gates =
        grant.source === "CAPITAL_Q_RECORD" &&
        input.companyId !== undefined &&
        ports.investorGates !== undefined
          ? new Map(
              (
                await ports.investorGates
                  .forOwnCompany(
                    context.actor,
                    input.companyId,
                    ranked.map((p) => p.investorOrganisationId),
                  )
                  .catch(() => [])
              ).map((gate) => [gate.investorOrganisationId, gate]),
            )
          : new Map<string, InvestorGateFitDto>();
      return {
        fitVersion: PROSPECT_FIT_VERSION,
        companySource: grant.source,
        compared,
        prospects: ranked.map((prospect) => ({
          investorOrganisationId: prospect.investorOrganisationId,
          name: prospect.displayName,
          investorType: prospect.investorType,
          hqCountry: prospect.hqCountry,
          publicDescription: prospect.publicDescription,
          websiteUrl: prospect.websiteUrl,
          deploymentState: prospect.deploymentState,
          reasons: prospect.reasons.map((reason) => ({ ...reason })),
          label: "likely fit, not evidence of interest" as const,
          gate: gateWords(gates.get(prospect.investorOrganisationId)),
        })),
        notes:
          slate.items.length === 0
            ? [
                ...NOTES,
                "No investor on Capital Q has made its profile visible to the network yet.",
              ]
            : [...NOTES],
      };
    },
  });
}
