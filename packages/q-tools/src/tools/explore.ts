import { z } from "zod";

import {
  EXPLORE_REASON_CODES,
  EXPLORE_RELATED_REASONS,
  UuidSchema,
  type QTaskClass,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import {
  allow,
  defineQTool,
  deny,
  type AnyQToolDefinition,
} from "../definition.js";
import { actorWideScope } from "../plan.js";

/**
 * Explore for Q (E1-E5, ADR 0055): "explore pitches like X" and "search
 * the network", answered from exactly the Explore read the person's own
 * screen uses, so Q never shows a pitch Explore would not.
 *
 * Authorization resolves before retrieval: the run must carry the actor's
 * network-visible scope, and the port then builds the pool through company
 * disclosure for this actor. Results carry only declared facts and the
 * profile link; no count, score or rank, and nothing founder-private.
 */

export const EXPLORE_PITCHES_LIKE = "explore.pitches_like" as const;
export const SEARCH_NETWORK = "explore.search_network" as const;

const PURPOSES: readonly QTaskClass[] = [
  "INVESTOR_QUESTION",
  "COUNTERPARTY_COMPANY_QUESTION",
  "OWN_COMPANY_QUESTION",
  "COMPARISON",
  "GENERAL_QUESTION",
];

export const ExploreToolPitchSchema = z
  .object({
    companyId: UuidSchema,
    companyName: z.string().max(200),
    pitchId: UuidSchema,
    title: z.string().max(200).nullable(),
    stageCode: z.string().max(64).nullable(),
    headquartersCountry: z.string().max(8).nullable(),
    /** Why Explore shows it (a tile's reason) or how it relates to the anchor. */
    reason: z.enum(EXPLORE_REASON_CODES).nullable(),
    related: z.array(z.enum(EXPLORE_RELATED_REASONS)).max(4),
    /** The profile: what a result opens, never a Q card. */
    profileHref: z.string().max(120),
  })
  .strict();
export type ExploreToolPitch = z.infer<typeof ExploreToolPitchSchema>;

export const ExploreToolCompanySchema = z
  .object({
    companyId: UuidSchema,
    companyName: z.string().max(200),
    shortDescription: z.string().max(600).nullable(),
    stageCode: z.string().max(64).nullable(),
    headquartersCountry: z.string().max(8).nullable(),
    profileHref: z.string().max(120),
  })
  .strict();
export type ExploreToolCompany = z.infer<typeof ExploreToolCompanySchema>;

/** The Explore read, for one actor. Implemented over the Explore service. */
export type ExploreToolPort = {
  /** Pitches like a company's; null when the viewer may not see that company. */
  readonly pitchesLike: (
    actor: ActorContext,
    query: {
      readonly companyId?: string | undefined;
      readonly companyName?: string | undefined;
      readonly limit: number;
    },
  ) => Promise<{
    readonly anchor: ExploreToolPitch;
    readonly items: readonly ExploreToolPitch[];
  } | null>;
  readonly searchNetwork: (
    actor: ActorContext,
    query: { readonly text: string; readonly limit: number },
  ) => Promise<{
    readonly companies: readonly ExploreToolCompany[];
    readonly pitches: readonly ExploreToolPitch[];
  }>;
};

export const ExplorePitchesLikeInputSchema = z
  .object({
    companyId: UuidSchema.optional().describe(
      "The company whose pitch the person means, when known from the conversation.",
    ),
    companyName: z
      .string()
      .min(2)
      .max(120)
      .optional()
      .describe(
        "The company's name as the person said it, when no id is known.",
      ),
    limit: z.number().int().min(1).max(12).default(6),
  })
  .strict()
  .refine((v) => v.companyId !== undefined || v.companyName !== undefined, {
    message: "a company id or name is required",
  });
export type ExplorePitchesLikeInput = z.infer<
  typeof ExplorePitchesLikeInputSchema
>;

export const ExplorePitchesLikeOutputSchema = z
  .object({
    found: z.boolean(),
    anchor: ExploreToolPitchSchema.nullable(),
    items: z.array(ExploreToolPitchSchema).max(12),
    /** Where the person can see these: Explore, opened on the anchor. */
    exploreHref: z.string().max(200),
  })
  .strict();
export type ExplorePitchesLikeOutput = z.infer<
  typeof ExplorePitchesLikeOutputSchema
>;

export const SearchNetworkInputSchema = z
  .object({
    query: z
      .string()
      .min(2)
      .max(80)
      .describe(
        "What to look for: a company name, a sector, a stage, a country, or a few of those words.",
      ),
    limit: z.number().int().min(1).max(20).default(8),
  })
  .strict();
export type SearchNetworkInput = z.infer<typeof SearchNetworkInputSchema>;

export const SearchNetworkOutputSchema = z
  .object({
    query: z.string().max(80),
    companies: z.array(ExploreToolCompanySchema).max(20),
    pitches: z.array(ExploreToolPitchSchema).max(20),
    exploreHref: z.string().max(200),
  })
  .strict();
export type SearchNetworkOutput = z.infer<typeof SearchNetworkOutputSchema>;

function networkScope(
  context: Parameters<Parameters<typeof defineQTool>[0]["authorize"]>[1],
) {
  return actorWideScope(context.plan, "NETWORK_VISIBLE_DATA");
}

export function createExploreTools(
  port: ExploreToolPort,
): readonly AnyQToolDefinition[] {
  const pitchesLike = defineQTool<
    ExplorePitchesLikeInput,
    ExplorePitchesLikeOutput,
    null
  >({
    id: EXPLORE_PITCHES_LIKE,
    version: 1,
    status: "ACTIVE",
    providerName: "explore_pitches_like",
    description:
      "Pitches on the Capital Q network like a given company's: the same founder's other pitches, then the same sector, stage or country, each saying which it shares. Call it when the person asks for pitches, companies or videos 'like X' or 'similar to X'. Only pitches this person may see are returned; say none were found rather than guessing. Point them to the profile link for each, never to a Q card.",
    classification: "READ_ONLY",
    riskClass: "SAFE_READ",
    requiredCapabilities: [],
    supportedPurposes: [...PURPOSES],
    requiredScopeKinds: ["NETWORK_VISIBLE_DATA"],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "q-tools",
    visibleStage: "COMPARING_OPPORTUNITIES",
    input: ExplorePitchesLikeInputSchema,
    output: ExplorePitchesLikeOutputSchema,
    authorize: (_input, context) => {
      const network = networkScope(context);
      return Promise.resolve(
        network === undefined
          ? deny<null>("NOT_AVAILABLE")
          : allow<null>(network.sensitivity, null),
      );
    },
    execute: async (input, context) => {
      const found = await port
        .pitchesLike(context.actor, {
          companyId: input.companyId,
          companyName: input.companyName,
          limit: input.limit,
        })
        .catch(() => null);
      return {
        found: found !== null,
        anchor: found?.anchor ?? null,
        items: [...(found?.items ?? [])].slice(0, input.limit),
        exploreHref: "/explore",
      };
    },
  });

  const searchNetwork = defineQTool<
    SearchNetworkInput,
    SearchNetworkOutput,
    null
  >({
    id: SEARCH_NETWORK,
    version: 1,
    status: "ACTIVE",
    providerName: "search_network",
    description:
      "Searches the Capital Q network the way Explore's search does: companies and their pitches whose name, line, declared stage or country match, among what this person may see. Call it when the person asks to find or search for companies or pitches on the network ('find seed fintech in Kenya'). Results come from the index, not from your own knowledge; each opens its profile.",
    classification: "READ_ONLY",
    riskClass: "SAFE_READ",
    requiredCapabilities: [],
    supportedPurposes: [...PURPOSES],
    requiredScopeKinds: ["NETWORK_VISIBLE_DATA"],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "q-tools",
    visibleStage: "COMPARING_OPPORTUNITIES",
    input: SearchNetworkInputSchema,
    output: SearchNetworkOutputSchema,
    authorize: (_input, context) => {
      const network = networkScope(context);
      return Promise.resolve(
        network === undefined
          ? deny<null>("NOT_AVAILABLE")
          : allow<null>(network.sensitivity, null),
      );
    },
    execute: async (input, context) => {
      const text = input.query.trim().slice(0, 80);
      const found = await port
        .searchNetwork(context.actor, { text, limit: input.limit })
        .catch(() => ({ companies: [], pitches: [] }));
      return {
        query: text,
        companies: [...found.companies].slice(0, input.limit),
        pitches: [...found.pitches].slice(0, input.limit),
        exploreHref: `/explore?${new URLSearchParams({ q: text }).toString()}`,
      };
    },
  });

  return [pitchesLike, searchNetwork];
}
