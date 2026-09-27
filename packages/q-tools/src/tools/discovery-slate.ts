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
import { networkVisibleCompanies } from "./network-companies.js";

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
    /**
     * An investor's own Save and Pass decisions, by company id (CQ-QACT-001).
     * Passed companies are never in `companies`; this is how Q can say
     * which one was skipped without guessing from a name two companies
     * may share.
     */
    decisions: z
      .array(
        z
          .object({
            companyId: UuidSchema,
            name: z.string(),
            stageCode: z.string().nullable(),
            headquartersCountry: z.string().nullable(),
            decision: z.enum(["SAVED", "PASSED"]),
          })
          .strict(),
      )
      .max(LIMIT_MAX)
      .default([]),
    /** Why the slate is what it is, as codes the answer can explain. */
    notes: z.array(z.string()).max(4),
    /**
     * An investor's feed held nothing (founder live 2026-09-27, #8): the
     * companies visible across the network instead, so "find founders who
     * might be interested" is never a dead end. Declared network profiles,
     * disclosure-checked, never ranked, never a recommendation or fit; the
     * guidance says how to present them and to add cited public research.
     */
    network: z
      .object({
        companies: z
          .array(
            z
              .object({
                companyId: UuidSchema,
                name: z.string(),
                stageCode: z.string().nullable(),
                headquartersCountry: z.string().nullable(),
                shortDescription: z.string().nullable(),
              })
              .strict(),
          )
          .max(LIMIT_MAX),
        guidance: z.string(),
      })
      .strict()
      .nullable()
      .default(null),
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
      "Lists the companies or investors this person can currently discover on Capital Q, in the platform's deterministic order, each with the declared reasons it is there. For an investor this is exactly their Discover feed: its eligibility, readiness, ranking and the companies they passed on already removed, plus their own Save and Pass decisions by company id. Call it whenever the person asks what to look at, which company first, what is in their feed or who you can tell them about, and recommend only from it. An investor gets companies; a founder gets investors. When an investor's feed is empty it also returns the companies visible on the network, with guidance on presenting them and on adding cited public research.",
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
          decisions: [],
          notes: ["DISCOVERY_NOT_AVAILABLE"],
          network: null,
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
          decisions: [],
          notes: ["NO_SUBJECT_YET"],
          network: null,
        };
      }
      const feed = ports.investorFeed;
      if (side === "INVESTOR" && feed !== undefined) {
        // The feed itself, so Q never recommends what the feed would not
        // show: a company that is visible but not marketplace-ready, one
        // outside the declared mandate, or one they already passed on.
        const [page, decisions] = await Promise.all([
          feed.page(context.actor, limit),
          feed.decisions(context.actor, LIMIT_MAX),
        ]);
        const empty = (page?.items ?? []).length === 0;
        return {
          direction: "COMPANIES" as const,
          companies: (page?.items ?? []).map((item) => ({
            companyId: item.companyId,
            name: item.name,
            stageCode: item.stageCode,
            headquartersCountry: item.headquartersCountry,
            shortDescription: item.shortDescription,
            websiteUrl: item.websiteUrl,
            reasons: item.reasonCodes.map((code) => ({
              kind: code,
              detail: REASON_DETAILS[code] ?? "A declared reason on the feed.",
            })),
          })),
          investors: [],
          decisions: decisions.map((decision) => ({ ...decision })),
          notes: [...(page?.notes ?? ["NO_ACTIVE_MANDATE"])].slice(0, 4),
          network: empty
            ? await networkInstead(
                ports,
                context.actor,
                limit,
                decisions.flatMap((decision) =>
                  decision.decision === "PASSED" ? [decision.companyId] : [],
                ),
              )
            : null,
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
          decisions: [],
          notes: [...slate.notes],
          network:
            slate.items.length === 0
              ? await networkInstead(ports, context.actor, limit, [])
              : null,
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
        decisions: [],
        notes: [...slate.notes],
        network: null,
      };
    },
  });
}

const NETWORK_GUIDANCE =
  "Nothing is in their Discover feed right now. These are companies visible on the Capital Q network: declared profiles, not recommendations, not a fit assessment and not evidence of interest. Offer them as exactly that, say why the feed is empty from the notes, and to find founders beyond the network, research public sources (research_public_web) and cite every source. Never answer that there is no one.";

/**
 * The network in place of an empty feed (founder live 2026-09-27, #8).
 * Disclosure-checked network projections only, in the search's own order;
 * companies they passed on stay out. A read that fails is no fallback,
 * never a failed slate.
 */
async function networkInstead(
  ports: QToolPorts,
  actor: Parameters<typeof networkVisibleCompanies>[1],
  limit: number,
  passed: readonly string[],
): Promise<DiscoverySlateOutput["network"]> {
  let found: Awaited<ReturnType<typeof networkVisibleCompanies>>;
  try {
    found = await networkVisibleCompanies(ports, actor, { limit });
  } catch {
    return null;
  }
  const skip = new Set(passed);
  return {
    companies: found.items
      .filter((item) => !skip.has(item.id))
      .map((item) => ({
        companyId: item.id,
        name: item.canonicalName,
        stageCode: item.currentStageCode,
        headquartersCountry: item.headquartersCountry,
        shortDescription: item.shortDescription,
      })),
    guidance: NETWORK_GUIDANCE,
  };
}

/**
 * The feed's public reason codes in words the answer can use. The codes are
 * the feed card's own; nothing here ranks or adds a reason.
 */
const REASON_DETAILS: Readonly<Record<string, string>> = {
  STAGE_ALIGNED: "Its stage is inside the mandate's declared stage range.",
  GEOGRAPHY_COUNTRY_ALIGNED: "It is based in a country the mandate names.",
  GEOGRAPHY_REGION_ALIGNED: "It is based in a region the mandate names.",
  TAXONOMY_EXACT: "Its sector is one the mandate names.",
  TAXONOMY_RELATED: "Its sector is related to one the mandate names.",
  SEMANTIC_SIMILARITY_PRESENT:
    "What it does reads close to what the mandate describes.",
};
