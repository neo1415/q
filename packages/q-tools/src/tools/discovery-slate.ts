import { z } from "zod";

import { UuidSchema } from "@capital-q/contracts";

import {
  allow,
  defineQTool,
  deny,
  type AnyQToolDefinition,
} from "../definition.js";
import { actorWideScope } from "../plan.js";
import type { QToolPorts } from "../ports.js";

/**
 * DISCOVERY_SLATE — `discovery.slate` v1 (doc 19).
 *
 * The question this exists for is the one a person actually asks: "who
 * can you tell me about?" Answering it by name search requires already
 * knowing a name, which is precisely what they do not have. This returns
 * the same deterministic slate the Discover surface shows, with the
 * declared reasons, so Q can answer from the platform rather than from
 * nothing.
 *
 * It reads; it never ranks anything itself and never sees a score. The
 * discovery context decides eligibility, exclusion and order, and a
 * founder is never matched against an investor's private mandate.
 */

export const DISCOVERY_SLATE = "discovery.slate" as const;

const LIMIT_DEFAULT = 10;
const LIMIT_MAX = 20;

export const DiscoverySlateInputSchema = z
  .object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(LIMIT_MAX)
      .optional()
      .describe("How many to return. Up to 20."),
  })
  .strict();
export type DiscoverySlateInput = z.infer<typeof DiscoverySlateInputSchema>;

const ReasonSchema = z
  .object({ kind: z.string(), detail: z.string() })
  .strict();

export const DiscoverySlateOutputSchema = z
  .object({
    /** Which side of the network this slate is for. */
    direction: z.enum(["COMPANIES", "INVESTORS", "NONE"]),
    companies: z
      .array(
        z
          .object({
            companyId: UuidSchema,
            name: z.string(),
            stageCode: z.string().nullable(),
            headquartersCountry: z.string().nullable(),
            shortDescription: z.string().nullable(),
            websiteUrl: z.string().nullable(),
            reasons: z.array(ReasonSchema),
          })
          .strict(),
      )
      .max(LIMIT_MAX),
    investors: z
      .array(
        z
          .object({
            investorOrganisationId: UuidSchema,
            name: z.string(),
            investorType: z.string(),
            hqCountry: z.string().nullable(),
            publicDescription: z.string().nullable(),
            websiteUrl: z.string().nullable(),
            deploymentState: z.string().nullable(),
            reasons: z.array(ReasonSchema),
          })
          .strict(),
      )
      .max(LIMIT_MAX),
    /** Why the slate is what it is, as codes the answer can explain. */
    notes: z.array(z.string()).max(4),
  })
  .strict();
export type DiscoverySlateOutput = z.infer<typeof DiscoverySlateOutputSchema>;

export function createDiscoverySlateTool(
  ports: QToolPorts,
): AnyQToolDefinition {
  return defineQTool<DiscoverySlateInput, DiscoverySlateOutput, null>({
    id: DISCOVERY_SLATE,
    version: 1,
    status: "ACTIVE",
    providerName: "discovery_slate",
    description:
      "Lists the companies or investors this person can currently discover on Capital Q, in the platform's deterministic order, each with the declared reasons it is there. Call it when the person asks who or what you can tell them about, or what is available, without naming anybody. An investor gets companies; a founder gets investors.",
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
    input: DiscoverySlateInputSchema,
    output: DiscoverySlateOutputSchema,
    authorize: (_input, context) => {
      const network = actorWideScope(context.plan, "NETWORK_VISIBLE_DATA");
      return Promise.resolve(
        network === undefined
          ? deny<null>("NOT_AVAILABLE")
          : allow<null>(network.sensitivity, null),
      );
    },
    execute: async (input, context) => {
      const discovery = ports.discovery;
      if (discovery === undefined) {
        return {
          direction: "NONE" as const,
          companies: [],
          investors: [],
          notes: ["DISCOVERY_NOT_AVAILABLE"],
        };
      }
      const limit = input.limit ?? LIMIT_DEFAULT;
      // Which side they are on is the platform's fact, not a model's guess.
      const side = await discovery.sideFor(context.actor);
      if (side === "NONE") {
        return {
          direction: "NONE" as const,
          companies: [],
          investors: [],
          notes: ["NO_SUBJECT_YET"],
        };
      }
      if (side === "INVESTOR") {
        const slate = await discovery.discoverCompanies({
          actor: context.actor,
          limit,
        });
        return {
          direction: "COMPANIES" as const,
          companies: slate.items.map((item) => ({
            companyId: item.companyId,
            name: item.canonicalName,
            stageCode: item.currentStageCode,
            headquartersCountry: item.headquartersCountry,
            shortDescription: item.shortDescription,
            websiteUrl: item.websiteUrl,
            reasons: item.reasons.map((reason) => ({
              kind: reason.kind,
              detail: reason.detail,
            })),
          })),
          investors: [],
          notes: [...slate.notes],
        };
      }
      const slate = await discovery.discoverInvestors({
        actor: context.actor,
        limit,
      });
      return {
        direction: "INVESTORS" as const,
        companies: [],
        investors: slate.items.map((item) => ({
          investorOrganisationId: item.investorOrganisationId,
          name: item.displayName,
          investorType: item.investorType,
          hqCountry: item.hqCountry,
          publicDescription: item.publicDescription,
          websiteUrl: item.websiteUrl,
          deploymentState: item.deploymentState,
          reasons: item.reasons.map((reason) => ({
            kind: reason.kind,
            detail: reason.detail,
          })),
        })),
        notes: [...slate.notes],
      };
    },
  });
}
