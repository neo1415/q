import { z } from "zod";

import {
  COMPANY_SEARCH_TEXT_MAX_LENGTH,
  CompanySearchCursorError,
} from "@capital-q/companies";
import { UuidSchema } from "@capital-q/contracts";
import { actorPrincipal } from "@capital-q/permissions";

import {
  allow,
  defineQTool,
  deny,
  QToolArgumentError,
  type AnyQToolDefinition,
} from "../definition.js";
import { actorWideScope } from "../plan.js";
import type { QToolPorts } from "../ports.js";

/**
 * SEARCH_COMPANIES — `company.search` v1 (doc 12 §28.1 `searchCompanies`;
 * packet §50-§56).
 *
 * Bounded discovery over companies classified network_visible or
 * public_external (ADR-001: two distinct scopes, both discoverable to an
 * authenticated participant), under the plan's actor-wide
 * NETWORK_VISIBLE_DATA scope. Filters are exact structured fields plus a
 * case-insensitive name substring; results are keyset-paged and every
 * candidate is re-checked through the Permissions bounded context before
 * it is returned — classification selects candidates, disclosure decides.
 * The actor's own organisation-private companies are not search results:
 * they are subjects of their own conversations. No ranking, no score, no
 * semantic retrieval (CQ-RAG), no taxonomy filter yet (no companies-by-node
 * query exists in the Taxonomy context).
 */

export const SEARCH_COMPANIES = "company.search" as const;

const LIMIT_DEFAULT = 10;
const LIMIT_MAX = 20;

export const SearchCompaniesInputSchema = z
  .object({
    query: z
      .string()
      .trim()
      .min(1)
      .max(COMPANY_SEARCH_TEXT_MAX_LENGTH)
      .optional()
      .describe("Case-insensitive substring of the company name."),
    stageCode: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .optional()
      .describe("Exact company stage code, e.g. seed."),
    headquartersCountry: z
      .string()
      .trim()
      .length(2)
      .optional()
      .describe("ISO 3166-1 alpha-2 country code of the headquarters."),
    limit: z.number().int().min(1).max(LIMIT_MAX).optional(),
    cursor: z
      .string()
      .min(1)
      .max(512)
      .optional()
      .describe("nextCursor from a previous result, for the next page."),
  })
  .strict();
export type SearchCompaniesInput = z.infer<typeof SearchCompaniesInputSchema>;

export const SearchCompaniesOutputSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            companyId: UuidSchema,
            canonicalName: z.string(),
            currentStageCode: z.string().nullable(),
            headquartersCountry: z.string().nullable(),
            shortDescription: z.string().nullable(),
          })
          .strict(),
      )
      .max(LIMIT_MAX),
    nextCursor: z.string().nullable(),
    /** Results are declared company profiles, not an assessment of any kind. */
    truthClass: z.literal("USER_CLAIM"),
  })
  .strict();
export type SearchCompaniesOutput = z.infer<typeof SearchCompaniesOutputSchema>;

export function createSearchCompaniesTool(
  ports: QToolPorts,
): AnyQToolDefinition {
  return defineQTool<SearchCompaniesInput, SearchCompaniesOutput, null>({
    id: SEARCH_COMPANIES,
    version: 1,
    status: "ACTIVE",
    providerName: "search_companies",
    description:
      "Searches companies visible across the Capital Q network by name substring, stage code and headquarters country, returning up to 20 per page with a cursor. Call it to find candidate companies; then use get_company for a profile. Results are declared profiles, not assessments.",
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
    input: SearchCompaniesInputSchema,
    output: SearchCompaniesOutputSchema,
    authorize: (_input, context) => {
      const network = actorWideScope(context.plan, "NETWORK_VISIBLE_DATA");
      return Promise.resolve(
        network === undefined
          ? deny<null>("NOT_AVAILABLE")
          : allow<null>(network.sensitivity, null),
      );
    },
    execute: async (input, context) => {
      let page;
      try {
        page = await ports.companies.searchCompanies({
          viewer: {
            tenantId: context.actor.tenantId,
            organisationId: undefined,
          },
          text: input.query,
          stageCode: input.stageCode,
          headquartersCountry: input.headquartersCountry?.toUpperCase(),
          limit: input.limit ?? LIMIT_DEFAULT,
          cursor: input.cursor,
        });
      } catch (error: unknown) {
        if (error instanceof CompanySearchCursorError) {
          throw new QToolArgumentError(
            "The cursor is not one this search issued; start again without it.",
          );
        }
        throw error;
      }
      // Classification chose the candidates; disclosure decides each one.
      const decisions =
        page.items.length === 0
          ? []
          : await ports.disclosure.evaluateMany(
              page.items.map((item) => ({
                principal: actorPrincipal(context.actor),
                resource: { type: "company" as const, id: item.id },
                requestedAccess: "view" as const,
              })),
            );
      const items = page.items.filter((_item, index) => {
        const decision = decisions[index];
        return (
          decision !== undefined &&
          decision.outcome === "ALLOW" &&
          (decision.reasonCode === "NETWORK_VISIBLE" ||
            decision.reasonCode === "PUBLIC_EXTERNAL")
        );
      });
      return {
        items: items.map((item) => ({
          companyId: item.id,
          canonicalName: item.canonicalName,
          currentStageCode: item.currentStageCode,
          headquartersCountry: item.headquartersCountry,
          shortDescription: item.shortDescription,
        })),
        nextCursor: page.nextCursor,
        truthClass: "USER_CLAIM",
      };
    },
  });
}
