import { z } from "zod";

import { UuidSchema } from "@capital-q/contracts";
import { actorPrincipal } from "@capital-q/permissions";

import {
  allow,
  defineQTool,
  deny,
  type AnyQToolDefinition,
} from "../definition.js";
import { actorWideScope } from "../plan.js";
import type { QToolPorts } from "../ports.js";

/**
 * DISCOVER_COMPANIES — `discovery.companies` v1 (founder brief K1,
 * 2026-10-09).
 *
 * "Show me three fintech companies" is a catalog question: which companies
 * on the network are in a sector, a country or a stage. Live (15:57 UTC)
 * it fell to the analyst, which answered with mandate prose and no cards.
 * This reads the declared taxonomy (confirmed assignments only, never an
 * unconfirmed Q inference that may come from a founder's private
 * material), in name order, and decides every candidate through the
 * Permissions context before it is returned: only a NETWORK_VISIBLE or
 * PUBLIC_EXTERNAL disclosure lets one through (ADR-001). It never ranks:
 * fit, when asked for, is the fit tools' own deterministic answer.
 */

export const DISCOVER_COMPANIES = "discovery.companies" as const;

const LIMIT_MAX = 24;
const FILTER_MAX = 8;

export const DiscoverCompaniesInputSchema = z
  .object({
    sectors: z
      .array(z.string().trim().min(1).max(64))
      .max(FILTER_MAX)
      .default([])
      .describe(
        "Sector taxonomy codes, lower_snake_case (fintech, payments, insurtech, digital_health, clean_energy, agritech, edtech, ...). A sector includes its sub-sectors. Empty for any sector.",
      ),
    countries: z
      .array(z.string().regex(/^[A-Za-z]{2}$/u))
      .max(FILTER_MAX)
      .default([])
      .describe("ISO 3166-1 alpha-2 head-office countries. Empty for any."),
    stages: z
      .array(
        z
          .string()
          .regex(/^[a-z][a-z0-9_]*$/u)
          .max(64),
      )
      .max(FILTER_MAX)
      .default([])
      .describe("Company stage codes (pre_seed, seed, series_a, ...)."),
    limit: z.number().int().min(1).max(LIMIT_MAX).default(10),
  })
  .strict();
export type DiscoverCompaniesInput = z.input<
  typeof DiscoverCompaniesInputSchema
>;

export const DiscoverCompaniesOutputSchema = z
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
            sectors: z.array(z.string()).max(FILTER_MAX),
          })
          .strict(),
      )
      .max(LIMIT_MAX),
    /** The order the list is in, said to the person as the basis. */
    order: z.literal("NAME"),
    sectors: z
      .array(z.object({ code: z.string(), name: z.string() }).strict())
      .max(FILTER_MAX),
    unknownSectors: z.array(z.string()).max(FILTER_MAX),
    /** Declared profiles, not an assessment and not a recommendation. */
    truthClass: z.literal("USER_CLAIM"),
  })
  .strict();
export type DiscoverCompaniesOutput = z.infer<
  typeof DiscoverCompaniesOutputSchema
>;

export function createDiscoverCompaniesTool(
  ports: QToolPorts,
): AnyQToolDefinition {
  return defineQTool<
    z.output<typeof DiscoverCompaniesInputSchema>,
    DiscoverCompaniesOutput,
    null
  >({
    id: DISCOVER_COMPANIES,
    version: 1,
    status: "ACTIVE",
    providerName: "discover_companies",
    description:
      'Lists the companies on Capital Q in a sector (taxonomy code, sub-sectors included), head-office country or stage, in name order, from their declared profiles. Call it when the person asks to see companies of a kind ("three fintech companies in Nigeria"). It does not rank: for how they fit a mandate use fit_profile on the ids it returns.',
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
    input: DiscoverCompaniesInputSchema,
    output: DiscoverCompaniesOutputSchema,
    authorize: (_input, context) => {
      const network = actorWideScope(context.plan, "NETWORK_VISIBLE_DATA");
      return Promise.resolve(
        network === undefined || ports.companyCatalog === undefined
          ? deny<null>("NOT_AVAILABLE")
          : allow<null>(network.sensitivity, null),
      );
    },
    execute: async (input, context) => {
      const catalog = ports.companyCatalog;
      if (catalog === undefined) {
        return {
          companies: [],
          order: "NAME" as const,
          sectors: [],
          unknownSectors: [],
          truthClass: "USER_CLAIM" as const,
        };
      }
      const found = await catalog.find(context.actor, {
        sectors: input.sectors,
        countries: input.countries.map((code) => code.toUpperCase()),
        stages: input.stages,
        // Room for candidates disclosure turns away, still bounded.
        limit: Math.min(input.limit * 3, 60),
      });
      const decisions =
        found.candidates.length === 0
          ? []
          : await ports.disclosure.evaluateMany(
              found.candidates.map((candidate) => ({
                principal: actorPrincipal(context.actor),
                resource: { type: "company" as const, id: candidate.companyId },
                requestedAccess: "view" as const,
              })),
            );
      const seen = new Set<string>();
      const companies = found.candidates
        .filter((candidate, index) => {
          const decision = decisions[index];
          if (
            decision === undefined ||
            decision.outcome !== "ALLOW" ||
            (decision.reasonCode !== "NETWORK_VISIBLE" &&
              decision.reasonCode !== "PUBLIC_EXTERNAL") ||
            seen.has(candidate.companyId)
          ) {
            return false;
          }
          seen.add(candidate.companyId);
          return true;
        })
        .slice(0, input.limit)
        .map((candidate) => ({
          companyId: candidate.companyId,
          name: candidate.name,
          stageCode: candidate.stageCode,
          headquartersCountry: candidate.headquartersCountry,
          shortDescription: candidate.shortDescription,
          sectors: candidate.sectors.slice(0, FILTER_MAX),
        }));
      return {
        companies,
        order: "NAME" as const,
        sectors: found.sectors.slice(0, FILTER_MAX).map((sector) => ({
          code: sector.code,
          name: sector.name,
        })),
        unknownSectors: found.unknownSectors.slice(0, FILTER_MAX),
        truthClass: "USER_CLAIM" as const,
      };
    },
  });
}
