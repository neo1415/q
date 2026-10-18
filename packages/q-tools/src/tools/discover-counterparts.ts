import { z } from "zod";

import { IdentityCardSchema } from "@capital-q/contracts/q";

import {
  allow,
  defineQTool,
  deny,
  type AnyQToolDefinition,
} from "../definition.js";
import { actorWideScope } from "../plan.js";
import type { QToolPorts } from "../ports.js";

/**
 * DISCOVER_COUNTERPARTS -- `people.discover` v1 (D1, 2026-10-10).
 *
 * "I need the top three Arab investors that may be interested in this":
 * find investors by meaning, from the prepared known-entity index first
 * (instant, no web) and one bounded public web search only for the slots
 * still empty. The member's words are read by the model (any paraphrase:
 * "Gulf money", "who in Qatar might back us"); everything after that --
 * region words to countries, ranking, the soft fit reasons -- is code.
 *
 * Read-only and public-only. It reads no Capital Q record: the only words
 * that can leave in a web query are the member's region descriptors and
 * public taxonomy terms (sector, stage), checked by `publicTerm` in
 * q-research. Founder-private figures or documents never go in a field of
 * this tool, and anything that is not a plain taxonomy word is dropped.
 */

export const DISCOVER_COUNTERPARTS = "people.discover" as const;

export const DiscoverCounterpartsInputSchema = z
  .object({
    counterpart: z
      .enum(["INVESTOR"])
      .default("INVESTOR")
      .describe("The kind of counterpart wanted. Investors for now."),
    regions: z
      .array(z.string().trim().min(2).max(40))
      .max(4)
      .default([])
      .describe(
        "Region, nationality or country words exactly as the member said them: 'Arab', 'Gulf', 'Middle Eastern', 'Qatar', 'from the region'. Never expand or translate. Empty when they named no place.",
      ),
    sector: z
      .string()
      .trim()
      .max(40)
      .nullable()
      .default(null)
      .describe(
        "A public sector word only (fintech, healthtech); null unless the member or their public company profile gives one. Never a figure, document or private detail.",
      ),
    stage: z
      .string()
      .trim()
      .max(40)
      .nullable()
      .default(null)
      .describe(
        "pre_seed, seed, series_a, series_b or series_c_plus, else null.",
      ),
    count: z
      .number()
      .int()
      .min(1)
      .max(5)
      .default(3)
      .describe(
        "How many they asked for; 3 when they gave no number; at most 5.",
      ),
    aboutMyCompany: z
      .boolean()
      .default(false)
      .describe(
        "True when 'this', 'us' or 'our' means the member's own company or raise.",
      ),
  })
  .strict();
export type DiscoverCounterpartsInput = z.infer<
  typeof DiscoverCounterpartsInputSchema
>;

export const DiscoveredCounterpartSchema = z
  .object({
    card: IdentityCardSchema,
    role: z.enum(["INVESTOR", "DOOR_OPENER"]),
    fit: z.array(z.string().max(160)).max(5),
    source: z.enum(["KNOWN_ENTITY", "WEB"]),
  })
  .strict();

export const DiscoverCounterpartsOutputSchema = z
  .object({
    outcome: z.enum(["FOUND", "NONE", "UNAVAILABLE"]),
    candidates: z.array(DiscoveredCounterpartSchema).max(5),
    countries: z.array(z.string().length(2)).max(40),
    regionWords: z.array(z.string().max(40)).max(4),
    webSearched: z.boolean(),
    aboutMyCompany: z.boolean(),
    truthClass: z.literal("UNKNOWN"),
    guidance: z.string().max(800),
  })
  .strict();
export type DiscoverCounterpartsOutput = z.infer<
  typeof DiscoverCounterpartsOutputSchema
>;

const GUIDANCE =
  "The cards are public material of unknown reliability, matched on region and what each is described as; none has said it is interested. Say in one short sentence who could fit and why, softly (could be a fit, reportedly invests in), and offer to rehearse a conversation with one. An entry whose role is DOOR_OPENER is not a fund; say so. If nothing was found, say so plainly and ask for a sector or a country. Never claim interest, never invent figures, never describe anyone from general knowledge.";

export function createDiscoverCounterpartsTool(
  ports: QToolPorts & {
    readonly counterparts: NonNullable<QToolPorts["counterparts"]>;
  },
): AnyQToolDefinition {
  return defineQTool<
    DiscoverCounterpartsInput,
    DiscoverCounterpartsOutput,
    Record<string, never>
  >({
    id: DISCOVER_COUNTERPARTS,
    version: 1,
    status: "ACTIVE",
    providerName: "discover_investors",
    description:
      "Finds investors outside Capital Q by what the member means, not by exact words, and returns up to five cards with a soft reason each could fit. Use it for any ask for investors of a region or kind without naming one: 'top three Arab investors that may be interested in this', 'Gulf money for us', 'Middle Eastern VCs', 'who in Qatar might back us', 'investors from the region', 'find me some Saudi funds'. Region and nationality words are mapped to countries by code. Prepared investors answer instantly; a short public search fills any remaining slots. For ONE named person or firm use find_public_entity instead. Results are unverified public material and never change Capital Q records.",
    classification: "READ_ONLY",
    riskClass: "SAFE_READ",
    requiredCapabilities: [],
    supportedPurposes: [
      "OWN_COMPANY_QUESTION",
      "INVESTOR_QUESTION",
      "GENERAL_QUESTION",
    ],
    requiredScopeKinds: ["PUBLIC_EXTERNAL_DATA"],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "q-tools",
    visibleStage: "SEARCHING_PUBLIC_SOURCES",
    input: DiscoverCounterpartsInputSchema,
    output: DiscoverCounterpartsOutputSchema,
    authorize: (_input, context) =>
      Promise.resolve(
        actorWideScope(context.plan, "PUBLIC_EXTERNAL_DATA") === undefined
          ? deny("NOT_AVAILABLE")
          : allow("PUBLIC", {}),
      ),
    execute: async (input, context) => {
      const found = await ports.counterparts.discover({
        tenantId: context.actor.tenantId,
        userId: context.actor.userId,
        regions: input.regions,
        sector: input.sector,
        stage: input.stage,
        count: input.count,
        signal: context.signal,
      });
      return {
        outcome: found.outcome,
        candidates: found.candidates.map((candidate) => ({
          card: candidate.card,
          role: candidate.role,
          fit: [...candidate.fit],
          source: candidate.source,
        })),
        countries: [...found.countries],
        regionWords: [...found.regionWords],
        webSearched: found.webSearched,
        aboutMyCompany: input.aboutMyCompany,
        truthClass: "UNKNOWN",
        guidance: GUIDANCE,
      };
    },
  });
}
